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
