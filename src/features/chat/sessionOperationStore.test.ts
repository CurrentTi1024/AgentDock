import 'fake-indexeddb/auto';

import assert from 'node:assert/strict';
import test from 'node:test';

import { cancelPendingCheckpoint } from '../../api/session/sessionHistoryService.ts';
import { createRunState } from '../../api/runtime/runReducer.ts';
import type { RunAgentInput } from '../../api/runtime/types.ts';
import { sessionOperationService } from './runtime/sessionOperationService.ts';
import type { SessionOperation } from './runtime/types.ts';
import { useSessionOperationStore } from '../../stores/sessionOperationStore.ts';

const resetStore = () => {
  useSessionOperationStore.setState({
    activeRunBySession: {},
    operationsById: {},
    runtimeBySession: {},
    viewingSessionId: undefined,
  });
};

const addOperation = (sessionId: string, runId: string): SessionOperation => {
  const input: RunAgentInput = {
    context: [],
    forwardedProps: { action: 'run', agentId: 'agent', fab: 'FAB', sessionId },
    messages: [{ content: sessionId, id: `user-${runId}`, role: 'user' }],
    runId,
    state: {},
    threadId: `thread-${sessionId}`,
    tools: [],
  };
  const snapshot = createRunState(runId, input.threadId);
  snapshot.status = 'running';
  const operation: SessionOperation = {
    input,
    operationId: runId,
    runId,
    sessionId,
    snapshot,
    startedAt: Date.now(),
    status: 'running',
    threadId: input.threadId,
  };
  useSessionOperationStore.getState().addOperation(operation);
  return operation;
};

test('独立订阅按捕获的 sessionId 路由：A 事件不会更新 B', async () => {
  resetStore();
  addOperation('session-A', 'run-A');
  addOperation('session-B', 'run-B');

  sessionOperationService.applyEvent(
    { sessionId: 'session-A', threadId: 'thread-session-A' },
    {
      messageId: 'assistant-A',
      rawEvent: { eventId: 'event-A-1' },
      role: 'assistant',
      type: 'TEXT_MESSAGE_START',
    },
  );
  sessionOperationService.applyEvent(
    { sessionId: 'session-A', threadId: 'thread-session-A' },
    {
      delta: 'A answer',
      messageId: 'assistant-A',
      rawEvent: { eventId: 'event-A-2' },
      type: 'TEXT_MESSAGE_CONTENT',
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 80));
  const state = useSessionOperationStore.getState();
  assert.equal(state.operationsById['run-A'].snapshot.messages['assistant-A']?.content, 'A answer');
  assert.equal(state.operationsById['run-B'].snapshot.messages['assistant-A'], undefined);
  // React 投影 50ms 节流，但 reducer 热状态已推进；重复 eventId 不会串入 B。
  sessionOperationService.applyEvent(
    { sessionId: 'session-B', threadId: 'thread-session-B' },
    {
      delta: 'B answer',
      messageId: 'assistant-B',
      rawEvent: { eventId: 'event-B-1' },
      type: 'TEXT_MESSAGE_CONTENT',
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(useSessionOperationStore.getState().operationsById['run-A'].sessionId, 'session-A');
  assert.equal(useSessionOperationStore.getState().operationsById['run-B'].sessionId, 'session-B');

  cancelPendingCheckpoint('run-A');
  cancelPendingCheckpoint('run-B');
});

test('RUN_STARTED 携带其他 active runId 时拒绝跨 Session 写入', () => {
  resetStore();
  addOperation('session-A', 'run-A');
  addOperation('session-B', 'run-B');

  sessionOperationService.applyEvent(
    { sessionId: 'session-A', threadId: 'thread-session-A' },
    {
      rawEvent: { eventId: 'mismatch-1' },
      runId: 'run-B',
      threadId: 'thread-session-B',
      type: 'RUN_STARTED',
    },
  );

  assert.equal(useSessionOperationStore.getState().operationsById['run-A'].snapshot.processedEventIds.length, 0);
  assert.equal(useSessionOperationStore.getState().operationsById['run-B'].snapshot.processedEventIds.length, 0);
  cancelPendingCheckpoint('run-A');
  cancelPendingCheckpoint('run-B');
});
