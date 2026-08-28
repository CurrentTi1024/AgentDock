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

test('a2ui.surface 活动与 render_a2ui 工具共用逻辑 surfaceId，不重复创建 surface', () => {
  // 工具先到：创建 components 版 surface
  let state = createRunState('run-2b', 'thread-2b');
  state = reduceRunEvent(state, { eventId: '1', event: { type: 'TOOL_CALL_START', toolCallId: 'tool-2', toolCallName: 'render_a2ui' } });
  state = reduceRunEvent(state, { eventId: '2', event: { type: 'TOOL_CALL_ARGS', toolCallId: 'tool-2', delta: '{"surfaceId":"dashboard","components":[]}' } });
  state = reduceRunEvent(state, { eventId: '3', event: { type: 'TOOL_CALL_END', toolCallId: 'tool-2' } });
  assert.deepEqual(Object.keys(state.surfaces), ['dashboard']);
  // 活动后到：ops 版覆盖 components 版，键不变、orderedBlocks 不重复
  state = reduceRunEvent(state, {
    eventId: '4',
    event: {
      type: 'ACTIVITY_SNAPSHOT',
      messageId: 'a2ui-surface-call',
      activityType: 'a2ui.surface',
      surfaceId: 'a2ui-surface-call',
      content: { a2ui_operations: [{ version: 'v0.9', createSurface: { surfaceId: 'dashboard', catalogId: 'catalog' } }] },
    },
  });
  assert.deepEqual(Object.keys(state.surfaces), ['dashboard']);
  assert.ok((state.surfaces['dashboard'] as { a2ui_operations?: unknown }).a2ui_operations);
  assert.equal(state.orderedBlocks.filter((block) => block.kind === 'surface').length, 1);
  // 反序：活动先到，工具后到时不覆盖 ops 版也不新增块
  state = createRunState('run-2c', 'thread-2c');
  state = reduceRunEvent(state, { eventId: '1', event: { type: 'ACTIVITY_SNAPSHOT', messageId: 'a2ui-1', activityType: 'a2ui.surface', surfaceId: 'a2ui-1', content: { a2ui_operations: [{ version: 'v0.9', createSurface: { surfaceId: 'dash', catalogId: 'catalog' } }] } } });
  state = reduceRunEvent(state, { eventId: '2', event: { type: 'TOOL_CALL_START', toolCallId: 'tool-3', toolCallName: 'render_a2ui' } });
  state = reduceRunEvent(state, { eventId: '3', event: { type: 'TOOL_CALL_ARGS', toolCallId: 'tool-3', delta: '{"surfaceId":"dash","components":[]}' } });
  state = reduceRunEvent(state, { eventId: '4', event: { type: 'TOOL_CALL_END', toolCallId: 'tool-3' } });
  assert.deepEqual(Object.keys(state.surfaces), ['dash']);
  assert.ok((state.surfaces['dash'] as { a2ui_operations?: unknown }).a2ui_operations);
  assert.equal(state.orderedBlocks.filter((block) => block.kind === 'surface').length, 1);
});

test('a2ui.surface 中间态（building/progress）不建 surface 行，最终 ops 到达才渲染', () => {
  let state = createRunState('run-2d', 'thread-2d');
  // 中间态：无 a2ui_operations / components
  state = reduceRunEvent(state, {
    eventId: '1',
    event: {
      type: 'ACTIVITY_SNAPSHOT',
      messageId: 'a2ui-surface-call_00_x',
      activityType: 'a2ui.surface',
      content: { status: 'building', progressTokens: 548 },
    },
  });
  assert.equal(Object.keys(state.surfaces).length, 0);
  assert.equal(state.orderedBlocks.filter((block) => block.kind === 'surface').length, 0);
  // 最终 ops 到达：创建 surface 行
  state = reduceRunEvent(state, {
    eventId: '2',
    event: {
      type: 'ACTIVITY_SNAPSHOT',
      messageId: 'a2ui-surface-call_00_x',
      activityType: 'a2ui.surface',
      content: { a2ui_operations: [{ version: 'v0.9', createSurface: { surfaceId: 'ticket', catalogId: 'catalog' } }] },
    },
  });
  assert.deepEqual(Object.keys(state.surfaces), ['ticket']);
  assert.equal(state.orderedBlocks.filter((block) => block.kind === 'surface').length, 1);
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

test('MESSAGES_SNAPSHOT live 投影只保留最近 200 条可见消息', () => {
  const state = reduceRunEvent(createRunState('run-bounded-snapshot', 'thread-bounded'), {
    eventId: 'snapshot-bounded-1',
    event: {
      messages: [
        { content: 'hidden', id: 'system-hidden', role: 'system' },
        ...Array.from({ length: 250 }, (_, index) => ({
          content: `message-${index}`,
          id: `message-${index}`,
          role: index % 2 === 0 ? 'user' : 'assistant',
        })),
      ],
      type: 'MESSAGES_SNAPSHOT',
    },
  });

  assert.equal(state.messageOrder.length, 200);
  assert.equal(Object.keys(state.messages).length, 200);
  assert.equal(state.messageOrder[0], 'message-50');
  assert.equal(state.messageOrder.at(-1), 'message-249');
  assert.equal(state.messages['system-hidden'], undefined);
});

test('连续 MESSAGES_SNAPSHOT 会淘汰旧快照项而不是跨事件无限累积', () => {
  let state = createRunState('run-repeated-snapshot', 'thread-repeated');
  state = reduceRunEvent(state, {
    eventId: 'repeated-1',
    event: {
      messages: Array.from({ length: 200 }, (_, index) => ({
        content: `old-${index}`,
        id: `old-${index}`,
        role: index === 0 ? 'tasks' : index % 2 === 0 ? 'user' : 'assistant',
      })),
      type: 'MESSAGES_SNAPSHOT',
    },
  });
  state.messages['local-current-user'] = {
    content: 'current question',
    id: 'local-current-user',
    role: 'user',
  };
  state.messageOrder.push('local-current-user');
  state = reduceRunEvent(state, {
    eventId: 'repeated-2',
    event: {
      messages: Array.from({ length: 200 }, (_, index) => ({
        content: `new-${index}`,
        id: `new-${index}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
      })),
      type: 'MESSAGES_SNAPSHOT',
    },
  });

  assert.equal(state.messageOrder.length, 201);
  assert.equal(Object.keys(state.messages).length, 201);
  assert.equal(state.messages['old-199'], undefined);
  assert.equal(state.messages['local-current-user']?.content, 'current question');
  assert.equal(state.activities['old-0'], undefined);
  assert.equal(state.orderedBlocks.some((block) => block.id === 'old-0'), false);
  assert.equal(state.messages['new-199']?.content, 'new-199');
});

test('rawEvents 仅保留小型诊断元数据，不复制大 payload 或 AG-UI state', () => {
  const huge = 'x'.repeat(100_000);
  let state = reduceRunEvent(createRunState('run-compact-raw', 'thread-compact-raw'), {
    eventId: 'compact-raw-1',
    event: {
      messageId: 'assistant-compact-raw',
      messages: [{ content: huge, id: 'large-message', role: 'assistant' }],
      snapshot: { huge },
      type: 'MESSAGES_SNAPSHOT',
    },
  });
  state = reduceRunEvent(state, {
    eventId: 'compact-raw-2',
    event: { snapshot: { huge }, type: 'STATE_SNAPSHOT' },
  });

  assert.deepEqual(state.rawEvents[0], {
    eventId: 'compact-raw-1',
    messageCount: 1,
    messageId: 'assistant-compact-raw',
    type: 'MESSAGES_SNAPSHOT',
  });
  assert.equal(JSON.stringify(state.rawEvents).length < 500, true);
  assert.equal(state.state, undefined);
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

test('assistant narration/text participates in orderedBlocks with tools in arrival order', () => {
  let state = createRunState('run-text-order', 'thread-text-order');
  state = reduceRunEvent(state, { eventId: '1', event: { type: 'TEXT_MESSAGE_START', messageId: 'assistant-intro', role: 'assistant' } });
  state = reduceRunEvent(state, { eventId: '2', event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'assistant-intro', delta: '我先查询数据。' } });
  state = reduceRunEvent(state, { eventId: '3', event: { type: 'TEXT_MESSAGE_END', messageId: 'assistant-intro' } });
  state = reduceRunEvent(state, { eventId: '4', event: { type: 'TOOL_CALL_START', toolCallId: 'tool-between', toolCallName: 'weather.search' } });
  state = reduceRunEvent(state, { eventId: '5', event: { type: 'TOOL_CALL_END', toolCallId: 'tool-between' } });
  state = reduceRunEvent(state, { eventId: '6', event: { type: 'TEXT_MESSAGE_START', messageId: 'assistant-final', role: 'assistant' } });
  state = reduceRunEvent(state, { eventId: '7', event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'assistant-final', delta: '查询完成。' } });
  assert.deepEqual(state.orderedBlocks, [
    { id: 'assistant-intro', kind: 'text' },
    { id: 'tool-between', kind: 'tool' },
    { id: 'assistant-final', kind: 'text' },
  ]);
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

test('preserves every LobeHub visible message role from MESSAGES_SNAPSHOT', () => {
  let state = createRunState('run-9', 'thread-9');
  const visibleRoles = [
    'user',
    'assistant',
    'assistantGroup',
    'supervisor',
    'task',
    'tasks',
    'groupTasks',
    'agentCouncil',
    'compressedGroup',
    'tool',
    'verify',
    'taskCallback',
  ] as const;
  state = reduceRunEvent(state, {
    eventId: '1',
    event: {
      type: 'MESSAGES_SNAPSHOT',
      messages: visibleRoles.map((role) => ({
        content: role,
        id: `${role}-9`,
        metadata: { source: 'snapshot' },
        role,
      })),
    },
  });
  assert.deepEqual(state.messageOrder, visibleRoles.map((role) => `${role}-9`));
  for (const role of visibleRoles) {
    assert.equal(state.messages[`${role}-9`].role, role);
    assert.deepEqual(state.messages[`${role}-9`].metadata, { source: 'snapshot' });
  }
  assert.equal(state.messages['task-9'].role, 'task');
  assert.equal(state.messages['supervisor-9'].role, 'supervisor');
  assert.equal(state.messages['assistant-9'].content, 'assistant');
  assert.equal(state.activities['task-9'].activityType, 'agentDock.task');
  assert.equal(state.activities['task-9'].diagnosticOnly, true);
  assert.equal(state.activities['supervisor-9'].activityType, 'agentDock.supervisor');
  assert.equal(Object.keys(state.messages).length, visibleRoles.length);
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

test('standalone ACTIVITY_DELTA preserves top-level activityType for task-card rendering', () => {
  const state = reduceRunEvent(createRunState('run-activity-delta', 'thread-activity-delta'), {
    eventId: 'activity-delta-1',
    event: {
      activityType: 'company.longRunningTask',
      patch: [
        { op: 'add', path: '/description', value: '正在查询业务数据' },
        { op: 'add', path: '/progress', value: { current: 1, labels: ['查询'] } },
        { op: 'replace', path: '/progress/current', value: 2 },
        { op: 'add', path: '/progress/labels/-', value: '分析' },
        { op: 'add', path: '/status', value: 'running' },
        { op: 'add', path: '/__proto__/polluted', value: true },
      ],
      messageId: 'company-task-1',
      type: 'ACTIVITY_DELTA',
    },
  });

  assert.deepEqual(state.activities['company-task-1'], {
    activityType: 'company.longRunningTask',
    description: '正在查询业务数据',
    messageId: 'company-task-1',
    progress: { current: 2, labels: ['查询', '分析'] },
    status: 'running',
  });
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
  assert.deepEqual(state.orderedBlocks, [{ id: 'company-task-1', kind: 'activity' }]);
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

test('RUN_ERROR：同时投影 agentDock.error 活动（供 LobeHub 错误卡渲染与持久化）', () => {
  let state = createRunState('run-error-2b', 'thread-error-2b');
  state = reduceRunEvent(state, {
    eventId: '1',
    event: {
      code: 'NETWORK_ERROR',
      message: 'connection lost',
      runId: 'run-error-2b',
      threadId: 'thread-error-2b',
      type: 'RUN_ERROR',
    },
  });
  const activity = state.activities['error-run-error-2b'];
  assert.equal(activity?.activityType, 'agentDock.error');
  assert.equal(activity?.message, 'connection lost');
  assert.equal(activity?.code, 'NETWORK_ERROR');
  assert.ok(
    state.orderedBlocks.some(
      (block) => block.kind === 'activity' && block.id === 'error-run-error-2b',
    ),
    '错误活动进入 orderedBlocks，历史渲染可识别',
  );
  // 用户主动取消（CANCELLED）不伪造错误活动
  state = reduceRunEvent(createRunState('run-error-2c', 'thread-error-2c'), {
    eventId: '1',
    event: {
      code: 'CANCELLED',
      message: 'cancelled',
      runId: 'run-error-2c',
      threadId: 'thread-error-2c',
      type: 'RUN_ERROR',
    },
  });
  assert.equal(Object.keys(state.activities).length, 0);
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

test('连续三轮错误：每轮 MESSAGES_SNAPSHOT 累积，顺序 Q1A1Q2A2Q3A3 不吞不重', () => {
  const rounds = [
    { err: 'err1', q: 'q1', runId: 'e-run-1' },
    { err: 'err2', q: 'q2', runId: 'e-run-2' },
    { err: 'err3', q: 'q3', runId: 'e-run-3' },
  ];
  let prior: Array<{ content: string; id: string; role: 'assistant' | 'user' }> = [];
  for (const { err, q, runId } of rounds) {
    let state = createRunState(runId, 'thread-multi3');
    state = reduceRunEvent(state, { eventId: `${runId}-1`, event: { type: 'RUN_STARTED', threadId: state.threadId, runId } });
    if (prior.length) {
      state = reduceRunEvent(state, { eventId: `${runId}-2`, event: { type: 'MESSAGES_SNAPSHOT', messages: prior } });
    }
    state = reduceRunEvent(state, { eventId: `${runId}-3`, event: { type: 'TEXT_MESSAGE_START', messageId: q, role: 'user' } });
    state = reduceRunEvent(state, {
      eventId: `${runId}-4`,
      event: { code: 'BACKEND_ERROR', message: err, runId, threadId: state.threadId, type: 'RUN_ERROR' },
    });
    const expected = [...prior.map((message) => message.id), q, `error-${runId}`];
    assert.deepEqual(state.messageOrder, expected, `${runId} 轮消息顺序正确`);
    assert.equal(state.messages[`error-${runId}`].content, err, '本轮错误内容独立');
    assert.equal(new Set(state.messageOrder).size, state.messageOrder.length, '无重复消息 id');
    prior = expected.map((id) => ({
      content: state.messages[id]?.content ?? '',
      id,
      role: id === q ? 'user' : 'assistant',
    }));
  }
  assert.deepEqual(
    prior.map((message) => message.id),
    ['q1', 'error-e-run-1', 'q2', 'error-e-run-2', 'q3', 'error-e-run-3'],
    '三轮错误最终顺序 Q1A1Q2A2Q3A3',
  );
});
