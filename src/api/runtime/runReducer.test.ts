import assert from 'node:assert/strict';
import test from 'node:test';
import { createRunState, reduceRunEvent } from './runReducer.ts';

test('deduplicates replayed stream ids and pauses for HITL', () => {
  const initial = createRunState('run-1', 'thread-1');
  const started = reduceRunEvent(initial, { streamId: '1', event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'assistant-1', delta: 'A' } });
  const replayed = reduceRunEvent(started, { streamId: '1', event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'assistant-1', delta: 'A' } });
  const paused = reduceRunEvent(replayed, { streamId: '2', event: { type: 'ACTIVITY_SNAPSHOT', messageId: 'hitl-1', activityType: 'agentDock.hitl', content: { requestId: 'request-1' } } });
  assert.equal(paused.messages['assistant-1'].content, 'A');
  assert.equal(paused.status, 'paused');
});

test('collects render_a2ui tool arguments as a surface', () => {
  let state = createRunState('run-2', 'thread-2');
  state = reduceRunEvent(state, { streamId: '1', event: { type: 'TOOL_CALL_START', toolCallId: 'tool-1', toolCallName: 'render_a2ui' } });
  state = reduceRunEvent(state, { streamId: '2', event: { type: 'TOOL_CALL_ARGS', toolCallId: 'tool-1', delta: '{"surfaceId":"surface-1","components":[]}' } });
  state = reduceRunEvent(state, { streamId: '3', event: { type: 'TOOL_CALL_END', toolCallId: 'tool-1' } });
  assert.deepEqual(state.surfaces['surface-1'], { surfaceId: 'surface-1', components: [] });
});

test('tracks workflow step lifecycle from STEP events', () => {
  let state = createRunState('run-3', 'thread-3');
  state = reduceRunEvent(state, { streamId: '1', event: { type: 'STEP_STARTED', stepId: 'plan', stepName: '规划' } });
  assert.equal(state.steps['plan'].status, 'running');
  assert.equal(state.steps['plan'].name, '规划');
  assert.deepEqual(state.orderedBlocks, [{ id: 'plan', kind: 'step' }]);
  state = reduceRunEvent(state, { streamId: '2', event: { type: 'STEP_FINISHED', stepId: 'plan' } });
  assert.equal(state.steps['plan'].status, 'completed');
  assert.ok(state.steps['plan'].finishedAt);
});

test('ignores system/developer context messages in MESSAGES_SNAPSHOT', () => {
  let state = createRunState('run-snap-1', 'thread-snap-1');
  state = reduceRunEvent(state, {
    streamId: '1',
    event: {
      type: 'MESSAGES_SNAPSHOT',
      messages: [
        { id: 'user-1', role: 'user', content: 'hi' },
        { id: 'ctx-1', role: 'system', content: 'App Context: [A2UI catalog]' },
        { id: 'assistant-1', role: 'assistant', content: 'Hello!' },
      ],
    },
  });
  assert.deepEqual(Object.keys(state.messages).sort(), ['assistant-1', 'user-1']);
  assert.equal(state.messages['ctx-1'], undefined);
});

test('drops CopilotKit internal duplicate message ids from MESSAGES_SNAPSHOT', () => {
  let state = createRunState('run-snap-2', 'thread-snap-2');
  // 流式阶段先产生 lc_run-- 占位消息
  state = reduceRunEvent(state, {
    streamId: '1',
    event: { type: 'TEXT_MESSAGE_START', messageId: 'lc_run--01a01afa-5bd9', role: 'assistant' },
  });
  state = reduceRunEvent(state, {
    streamId: '2',
    event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'lc_run--01a01afa-5bd9', delta: 'Hi!' },
  });
  state = reduceRunEvent(state, {
    streamId: '3',
    event: {
      type: 'MESSAGES_SNAPSHOT',
      messages: [
        { id: 'user-2', role: 'user', content: 'hi' },
        { id: 'assistant-2', role: 'assistant', content: 'Hi!' },
      ],
    },
  });
  // 快照用规范 UUID 替换流式占位：同一回复只剩一个 id
  assert.deepEqual(Object.keys(state.messages).sort(), ['assistant-2', 'user-2']);
  assert.equal(state.messages['lc_run--01a01afa-5bd9'], undefined);
});

test('快照先于流式完成到达：规范 UUID 按角色替换部分内容占位，不产生双气泡', () => {
  let state = createRunState('run-snap-3', 'thread-snap-3');
  // 流式阶段只输出了一部分（“我”），快照携带规范 UUID + 完整内容
  state = reduceRunEvent(state, {
    streamId: '1',
    event: { type: 'TEXT_MESSAGE_START', messageId: 'lc_run--part-1', role: 'assistant' },
  });
  state = reduceRunEvent(state, {
    streamId: '2',
    event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'lc_run--part-1', delta: '我' },
  });
  state = reduceRunEvent(state, {
    streamId: '3',
    event: {
      type: 'MESSAGES_SNAPSHOT',
      messages: [
        { id: 'user-3', role: 'user', content: '天气如何' },
        { id: 'assistant-3', role: 'assistant', content: '我目前无法获取实时天气数据。' },
      ],
    },
  });
  assert.deepEqual(Object.keys(state.messages).sort(), ['assistant-3', 'user-3']);
  assert.equal(state.messages['lc_run--part-1'], undefined);
  assert.equal(state.messages['assistant-3'].content, '我目前无法获取实时天气数据。');
  // 时间线里只有规范 id，没有占位 id
  assert.deepEqual(state.messageOrder, ['user-3', 'assistant-3']);
});

test('records per-message streamId and dedupes replay', () => {
  let state = createRunState('run-4', 'thread-4');
  state = reduceRunEvent(state, { streamId: '1', event: { type: 'TEXT_MESSAGE_START', messageId: 'assistant-4', role: 'assistant' } });
  state = reduceRunEvent(state, { streamId: '2', event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'assistant-4', delta: 'A' } });
  assert.equal(state.messages['assistant-4'].streamId, '2');
  // 重放同一 streamId 应被去重，不重复拼接
  state = reduceRunEvent(state, { streamId: '2', event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'assistant-4', delta: 'A' } });
  assert.equal(state.messages['assistant-4'].content, 'A');
  assert.equal(state.latestStreamId, '2');
  assert.deepEqual(state.processedStreamIds, ['1', '2']);
});

test('tracks reasoning streaming state and duration across REASONING events', () => {
  let state = createRunState('run-5', 'thread-5');
  state = reduceRunEvent(state, { streamId: '1', event: { type: 'REASONING_MESSAGE_START', messageId: 'reasoning-5' } });
  assert.equal(state.reasoningMeta['reasoning-5'].streaming, true);
  assert.ok(state.reasoningMeta['reasoning-5'].startedAt);
  state = reduceRunEvent(state, { streamId: '2', event: { type: 'REASONING_MESSAGE_CONTENT', messageId: 'reasoning-5', delta: '分析中' } });
  assert.equal(state.reasoning['reasoning-5'], '分析中');
  assert.equal(state.reasoningMeta['reasoning-5'].streaming, true);
  state = reduceRunEvent(state, { streamId: '3', event: { type: 'REASONING_MESSAGE_END', messageId: 'reasoning-5' } });
  assert.equal(state.reasoningMeta['reasoning-5'].streaming, false);
  assert.ok(state.reasoningMeta['reasoning-5'].finishedAt);
  assert.deepEqual(state.orderedBlocks, [{ id: 'reasoning-5', kind: 'reasoning' }]);
});

test('records tool call timing, apiName and result message id', () => {
  let state = createRunState('run-6', 'thread-6');
  state = reduceRunEvent(state, { streamId: '1', event: { type: 'TOOL_CALL_START', toolCallId: 'tool-6', toolCallName: 'flightData.queryMetrics', apiName: 'flightData.queryMetrics' } });
  assert.equal(state.toolCalls['tool-6'].status, 'running');
  assert.equal(state.toolCalls['tool-6'].apiName, 'flightData.queryMetrics');
  assert.ok(state.toolCalls['tool-6'].startedAt);
  state = reduceRunEvent(state, { streamId: '2', event: { type: 'TOOL_CALL_END', toolCallId: 'tool-6' } });
  assert.equal(state.toolCalls['tool-6'].status, 'called');
  assert.ok(state.toolCalls['tool-6'].finishedAt);
  state = reduceRunEvent(state, { streamId: '3', event: { type: 'TOOL_CALL_RESULT', toolCallId: 'tool-6', content: { ok: true }, result_msg_id: 'result-6' } });
  assert.equal(state.toolCalls['tool-6'].status, 'completed');
  assert.equal(state.toolCalls['tool-6'].resultMsgId, 'result-6');
  assert.deepEqual(state.toolCalls['tool-6'].result, { ok: true });
  assert.ok(state.toolCalls['tool-6'].finishedAt);
});

test('projects company custom events into activity blocks (supervisor/groupTasks/tasks)', () => {
  let state = createRunState('run-7', 'thread-7');
  state = reduceRunEvent(state, { streamId: '1', event: { type: 'CUSTOM_EVENT', name: 'agentDock.supervisor', messageId: 'supervisor-7', value: { description: 'Supervisor 汇总' } } });
  state = reduceRunEvent(state, { streamId: '2', event: { type: 'CUSTOM_EVENT', name: 'agentDock.groupTasks', messageId: 'group-tasks-7', value: { description: '群组任务' } } });
  state = reduceRunEvent(state, { streamId: '3', event: { type: 'CUSTOM_EVENT', name: 'agentDock.tasks', messageId: 'tasks-7', value: { description: '子任务' } } });
  assert.equal(state.activities['supervisor-7'].activityType, 'agentDock.supervisor');
  assert.equal(state.activities['supervisor-7'].description, 'Supervisor 汇总');
  assert.equal(state.activities['group-tasks-7'].activityType, 'agentDock.groupTasks');
  assert.equal(state.activities['tasks-7'].activityType, 'agentDock.tasks');
  assert.deepEqual(state.orderedBlocks, [
    { id: 'supervisor-7', kind: 'activity' },
    { id: 'group-tasks-7', kind: 'activity' },
    { id: 'tasks-7', kind: 'activity' },
  ]);
});

test('projects legacy on_interrupt custom event as a HITL pause', () => {
  let state = createRunState('run-8', 'thread-8');
  state = reduceRunEvent(state, { streamId: '1', event: { type: 'CUSTOM_EVENT', name: 'on_interrupt', value: { id: 'request-8', message: '需要确认' } } });
  assert.equal(state.status, 'paused');
  assert.equal(state.activities['hitl-request-8'].activityType, 'agentDock.hitl');
  assert.equal(state.activities['hitl-request-8'].requestId, 'request-8');
});

test('projects LobeHub task roles from MESSAGES_SNAPSHOT as activity blocks', () => {
  let state = createRunState('run-9', 'thread-9');
  state = reduceRunEvent(state, {
    streamId: '1',
    event: {
      type: 'MESSAGES_SNAPSHOT',
      messages: [
        { id: 'user-9', role: 'user', content: 'hi' },
        { id: 'task-9', role: 'task', content: '读取数据' },
        { id: 'supervisor-9', role: 'supervisor', content: '汇总' },
        { id: 'assistant-9', role: 'assistant', content: '完成' },
      ],
    },
  });
  assert.equal(state.messages['user-9'].content, 'hi');
  assert.equal(state.messages['assistant-9'].content, '完成');
  assert.equal(state.activities['task-9'].activityType, 'agentDock.task');
  assert.equal(state.activities['supervisor-9'].activityType, 'agentDock.supervisor');
  assert.equal(Object.keys(state.messages).length, 2);
});

test('ACTIVITY_SNAPSHOT stores activityType alongside content for live rendering', () => {
  let state = createRunState('run-10', 'thread-10');
  state = reduceRunEvent(state, {
    streamId: '1',
    event: {
      type: 'ACTIVITY_SNAPSHOT',
      messageId: 'task-10',
      activityType: 'agentDock.task',
      content: { status: 'completed', fab: 'F15B' },
    },
  });
  assert.equal(state.activities['task-10'].activityType, 'agentDock.task');
  assert.equal(state.activities['task-10'].status, 'completed');
  assert.deepEqual(state.orderedBlocks, [{ id: 'task-10', kind: 'activity' }]);
});
