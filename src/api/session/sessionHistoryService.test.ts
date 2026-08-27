import 'fake-indexeddb/auto';

import assert from 'node:assert/strict';
import test from 'node:test';

import Dexie from 'dexie';

import { createRunState, reduceRunEvent } from '../runtime/runReducer.ts';
import type { RunAgentInput, RuntimeRunState } from '../runtime/types.ts';
import {
  cancelPendingCheckpoint,
  flushRunCheckpoint,
  sessionDatabase,
  scheduleRunCheckpoint,
  sessionHistoryService,
  sweepTerminalCheckpoints,
} from './sessionHistoryService.ts';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 构造一条完整单 Agent 运行：用户消息 + 流式事件投影 + 终态。 */
const buildSingleAgentRun = (sessionId: string, runId: string): { input: RunAgentInput; snapshot: RuntimeRunState } => {
  const input: RunAgentInput = {
    context: [],
    forwardedProps: { action: 'run', agentId: 'flight-analysis', fab: 'F15B', sessionId },
    messages: [{ content: '今天数据如何', id: `user-${runId}`, role: 'user' }],
    runId,
    state: {},
    threadId: `thread-${sessionId}`,
    tools: [],
  };
  let state = createRunState(runId, `thread-${sessionId}`);
  state.messages[input.messages[0].id] = input.messages[0];
  state.messageOrder.push(input.messages[0].id);
  state = reduceRunEvent(state, { eventId: '1', event: { type: 'RUN_STARTED', threadId: state.threadId, runId } });
  state = reduceRunEvent(state, { eventId: '2', event: { type: 'STEP_STARTED', stepId: 'plan', stepName: 'plan' } });
  state = reduceRunEvent(state, { eventId: '3', event: { type: 'REASONING_MESSAGE_START', messageId: `reasoning-${runId}` } });
  state = reduceRunEvent(state, { eventId: '4', event: { type: 'REASONING_MESSAGE_CONTENT', messageId: `reasoning-${runId}`, delta: '校验输入并规划只读工具调用。' } });
  state = reduceRunEvent(state, { eventId: '5', event: { type: 'REASONING_MESSAGE_END', messageId: `reasoning-${runId}` } });
  state = reduceRunEvent(state, { eventId: '6', event: { type: 'TOOL_CALL_START', toolCallId: `tool-${runId}`, toolCallName: 'flightData.queryMetrics' } });
  state = reduceRunEvent(state, { eventId: '7', event: { type: 'TOOL_CALL_ARGS', toolCallId: `tool-${runId}`, delta: '{"fab":"F15B"}' } });
  state = reduceRunEvent(state, { eventId: '8', event: { type: 'TOOL_CALL_END', toolCallId: `tool-${runId}` } });
  state = reduceRunEvent(state, { eventId: '9', event: { type: 'TOOL_CALL_RESULT', toolCallId: `tool-${runId}`, content: { anomalies: 2, status: 'ok' } } });
  state = reduceRunEvent(state, { eventId: '10', event: { type: 'TEXT_MESSAGE_START', messageId: `assistant-${runId}`, role: 'assistant' } });
  state = reduceRunEvent(state, { eventId: '11', event: { type: 'TEXT_MESSAGE_CONTENT', messageId: `assistant-${runId}`, delta: '分析完成' } });
  state = reduceRunEvent(state, { eventId: '12', event: { type: 'TEXT_MESSAGE_END', messageId: `assistant-${runId}` } });
  state = reduceRunEvent(state, { eventId: '13', event: { type: 'ACTIVITY_SNAPSHOT', messageId: `surface-${runId}`, activityType: 'a2ui.surface', surfaceId: `surface-${runId}`, content: { catalogId: 'agentdock://catalog', components: [] } } });
  state = reduceRunEvent(state, { eventId: '14', event: { type: 'RUN_FINISHED', threadId: state.threadId, runId } });
  return { input, snapshot: state };
};

test('createSession 写入后可读，显式 id 幂等覆盖', async () => {
  await flushRunCheckpoint();
  const created = await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: 'session-persist-1',
    pinned: false,
    threadId: 'thread-persist-1',
    title: '持久化测试',
    type: 'agent',
    version: '2.1.0',
  });
  assert.equal(created.id, 'session-persist-1');
  const loaded = await sessionHistoryService.getSession('session-persist-1');
  assert.equal(loaded?.title, '持久化测试');
  assert.equal(loaded?.type, 'agent');
});

test('hasMessages：空会话为 false；落库用户/助手文本后为 true；仅过程块仍为 false', async () => {
  await flushRunCheckpoint();
  const sessionId = 'session-has-messages';
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId: `thread-${sessionId}`,
    title: '首条消息标题',
    type: 'agent',
    version: '2.1.0',
  });
  assert.equal(await sessionHistoryService.hasMessages(sessionId), false, '空会话无消息');

  // 只有过程块（tool/reasoning）不算可见文本消息
  await sessionHistoryService.appendMessages([
    { createdAt: new Date().toISOString(), id: 'tool:only', kind: 'tool', sessionId, sequence: 1 },
  ]);
  assert.equal(await sessionHistoryService.hasMessages(sessionId), false, '仅过程块不算首条消息');

  await sessionHistoryService.appendMessages([
    {
      content: '帮我分析一下今天的飞行试验数据',
      createdAt: new Date().toISOString(),
      id: 'text:first',
      kind: 'text',
      role: 'user',
      sessionId,
      sequence: 2,
    },
  ]);
  assert.equal(await sessionHistoryService.hasMessages(sessionId), true, '用户文本落库后为 true');
});

test('单 Agent 运行结束 flush 后：messages 落库、sessions 时间戳更新、终态不落 checkpoint', async () => {
  const sessionId = 'session-persist-run-1';
  const runId = 'run-persist-1';
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId: `thread-${sessionId}`,
    title: '单 Agent 落库',
    type: 'agent',
    version: '2.1.0',
  });
  const before = await sessionHistoryService.getSession(sessionId);

  const { input, snapshot } = buildSingleAgentRun(sessionId, runId);
  // 模拟 runStore.execute：流式事件期间只防抖调度，不立即写库
  scheduleRunCheckpoint(sessionId, input, snapshot);
  assert.equal((await sessionHistoryService.getLatestRun(sessionId))?.runId, undefined);
  // 运行结束显式 flush（对应 runStore 终态路径）
  await flushRunCheckpoint();

  const checkpoint = await sessionHistoryService.getLatestRun(sessionId);
  assert.equal(checkpoint, undefined, '终态不落 checkpoint：历史以 messages 表为准');

  const messages = await sessionHistoryService.getMessages(sessionId);
  const kinds = messages.map((record) => record.kind);
  assert.ok(kinds.includes('text'), '应有 text 消息');
  assert.ok(kinds.includes('reasoning'), '应有 reasoning 摘要');
  assert.ok(kinds.includes('tool'), '应有 tool 调用');
  assert.ok(kinds.includes('surface'), '应有 A2UI surface');
  const textRoles = messages.filter((record) => record.kind === 'text').map((record) => record.role);
  assert.ok(textRoles.includes('user'), '用户消息已落库');
  assert.ok(textRoles.includes('assistant'), '助手消息已落库');

  const after = await sessionHistoryService.getSession(sessionId);
  assert.ok(new Date(after!.updatedAt).getTime() >= new Date(before!.updatedAt).getTime(), 'sessions.updatedAt 应随落库更新');
});

test('LobeHub 扩展消息角色与结构化 payload 原样落库（不降级为 activity）', async () => {
  const sessionId = 'session-lobehub-message-roles';
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId: `thread-${sessionId}`,
    title: 'LobeHub 消息角色',
    type: 'agent',
  });
  let snapshot = createRunState('run-lobehub-message-roles', `thread-${sessionId}`);
  snapshot = reduceRunEvent(snapshot, {
    eventId: '1',
    event: {
      messages: [
        { content: '开始', id: 'user-role', role: 'user' },
        {
          content: '',
          id: 'tasks-role',
          role: 'tasks',
          tasks: [
            {
              content: '读取完成',
              id: 'nested-task',
              metadata: { taskTitle: '读取飞行数据' },
              role: 'task',
              taskDetail: { status: 'completed', totalSteps: 2, totalToolCalls: 1 },
            },
          ],
        },
        { content: '汇总结论', id: 'supervisor-role', metadata: { isSupervisor: true }, role: 'supervisor' },
      ],
      type: 'MESSAGES_SNAPSHOT',
    },
  });
  snapshot.status = 'success';
  await sessionHistoryService.persistRunSnapshot(sessionId, snapshot);

  const rows = await sessionHistoryService.getMessages(sessionId);
  const tasks = rows.find((record) => record.id === 'text:tasks-role');
  const supervisor = rows.find((record) => record.id === 'text:supervisor-role');
  assert.equal(tasks?.role, 'tasks');
  assert.equal(Array.isArray(tasks?.payload?.tasks), true);
  assert.equal(supervisor?.role, 'supervisor');
  assert.deepEqual(supervisor?.payload?.metadata, { isSupervisor: true });
  assert.equal(
    rows.some((record) => record.kind === 'activity' && record.id.includes('tasks-role')),
    false,
    'diagnosticOnly activity 不得落库造成重复显示',
  );
});

test('AssistantGroup 中间文本按 narration 落库，并与工具保持事件顺序', async () => {
  const sessionId = 'session-assistant-group-order';
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId: `thread-${sessionId}`,
    title: 'AssistantGroup 顺序',
    type: 'agent',
  });
  let snapshot = createRunState('run-assistant-group-order', `thread-${sessionId}`);
  snapshot.messages['user-order'] = { content: '查天气', id: 'user-order', role: 'user' };
  snapshot.messageOrder.push('user-order');
  snapshot = reduceRunEvent(snapshot, { eventId: '1', event: { type: 'TEXT_MESSAGE_START', messageId: 'intro-order', role: 'assistant' } });
  snapshot = reduceRunEvent(snapshot, { eventId: '2', event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'intro-order', delta: '我先搜索页面。' } });
  snapshot = reduceRunEvent(snapshot, { eventId: '3', event: { type: 'TOOL_CALL_START', toolCallId: 'tool-order', toolCallName: 'browser.search' } });
  snapshot = reduceRunEvent(snapshot, { eventId: '4', event: { type: 'TOOL_CALL_END', toolCallId: 'tool-order' } });
  snapshot = reduceRunEvent(snapshot, { eventId: '5', event: { type: 'TEXT_MESSAGE_START', messageId: 'final-order', role: 'assistant' } });
  snapshot = reduceRunEvent(snapshot, { eventId: '6', event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'final-order', delta: '搜索完成。' } });
  snapshot.status = 'success';
  await sessionHistoryService.persistRunSnapshot(sessionId, snapshot);

  const rows = await sessionHistoryService.getMessages(sessionId);
  assert.equal(rows.some((record) => record.id === 'text:intro-order'), false);
  assert.equal(rows.find((record) => record.id === 'text:final-order')?.content, '搜索完成。');
  assert.deepEqual(
    rows.filter((record) => record.kind !== 'text').map((record) => record.kind),
    ['narration', 'tool'],
  );
});

test('流式防抖：空闲 350ms 后自动落盘，无需手动 flush', async () => {
  const sessionId = 'session-persist-debounce';
  const runId = 'run-debounce';
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId: `thread-${sessionId}`,
    title: '防抖落库',
    type: 'agent',
    version: '2.1.0',
  });
  const { input, snapshot } = buildSingleAgentRun(sessionId, runId);
  scheduleRunCheckpoint(sessionId, input, snapshot);
  assert.equal((await sessionHistoryService.getLatestRun(sessionId))?.runId, undefined);
  // 留足余量：防抖 350ms，负载高时避免 500ms 紧贴边界造成偶发抖动。
  await wait(600);
  const messages = await sessionHistoryService.getMessages(sessionId);
  assert.ok(messages.some((record) => record.kind === 'text'), '防抖定时器到期后消息应自动落盘');
  assert.equal(await sessionHistoryService.getLatestRun(sessionId), undefined, '终态不落 checkpoint');
  await flushRunCheckpoint();
});

test('刷新后恢复：历史消息从 messages 表重建，终态无 checkpoint', async () => {
  const sessionId = 'session-persist-reload';
  const runId = 'run-reload';
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId: `thread-${sessionId}`,
    title: '刷新恢复',
    type: 'agent',
    version: '2.1.0',
  });
  const { input, snapshot } = buildSingleAgentRun(sessionId, runId);
  scheduleRunCheckpoint(sessionId, input, snapshot);
  await flushRunCheckpoint();

  // 模拟页面重新打开：重新读库
  const messages = await sessionHistoryService.getMessages(sessionId);
  const assistantText = messages.find(
    (record) => record.kind === 'text' && record.role === 'assistant',
  );
  assert.equal(assistantText?.content, '分析完成');
  const checkpoint = await sessionHistoryService.getLatestRun(sessionId);
  assert.equal(checkpoint, undefined, '终态不落 checkpoint');
});

test('会话/线程/run/流游标一致性：checkpoint、消息与 sessions 同键同值', async () => {
  const sessionId = 'session-invariants';
  const runId = 'run-invariants';
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId: `thread-${sessionId}`,
    title: '一致性测试',
    type: 'agent',
    version: '2.1.0',
  });
  const { input, snapshot } = buildSingleAgentRun(sessionId, runId);
  const runningSnapshot = { ...snapshot, status: 'running' as const };
  scheduleRunCheckpoint(sessionId, input, runningSnapshot);
  await flushRunCheckpoint();

  const checkpoint = await sessionHistoryService.getLatestRun(sessionId);
  assert.equal(checkpoint?.runId, runId);
  assert.equal(checkpoint?.sessionId, sessionId);
  assert.equal(checkpoint?.threadId, `thread-${sessionId}`);
  assert.equal(checkpoint?.latestEventId, snapshot.latestEventId);
  assert.equal(checkpoint?.snapshot.runId, runId);
  assert.equal(checkpoint?.snapshot.threadId, `thread-${sessionId}`);
  assert.ok(snapshot.processedEventIds.includes(snapshot.latestEventId!), 'latestEventId 应已去重集合收录');

  const messages = await sessionHistoryService.getMessages(sessionId);
  assert.ok(messages.length > 0);
  for (const record of messages) {
    assert.equal(record.sessionId, sessionId);
    assert.equal(record.runId, runId);
    if (record.eventId) {
      assert.ok(Number(record.eventId) <= Number(snapshot.latestEventId), '消息游标不得晚于 run 终态游标');
    }
  }
  const assistant = messages.find((record) => record.kind === 'text' && record.role === 'assistant');
  assert.equal(assistant?.eventId, '12', '助手文本应记录其最后一次更新的 eventId（TEXT_MESSAGE_END）');

  // 同一会话第二次 run：threadId 复用、runId 更新
  const runId2 = 'run-invariants-2';
  const second = buildSingleAgentRun(sessionId, runId2);
  scheduleRunCheckpoint(sessionId, second.input, { ...second.snapshot, status: 'running' as const });
  await flushRunCheckpoint();
  const checkpoint2 = await sessionHistoryService.getLatestRun(sessionId);
  assert.equal(checkpoint2?.runId, runId2);
  assert.equal(checkpoint2?.threadId, `thread-${sessionId}`, '同一会话所有 run 共用 threadId');
});

test('多会话隔离：消息与 checkpoint 不串库', async () => {
  const cases = [
    ['session-iso-a', 'run-iso-a'],
    ['session-iso-b', 'run-iso-b'],
  ] as const;
  for (const [sessionId, runId] of cases) {
    await sessionHistoryService.createSession({
      agentId: 'flight-analysis',
      agentName: 'FlightAnalysis_Agent',
      fab: 'F15B',
      id: sessionId,
      pinned: false,
      threadId: `thread-${sessionId}`,
      title: sessionId,
      type: 'agent',
      version: '2.1.0',
    });
    const { input, snapshot } = buildSingleAgentRun(sessionId, runId);
    scheduleRunCheckpoint(sessionId, input, { ...snapshot, status: 'running' as const });
    await flushRunCheckpoint();
  }
  for (const [sessionId, runId] of cases) {
    const messages = await sessionHistoryService.getMessages(sessionId);
    assert.ok(messages.length > 0);
    assert.ok(messages.every((record) => record.sessionId === sessionId && record.runId === runId), `${sessionId} 不应混入其他会话数据`);
    assert.equal((await sessionHistoryService.getLatestRun(sessionId))?.runId, runId);
  }
});

test('多轮 run 快照累积（MESSAGES_SNAPSHOT）后文本消息顺序保持时间线', async () => {
  await flushRunCheckpoint();
  const sessionId = 'session-multi-run-order';
  const threadId = `thread-${sessionId}`;
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId,
    title: sessionId,
    type: 'agent',
    version: '2.1.0',
  });

  const buildRun = (runId: string, user: { id: string; content: string }, assistantId: string, assistantDelta: string, prior: Array<{ id: string; role: 'user' | 'assistant'; content: string }>) => {
    let state = createRunState(runId, threadId);
    state.messages[user.id] = { id: user.id, role: 'user', content: user.content };
    state.messageOrder.push(user.id);
    if (prior.length) {
      state = reduceRunEvent(state, { event: { type: 'MESSAGES_SNAPSHOT', messages: prior } });
    }
    state = reduceRunEvent(state, { event: { type: 'TEXT_MESSAGE_START', messageId: assistantId, role: 'assistant' } });
    state = reduceRunEvent(state, { event: { type: 'TEXT_MESSAGE_CONTENT', messageId: assistantId, delta: assistantDelta } });
    state = reduceRunEvent(state, { event: { type: 'TEXT_MESSAGE_END', messageId: assistantId } });
    return state;
  };

  const inputFor = (runId: string, user: { id: string; content: string }) => ({
    context: [],
    forwardedProps: { action: 'run' as const, agentId: 'flight-analysis', fab: 'F15B', sessionId },
    messages: [{ id: user.id, role: 'user' as const, content: user.content }],
    runId,
    state: {},
    threadId,
    tools: [],
  });

  const u1 = { id: 'u1', content: 'hi' };
  const u2 = { id: 'u2', content: '今天周几' };
  const u3 = { id: 'u3', content: '天气如何' };

  // 第一轮：u1 + a1
  const run1 = buildRun('run-order-1', u1, 'a1', 'Hi there!', []);
  scheduleRunCheckpoint(sessionId, inputFor('run-order-1', u1), run1);
  await flushRunCheckpoint();

  // 第二轮：快照携带 [u1,a1]，再追加 u2/a2（http 累积模式）
  const run2 = buildRun('run-order-2', u2, 'a2', '今天是周几…', [
    { id: 'u1', role: 'user', content: 'hi' },
    { id: 'a1', role: 'assistant', content: 'Hi there!' },
  ]);
  scheduleRunCheckpoint(sessionId, inputFor('run-order-2', u2), run2);
  await flushRunCheckpoint();

  // 第三轮：快照携带 [u1,a1,u2,a2]，再追加 u3/a3
  const run3 = buildRun('run-order-3', u3, 'a3', '天气无法实时获取', [
    { id: 'u1', role: 'user', content: 'hi' },
    { id: 'a1', role: 'assistant', content: 'Hi there!' },
    { id: 'u2', role: 'user', content: '今天周几' },
    { id: 'a2', role: 'assistant', content: '今天是周几…' },
  ]);
  scheduleRunCheckpoint(sessionId, inputFor('run-order-3', u3), run3);
  await flushRunCheckpoint();

  const records = await sessionHistoryService.getMessages(sessionId);
  const textIds = records.filter((record) => record.kind === 'text').map((record) => record.id);
  assert.deepEqual(
    textIds,
    ['text:u1', 'text:a1', 'text:u2', 'text:a2', 'text:u3', 'text:a3'],
    '多轮累积后文本消息必须保持时间线顺序',
  );
});

test('快速连续两轮 run：防抖按 runId 分槽，两轮消息都不丢失', async () => {
  await flushRunCheckpoint();
  const sessionId = 'session-overlap-runs';
  const threadId = `thread-${sessionId}`;
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId,
    title: sessionId,
    type: 'agent',
    version: '2.1.0',
  });

  const makeState = (runId: string, userText: string, assistantText: string) => {
    const user = { id: `u-${runId}`, role: 'user' as const, content: userText };
    let state = createRunState(runId, threadId);
    state.messages[user.id] = user;
    state.messageOrder.push(user.id);
    const assistantId = `a-${runId}`;
    state = reduceRunEvent(state, { event: { type: 'TEXT_MESSAGE_START', messageId: assistantId, role: 'assistant' } });
    state = reduceRunEvent(state, { event: { type: 'TEXT_MESSAGE_CONTENT', messageId: assistantId, delta: assistantText } });
    return { state, user };
  };

  // 两轮都尚未 flush 时各自 schedule（模拟快速连续发送），再统一 flush。
  const runA = makeState('overlap-a', '问题A', '回答A');
  const runB = makeState('overlap-b', '问题B', '回答B');
  scheduleRunCheckpoint(sessionId, { context: [], forwardedProps: { action: 'run', agentId: 'x', fab: 'F15B', sessionId }, messages: [runA.user], runId: 'overlap-a', state: {}, threadId, tools: [] }, runA.state);
  scheduleRunCheckpoint(sessionId, { context: [], forwardedProps: { action: 'run', agentId: 'x', fab: 'F15B', sessionId }, messages: [runB.user], runId: 'overlap-b', state: {}, threadId, tools: [] }, runB.state);
  await flushRunCheckpoint();

  const records = await sessionHistoryService.getMessages(sessionId);
  const texts = records.filter((record) => record.kind === 'text').map((record) => record.content);
  assert.ok(texts.includes('问题A') && texts.includes('回答A'), '第一轮消息不应丢失');
  assert.ok(texts.includes('问题B') && texts.includes('回答B'), '第二轮消息不应丢失');
  assert.deepEqual(
    texts,
    ['问题A', '回答A', '问题B', '回答B'],
    '两轮消息按时间线顺序落库',
  );
});

test('持久化不落 lc_run-- 占位行：规范 UUID 是唯一权威文本行', async () => {
  await flushRunCheckpoint();
  const sessionId = 'session-placeholder-skip';
  const threadId = `thread-${sessionId}`;
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId,
    title: sessionId,
    type: 'agent',
    version: '2.1.0',
  });

  // 快照到达前的状态同时存在占位（部分内容）与规范消息（完整内容）
  let state = createRunState('run-placeholder', threadId);
  state.messages['user-ph'] = { id: 'user-ph', role: 'user', content: '天气如何' };
  state.messageOrder.push('user-ph');
  state.messages['lc_run--part-1'] = { id: 'lc_run--part-1', role: 'assistant', content: '我' };
  state.messageOrder.push('lc_run--part-1');
  state.messages['assistant-ph'] = { id: 'assistant-ph', role: 'assistant', content: '我目前无法获取实时天气数据。' };
  state.messageOrder.push('assistant-ph');

  const input = {
    context: [],
    forwardedProps: { action: 'run' as const, agentId: 'flight-analysis', fab: 'F15B', sessionId },
    messages: [{ id: 'user-ph', role: 'user' as const, content: '天气如何' }],
    runId: 'run-placeholder',
    state: {},
    threadId,
    tools: [],
  };
  scheduleRunCheckpoint(sessionId, input, state);
  await flushRunCheckpoint();

  const records = await sessionHistoryService.getMessages(sessionId);
  const textIds = records.filter((record) => record.kind === 'text').map((record) => record.id);
  assert.deepEqual(textIds, ['text:user-ph', 'text:assistant-ph']);
  assert.equal(textIds.some((id) => id.includes('lc_run--')), false);
});

test('lastMessageAt：随消息落库更新到最后一条消息时间', async () => {
  await flushRunCheckpoint();
  const sessionId = 'session-last-message-at';
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId: `thread-${sessionId}`,
    title: 'lastMessageAt',
    type: 'agent',
  });
  const created = await sessionHistoryService.getSession(sessionId);
  assert.equal(created?.lastMessageAt, created?.createdAt, '空会话 lastMessageAt 初始化为 createdAt');

  const { input, snapshot } = buildSingleAgentRun(sessionId, 'run-last-message-at');
  await sessionHistoryService.saveRunCheckpoint(sessionId, input, snapshot);
  const after = await sessionHistoryService.getSession(sessionId);
  assert.ok(
    after?.lastMessageAt && new Date(after.lastMessageAt).getTime() > new Date(after.createdAt).getTime(),
    '落库后 lastMessageAt 应更新到最后一条消息时间',
  );
});

test('v1 → v2 升级：lastMessageAt 从 text 消息回填，空会话回退 createdAt，旧数据保留', async () => {
  // 先删库，再用仅 v1 schema 的独立实例造旧数据，最后用真实 v2 实例触发升级回填。
  await sessionDatabase.delete();
  const legacy = new Dexie('agentdock-session-v3');
  legacy.version(1).stores({
    sessions: 'id,threadId,updatedAt,pinned,type',
    messages: 'id,sessionId,runId,createdAt,sequence',
    checkpoints: 'runId,sessionId,threadId,status,updatedAt',
  });
  const legacySessions = legacy.table('sessions');
  const legacyMessages = legacy.table('messages');
  await legacySessions.add({
    agentId: 'flight-analysis',
    createdAt: '2024-01-01T00:00:00.000Z',
    fab: 'F15B',
    id: 'legacy-with-msg',
    pinned: false,
    threadId: 'thread-legacy-1',
    title: 'legacy 1',
    type: 'agent',
    updatedAt: '2024-01-02T00:00:00.000Z',
  });
  await legacySessions.add({
    agentId: 'flight-analysis',
    createdAt: '2024-02-01T00:00:00.000Z',
    fab: 'F15B',
    id: 'legacy-empty',
    pinned: false,
    threadId: 'thread-legacy-2',
    title: 'legacy 2',
    type: 'agent',
    updatedAt: '2024-02-02T00:00:00.000Z',
  });
  await legacyMessages.add({
    content: 'hi',
    createdAt: '2024-01-03T00:00:00.000Z',
    id: 'text:m1',
    kind: 'text',
    role: 'user',
    sequence: 1,
    sessionId: 'legacy-with-msg',
  });
  legacy.close();

  await sessionDatabase.open();
  const withMsg = await sessionDatabase.sessions.get('legacy-with-msg');
  const empty = await sessionDatabase.sessions.get('legacy-empty');
  assert.equal(withMsg?.lastMessageAt, '2024-01-03T00:00:00.000Z', '有消息会话按 text 最大 createdAt 回填');
  assert.equal(empty?.lastMessageAt, '2024-02-01T00:00:00.000Z', '空会话回退 createdAt');
  assert.equal((await sessionDatabase.messages.get('text:m1'))?.content, 'hi', '旧消息数据保留');
});

test('checkpoint 剪枝：终态全部删除，running/paused 始终保留', async () => {
  if (!sessionDatabase.isOpen()) await sessionDatabase.open();
  const sessionId = 'session-prune-checkpoints';
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId: `thread-${sessionId}`,
    title: 'prune',
    type: 'agent',
  });
  const baseInput: RunAgentInput = {
    context: [],
    forwardedProps: { action: 'run', agentId: 'flight-analysis', fab: 'F15B', sessionId },
    messages: [],
    runId: '',
    state: {},
    threadId: `thread-${sessionId}`,
    tools: [],
  };
  for (let index = 1; index <= 5; index += 1) {
    const runId = `prune-terminal-${index}`;
    await sessionDatabase.checkpoints.put({
      input: { ...baseInput, runId },
      latestEventId: String(index),
      runId,
      sessionId,
      snapshot: { ...createRunState(runId, `thread-${sessionId}`), status: 'success' },
      status: 'success',
      threadId: `thread-${sessionId}`,
      updatedAt: `2024-01-0${index}T00:00:00.000Z`,
    });
  }
  await sessionDatabase.checkpoints.put({
    input: { ...baseInput, runId: 'prune-running' },
    latestEventId: '9',
    runId: 'prune-running',
    sessionId,
    snapshot: { ...createRunState('prune-running', `thread-${sessionId}`), status: 'running' },
    status: 'running',
    threadId: `thread-${sessionId}`,
    updatedAt: '2024-01-06T00:00:00.000Z',
  });

  await sessionHistoryService.pruneCheckpoints(sessionId);
  const remaining = await sessionDatabase.checkpoints.where('sessionId').equals(sessionId).toArray();
  assert.deepEqual(
    remaining.map((record) => record.runId).sort(),
    ['prune-running'],
    '终态全部删除，running 保留',
  );
});

test('checkpoint 压缩：只保留渲染/续跑必需字段，rawEvents/state/input 大字段裁剪', async () => {
  await flushRunCheckpoint();
  const sessionId = 'session-compact-checkpoint';
  const runId = 'run-compact';
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId: `thread-${sessionId}`,
    title: 'compact',
    type: 'agent',
  });
  const { input, snapshot } = buildSingleAgentRun(sessionId, runId);
  // 带大体积 context/state/tools 的输入，验证落库后被裁剪。
  const bulkyInput: RunAgentInput = {
    ...input,
    context: [{ big: 'x'.repeat(500) }],
    state: { big: 'y'.repeat(500) },
    tools: [{ big: 'z'.repeat(500) }],
  };
  const runningSnapshot = { ...snapshot, status: 'running' as const };
  await sessionHistoryService.saveRunCheckpoint(sessionId, bulkyInput, runningSnapshot);

  const checkpoint = await sessionHistoryService.getLatestRun(sessionId);
  assert.ok(checkpoint);
  assert.equal(checkpoint.snapshot.rawEvents.length, 0, 'rawEvents（完整事件日志）不落库');
  assert.equal(checkpoint.snapshot.state, undefined, 'state 不落库');
  assert.equal(checkpoint.input.context.length, 0, 'input.context 置空');
  assert.deepEqual(checkpoint.input.state, {}, 'input.state 置空');
  assert.equal(checkpoint.input.tools.length, 0, 'input.tools 置空');
  // 渲染与续跑必需字段全部保留。
  assert.equal(checkpoint.snapshot.status, 'running');
  assert.equal(checkpoint.snapshot.messages[`assistant-${runId}`]?.content, '分析完成');
  assert.ok(checkpoint.snapshot.toolCalls[`tool-${runId}`], 'tool 块保留');
  assert.equal(checkpoint.snapshot.reasoning[`reasoning-${runId}`], '校验输入并规划只读工具调用。');
  assert.equal(checkpoint.snapshot.latestEventId, snapshot.latestEventId);
  assert.ok(checkpoint.snapshot.processedEventIds.length > 0, 'processedEventIds 保留（重放去重）');
  // 压缩后体积显著小于原始快照（rawEvents/state 是主要大头）。
  assert.ok(
    JSON.stringify(checkpoint.snapshot).length < JSON.stringify(snapshot).length,
    '压缩后应小于原始快照',
  );
  // 恢复后 reducer 可继续消费事件（rawEvents=[]、state=undefined 不破坏）。
  const continued = reduceRunEvent(checkpoint.snapshot, {
    eventId: '99',
    event: { type: 'TEXT_MESSAGE_CONTENT', messageId: `assistant-${runId}`, delta: '!' },
  });
  assert.equal(continued.rawEvents.length, 1, '恢复后 reducer 可继续追加事件');
  assert.equal(continued.status, 'running');
});

test('存量旧格式 checkpoint（running）：读取时惰性压缩并重写（一次性回收空间）', async () => {
  const sessionId = 'session-legacy-compact';
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId: `thread-${sessionId}`,
    title: 'legacy-compact',
    type: 'agent',
  });
  const { input, snapshot } = buildSingleAgentRun(sessionId, 'run-legacy-compact');
  // 直接写入旧格式（未压缩）：rawEvents 带完整事件、input 带大 context。
  await sessionDatabase.checkpoints.put({
    input: { ...input, context: [{ big: 'x'.repeat(500) }] },
    latestEventId: snapshot.latestEventId,
    runId: snapshot.runId,
    sessionId,
    snapshot,
    status: 'running',
    threadId: snapshot.threadId,
    updatedAt: new Date().toISOString(),
  });

  const checkpoint = await sessionHistoryService.getLatestRun(sessionId);
  assert.ok(checkpoint);
  assert.equal(checkpoint.snapshot.rawEvents.length, 0, '读取后返回压缩快照');
  assert.equal(checkpoint.input.context.length, 0, '读取后 input 已裁剪');
  // 库内行也被重写为压缩格式。
  const stored = await sessionDatabase.checkpoints.get(snapshot.runId);
  assert.equal(stored?.snapshot.rawEvents.length, 0, '库内旧格式已惰性压缩');
  assert.equal(stored?.snapshot.messages[`assistant-${snapshot.runId}`]?.content, '分析完成');
});

test('终态不落 checkpoint；sweepTerminalCheckpoints 清理存量终态行且不碰 running', async () => {
  await flushRunCheckpoint();
  const sessionId = 'session-terminal-sweep';
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId: `thread-${sessionId}`,
    title: 'sweep',
    type: 'agent',
  });
  const { input, snapshot } = buildSingleAgentRun(sessionId, 'run-sweep-success');
  await sessionHistoryService.saveRunCheckpoint(sessionId, input, snapshot);
  assert.equal(await sessionHistoryService.getLatestRun(sessionId), undefined, '终态不落 checkpoint');
  const messages = await sessionHistoryService.getMessages(sessionId);
  assert.ok(messages.some((record) => record.kind === 'text'), '终态消息仍完整落库');

  // 模拟存量终态行（旧版本数据），由启动清扫回收。
  await sessionDatabase.checkpoints.put({
    input,
    latestEventId: snapshot.latestEventId,
    runId: 'legacy-terminal-sweep',
    sessionId,
    snapshot,
    status: 'success',
    threadId: `thread-${sessionId}`,
    updatedAt: new Date().toISOString(),
  });
  assert.equal(await sweepTerminalCheckpoints(), 1, '清扫删除存量终态行');
  assert.equal(await sessionDatabase.checkpoints.get('legacy-terminal-sweep'), undefined);

  // running 行不被清扫。
  await sessionHistoryService.saveRunCheckpoint(sessionId, input, { ...snapshot, status: 'running' as const });
  assert.equal((await sessionHistoryService.getLatestRun(sessionId))?.status, 'running');
  assert.equal(await sweepTerminalCheckpoints(), 0, 'running 不被清扫');
});

test('断线续传：checkpoint 存 latestEventId，restore 取用并构造 resume.lastEventId', async () => {
  await flushRunCheckpoint();
  const sessionId = 'session-resume-event-id';
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId: `thread-${sessionId}`,
    title: 'resume-eid',
    type: 'agent',
  });
  const { input, snapshot } = buildSingleAgentRun(sessionId, 'run-resume-eid');
  await sessionHistoryService.saveRunCheckpoint(sessionId, input, { ...snapshot, status: 'running' as const });

  // 取用：与 runStore.restoreSession 一致，从 checkpoint 恢复游标。
  const checkpoint = await sessionHistoryService.getLatestRun(sessionId);
  assert.ok(checkpoint);
  assert.equal(checkpoint.status, 'running');
  assert.equal(checkpoint.latestEventId, snapshot.latestEventId, '游标存于 checkpoint.latestEventId');
  assert.ok(
    checkpoint.snapshot.processedEventIds.includes(snapshot.latestEventId!),
    'processedEventIds 保留供重放精确去重',
  );

  // 发送：与 runStore.resume 相同的构造逻辑，lastEventId 随 forwardedProps 发往后端。
  const resumeInput = {
    ...checkpoint.input,
    forwardedProps: {
      ...checkpoint.input.forwardedProps,
      action: 'resume' as const,
      resume: { lastEventId: checkpoint.latestEventId! },
    },
  };
  assert.equal(resumeInput.forwardedProps.resume.lastEventId, '14', 'resume 携带最新事件游标');
  assert.equal(resumeInput.forwardedProps.sessionId, sessionId, 'forwardedProps 保留（fab/sessionId）');
  assert.equal(resumeInput.forwardedProps.fab, 'F15B', 'fab 保留');
  assert.equal(resumeInput.runId, 'run-resume-eid', 'runId 保留');
  assert.equal(resumeInput.threadId, `thread-${sessionId}`, 'threadId 保留');
});

test('RUN_ERROR 经 reducer 生成 assistant 错误回复并持久化为历史', async () => {
  await flushRunCheckpoint();
  const sessionId = 'session-run-error-persist';
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId: `thread-${sessionId}`,
    title: 'run-error-persist',
    type: 'agent',
  });
  const { input } = buildSingleAgentRun(sessionId, 'run-error-persist');
  // 模拟 runtime 捕获上游错误后注入 RUN_ERROR（无正常回复）。
  let state = createRunState('run-error-persist', `thread-${sessionId}`);
  state = reduceRunEvent(state, {
    eventId: '1',
    event: { type: 'RUN_STARTED', threadId: state.threadId, runId: state.runId },
  });
  state = reduceRunEvent(state, {
    eventId: '2',
    event: {
      code: 'FAB_UPSTREAM_ERROR',
      message: 'upstream exploded',
      runId: state.runId,
      threadId: state.threadId,
      type: 'RUN_ERROR',
    },
  });
  await sessionHistoryService.saveRunCheckpoint(sessionId, input, state);

  const messages = await sessionHistoryService.getMessages(sessionId);
  const errorRow = messages.find((record) => record.id === 'text:error-run-error-persist');
  assert.ok(errorRow, '错误回复作为消息行落库');
  assert.equal(errorRow?.role, 'assistant');
  assert.equal(errorRow?.content, 'upstream exploded');
  // 幂等：同一终态错误重复落盘只保留一行，不重复持久化。
  await sessionHistoryService.saveRunCheckpoint(sessionId, input, state);
  const again = await sessionHistoryService.getMessages(sessionId);
  assert.equal(
    again.filter((record) => record.id === 'text:error-run-error-persist').length,
    1,
    '错误回复重复落盘不产生重复行',
  );
  assert.equal(await sessionHistoryService.getLatestRun(sessionId), undefined, '终态不落 checkpoint');
});

test('cancelPendingCheckpoint：错误兜底后丢弃未落盘快照，flush 不写回陈旧 running checkpoint', async () => {
  await flushRunCheckpoint();
  const sessionId = 'session-cancel-pending';
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId: `thread-${sessionId}`,
    title: 'cancel-pending',
    type: 'agent',
  });
  const { input, snapshot } = buildSingleAgentRun(sessionId, 'run-cancel-pending');
  scheduleRunCheckpoint(sessionId, input, { ...snapshot, status: 'running' as const });
  cancelPendingCheckpoint('run-cancel-pending');
  await flushRunCheckpoint();
  assert.equal(
    await sessionHistoryService.getLatestRun(sessionId),
    undefined,
    '取消后 flush 不再写入陈旧 running checkpoint',
  );
});

test('多轮错误持久化：第二轮带 MESSAGES_SNAPSHOT 时落库顺序 Q1A1Q2A2 且不串轮', async () => {
  await flushRunCheckpoint();
  const sessionId = 'session-multi-error-order';
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId: `thread-${sessionId}`,
    title: 'multi-error-order',
    type: 'agent',
  });
  const baseInput: RunAgentInput = {
    context: [],
    forwardedProps: { action: 'run', agentId: 'flight-analysis', fab: 'F15B', sessionId },
    messages: [],
    runId: '',
    state: {},
    threadId: `thread-${sessionId}`,
    tools: [],
  };
  // 第一轮：Q1 + 错误 A1
  let run1 = createRunState('me-run-1', `thread-${sessionId}`);
  run1 = reduceRunEvent(run1, { eventId: '1', event: { type: 'RUN_STARTED', threadId: run1.threadId, runId: run1.runId } });
  run1 = reduceRunEvent(run1, { eventId: '2', event: { type: 'TEXT_MESSAGE_START', messageId: 'q1', role: 'user' } });
  // 用户消息内容由 runStore/execute 从 input 种子注入（真实路径）。
  run1.messages['q1'] = { ...run1.messages['q1'], content: 'Q1' };
  run1 = reduceRunEvent(run1, {
    eventId: '3',
    event: { code: 'BACKEND_ERROR', message: 'err1', runId: run1.runId, threadId: run1.threadId, type: 'RUN_ERROR' },
  });
  await sessionHistoryService.saveRunCheckpoint(sessionId, { ...baseInput, runId: 'me-run-1' }, run1);

  // 第二轮：快照携带 [Q1, A1(err1), Q2]，随后本轮 RUN_ERROR
  let run2 = createRunState('me-run-2', `thread-${sessionId}`);
  run2 = reduceRunEvent(run2, { eventId: '10', event: { type: 'RUN_STARTED', threadId: run2.threadId, runId: run2.runId } });
  run2 = reduceRunEvent(run2, {
    eventId: '11',
    event: {
      type: 'MESSAGES_SNAPSHOT',
      messages: [
        { id: 'q1', role: 'user', content: 'Q1' },
        { id: 'error-me-run-1', role: 'assistant', content: 'err1' },
        { id: 'q2', role: 'user', content: 'Q2' },
      ],
    },
  });
  run2.messages['q2'] = { ...run2.messages['q2'], content: 'Q2' };
  run2 = reduceRunEvent(run2, {
    eventId: '12',
    event: { code: 'BACKEND_ERROR', message: 'err2', runId: run2.runId, threadId: run2.threadId, type: 'RUN_ERROR' },
  });
  await sessionHistoryService.saveRunCheckpoint(sessionId, { ...baseInput, runId: 'me-run-2' }, run2);

  const messages = await sessionHistoryService.getMessages(sessionId);
  const texts = messages.filter((record) => record.kind === 'text');
  assert.deepEqual(
    texts.map((record) => record.id),
    ['text:q1', 'text:error-me-run-1', 'text:q2', 'text:error-me-run-2'],
    '落库顺序必须 Q1 A1 Q2 A2',
  );
  assert.equal(texts[1].content, 'err1', 'A1 内容不被第二轮污染');
  assert.equal(texts[3].content, 'err2');
  assert.equal(texts[3].role, 'assistant');
});

test('连续三轮错误持久化：落库 Q1A1Q2A2Q3A3，无吞无重', async () => {
  await flushRunCheckpoint();
  const sessionId = 'session-multi3-error';
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId: `thread-${sessionId}`,
    title: 'multi3-error',
    type: 'agent',
  });
  const baseInput: RunAgentInput = {
    context: [],
    forwardedProps: { action: 'run', agentId: 'flight-analysis', fab: 'F15B', sessionId },
    messages: [],
    runId: '',
    state: {},
    threadId: `thread-${sessionId}`,
    tools: [],
  };
  const rounds = [
    { err: 'err1', q: 'q1', runId: 'm3-run-1' },
    { err: 'err2', q: 'q2', runId: 'm3-run-2' },
    { err: 'err3', q: 'q3', runId: 'm3-run-3' },
  ];
  let prior: Array<{ content: string; id: string; role: 'assistant' | 'user' }> = [];
  for (const { err, q, runId } of rounds) {
    let state = createRunState(runId, `thread-${sessionId}`);
    state = reduceRunEvent(state, { eventId: `${runId}-1`, event: { type: 'RUN_STARTED', threadId: state.threadId, runId } });
    if (prior.length) {
      state = reduceRunEvent(state, { eventId: `${runId}-2`, event: { type: 'MESSAGES_SNAPSHOT', messages: prior } });
    }
    state = reduceRunEvent(state, { eventId: `${runId}-3`, event: { type: 'TEXT_MESSAGE_START', messageId: q, role: 'user' } });
    // 用户消息内容由 runStore/execute 从 input.messages 种子注入（真实路径），补上内容。
    state.messages[q] = { ...state.messages[q], content: q };
    state = reduceRunEvent(state, {
      eventId: `${runId}-4`,
      event: { code: 'BACKEND_ERROR', message: err, runId, threadId: state.threadId, type: 'RUN_ERROR' },
    });
    await sessionHistoryService.saveRunCheckpoint(sessionId, { ...baseInput, runId }, state);
    prior = [...prior, { content: q, id: q, role: 'user' }, { content: err, id: `error-${runId}`, role: 'assistant' }];
  }
  const messages = await sessionHistoryService.getMessages(sessionId);
  const texts = messages.filter((record) => record.kind === 'text');
  assert.deepEqual(
    texts.map((record) => record.id),
    ['text:q1', 'text:error-m3-run-1', 'text:q2', 'text:error-m3-run-2', 'text:q3', 'text:error-m3-run-3'],
    '三轮错误落库顺序 Q1A1Q2A2Q3A3',
  );
  assert.equal(texts.length, 6, '无重复行');
  assert.deepEqual(
    texts.map((record) => record.content),
    ['q1', 'err1', 'q2', 'err2', 'q3', 'err3'],
    '内容一一对应，无吞无重',
  );
});

test('sequence 单调：系统时钟回拨后，新消息仍排在旧消息之后', async () => {
  await flushRunCheckpoint();
  const sessionId = 'session-clock-regress';
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId: `thread-${sessionId}`,
    title: 'clock-regress',
    type: 'agent',
  });
  const { input: input1, snapshot: snap1 } = buildSingleAgentRun(sessionId, 'clock-run-1');
  await sessionHistoryService.saveRunCheckpoint(sessionId, input1, { ...snap1, status: 'running' as const });

  // 模拟时钟回拨 1 秒后再落下一轮（nextSequence 依赖 Date.now()，lastSequence 兜底必须生效）。
  const originalNow = Date.now;
  const regressed = originalNow() - 1000;
  Date.now = () => regressed;
  try {
    const { input: input2, snapshot: snap2 } = buildSingleAgentRun(sessionId, 'clock-run-2');
    await sessionHistoryService.saveRunCheckpoint(sessionId, input2, { ...snap2, status: 'running' as const });
  } finally {
    Date.now = originalNow;
  }

  const messages = await sessionHistoryService.getMessages(sessionId);
  const texts = messages.filter((record) => record.kind === 'text');
  const sequences = texts.map((record) => record.sequence);
  assert.ok(
    sequences.every((value, index) => index === 0 || value > sequences[index - 1]),
    '时钟回拨后 sequence 仍严格递增',
  );
  const ids = texts.map((record) => record.id);
  assert.ok(
    ids.indexOf('text:user-clock-run-2') > ids.indexOf('text:assistant-clock-run-1'),
    '回拨后第二轮仍排在第一轮之后',
  );
});

test('LobeHub 同款占位+增量：空占位行存在，内容到达后同 id upsert 且顺序正确', async () => {
  await flushRunCheckpoint();
  const sessionId = 'session-no-empty-placeholder';
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId: `thread-${sessionId}`,
    title: 'no-empty-placeholder',
    type: 'agent',
  });
  const input: RunAgentInput = {
    context: [],
    forwardedProps: { action: 'run', agentId: 'flight-analysis', fab: 'F15B', sessionId },
    messages: [{ content: 'Q', id: 'q-empty', role: 'user' }],
    runId: 'empty-run',
    state: {},
    threadId: `thread-${sessionId}`,
    tools: [],
  };
  // 中途 flush：Q 有内容，assistant 仅有 TEXT_MESSAGE_START（content 为空）——占位行照常落库。
  let state = createRunState('empty-run', `thread-${sessionId}`);
  state = reduceRunEvent(state, { eventId: '1', event: { type: 'RUN_STARTED', threadId: state.threadId, runId: state.runId } });
  state.messages['q-empty'] = { content: 'Q', id: 'q-empty', role: 'user' };
  state.messageOrder.push('q-empty');
  state = reduceRunEvent(state, { eventId: '2', event: { type: 'TEXT_MESSAGE_START', messageId: 'a-empty', role: 'assistant' } });
  await sessionHistoryService.saveRunCheckpoint(sessionId, input, { ...state, status: 'running' as const });
  let messages = await sessionHistoryService.getMessages(sessionId);
  const placeholder = messages.find((record) => record.id === 'text:a-empty');
  assert.ok(placeholder, '空占位行存在（LobeHub 同款：发送即建行）');
  assert.equal(placeholder?.content, '');

  // 内容到达后再 flush：同一 id upsert，content 覆盖、sequence 不变，仍排在用户之后。
  state = reduceRunEvent(state, { eventId: '3', event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a-empty', delta: '回复内容' } });
  await sessionHistoryService.saveRunCheckpoint(sessionId, input, { ...state, status: 'running' as const });
  messages = await sessionHistoryService.getMessages(sessionId);
  const userRow = messages.find((record) => record.id === 'text:q-empty');
  const assistantRow = messages.find((record) => record.id === 'text:a-empty');
  assert.ok(userRow, '用户消息落库');
  assert.ok(assistantRow, '占位行更新为内容');
  assert.equal(assistantRow?.content, '回复内容');
  assert.equal(assistantRow?.sequence, placeholder?.sequence, '占位行 upsert 不改变 sequence');
  assert.ok(userRow && assistantRow && assistantRow.sequence > userRow.sequence, 'assistant 排在用户之后');
});

test('所有 Session 列表按 createdAt 倒序，消息更新不改变侧边栏顺序', async () => {
  await sessionDatabase.delete();
  await sessionDatabase.open();
  for (let index = 1; index <= 5; index += 1) {
    const id = `page-session-${index}`;
    await sessionHistoryService.createSession({
      agentId: 'flight-analysis',
      agentName: 'FlightAnalysis_Agent',
      fab: 'F15B',
      id,
      pinned: false,
      threadId: `thread-${id}`,
      title: `s${index}`,
      type: 'agent',
    });
    await sessionDatabase.sessions.update(id, {
      createdAt: new Date(2024, 0, index).toISOString(),
      updatedAt: new Date(2025, 0, 6 - index).toISOString(),
    });
  }
  const page1 = await sessionHistoryService.listSessions({ limit: 2 });
  assert.deepEqual(page1.map((session) => session.id), ['page-session-5', 'page-session-4']);
  const page2 = await sessionHistoryService.listSessions({ limit: 2, offset: 2 });
  assert.deepEqual(page2.map((session) => session.id), ['page-session-3', 'page-session-2']);
  assert.equal(await sessionHistoryService.countSessions(), 5);

  await sessionDatabase.sessions.update('page-session-1', {
    updatedAt: new Date(2030, 0, 1).toISOString(),
  });
  const unchanged = await sessionHistoryService.listSessions();
  assert.deepEqual(
    unchanged.map((session) => session.id),
    ['page-session-5', 'page-session-4', 'page-session-3', 'page-session-2', 'page-session-1'],
  );
});

test('Agent 话题与 Group 侧边栏同样按 createdAt 倒序', async () => {
  await sessionDatabase.delete();
  await sessionDatabase.open();
  const create = async (id: string, type: 'agent' | 'group', createdAt: string) => {
    await sessionHistoryService.createSession({
      agentId: 'flight-analysis',
      agentName: 'FlightAnalysis_Agent',
      fab: 'F15B',
      id,
      pinned: false,
      threadId: `thread-${id}`,
      title: id,
      type,
    });
    await sessionDatabase.sessions.update(id, { createdAt });
  };
  await create('agent-old', 'agent', '2024-01-01T00:00:00.000Z');
  await create('agent-new', 'agent', '2024-01-03T00:00:00.000Z');
  await create('group-old', 'group', '2024-01-02T00:00:00.000Z');
  await create('group-new', 'group', '2024-01-04T00:00:00.000Z');

  assert.deepEqual(
    (await sessionHistoryService.listSessionsByAgent('flight-analysis', 'F15B'))
      .filter((session) => session.type === 'agent')
      .map((session) => session.id),
    ['agent-new', 'agent-old'],
  );
  assert.deepEqual(
    (await sessionHistoryService.listGroupSessions()).map((session) => session.id),
    ['group-new', 'group-old'],
  );
});

test('getMessagesPage：按 run 整轮分页，文本不重叠、顺序正确、翻页收敛', async () => {
  await sessionDatabase.delete();
  await sessionDatabase.open();
  const sessionId = 'session-msg-page';
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId: `thread-${sessionId}`,
    title: 'msg-page',
    type: 'agent',
  });
  // 5 轮，每轮 user + assistant 文本 + reasoning/tool/step/activity/surface 过程块。
  for (let run = 1; run <= 5; run += 1) {
    const { input, snapshot } = buildSingleAgentRun(sessionId, `page-run-${run}`);
    await sessionHistoryService.saveRunCheckpoint(sessionId, input, { ...snapshot, status: 'running' as const });
  }

  const seenTextIds = new Set<string>();
  let cursor: number | undefined;
  let hasMore = true;
  let pageCount = 0;
  const textIdsByRun = new Map<string, string[]>();
  while (hasMore && pageCount < 10) {
    pageCount += 1;
    const page = await sessionHistoryService.getMessagesPage(
      sessionId,
      cursor === undefined ? { limit: 2 } : { beforeSequence: cursor, limit: 2 },
    );
    for (const record of page.records) {
      if (record.kind !== 'text') continue;
      assert.equal(seenTextIds.has(record.id), false, '跨页文本不得重复');
      seenTextIds.add(record.id);
      if (record.runId) {
        const bucket = textIdsByRun.get(record.runId) ?? [];
        bucket.push(record.id);
        textIdsByRun.set(record.runId, bucket);
      }
    }
    // 每页文本所属的 run 必须整轮完整（含 tool/reasoning 块）。
    const pageRunIds = [...new Set(page.records.map((record) => record.runId).filter(Boolean))];
    for (const runId of pageRunIds) {
      assert.ok(
        page.records.some((record) => record.kind === 'tool' && record.runId === runId),
        `${runId} 的 tool 块应随整轮加载`,
      );
    }
    hasMore = page.hasMore;
    cursor = page.nextBeforeSequence;
  }
  assert.equal(pageCount, 5, '10 条文本 / 每页 2 条 = 5 页');
  assert.equal(seenTextIds.size, 10);
  assert.equal(hasMore, false, '翻到最旧后 hasMore=false');
  assert.equal(textIdsByRun.size, 5, '5 轮全部覆盖');
});

test('消息分页压力：20 轮混排过程块，翻页无漏无重且整体有序', async () => {
  await sessionDatabase.delete();
  await sessionDatabase.open();
  const sessionId = 'session-page-stress';
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId: `thread-${sessionId}`,
    title: 'page-stress',
    type: 'agent',
  });
  for (let run = 1; run <= 20; run += 1) {
    const { input, snapshot } = buildSingleAgentRun(sessionId, `stress-run-${run}`);
    await sessionHistoryService.saveRunCheckpoint(sessionId, input, { ...snapshot, status: 'running' as const });
  }

  // 全量基线：40 条文本。
  const all = await sessionHistoryService.getMessages(sessionId);
  const allTextIds = new Set(all.filter((record) => record.kind === 'text').map((record) => record.id));
  assert.equal(allTextIds.size, 40);
  const allSequences = all.map((record) => record.sequence);
  assert.ok(
    allSequences.every((value, index) => index === 0 || value > allSequences[index - 1]),
    '全量读取 sequence 严格递增（同标签页内无回绕）',
  );

  // limit=7 翻页：无漏、无重、跨页严格更早。
  const seenTextIds = new Set<string>();
  let cursor: number | undefined;
  let hasMore = true;
  let prevMin = Number.POSITIVE_INFINITY;
  let pages = 0;
  while (hasMore && pages < 20) {
    pages += 1;
    const page = await sessionHistoryService.getMessagesPage(
      sessionId,
      cursor === undefined ? { limit: 7 } : { beforeSequence: cursor, limit: 7 },
    );
    assert.ok(page.records.length > 0, 'hasMore 为真时页面不为空');
    const pageMax = page.records[page.records.length - 1].sequence;
    assert.ok(pageMax < prevMin, '跨页整体严格更早（新页全部旧于旧页最旧行）');
    prevMin = page.records[0].sequence;
    for (const record of page.records) {
      if (record.kind !== 'text') continue;
      assert.equal(seenTextIds.has(record.id), false, '文本跨页不重复');
      seenTextIds.add(record.id);
    }
    const pageRunIds = [...new Set(page.records.map((record) => record.runId).filter(Boolean))];
    for (const runId of pageRunIds) {
      assert.ok(
        page.records.some((record) => record.kind === 'tool' && record.runId === runId),
        `${runId} 整轮完整`,
      );
    }
    hasMore = page.hasMore;
    cursor = page.nextBeforeSequence;
  }
  // 每轮 2 条文本：limit=7 截断在轮中间时会补全整轮（每页 8 条文本），5 页翻尽。
  assert.equal(pages, 5, '每页按整轮补齐，40 条文本 / 每页 8 条 = 5 页');
  assert.deepEqual([...seenTextIds].sort(), [...allTextIds].sort(), '翻页覆盖全部文本，无漏');
  assert.equal(hasMore, false, '翻到最旧后 hasMore=false');
});

/** 构造每轮 1..4 段 user/assistant 文本的自定义快照（验证分页不依赖均匀轮结构）。 */
const buildVariableRun = (sessionId: string, runId: string, textPairs: number) => {
  const state = createRunState(runId, `thread-${sessionId}`);
  for (let index = 0; index < textPairs; index += 1) {
    const userId = `vuser-${runId}-${index}`;
    const assistantId = `vassistant-${runId}-${index}`;
    state.messages[userId] = { content: `u${index}`, id: userId, role: 'user' };
    state.messageOrder.push(userId);
    state.messages[assistantId] = { content: `a${index}`, id: assistantId, role: 'assistant' };
    state.messageOrder.push(assistantId);
  }
  state.toolCalls[`vtool-${runId}`] = { args: '{}', status: 'completed' };
  const input: RunAgentInput = {
    context: [],
    forwardedProps: { action: 'run', agentId: 'flight-analysis', fab: 'F15B', sessionId },
    messages: [],
    runId,
    state: {},
    threadId: `thread-${sessionId}`,
    tools: [],
  };
  return { input, snapshot: { ...state, status: 'running' as const } };
};

test('消息分页压力（变长文本/轮）：翻页无漏无重且整体有序', async () => {
  await sessionDatabase.delete();
  await sessionDatabase.open();
  const sessionId = 'session-var-page';
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id: sessionId,
    pinned: false,
    threadId: `thread-${sessionId}`,
    title: 'var-page',
    type: 'agent',
  });
  const textCounts = [2, 3, 1, 4, 2, 2, 3, 1, 4, 2, 3, 2, 1, 4, 3];
  let expectedTexts = 0;
  for (let index = 0; index < textCounts.length; index += 1) {
    const { input, snapshot } = buildVariableRun(sessionId, `vrun-${index}`, textCounts[index]);
    await sessionHistoryService.saveRunCheckpoint(sessionId, input, snapshot);
    expectedTexts += textCounts[index] * 2;
  }
  const all = await sessionHistoryService.getMessages(sessionId);
  assert.equal(all.filter((record) => record.kind === 'text').length, expectedTexts);

  const seenTextIds = new Set<string>();
  let cursor: number | undefined;
  let hasMore = true;
  let prevMin = Number.POSITIVE_INFINITY;
  let pages = 0;
  while (hasMore && pages < 40) {
    pages += 1;
    const page = await sessionHistoryService.getMessagesPage(
      sessionId,
      cursor === undefined ? { limit: 7 } : { beforeSequence: cursor, limit: 7 },
    );
    assert.ok(page.records.length > 0, 'hasMore 为真时页面不为空');
    assert.ok(
      page.records[page.records.length - 1].sequence < prevMin,
      '跨页整体严格更早',
    );
    prevMin = page.records[0].sequence;
    for (const record of page.records) {
      if (record.kind !== 'text') continue;
      assert.equal(seenTextIds.has(record.id), false, '文本跨页不重复');
      seenTextIds.add(record.id);
    }
    const pageRunIds = [...new Set(page.records.map((record) => record.runId).filter(Boolean))];
    for (const runId of pageRunIds) {
      assert.ok(
        page.records.some((record) => record.kind === 'tool' && record.runId === runId),
        `${runId} 整轮完整`,
      );
    }
    hasMore = page.hasMore;
    cursor = page.nextBeforeSequence;
  }
  assert.equal(seenTextIds.size, expectedTexts, '翻页覆盖全部变长文本，无漏');
  assert.equal(hasMore, false, '翻到最旧后 hasMore=false');
});
