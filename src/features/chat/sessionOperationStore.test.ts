import 'fake-indexeddb/auto';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cancelPendingCheckpoint,
  sessionDatabase,
  sessionHistoryService,
} from '../../api/session/sessionHistoryService.ts';
import { createRunState } from '../../api/runtime/runReducer.ts';
import type { RunAgentInput } from '../../api/runtime/types.ts';
import {
  bindEventToRun,
  sessionOperationService,
} from './runtime/sessionOperationService.ts';
import { sessionRuntimeRegistry } from './runtime/sessionRuntimeRegistry.ts';
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

const createSessionRecord = async (operation: SessionOperation) => {
  await sessionHistoryService.createSession({
    agentId: operation.input.forwardedProps.agentId,
    agentName: 'Test Agent',
    fab: operation.input.forwardedProps.fab,
    id: operation.sessionId,
    pinned: false,
    threadId: operation.threadId,
    title: operation.sessionId,
    type: 'agent',
  });
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

test('同一 Session 的旧 thread 订阅事件不会写入新 operation', () => {
  resetStore();
  addOperation('session-A', 'run-A');

  sessionOperationService.applyEvent(
    { sessionId: 'session-A', threadId: 'thread-stale' },
    {
      delta: 'stale answer',
      messageId: 'assistant-stale',
      rawEvent: { eventId: 'stale-thread-event' },
      type: 'TEXT_MESSAGE_CONTENT',
    },
  );

  assert.equal(
    useSessionOperationStore.getState().operationsById['run-A'].snapshot.messages['assistant-stale'],
    undefined,
  );
  cancelPendingCheckpoint('run-A');
});

test('subscriber input 为无 runId 事件绑定旧 run，迟到事件不会污染新 run', async () => {
  resetStore();
  const oldOperation = addOperation('session-late', 'run-old');
  const newOperation = addOperation('session-late', 'run-new');
  const event = bindEventToRun(
    {
      delta: 'late old answer',
      messageId: 'assistant-late',
      rawEvent: { eventId: 'late-event-1' },
      type: 'TEXT_MESSAGE_CONTENT',
    },
    oldOperation.input,
  );

  sessionOperationService.applyEvent(
    { sessionId: newOperation.sessionId, threadId: newOperation.threadId },
    event,
  );
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.equal(
    useSessionOperationStore.getState().operationsById['run-new'].snapshot.messages['assistant-late'],
    undefined,
  );
  cancelPendingCheckpoint('run-old');
  cancelPendingCheckpoint('run-new');
});

test('RUN_FINISHED interrupt 推进 cursor、保留全部审批并进入 paused', async () => {
  resetStore();
  const operation = addOperation('session-hitl-cursor', 'run-hitl-cursor');
  sessionOperationService.applyRunFinished(
    { sessionId: operation.sessionId, threadId: operation.threadId },
    {
      rawEvent: { eventId: 'interrupt-event-7' },
      runId: operation.runId,
      threadId: operation.threadId,
      type: 'RUN_FINISHED',
    },
    'interrupt',
    [{ id: 'approval-1' }, { id: 'approval-2' }],
  );
  await new Promise((resolve) => setTimeout(resolve, 80));

  const snapshot = useSessionOperationStore.getState().operationsById[operation.runId].snapshot;
  assert.equal(snapshot.status, 'paused');
  assert.equal(snapshot.latestEventId, 'interrupt-event-7');
  assert.equal(Object.keys(snapshot.activities).length, 2);
  await sessionOperationService.disposeSession(operation.sessionId);
});

test('缺少 interrupt payload 的中断按协议错误终止，不永久停在 running', async () => {
  resetStore();
  const operation = addOperation('session-empty-interrupt', 'run-empty-interrupt');
  sessionOperationService.applyRunFinished(
    { sessionId: operation.sessionId, threadId: operation.threadId },
    {
      rawEvent: { eventId: 'interrupt-empty-1' },
      runId: operation.runId,
      threadId: operation.threadId,
      type: 'RUN_FINISHED',
    },
    'interrupt',
    [],
  );
  await new Promise((resolve) => setTimeout(resolve, 80));

  const snapshot = useSessionOperationStore.getState().operationsById[operation.runId].snapshot;
  assert.equal(snapshot.status, 'error');
  assert.equal(snapshot.error?.code, 'INTERRUPT_MISSING');
  assert.equal(snapshot.latestEventId, 'interrupt-empty-1');
  await sessionOperationService.disposeSession(operation.sessionId);
});

test('HITL 恢复异步失败不得把已停止 run 从 cancelled 复活为 paused', async () => {
  resetStore();
  const operation = addOperation('session-hitl-stop', 'run-hitl-stop');
  operation.snapshot.status = 'paused';
  useSessionOperationStore.getState().updateOperation(operation.runId, {
    snapshot: operation.snapshot,
    status: 'paused',
  });

  const originalLocalStorage = globalThis.localStorage;
  const values = new Map<string, string>([['agentdock-chat-mode', 'http']]);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } as Storage,
  });
  let rejectResume!: (reason: Error) => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const resume = new Promise<void>((_resolve, reject) => { rejectResume = reject; });
  const handle = {
    isReady: () => true,
    respondToHitl: async () => {
      markStarted();
      await resume;
    },
    run: async () => {},
    stop: async () => {},
  };
  sessionRuntimeRegistry.register(operation.sessionId, handle);

  try {
    const responding = sessionOperationService.respondToHitl(operation.sessionId, {
      decision: 'approve',
      mode: 'approval',
      requestId: 'approval-stop-race',
    });
    await started;
    await sessionOperationService.stop(operation.sessionId);
    rejectResume(new Error('late resume failure'));
    await responding;
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.equal(
      useSessionOperationStore.getState().operationsById[operation.runId]?.snapshot.status,
      'cancelled',
    );
    await sessionOperationService.disposeSession(operation.sessionId);
  } finally {
    sessionRuntimeRegistry.unregister(operation.sessionId, handle);
    cancelPendingCheckpoint(operation.runId);
    if (originalLocalStorage) {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: originalLocalStorage,
      });
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
    resetStore();
  }
});

test('paused checkpoint 恢复使用 checkpoint 的权威 threadId，而不是页面临时值', async () => {
  resetStore();
  await sessionDatabase.delete();
  await sessionDatabase.open();
  const operation = addOperation('session-restore', 'run-restore');
  await createSessionRecord(operation);
  operation.snapshot.status = 'paused';
  await sessionHistoryService.saveRunCheckpoint(
    operation.sessionId,
    operation.input,
    operation.snapshot,
  );
  resetStore();

  await sessionOperationService.restore({
    agentId: 'temporary-agent',
    fab: 'TEMP',
    sessionId: operation.sessionId,
    threadId: 'thread-temporary',
  });

  const state = useSessionOperationStore.getState();
  assert.equal(state.operationsById['run-restore']?.threadId, 'thread-session-restore');
  assert.equal(state.runtimeBySession['session-restore']?.threadId, 'thread-session-restore');
  cancelPendingCheckpoint('run-restore');
  resetStore();
});

test('restore 读取 checkpoint 期间若新 run 已启动，不得用旧 run 覆盖 active 映射', async () => {
  resetStore();
  await sessionDatabase.delete();
  await sessionDatabase.open();
  const oldOperation = addOperation('session-restore-race', 'run-old');
  await createSessionRecord(oldOperation);
  oldOperation.snapshot.status = 'paused';
  await sessionHistoryService.saveRunCheckpoint(
    oldOperation.sessionId,
    oldOperation.input,
    oldOperation.snapshot,
  );
  resetStore();

  const originalGetLatest = sessionHistoryService.getLatestRecoverableRun;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  sessionHistoryService.getLatestRecoverableRun = async (sessionId) => {
    await gate;
    return originalGetLatest.call(sessionHistoryService, sessionId);
  };
  try {
    const restoring = sessionOperationService.restore({
      agentId: 'agent',
      fab: 'FAB',
      sessionId: oldOperation.sessionId,
      threadId: oldOperation.threadId,
    });
    addOperation(oldOperation.sessionId, 'run-new');
    release();
    await restoring;
    const state = useSessionOperationStore.getState();
    assert.equal(state.activeRunBySession[oldOperation.sessionId], 'run-new');
    assert.equal(state.operationsById['run-old'], undefined);
  } finally {
    sessionHistoryService.getLatestRecoverableRun = originalGetLatest;
    cancelPendingCheckpoint('run-new');
    resetStore();
  }
});

test('runtime reset 会立即拒绝等待者，不遗留 15 秒定时等待', async () => {
  const waiting = sessionRuntimeRegistry.whenReady('session-runtime-reset');
  sessionRuntimeRegistry.reset('session-runtime-reset', 'disposed for test');
  await assert.rejects(waiting, /disposed for test/);
});

test('running checkpoint 有 latestEventId 时按同 runId 发起 resume 并完成', async () => {
  resetStore();
  await sessionDatabase.delete();
  await sessionDatabase.open();
  const operation = addOperation('session-resume', 'run-resume');
  await createSessionRecord(operation);
  operation.snapshot.latestEventId = 'event-cursor-10';
  await sessionHistoryService.saveRunCheckpoint(
    operation.sessionId,
    operation.input,
    operation.snapshot,
  );
  resetStore();

  await sessionOperationService.restore({
    agentId: 'temporary-agent',
    fab: 'TEMP',
    sessionId: operation.sessionId,
    threadId: 'thread-temporary',
  });

  const restored = useSessionOperationStore.getState().operationsById['run-resume'];
  assert.equal(restored?.input.forwardedProps.action, 'resume');
  assert.equal(restored?.input.forwardedProps.resume?.lastEventId, 'event-cursor-10');
  assert.equal(restored?.runId, 'run-resume');
  assert.equal(restored?.snapshot.status, 'success');
  await sessionOperationService.disposeSession(operation.sessionId);
  resetStore();
});
