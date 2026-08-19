import 'fake-indexeddb/auto';

import assert from 'node:assert/strict';
import test from 'node:test';

import { createRunState, reduceRunEvent } from '../runtime/runReducer.ts';
import type { RunAgentInput, RuntimeRunState } from '../runtime/types.ts';
import {
  flushRunCheckpoint,
  scheduleRunCheckpoint,
  sessionHistoryService,
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
  state = reduceRunEvent(state, { streamId: '1', event: { type: 'RUN_STARTED', threadId: state.threadId, runId } });
  state = reduceRunEvent(state, { streamId: '2', event: { type: 'STEP_STARTED', stepId: 'plan', stepName: 'plan' } });
  state = reduceRunEvent(state, { streamId: '3', event: { type: 'REASONING_MESSAGE_START', messageId: `reasoning-${runId}` } });
  state = reduceRunEvent(state, { streamId: '4', event: { type: 'REASONING_MESSAGE_CONTENT', messageId: `reasoning-${runId}`, delta: '校验输入并规划只读工具调用。' } });
  state = reduceRunEvent(state, { streamId: '5', event: { type: 'REASONING_MESSAGE_END', messageId: `reasoning-${runId}` } });
  state = reduceRunEvent(state, { streamId: '6', event: { type: 'TOOL_CALL_START', toolCallId: `tool-${runId}`, toolCallName: 'flightData.queryMetrics' } });
  state = reduceRunEvent(state, { streamId: '7', event: { type: 'TOOL_CALL_ARGS', toolCallId: `tool-${runId}`, delta: '{"fab":"F15B"}' } });
  state = reduceRunEvent(state, { streamId: '8', event: { type: 'TOOL_CALL_END', toolCallId: `tool-${runId}` } });
  state = reduceRunEvent(state, { streamId: '9', event: { type: 'TOOL_CALL_RESULT', toolCallId: `tool-${runId}`, content: { anomalies: 2, status: 'ok' } } });
  state = reduceRunEvent(state, { streamId: '10', event: { type: 'TEXT_MESSAGE_START', messageId: `assistant-${runId}`, role: 'assistant' } });
  state = reduceRunEvent(state, { streamId: '11', event: { type: 'TEXT_MESSAGE_CONTENT', messageId: `assistant-${runId}`, delta: '分析完成' } });
  state = reduceRunEvent(state, { streamId: '12', event: { type: 'TEXT_MESSAGE_END', messageId: `assistant-${runId}` } });
  state = reduceRunEvent(state, { streamId: '13', event: { type: 'ACTIVITY_SNAPSHOT', messageId: `surface-${runId}`, activityType: 'a2ui.surface', surfaceId: `surface-${runId}`, content: { catalogId: 'agentdock://catalog' } } });
  state = reduceRunEvent(state, { streamId: '14', event: { type: 'RUN_FINISHED', threadId: state.threadId, runId } });
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

test('单 Agent 运行结束 flush 后：checkpoint + 全部可见消息 + sessions 时间戳落库', async () => {
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
  assert.equal(checkpoint?.runId, runId);
  assert.equal(checkpoint?.status, 'success');
  assert.equal(checkpoint?.snapshot.messages[`assistant-${runId}`]?.content, '分析完成');

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
  await wait(500);
  const checkpoint = await sessionHistoryService.getLatestRun(sessionId);
  assert.equal(checkpoint?.runId, runId, '防抖定时器到期后应自动落盘');
  await flushRunCheckpoint();
});

test('刷新后恢复：getMessages / getLatestRun 返回与落库时一致的数据', async () => {
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
  assert.equal(checkpoint?.snapshot.status, 'success');
  assert.equal(checkpoint?.snapshot.latestStreamId, snapshot.latestStreamId);
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
  scheduleRunCheckpoint(sessionId, input, snapshot);
  await flushRunCheckpoint();

  const checkpoint = await sessionHistoryService.getLatestRun(sessionId);
  assert.equal(checkpoint?.runId, runId);
  assert.equal(checkpoint?.sessionId, sessionId);
  assert.equal(checkpoint?.threadId, `thread-${sessionId}`);
  assert.equal(checkpoint?.latestStreamId, snapshot.latestStreamId);
  assert.equal(checkpoint?.snapshot.runId, runId);
  assert.equal(checkpoint?.snapshot.threadId, `thread-${sessionId}`);
  assert.ok(snapshot.processedStreamIds.includes(snapshot.latestStreamId!), 'latestStreamId 应已去重集合收录');

  const messages = await sessionHistoryService.getMessages(sessionId);
  assert.ok(messages.length > 0);
  for (const record of messages) {
    assert.equal(record.sessionId, sessionId);
    assert.equal(record.runId, runId);
    if (record.streamId) {
      assert.ok(Number(record.streamId) <= Number(snapshot.latestStreamId), '消息游标不得晚于 run 终态游标');
    }
  }
  const assistant = messages.find((record) => record.kind === 'text' && record.role === 'assistant');
  assert.equal(assistant?.streamId, '12', '助手文本应记录其最后一次更新的 streamId（TEXT_MESSAGE_END）');

  // 同一会话第二次 run：threadId 复用、runId 更新
  const runId2 = 'run-invariants-2';
  const second = buildSingleAgentRun(sessionId, runId2);
  scheduleRunCheckpoint(sessionId, second.input, second.snapshot);
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
    scheduleRunCheckpoint(sessionId, input, snapshot);
    await flushRunCheckpoint();
  }
  for (const [sessionId, runId] of cases) {
    const messages = await sessionHistoryService.getMessages(sessionId);
    assert.ok(messages.length > 0);
    assert.ok(messages.every((record) => record.sessionId === sessionId && record.runId === runId), `${sessionId} 不应混入其他会话数据`);
    assert.equal((await sessionHistoryService.getLatestRun(sessionId))?.runId, runId);
  }
});

test('removeTurn 整轮删除（用户文本 + 回复 + 过程块 + checkpoint）', async () => {
  await flushRunCheckpoint();
  const sessionId = 'session-remove-branch';
  const runId = 'run-remove-branch';
  const { input, snapshot } = buildSingleAgentRun(sessionId, runId);
  await sessionHistoryService.saveRunCheckpoint(sessionId, input, snapshot);
  const before = await sessionHistoryService.getMessages(sessionId);
  const userMessageId = input.messages[0].id;
  assert.ok(before.some((record) => record.id === `text:${userMessageId}`));
  assert.ok(before.some((record) => record.kind === 'tool'));

  await sessionHistoryService.removeTurn(sessionId, userMessageId);
  const after = await sessionHistoryService.getMessages(sessionId);
  assert.equal(after.some((record) => record.id === `text:${userMessageId}`), false);
  // 助手回复与过程块（tool/reasoning/step）随该轮一并删除
  assert.equal(after.some((record) => record.kind === 'text'), false);
  assert.equal(after.some((record) => record.kind === 'tool'), false);
  assert.equal(after.some((record) => record.kind === 'reasoning'), false);
  // checkpoint 不复活已删消息
  const latest = await sessionHistoryService.getLatestRun(sessionId);
  assert.equal(latest, undefined);
});

test('updateMessageContent 同步消息行与 checkpoint 快照', async () => {
  await flushRunCheckpoint();
  const sessionId = 'session-edit-content';
  const runId = 'run-edit-content';
  const { input, snapshot } = buildSingleAgentRun(sessionId, runId);
  await sessionHistoryService.saveRunCheckpoint(sessionId, input, snapshot);
  const userMessageId = input.messages[0].id;

  await sessionHistoryService.updateMessageContent(sessionId, userMessageId, '编辑后的新问题');
  const records = await sessionHistoryService.getMessages(sessionId);
  const record = records.find((item) => item.id === `text:${userMessageId}`);
  assert.equal(record?.content, '编辑后的新问题');
  const checkpoint = await sessionHistoryService.getLatestRun(sessionId);
  assert.equal(checkpoint?.snapshot.messages[userMessageId].content, '编辑后的新问题');
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
