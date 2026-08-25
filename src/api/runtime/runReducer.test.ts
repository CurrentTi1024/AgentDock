import assert from 'node:assert/strict';
import test from 'node:test';
import { createRunState, reduceRunEvent } from './runReducer.ts';

test('deduplicates replayed event ids and pauses for HITL', () => {
  const initial = createRunState('run-1', 'thread-1');
  const started = reduceRunEvent(initial, { eventId: '1', event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'assistant-1', delta: 'A' } });
  const replayed = reduceRunEvent(started, { eventId: '1', event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'assistant-1', delta: 'A' } });
  const paused = reduceRunEvent(replayed, { eventId: '2', event: { type: 'ACTIVITY_SNAPSHOT', messageId: 'hitl-1', activityType: 'agentDock.hitl', content: { requestId: 'request-1' } } });
  assert.equal(paused.messages['assistant-1'].content, 'A');
  assert.equal(paused.status, 'paused');
});

test('collects render_a2ui tool arguments as a surface', () => {
  let state = createRunState('run-2', 'thread-2');
  state = reduceRunEvent(state, { eventId: '1', event: { type: 'TOOL_CALL_START', toolCallId: 'tool-1', toolCallName: 'render_a2ui' } });
  state = reduceRunEvent(state, { eventId: '2', event: { type: 'TOOL_CALL_ARGS', toolCallId: 'tool-1', delta: '{"surfaceId":"surface-1","components":[]}' } });
  state = reduceRunEvent(state, { eventId: '3', event: { type: 'TOOL_CALL_END', toolCallId: 'tool-1' } });
  assert.deepEqual(state.surfaces['surface-1'], { surfaceId: 'surface-1', components: [] });
});

test('tracks workflow step lifecycle from STEP events', () => {
  let state = createRunState('run-3', 'thread-3');
  state = reduceRunEvent(state, { eventId: '1', event: { type: 'STEP_STARTED', stepId: 'plan', stepName: '规划' } });
  assert.equal(state.steps['plan'].status, 'running');
  assert.equal(state.steps['plan'].name, '规划');
  assert.deepEqual(state.orderedBlocks, [{ id: 'plan', kind: 'step' }]);
  state = reduceRunEvent(state, { eventId: '2', event: { type: 'STEP_FINISHED', stepId: 'plan' } });
  assert.equal(state.steps['plan'].status, 'completed');
  assert.ok(state.steps['plan'].finishedAt);
});

test('ignores system/developer context messages in MESSAGES_SNAPSHOT', () => {
  let state = createRunState('run-snap-1', 'thread-snap-1');
  state = reduceRunEvent(state, {
    eventId: '1',
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
    eventId: '1',
    event: { type: 'TEXT_MESSAGE_START', messageId: 'lc_run--01a01afa-5bd9', role: 'assistant' },
  });
  state = reduceRunEvent(state, {
    eventId: '2',
    event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'lc_run--01a01afa-5bd9', delta: 'Hi!' },
  });
  state = reduceRunEvent(state, {
    eventId: '3',
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
    eventId: '1',
    event: { type: 'TEXT_MESSAGE_START', messageId: 'lc_run--part-1', role: 'assistant' },
  });
  state = reduceRunEvent(state, {
    eventId: '2',
    event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'lc_run--part-1', delta: '我' },
  });
  state = reduceRunEvent(state, {
    eventId: '3',
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

test('records per-message eventId and dedupes replay', () => {
  let state = createRunState('run-4', 'thread-4');
  state = reduceRunEvent(state, { eventId: '1', event: { type: 'TEXT_MESSAGE_START', messageId: 'assistant-4', role: 'assistant' } });
  state = reduceRunEvent(state, { eventId: '2', event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'assistant-4', delta: 'A' } });
  assert.equal(state.messages['assistant-4'].eventId, '2');
  // 重放同一 eventId 应被去重，不重复拼接
  state = reduceRunEvent(state, { eventId: '2', event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'assistant-4', delta: 'A' } });
  assert.equal(state.messages['assistant-4'].content, 'A');
  assert.equal(state.latestEventId, '2');
  assert.deepEqual(state.processedEventIds, ['1', '2']);
});

test('tracks reasoning streaming state and duration across REASONING events', () => {
  let state = createRunState('run-5', 'thread-5');
  state = reduceRunEvent(state, { eventId: '1', event: { type: 'REASONING_MESSAGE_START', messageId: 'reasoning-5' } });
  assert.equal(state.reasoningMeta['reasoning-5'].streaming, true);
  assert.ok(state.reasoningMeta['reasoning-5'].startedAt);
  state = reduceRunEvent(state, { eventId: '2', event: { type: 'REASONING_MESSAGE_CONTENT', messageId: 'reasoning-5', delta: '分析中' } });
  assert.equal(state.reasoning['reasoning-5'], '分析中');
  assert.equal(state.reasoningMeta['reasoning-5'].streaming, true);
  state = reduceRunEvent(state, { eventId: '3', event: { type: 'REASONING_MESSAGE_END', messageId: 'reasoning-5' } });
  assert.equal(state.reasoningMeta['reasoning-5'].streaming, false);
  assert.ok(state.reasoningMeta['reasoning-5'].finishedAt);
  assert.deepEqual(state.orderedBlocks, [{ id: 'reasoning-5', kind: 'reasoning' }]);
});

test('RUN_FINISHED / RUN_ERROR 兜底收尾所有 reasoning（thinking 完成后必定折叠）', () => {
  let state = createRunState('run-5b', 'thread-5b');
  state = reduceRunEvent(state, { eventId: '1', event: { type: 'REASONING_MESSAGE_START', messageId: 'reasoning-5b' } });
  assert.equal(state.reasoningMeta['reasoning-5b'].streaming, true);
  // 后端未发 REASONING_MESSAGE_END 直接结束：终态必须兜底置 false
  state = reduceRunEvent(state, { eventId: '2', event: { type: 'RUN_FINISHED', threadId: 'thread-5b', runId: 'run-5b' } });
  assert.equal(state.status, 'success');
  assert.equal(state.reasoningMeta['reasoning-5b'].streaming, false);
  assert.ok(state.reasoningMeta['reasoning-5b'].finishedAt);
  // RUN_ERROR 同样兜底
  state = createRunState('run-5c', 'thread-5c');
  state = reduceRunEvent(state, { eventId: '1', event: { type: 'REASONING_MESSAGE_START', messageId: 'reasoning-5c' } });
  state = reduceRunEvent(state, { eventId: '2', event: { type: 'RUN_ERROR', threadId: 'thread-5c', runId: 'run-5c', code: 'CANCELLED', message: 'cancelled' } });
  assert.equal(state.status, 'cancelled');
  assert.equal(state.reasoningMeta['reasoning-5c'].streaming, false);
});

test('records tool call timing, apiName and result message id', () => {
  let state = createRunState('run-6', 'thread-6');
  state = reduceRunEvent(state, { eventId: '1', event: { type: 'TOOL_CALL_START', toolCallId: 'tool-6', toolCallName: 'flightData.queryMetrics', apiName: 'flightData.queryMetrics' } });
  assert.equal(state.toolCalls['tool-6'].status, 'running');
  assert.equal(state.toolCalls['tool-6'].apiName, 'flightData.queryMetrics');
  assert.ok(state.toolCalls['tool-6'].startedAt);
  state = reduceRunEvent(state, { eventId: '2', event: { type: 'TOOL_CALL_END', toolCallId: 'tool-6' } });
  assert.equal(state.toolCalls['tool-6'].status, 'called');
  assert.ok(state.toolCalls['tool-6'].finishedAt);
  state = reduceRunEvent(state, { eventId: '3', event: { type: 'TOOL_CALL_RESULT', toolCallId: 'tool-6', content: { ok: true }, result_msg_id: 'result-6' } });
  assert.equal(state.toolCalls['tool-6'].status, 'completed');
  assert.equal(state.toolCalls['tool-6'].resultMsgId, 'result-6');
  assert.deepEqual(state.toolCalls['tool-6'].result, { ok: true });
  assert.ok(state.toolCalls['tool-6'].finishedAt);
});

test('projects company custom events into activity blocks (supervisor/groupTasks/tasks)', () => {
  let state = createRunState('run-7', 'thread-7');
  state = reduceRunEvent(state, { eventId: '1', event: { type: 'CUSTOM_EVENT', name: 'agentDock.supervisor', messageId: 'supervisor-7', value: { description: 'Supervisor 汇总' } } });
  state = reduceRunEvent(state, { eventId: '2', event: { type: 'CUSTOM_EVENT', name: 'agentDock.groupTasks', messageId: 'group-tasks-7', value: { description: '群组任务' } } });
  state = reduceRunEvent(state, { eventId: '3', event: { type: 'CUSTOM_EVENT', name: 'agentDock.tasks', messageId: 'tasks-7', value: { description: '子任务' } } });
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
  state = reduceRunEvent(state, { eventId: '1', event: { type: 'CUSTOM_EVENT', name: 'on_interrupt', value: { id: 'request-8', message: '需要确认' } } });
  assert.equal(state.status, 'paused');
  assert.equal(state.activities['hitl-request-8'].activityType, 'agentDock.hitl');
  assert.equal(state.activities['hitl-request-8'].requestId, 'request-8');
});

test('projects LobeHub task roles from MESSAGES_SNAPSHOT as activity blocks', () => {
  let state = createRunState('run-9', 'thread-9');
  state = reduceRunEvent(state, {
    eventId: '1',
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
    eventId: '1',
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

test('RUN_ERROR：真实错误生成 assistant 错误回复（最后一个 chunk）并置 error 元信息', () => {
  let state = createRunState('run-error-1', 'thread-error-1');
  state = reduceRunEvent(state, {
    eventId: '1',
    event: { type: 'TEXT_MESSAGE_START', messageId: 'assistant-partial', role: 'assistant' },
  });
  state = reduceRunEvent(state, {
    eventId: '2',
    event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'assistant-partial', delta: '分析中' },
  });
  state = reduceRunEvent(state, {
    eventId: '3',
    event: {
      code: 'FAB_UPSTREAM_ERROR',
      message: 'upstream exploded',
      runId: 'run-error-1',
      threadId: 'thread-error-1',
      type: 'RUN_ERROR',
    },
  });
  assert.equal(state.status, 'error');
  assert.deepEqual(state.error, { code: 'FAB_UPSTREAM_ERROR', message: 'upstream exploded' });
  // 已有部分回复时，错误文本追加为该 assistant 消息的最后一个 chunk。
  assert.equal(state.messages['assistant-partial'].content, '分析中\n\nupstream exploded');
  assert.equal(state.messageOrder.at(-1), 'assistant-partial');
});

test('RUN_ERROR：无部分回复时新建 error-<runId> assistant 消息（可持久化为历史）', () => {
  let state = createRunState('run-error-2', 'thread-error-2');
  state = reduceRunEvent(state, {
    eventId: '1',
    event: {
      code: 'NETWORK_ERROR',
      message: 'connection lost',
      runId: 'run-error-2',
      threadId: 'thread-error-2',
      type: 'RUN_ERROR',
    },
  });
  assert.equal(state.status, 'error');
  assert.equal(state.messages['error-run-error-2'].content, 'connection lost');
  assert.equal(state.messages['error-run-error-2'].role, 'assistant');
  assert.equal(state.messageOrder.at(-1), 'error-run-error-2');
});

test('RUN_ERROR CANCELLED（用户主动取消）：不伪造 assistant 回复', () => {
  const state = reduceRunEvent(createRunState('run-error-3', 'thread-error-3'), {
    eventId: '1',
    event: {
      code: 'CANCELLED',
      message: 'Run cancelled by user.',
      runId: 'run-error-3',
      threadId: 'thread-error-3',
      type: 'RUN_ERROR',
    },
  });
  assert.equal(state.status, 'cancelled');
  assert.equal(Object.keys(state.messages).length, 0, '取消不生成 assistant 消息');
});

test('多轮错误：第二轮 MESSAGES_SNAPSHOT 带入上一轮错误回复时，不串轮、顺序 Q1A1Q2A2', () => {
  // 第一轮：Q1 + 错误 A1（error-run-err-1）
  let run1 = createRunState('run-err-1', 'thread-multi-err');
  run1 = reduceRunEvent(run1, { eventId: '1', event: { type: 'RUN_STARTED', threadId: run1.threadId, runId: run1.runId } });
  run1 = reduceRunEvent(run1, { eventId: '2', event: { type: 'TEXT_MESSAGE_START', messageId: 'q1', role: 'user' } });
  run1 = reduceRunEvent(run1, {
    eventId: '3',
    event: { code: 'BACKEND_ERROR', message: 'err1', runId: run1.runId, threadId: run1.threadId, type: 'RUN_ERROR' },
  });
  assert.equal(run1.messages['error-run-err-1'].content, 'err1');
  assert.deepEqual(run1.messageOrder, ['q1', 'error-run-err-1']);

  // 第二轮：MESSAGES_SNAPSHOT 携带 [Q1, A1(err1), Q2]，随后本轮 RUN_ERROR
  let run2 = createRunState('run-err-2', 'thread-multi-err');
  run2 = reduceRunEvent(run2, { eventId: '10', event: { type: 'RUN_STARTED', threadId: run2.threadId, runId: run2.runId } });
  run2 = reduceRunEvent(run2, {
    eventId: '11',
    event: {
      type: 'MESSAGES_SNAPSHOT',
      messages: [
        { id: 'q1', role: 'user', content: 'Q1' },
        { id: 'error-run-err-1', role: 'assistant', content: 'err1' },
        { id: 'q2', role: 'user', content: 'Q2' },
      ],
    },
  });
  run2 = reduceRunEvent(run2, {
    eventId: '12',
    event: { code: 'BACKEND_ERROR', message: 'err2', runId: run2.runId, threadId: run2.threadId, type: 'RUN_ERROR' },
  });
  assert.deepEqual(
    run2.messageOrder,
    ['q1', 'error-run-err-1', 'q2', 'error-run-err-2'],
    '顺序必须 Q1 A1 Q2 A2',
  );
  assert.equal(run2.messages['error-run-err-1'].content, 'err1', '第一轮错误内容不被第二轮污染');
  assert.equal(run2.messages['error-run-err-2'].content, 'err2');
  assert.equal(run2.messages['error-run-err-2'].runId, 'run-err-2');
});
