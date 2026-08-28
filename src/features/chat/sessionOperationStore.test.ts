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

const installHttpChatMode = () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>([['agentdock-chat-mode', 'http']]);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } as Storage,
  });
  return () => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  };
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
      eventId: 'event-A-1',
      role: 'assistant',
      type: 'TEXT_MESSAGE_START',
    },
  );
  sessionOperationService.applyEvent(
    { sessionId: 'session-A', threadId: 'thread-session-A' },
    {
      delta: 'A answer',
      messageId: 'assistant-A',
      eventId: 'event-A-2',
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
      eventId: 'event-B-1',
      type: 'TEXT_MESSAGE_CONTENT',
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(useSessionOperationStore.getState().operationsById['run-A'].sessionId, 'session-A');
  assert.equal(useSessionOperationStore.getState().operationsById['run-B'].sessionId, 'session-B');

  cancelPendingCheckpoint('run-A');
  cancelPendingCheckpoint('run-B');
});

test('顶层 eventId 用于事件去重与断点游标', async () => {
  resetStore();
  const operation = addOperation('session-top-level-cursor', 'run-top-level-cursor');
  const event = {
    delta: 'only once',
    eventId: 'cursor-top-level-1',
    messageId: 'assistant-top-level-cursor',
    type: 'TEXT_MESSAGE_CONTENT',
  };

  sessionOperationService.applyEvent(
    { sessionId: operation.sessionId, threadId: operation.threadId },
    event,
  );
  sessionOperationService.applyEvent(
    { sessionId: operation.sessionId, threadId: operation.threadId },
    event,
  );
  await new Promise((resolve) => setTimeout(resolve, 80));

  const snapshot = useSessionOperationStore.getState().operationsById[operation.runId].snapshot;
  assert.equal(snapshot.messages['assistant-top-level-cursor']?.content, 'only once');
  assert.equal(snapshot.latestEventId, 'cursor-top-level-1');
  assert.deepEqual(snapshot.processedEventIds, ['cursor-top-level-1']);
  await sessionOperationService.disposeSession(operation.sessionId);
});

test('RUN_STARTED 携带其他 active runId 时拒绝跨 Session 写入', () => {
  resetStore();
  addOperation('session-A', 'run-A');
  addOperation('session-B', 'run-B');

  sessionOperationService.applyEvent(
    { sessionId: 'session-A', threadId: 'thread-session-A' },
    {
      eventId: 'mismatch-1',
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
      eventId: 'stale-thread-event',
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
      eventId: 'late-event-1',
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

test('subscriber input 覆盖上游自定义 run/thread id，终态归属客户端 operation', () => {
  const bound = bindEventToRun(
    { runId: 'backend-run', threadId: 'backend-thread', type: 'RUN_FINISHED' },
    { runId: 'client-run', threadId: 'client-thread' },
  );
  assert.equal(bound.runId, 'client-run');
  assert.equal(bound.threadId, 'client-thread');
});

test('多 Session 分别收到顶层 eventId 终态事件后，各自退出运行态', async () => {
  resetStore();
  const operationA = addOperation('terminal-session-A', 'terminal-run-A');
  const operationB = addOperation('terminal-session-B', 'terminal-run-B');
  sessionOperationService.setViewingSession(operationB.sessionId);

  sessionOperationService.applyEvent(
    { sessionId: operationA.sessionId, threadId: operationA.threadId },
    {
      eventId: 'terminal-A-1',
      runId: operationA.runId,
      threadId: operationA.threadId,
      type: 'RUN_FINISHED',
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 80));

  let state = useSessionOperationStore.getState();
  assert.equal(state.operationsById[operationA.runId]?.snapshot.status, 'success');
  assert.equal(state.operationsById[operationA.runId]?.status, 'success');
  assert.equal(state.operationsById[operationA.runId]?.latestEventId, 'terminal-A-1');
  assert.equal(state.operationsById[operationB.runId]?.snapshot.status, 'running');

  sessionOperationService.applyEvent(
    { sessionId: operationB.sessionId, threadId: operationB.threadId },
    {
      eventId: 'terminal-B-1',
      runId: operationB.runId,
      threadId: operationB.threadId,
      type: 'RUN_FINISHED',
    },
  );
  sessionOperationService.setViewingSession(operationA.sessionId);
  await new Promise((resolve) => setTimeout(resolve, 80));

  state = useSessionOperationStore.getState();
  assert.equal(state.operationsById[operationA.runId]?.snapshot.status, 'success');
  assert.equal(state.operationsById[operationB.runId]?.snapshot.status, 'success');
  assert.equal(state.operationsById[operationB.runId]?.status, 'success');
  assert.equal(state.operationsById[operationB.runId]?.latestEventId, 'terminal-B-1');
  await Promise.all([
    sessionOperationService.disposeSession(operationA.sessionId),
    sessionOperationService.disposeSession(operationB.sessionId),
  ]);
});

test('终态 Operation 全局保留不超过 50 个，避免 Session 数增长造成热内存堆积', async () => {
  resetStore();
  const operations = Array.from({ length: 55 }, (_, index) =>
    addOperation(`bounded-session-${index}`, `bounded-run-${index}`));
  for (const [index, operation] of operations.entries()) {
    sessionOperationService.applyEvent(
      { sessionId: operation.sessionId, threadId: operation.threadId },
      {
        eventId: `bounded-terminal-${index}`,
        runId: operation.runId,
        threadId: operation.threadId,
        type: 'RUN_FINISHED',
      },
    );
  }

  const state = useSessionOperationStore.getState();
  assert.equal(Object.keys(state.operationsById).length, 50);
  assert.equal(state.operationsById['bounded-run-0'], undefined);
  assert.ok(state.operationsById['bounded-run-54']);
  await Promise.all(
    operations.map((operation) => sessionOperationService.disposeSession(operation.sessionId)),
  );
  assert.equal(Object.keys(useSessionOperationStore.getState().operationsById).length, 0);
});

test('disposeSession 清理同一 Session 的 active 与旧 Operation 残留', async () => {
  resetStore();
  addOperation('dispose-all-runs', 'dispose-old-run').snapshot.status = 'success';
  const active = addOperation('dispose-all-runs', 'dispose-active-run');
  active.snapshot.status = 'success';
  useSessionOperationStore.getState().updateOperation(active.runId, {
    snapshot: active.snapshot,
    status: 'success',
  });

  await sessionOperationService.disposeSession('dispose-all-runs');
  const state = useSessionOperationStore.getState();
  assert.equal(state.operationsById['dispose-old-run'], undefined);
  assert.equal(state.operationsById['dispose-active-run'], undefined);
  assert.equal(state.activeRunBySession['dispose-all-runs'], undefined);
});

test('Runtime Worker 水合只加载最近 200 条用户/助手文本', async () => {
  resetStore();
  await sessionDatabase.delete();
  await sessionDatabase.open();
  const operation = addOperation('bounded-hydration', 'bounded-hydration-run');
  await createSessionRecord(operation);
  await sessionDatabase.sessionMessages.bulkPut(
    Array.from({ length: 250 }, (_, index) => ({
      content: `content-${index}`,
      createdAt: new Date(1_700_000_000_000 + index).toISOString(),
      id: `text:hydration-${index}`,
      kind: 'text' as const,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      runId: `hydration-run-${index}`,
      sequence: index + 1,
      sessionId: operation.sessionId,
    })),
  );

  const messages = await sessionOperationService.hydrateRuntime(operation.sessionId);
  assert.equal(messages.length, 200);
  assert.equal(messages[0]?.id, 'hydration-50');
  assert.equal(messages.at(-1)?.id, 'hydration-249');
  await sessionOperationService.disposeSession(operation.sessionId);
});

test('Runtime 流正常关闭但没有 RUN_FINISHED 时，单/多 Session 都会退出 running', async () => {
  resetStore();
  const restoreChatMode = installHttpChatMode();
  const contexts = ['stream-close-a', 'stream-close-b'].map((sessionId) => ({
    agentId: 'agent',
    fab: 'FAB',
    sessionId,
    threadId: `thread-${sessionId}`,
  }));
  const handles = contexts.map(() => ({
    isReady: () => true,
    respondToHitl: async () => {},
    run: async () => {},
    stop: async () => {},
  }));
  try {
    const sending = contexts.map((context) => sessionOperationService.send(context, 'hello'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    contexts.forEach((context, index) => sessionRuntimeRegistry.register(context.sessionId, handles[index]));
    await Promise.all(sending);
    await new Promise((resolve) => setTimeout(resolve, 80));

    for (const context of contexts) {
      const runId = useSessionOperationStore.getState().activeRunBySession[context.sessionId];
      assert.equal(useSessionOperationStore.getState().operationsById[runId!]?.snapshot.status, 'success');
    }
  } finally {
    await Promise.all(contexts.map((context) => sessionOperationService.disposeSession(context.sessionId)));
    contexts.forEach((context, index) => sessionRuntimeRegistry.unregister(context.sessionId, handles[index]));
    restoreChatMode();
    resetStore();
  }
});

test('Runtime 已投影 RUN_ERROR 后关闭流，success 兜底不会覆盖 error', async () => {
  resetStore();
  const restoreChatMode = installHttpChatMode();
  const context = {
    agentId: 'agent',
    fab: 'FAB',
    sessionId: 'stream-error',
    threadId: 'thread-stream-error',
  };
  const handle = {
    isReady: () => true,
    respondToHitl: async () => {},
    run: async (input: RunAgentInput) => {
      sessionOperationService.applyEvent(
        { sessionId: context.sessionId, threadId: context.threadId },
        {
          code: 'BACKEND_ERROR',
          message: 'backend failed',
          runId: input.runId,
          threadId: input.threadId,
          type: 'RUN_ERROR',
        },
      );
    },
    stop: async () => {},
  };
  try {
    const sending = sessionOperationService.send(context, 'fail');
    await new Promise((resolve) => setTimeout(resolve, 0));
    sessionRuntimeRegistry.register(context.sessionId, handle);
    await sending;
    await new Promise((resolve) => setTimeout(resolve, 80));

    const runId = useSessionOperationStore.getState().activeRunBySession[context.sessionId];
    const snapshot = useSessionOperationStore.getState().operationsById[runId!]?.snapshot;
    assert.equal(snapshot?.status, 'error');
    assert.equal(snapshot?.error?.code, 'BACKEND_ERROR');
  } finally {
    await sessionOperationService.disposeSession(context.sessionId);
    sessionRuntimeRegistry.unregister(context.sessionId, handle);
    restoreChatMode();
    resetStore();
  }
});

test('Stop 触发 Runtime 流关闭时保持 cancelled，不被关闭兜底改成 success', async () => {
  resetStore();
  const restoreChatMode = installHttpChatMode();
  const context = {
    agentId: 'agent',
    fab: 'FAB',
    sessionId: 'stream-stop',
    threadId: 'thread-stream-stop',
  };
  let closeStream!: () => void;
  let markRunStarted!: () => void;
  let stopCalls = 0;
  const runStarted = new Promise<void>((resolve) => { markRunStarted = resolve; });
  const stream = new Promise<void>((resolve) => { closeStream = resolve; });
  const handle = {
    isReady: () => true,
    respondToHitl: async () => {},
    run: async () => {
      markRunStarted();
      await stream;
    },
    stop: async () => {
      stopCalls += 1;
      closeStream();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
  try {
    const sending = sessionOperationService.send(context, 'stop me');
    await new Promise((resolve) => setTimeout(resolve, 0));
    sessionRuntimeRegistry.register(context.sessionId, handle);
    await runStarted;
    await Promise.all([
      sessionOperationService.stop(context.sessionId),
      sessionOperationService.stop(context.sessionId),
    ]);
    await sending;
    await new Promise((resolve) => setTimeout(resolve, 80));

    const runId = useSessionOperationStore.getState().activeRunBySession[context.sessionId];
    assert.equal(useSessionOperationStore.getState().operationsById[runId!]?.snapshot.status, 'cancelled');
    assert.equal(stopCalls, 1);
  } finally {
    await sessionOperationService.disposeSession(context.sessionId);
    sessionRuntimeRegistry.unregister(context.sessionId, handle);
    restoreChatMode();
    resetStore();
  }
});

test('远端 stop 尚未返回时，当前 Session 已立即退出运行态', async () => {
  resetStore();
  const restoreChatMode = installHttpChatMode();
  const operation = addOperation('stop-local-first', 'run-stop-local-first');
  let releaseStop!: () => void;
  const remoteStop = new Promise<void>((resolve) => { releaseStop = resolve; });
  const handle = {
    isReady: () => true,
    respondToHitl: async () => {},
    run: async () => {},
    stop: async () => remoteStop,
  };
  sessionRuntimeRegistry.register(operation.sessionId, handle);
  try {
    const stopping = sessionOperationService.stop(operation.sessionId);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const snapshot = useSessionOperationStore.getState().operationsById[operation.runId]?.snapshot;
    assert.equal(snapshot?.status, 'cancelled');
    releaseStop();
    await stopping;
  } finally {
    releaseStop();
    await sessionOperationService.disposeSession(operation.sessionId);
    sessionRuntimeRegistry.unregister(operation.sessionId, handle);
    restoreChatMode();
    resetStore();
  }
});

test('Runtime stop 失败仍安全完成本地取消且不向 UI 抛出 rejection', async () => {
  resetStore();
  const restoreChatMode = installHttpChatMode();
  const operation = addOperation('stop-rejection', 'run-stop-rejection');
  const handle = {
    isReady: () => true,
    respondToHitl: async () => {},
    run: async () => {},
    stop: async () => {
      throw new Error('remote stop unavailable');
    },
  };
  sessionRuntimeRegistry.register(operation.sessionId, handle);
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await assert.doesNotReject(sessionOperationService.stop(operation.sessionId));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const snapshot = useSessionOperationStore.getState().operationsById[operation.runId]?.snapshot;
    assert.equal(snapshot?.status, 'cancelled');
    assert.equal(snapshot?.error?.code, 'CANCELLED');
  } finally {
    console.error = originalConsoleError;
    await sessionOperationService.disposeSession(operation.sessionId);
    sessionRuntimeRegistry.unregister(operation.sessionId, handle);
    restoreChatMode();
    resetStore();
  }
});

test('HITL Runtime 恢复流正常关闭但无终态事件时退出 running', async () => {
  resetStore();
  const operation = addOperation('hitl-stream-close', 'run-hitl-stream-close');
  operation.snapshot.status = 'paused';
  useSessionOperationStore.getState().updateOperation(operation.runId, {
    snapshot: operation.snapshot,
    status: 'paused',
  });
  const restoreChatMode = installHttpChatMode();
  const handle = {
    isReady: () => true,
    respondToHitl: async () => {},
    run: async () => {},
    stop: async () => {},
  };
  sessionRuntimeRegistry.register(operation.sessionId, handle);
  try {
    await sessionOperationService.respondToHitl(operation.sessionId, {
      decision: 'approve',
      mode: 'approval',
      requestId: 'approval-stream-close',
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(
      useSessionOperationStore.getState().operationsById[operation.runId]?.snapshot.status,
      'success',
    );
  } finally {
    await sessionOperationService.disposeSession(operation.sessionId);
    sessionRuntimeRegistry.unregister(operation.sessionId, handle);
    restoreChatMode();
    resetStore();
  }
});

test('RUN_FINISHED interrupt 推进 cursor、保留全部审批并进入 paused', async () => {
  resetStore();
  const operation = addOperation('session-hitl-cursor', 'run-hitl-cursor');
  sessionOperationService.applyRunFinished(
    { sessionId: operation.sessionId, threadId: operation.threadId },
    {
      eventId: 'interrupt-event-7',
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
      eventId: 'interrupt-empty-1',
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

  const restoreChatMode = installHttpChatMode();
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
    restoreChatMode();
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
