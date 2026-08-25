import assert from 'node:assert/strict';
import test from 'node:test';

import { createAgentRuntimeMockEvents } from '../../mock-data/agentRuntime.ts';
import { createRunState, reduceRunEvent } from './runReducer.ts';
import type { RunAgentInput } from './types.ts';

const buildInput = (message: string, runId = 'scenario-run'): RunAgentInput => ({
  context: [],
  forwardedProps: { action: 'run', agentId: 'flight-analysis', fab: 'F15B', sessionId: 'scenario-session' },
  messages: [{ content: message, id: 'user-scenario', role: 'user' }],
  runId,
  state: {},
  threadId: 'thread-scenario',
  tools: [],
});

const collect = async (input: RunAgentInput) => {
  const events = [];
  for await (const event of createAgentRuntimeMockEvents(input)) events.push(event);
  return events;
};

test('Mock 场景注入：!error 触发上游 RUN_ERROR，assistant 生成错误回复', async () => {
  const events = await collect(buildInput('!error 帮我查一下数据'));
  assert.ok(events.some((event) => event.type === 'RUN_ERROR' && event.code === 'BACKEND_ERROR'), '应产出结构化 RUN_ERROR');
  assert.equal(events.some((event) => event.type === 'TEXT_MESSAGE_START'), false, '后端直接报错不应有正常回复');
  let state = createRunState('scenario-run', 'thread-scenario');
  for (const event of events) state = reduceRunEvent(state, { event, eventId: event.rawEvent?.eventId });
  assert.equal(state.status, 'error');
  const errorText = Object.values(state.messages).find((message) => message.role === 'assistant')?.content || '';
  assert.match(errorText, /Mock 后端错误/);
});

test('Mock 场景注入：!partial-error 部分回复后追加错误为最后一个 chunk', async () => {
  const events = await collect(buildInput('!partial-error'));
  let state = createRunState('scenario-run', 'thread-scenario');
  for (const event of events) state = reduceRunEvent(state, { event, eventId: event.rawEvent?.eventId });
  const assistant = Object.values(state.messages).find((message) => message.role === 'assistant');
  assert.ok(assistant, '应有 assistant 消息');
  assert.match(assistant!.content, /已经生成了部分回复/);
  assert.match(assistant!.content, /Mock 后端错误/);
  assert.ok(assistant!.content.indexOf('Mock 后端错误') > assistant!.content.indexOf('部分回复'), '错误追加在部分回复之后');
  assert.equal(state.status, 'error');
});

test('Mock 场景注入：!runtime-error 流中断由调用方兜底（generator 抛错）', async () => {
  await assert.rejects(() => collect(buildInput('!runtime-error')), /Mocked runtime stream interruption/);
});

test('Mock 场景注入：普通输入不受影响（无 RUN_ERROR）', async () => {
  const events = await collect(buildInput('今天数据如何'));
  assert.equal(events.some((event) => event.type === 'RUN_ERROR'), false, '普通输入不触发错误');
  assert.ok(events.some((event) => event.type === 'ACTIVITY_SNAPSHOT'), '正常 mock 流程（HITL 活动）');
});
