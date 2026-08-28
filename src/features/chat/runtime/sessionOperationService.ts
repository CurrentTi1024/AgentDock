import type { Message } from '@ag-ui/client';

import { getChatServiceMode } from '../../../api/core/serviceMode.ts';
import { agentRuntimeService, createRunInput } from '../../../api/runtime/agentRuntimeService.ts';
import { createRunState, finalizeReasoningMeta, reduceRunEvent } from '../../../api/runtime/runReducer.ts';
import type { AgUiEvent, MentionAgentRef, RunAgentInput, RuntimeRunState, StreamedEvent } from '../../../api/runtime/types.ts';
import {
  cancelPendingCheckpoint,
  flushRunCheckpoint,
  scheduleRunCheckpoint,
  sessionHistoryService,
  waitForRunCheckpoint,
} from '../../../api/session/sessionHistoryService.ts';
import {
  isOperationBusy,
  useSessionOperationStore,
} from '../../../stores/sessionOperationStore.ts';

import { sessionRuntimeRegistry } from './sessionRuntimeRegistry.ts';
import type {
  A2uiAction,
  EventRoute,
  HitlResponse,
  OperationStatus,
  SessionOperation,
  SessionRuntimeContext,
} from './types.ts';

const OPERATION_RETAIN_MS = 30_000;
const OPERATION_PERSIST_FAILURE_RETAIN_MS = 5 * 60_000;
const MAX_RETAINED_TERMINAL_OPERATIONS = 50;
const RUNTIME_HYDRATION_TEXT_LIMIT = 200;
const REMOTE_STOP_TIMEOUT_MS = 10_000;
const renderTimers = new Map<string, ReturnType<typeof setTimeout>>();
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
const hotSnapshots = new Map<string, RuntimeRunState>();
const mockControllers = new Map<string, AbortController>();
const stopPromises = new Map<string, Promise<void>>();
const stoppingRuns = new Set<string>();

const waitForRemoteStop = async (task: Promise<void>) => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      task,
      new Promise<void>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Runtime stop timed out.')),
          REMOTE_STOP_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const isTerminal = (status: RuntimeRunState['status']) =>
  status === 'success' || status === 'error' || status === 'cancelled';
const toOperationStatus = (status: RuntimeRunState['status']): OperationStatus =>
  status === 'idle' ? 'booting' : status;

const toStreamedEvent = (event: AgUiEvent): StreamedEvent => ({
  event,
  // 后端契约：eventId 是 AG-UI 事件顶层字段，也是去重与断点续传的唯一游标。
  eventId: typeof event.eventId === 'string' ? event.eventId : undefined,
});

/**
 * Bind every subscriber event to the run that produced the callback. Some upstream agents
 * emit their own run/thread identifiers; CopilotKit's subscriber input is authoritative for
 * the client operation, so source identifiers must never override it and strand the UI busy.
 */
export const bindEventToRun = (
  event: AgUiEvent,
  input: Pick<RunAgentInput, 'runId' | 'threadId'>,
): AgUiEvent => {
  if (
    (typeof event.runId === 'string' && event.runId !== input.runId) ||
    (typeof event.threadId === 'string' && event.threadId !== input.threadId)
  ) {
    console.warn('[AgentDock] upstream event route normalized to subscriber input', {
      inputRunId: input.runId,
      inputThreadId: input.threadId,
      sourceRunId: event.runId,
      sourceThreadId: event.threadId,
      type: event.type,
    });
  }
  return { ...event, runId: input.runId, threadId: input.threadId };
};

const getOperation = (sessionId: string): SessionOperation | undefined => {
  const state = useSessionOperationStore.getState();
  const runId = state.activeRunBySession[sessionId];
  return runId ? state.operationsById[runId] : undefined;
};

const runtimeKey = (context: SessionRuntimeContext) =>
  `${context.sessionId}:${context.threadId}`;

const ensureRuntime = (context: SessionRuntimeContext) => {
  const store = useSessionOperationStore.getState();
  const key = runtimeKey(context);
  // 终态清理已移除 descriptor、但旧 Worker 尚未完成 unmount 时，registry 里仍可能
  // 短暂保留旧 handle；只要当前 descriptor 不是同一 key，就先同步失效。
  if (store.runtimeBySession[context.sessionId]?.key !== key) {
    sessionRuntimeRegistry.reset(context.sessionId, 'Session runtime context changed.');
  }
  store.upsertRuntime({
    ...context,
    key,
    status: 'booting',
  });
};

const pushRenderSnapshot = (runId: string, snapshot: RuntimeRunState, immediate = false) => {
  const publish = () => {
    renderTimers.delete(runId);
    const latest = hotSnapshots.get(runId);
    if (!latest) return;
    useSessionOperationStore.getState().updateOperation(runId, {
      latestEventId: latest.latestEventId,
      snapshot: latest,
      status: toOperationStatus(latest.status),
    });
  };
  if (immediate) {
    const timer = renderTimers.get(runId);
    if (timer) clearTimeout(timer);
    publish();
    return;
  }
  if (!renderTimers.has(runId)) {
    renderTimers.set(runId, setTimeout(publish, 50));
  }
};

const buildAgentMessages = async (sessionId: string): Promise<Message[]> => {
  // CopilotKit Agent 只需要最近上下文；完整可见历史由 ChatPage 的 IndexedDB 分页负责。
  // 禁止每创建一个后台 Worker 就把一个超长 Session 的全部历史复制进内存。
  const history = await sessionHistoryService.getRecentAgentMessages(
    sessionId,
    RUNTIME_HYDRATION_TEXT_LIMIT,
  );
  return history
    .filter(
      (record) =>
        record.kind === 'text' && (record.role === 'user' || record.role === 'assistant'),
    )
    .map((record) => ({
      content: record.content || '',
      id: record.id.replace(/^text:/, ''),
      role: record.role as 'user' | 'assistant',
    }));
};

const releaseOperationResources = (
  operation: SessionOperation,
  options: { keepRuntime?: boolean; reason?: string } = {},
) => {
  const renderTimer = renderTimers.get(operation.runId);
  if (renderTimer) clearTimeout(renderTimer);
  renderTimers.delete(operation.runId);
  const cleanupTimer = cleanupTimers.get(operation.runId);
  if (cleanupTimer) clearTimeout(cleanupTimer);
  cleanupTimers.delete(operation.runId);
  mockControllers.get(operation.runId)?.abort();
  mockControllers.delete(operation.runId);
  hotSnapshots.delete(operation.runId);

  const state = useSessionOperationStore.getState();
  const isActive = state.activeRunBySession[operation.sessionId] === operation.runId;
  state.removeOperation(operation.runId);
  if (!isActive || options.keepRuntime) return;
  const descriptor = useSessionOperationStore.getState().runtimeBySession[operation.sessionId];
  useSessionOperationStore.getState().removeRuntime(operation.sessionId, descriptor?.key);
  sessionRuntimeRegistry.reset(
    operation.sessionId,
    options.reason ?? 'Terminal session runtime was released.',
  );
};

const enforceTerminalRetentionLimit = () => {
  const terminal = Object.values(useSessionOperationStore.getState().operationsById)
    .filter((operation) => !isOperationBusy(operation))
    .sort((a, b) => (a.completedAt ?? a.startedAt) - (b.completedAt ?? b.startedAt));
  const overflow = Math.max(0, terminal.length - MAX_RETAINED_TERMINAL_OPERATIONS);
  for (const operation of terminal.slice(0, overflow)) {
    releaseOperationResources(operation, {
      reason: 'Terminal operation retention limit reached.',
    });
  }
};

const scheduleCleanup = (operation: SessionOperation, retainMs = OPERATION_RETAIN_MS) => {
  const previous = cleanupTimers.get(operation.runId);
  if (previous) clearTimeout(previous);
  cleanupTimers.set(operation.runId, setTimeout(() => {
    // 定时器已经触发，先移除自身引用；即使 Operation 已被其他路径移除或重新进入
    // busy 状态，也不能让已完成的 Timeout handle 永久留在模块级 Map 中。
    cleanupTimers.delete(operation.runId);
    const state = useSessionOperationStore.getState();
    if (state.activeRunBySession[operation.sessionId] !== operation.runId) {
      releaseOperationResources(operation, { keepRuntime: true });
      return;
    }
    const current = state.operationsById[operation.runId];
    if (!current || isOperationBusy(current)) return;
    releaseOperationResources(current);
  }, retainMs));
};

const completeOperation = async (runId: string, snapshot: RuntimeRunState) => {
  const state = useSessionOperationStore.getState();
  const operation = state.operationsById[runId];
  if (!operation || operation.completedAt) return;
  const completedAt = Date.now();
  state.updateOperation(runId, {
    completedAt,
    latestEventId: snapshot.latestEventId,
    snapshot,
    status: toOperationStatus(snapshot.status),
  });
  // 即使 IndexedDB 被阻塞，终态 Operation 的总量也不能随 Session 数无限增长。
  enforceTerminalRetentionLimit();
  let persisted = false;
  for (let attempt = 1; attempt <= 3 && !persisted; attempt += 1) {
    if (!useSessionOperationStore.getState().operationsById[runId]) return;
    try {
      if (attempt > 1) {
        scheduleRunCheckpoint(operation.sessionId, operation.input, snapshot);
      }
      await flushRunCheckpoint(runId);
      persisted = true;
    } catch (error) {
      console.error('[AgentDock] operation checkpoint failed', {
        attempt,
        error,
        runId,
        sessionId: operation.sessionId,
      });
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 300));
      }
    }
  }
  // 落库期间 Session 可能已被用户删除/dispose；此时不能重新挂清理定时器。
  const current = useSessionOperationStore.getState().operationsById[runId];
  if (!current) return;
  // 落库失败时延长内存可见期，但仍设置硬上限，避免存储故障导致 Worker 永久堆积。
  scheduleCleanup(
    { ...current, completedAt, snapshot, status: toOperationStatus(snapshot.status) },
    persisted ? OPERATION_RETAIN_MS : OPERATION_PERSIST_FAILURE_RETAIN_MS,
  );
};

const resolveOperation = (route: EventRoute, event: AgUiEvent) => {
  const state = useSessionOperationStore.getState();
  const activeRunId = state.activeRunBySession[route.sessionId];
  const eventRunId =
    (typeof event.runId === 'string' && event.runId) ||
    (typeof event.rawEvent?.runId === 'string' && event.rawEvent.runId) ||
    undefined;
  const runId = eventRunId ?? activeRunId;
  if (!runId) return undefined;
  const operation = state.operationsById[runId];
  if (!operation || operation.sessionId !== route.sessionId) return undefined;
  const eventThreadId = typeof event.threadId === 'string' ? event.threadId : undefined;
  if (
    operation.threadId !== route.threadId ||
    (eventThreadId && eventThreadId !== operation.threadId)
  ) {
    console.error('[AgentDock] operation thread mismatch', {
      eventThreadId,
      operationThreadId: operation.threadId,
      routeThreadId: route.threadId,
      sessionId: route.sessionId,
      type: event.type,
    });
    return undefined;
  }
  if (eventRunId && activeRunId && eventRunId !== activeRunId) {
    console.error('[AgentDock] operation protocol mismatch', {
      activeRunId,
      eventRunId,
      sessionId: route.sessionId,
      type: event.type,
    });
    return undefined;
  }
  return operation;
};

const applyStreamedEvent = (route: EventRoute, streamed: StreamedEvent) => {
  const operation = resolveOperation(route, streamed.event);
  if (!operation) return;
  const previous = hotSnapshots.get(operation.runId) ?? operation.snapshot;
  const next = reduceRunEvent(previous, streamed);
  if (next === previous) return;
  hotSnapshots.set(operation.runId, next);
  scheduleRunCheckpoint(operation.sessionId, operation.input, next);
  const terminal = isTerminal(next.status);
  pushRenderSnapshot(operation.runId, next, terminal);
  if (terminal) void completeOperation(operation.runId, next);
};

const applySyntheticError = (
  operation: SessionOperation,
  error: unknown,
  code = 'NETWORK_ERROR',
) => {
  const current = hotSnapshots.get(operation.runId) ?? operation.snapshot;
  if (isTerminal(current.status)) return;
  applyStreamedEvent(
    { sessionId: operation.sessionId, threadId: operation.threadId },
    {
      event: {
        code,
        message: error instanceof Error ? error.message : String(error),
        runId: operation.runId,
        threadId: operation.threadId,
        type: 'RUN_ERROR',
      },
    },
  );
};

/**
 * CopilotKit resolves runAgent() when the transport lifecycle closes. Normally RUN_FINISHED
 * already made the snapshot terminal; this fallback only closes the same still-running run.
 * It deliberately leaves paused HITL, errors, cancellations, disposed runs, and newer runs alone.
 */
const finalizeOperationAfterStreamClosed = (operation: SessionOperation) => {
  const current = getOperation(operation.sessionId);
  const snapshot = hotSnapshots.get(operation.runId);
  if (
    current?.runId !== operation.runId ||
    !snapshot ||
    stoppingRuns.has(operation.runId) ||
    snapshot.status !== 'running'
  ) return;
  applyStreamedEvent(
    { sessionId: operation.sessionId, threadId: operation.threadId },
    {
      event: {
        runId: operation.runId,
        threadId: operation.threadId,
        type: 'RUN_FINISHED',
      },
    },
  );
};

const executeMock = async (operation: SessionOperation) => {
  const controller = new AbortController();
  mockControllers.set(operation.runId, controller);
  try {
    for await (const streamed of agentRuntimeService.stream(operation.input, {
      signal: controller.signal,
    })) {
      applyStreamedEvent(
        { sessionId: operation.sessionId, threadId: operation.threadId },
        streamed,
      );
    }
  } catch (error) {
    if ((error as DOMException).name !== 'AbortError') applySyntheticError(operation, error);
  } finally {
    mockControllers.delete(operation.runId);
  }
};

const dispatchOperation = async (operation: SessionOperation) => {
  if (getChatServiceMode() === 'http') {
    const runtime = await sessionRuntimeRegistry.whenReady(operation.sessionId);
    useSessionOperationStore.getState().updateOperation(operation.runId, { status: 'running' });
    await runtime.run(operation.input);
    finalizeOperationAfterStreamClosed(operation);
    return;
  }
  useSessionOperationStore.getState().markRuntimeReady(operation.sessionId);
  useSessionOperationStore.getState().updateOperation(operation.runId, { status: 'running' });
  await executeMock(operation);
  finalizeOperationAfterStreamClosed(operation);
};

const startOperation = (
  context: SessionRuntimeContext,
  input: RunAgentInput,
  initialSnapshot?: RuntimeRunState,
) => {
  const previous = getOperation(context.sessionId);
  if (previous && !isOperationBusy(previous)) {
    // 同 Session 开始下一轮时，上一轮已由 IndexedDB 历史接管；立即释放旧热快照。
    releaseOperationResources(previous, { keepRuntime: true });
  }
  const snapshot = initialSnapshot ?? createRunState(input.runId, input.threadId);
  if (!initialSnapshot) snapshot.status = 'running';
  for (const message of input.messages) {
    snapshot.messages[message.id] = { ...message, runId: input.runId };
    if (!snapshot.messageOrder.includes(message.id)) snapshot.messageOrder.push(message.id);
  }
  const operation: SessionOperation = {
    input,
    operationId: input.runId,
    runId: input.runId,
    sessionId: context.sessionId,
    snapshot,
    startedAt: Date.now(),
    status: initialSnapshot ? toOperationStatus(snapshot.status) : 'booting',
    threadId: context.threadId,
  };
  hotSnapshots.set(input.runId, snapshot);
  ensureRuntime(context);
  useSessionOperationStore.getState().addOperation(operation);
  scheduleRunCheckpoint(context.sessionId, input, snapshot);
  return operation;
};

export const sessionOperationService = {
  applyCustomEvent(route: EventRoute, event: AgUiEvent) {
    // @ag-ui/client 暴露 CUSTOM；现有投影 reducer 的兼容分支使用 CUSTOM_EVENT。
    applyStreamedEvent(route, toStreamedEvent({ ...event, type: 'CUSTOM_EVENT' }));
    const custom = event as { name?: string; value?: { id?: string; message?: string } };
    if (custom.name !== 'on_interrupt') return;
    const operation = resolveOperation(route, event);
    if (!operation) return;
    const requestId = custom.value?.id ?? '';
    useSessionOperationStore.getState().updateOperation(operation.runId, {
      legacyInterruptId: requestId || undefined,
    });
    applyStreamedEvent(route, {
      event: {
        activityType: 'agentDock.hitl',
        content: {
          description: custom.value?.message ?? 'Agent requests your confirmation.',
          requestId,
        },
        messageId: `hitl-${requestId || Date.now()}`,
        type: 'ACTIVITY_SNAPSHOT',
      },
    });
  },

  applyEvent(route: EventRoute, event: AgUiEvent) {
    applyStreamedEvent(route, toStreamedEvent(event));
  },

  applyRunFinished(
    route: EventRoute,
    event: AgUiEvent,
    outcome?: string,
    interrupts: Array<{ id: string; message?: string }> = [],
  ) {
    if (outcome !== 'interrupt') {
      applyStreamedEvent(route, toStreamedEvent(event));
      return;
    }
    const streamed = toStreamedEvent(event);
    if (interrupts.length === 0) {
      applyStreamedEvent(route, {
        event: {
          code: 'INTERRUPT_MISSING',
          message: 'Agent reported an interrupt without an interrupt payload.',
          eventId: streamed.eventId,
          runId: event.runId,
          threadId: event.threadId,
          type: 'RUN_ERROR',
        },
        eventId: streamed.eventId,
      });
      return;
    }
    for (const [index, interrupt] of interrupts.entries()) {
      applyStreamedEvent(route, {
        event: {
          activityType: 'agentDock.hitl',
          content: {
            description: interrupt.message ?? 'Agent requests your confirmation.',
            requestId: interrupt.id,
          },
          messageId: `hitl-${interrupt.id}`,
          eventId: index === 0 ? streamed.eventId : undefined,
          runId: event.runId,
          threadId: event.threadId,
          type: 'ACTIVITY_SNAPSHOT',
        },
        eventId: index === 0 ? streamed.eventId : undefined,
      });
    }
  },

  async hydrateRuntime(sessionId: string) {
    return buildAgentMessages(sessionId);
  },

  async respondToHitl(sessionId: string, response: HitlResponse) {
    const operation = getOperation(sessionId);
    if (!operation || operation.status !== 'paused') return;
    const snapshot = hotSnapshots.get(operation.runId) ?? operation.snapshot;
    const running = { ...snapshot, status: 'running' as const };
    const resumedInput: RunAgentInput = {
      ...operation.input,
      forwardedProps: {
        ...operation.input.forwardedProps,
        action: 'hitlResponse',
        hitlResponse: response,
      },
    };
    hotSnapshots.set(operation.runId, running);
    useSessionOperationStore.getState().updateOperation(operation.runId, {
      input: resumedInput,
      snapshot: running,
      status: 'running',
    });
    try {
      // 先把“审批已提交、正在恢复”写入 checkpoint，关闭点击后到首个新事件之间的刷新窗口。
      scheduleRunCheckpoint(operation.sessionId, resumedInput, running);
      await flushRunCheckpoint(operation.runId);
      const currentBeforeDispatch = getOperation(sessionId);
      const currentSnapshot = hotSnapshots.get(operation.runId);
      if (
        currentBeforeDispatch?.runId !== operation.runId ||
        !currentSnapshot ||
        isTerminal(currentSnapshot.status)
      ) return;
      if (getChatServiceMode() === 'http') {
        const runtime = await sessionRuntimeRegistry.whenReady(sessionId);
        const currentAfterReady = getOperation(sessionId);
        const snapshotAfterReady = hotSnapshots.get(operation.runId);
        if (
          currentAfterReady?.runId !== operation.runId ||
          !snapshotAfterReady ||
          isTerminal(snapshotAfterReady.status)
        ) return;
        await runtime.respondToHitl(resumedInput, response, operation.legacyInterruptId);
        finalizeOperationAfterStreamClosed(operation);
        return;
      }
      const resumed: SessionOperation = {
        ...operation,
        input: resumedInput,
        snapshot: running,
        status: 'running',
      };
      await executeMock(resumed);
      finalizeOperationAfterStreamClosed(resumed);
    } catch (error) {
      const current = getOperation(sessionId);
      const latest = hotSnapshots.get(operation.runId);
      if (current?.runId !== operation.runId || !latest || isTerminal(latest.status)) {
        console.error('[AgentDock] stale HITL resume failed after operation ended', {
          error,
          runId: operation.runId,
          sessionId,
        });
        return;
      }
      // 恢复请求失败时仍然允许用户重试，不能永久卡在 running 且失去审批按钮。
      const paused = { ...latest, status: 'paused' as const };
      hotSnapshots.set(operation.runId, paused);
      useSessionOperationStore.getState().updateOperation(operation.runId, {
        input: operation.input,
        snapshot: paused,
        status: 'paused',
      });
      scheduleRunCheckpoint(operation.sessionId, operation.input, paused);
      try {
        await flushRunCheckpoint(operation.runId);
      } catch (persistError) {
        console.error('[AgentDock] HITL rollback checkpoint failed', {
          error: persistError,
          runId: operation.runId,
          sessionId,
        });
      }
      console.error('[AgentDock] HITL resume failed', { error, runId: operation.runId, sessionId });
    }
  },

  async restore(context: SessionRuntimeContext) {
    if (getOperation(context.sessionId)) return;
    const checkpoint = await sessionHistoryService.getLatestRecoverableRun(context.sessionId);
    if (!checkpoint) return;
    // checkpoint 读取是异步的；期间用户可能已发送新消息或另一次 restore 已经启动。
    // 旧恢复绝不能覆盖刚建立的新 active run。
    if (getOperation(context.sessionId)) return;
    if (checkpoint.status === 'running' && !checkpoint.latestEventId) {
      const cancelled = finalizeReasoningMeta({
        ...checkpoint.snapshot,
        error: {
          code: 'CANCELLED',
          message: 'Run interrupted before a resumable event cursor was persisted.',
        },
        status: 'cancelled',
      });
      await sessionHistoryService.saveRunCheckpoint(context.sessionId, checkpoint.input, cancelled);
      return;
    }
    // 首次渲染时页面的 Session 记录可能尚未读完，context.threadId 仍是临时兜底值；
    // checkpoint 才是恢复运行的权威 thread/agent 上下文。
    const restoredContext: SessionRuntimeContext = {
      agentId: checkpoint.input.forwardedProps.agentId || context.agentId,
      fab: checkpoint.input.forwardedProps.fab || context.fab,
      group: checkpoint.input.forwardedProps.group,
      mentionAgents: checkpoint.input.forwardedProps.mentionAgents,
      sessionId: context.sessionId,
      threadId: checkpoint.threadId || checkpoint.input.threadId,
    };
    const restoredInput = checkpoint.status === 'running'
      ? {
          ...checkpoint.input,
          forwardedProps: {
            ...checkpoint.input.forwardedProps,
            action: 'resume' as const,
            resume: { lastEventId: checkpoint.latestEventId! },
          },
        }
      : checkpoint.input;
    const operation = startOperation(restoredContext, restoredInput, checkpoint.snapshot);
    pushRenderSnapshot(checkpoint.runId, checkpoint.snapshot, true);
    if (checkpoint.status === 'running') {
      try {
        await dispatchOperation(operation);
      } catch (error) {
        applySyntheticError(operation, error, 'RESUME_ERROR');
      }
    }
  },

  async disposeSession(sessionId: string) {
    const activeOperation = getOperation(sessionId);
    if (activeOperation && isOperationBusy(activeOperation)) {
      try {
        await this.stop(sessionId);
      } catch (error) {
        console.error('[AgentDock] failed to stop disposed session', { error, sessionId });
      }
    }
    // 删除/跨标签页删除要清理这个 Session 的全部残留 Operation，而不只 active 映射。
    const operations = Object.values(useSessionOperationStore.getState().operationsById)
      .filter((operation) => operation.sessionId === sessionId);
    for (const operation of operations) {
      cancelPendingCheckpoint(operation.runId);
      await waitForRunCheckpoint(operation.runId);
      releaseOperationResources(operation, { keepRuntime: true });
    }
    const descriptor = useSessionOperationStore.getState().runtimeBySession[sessionId];
    useSessionOperationStore.getState().removeRuntime(sessionId, descriptor?.key);
    sessionRuntimeRegistry.reset(sessionId, 'Session was disposed.');
  },

  async send(
    context: SessionRuntimeContext,
    message: string,
    options?: { mentionAgents?: MentionAgentRef[] },
  ) {
    const current = getOperation(context.sessionId);
    if (isOperationBusy(current)) return;
    const input = createRunInput({
      agentId: context.agentId,
      fab: context.fab,
      group: context.group,
      mentionAgents: options?.mentionAgents ?? context.mentionAgents,
      message,
      sessionId: context.sessionId,
      threadId: context.threadId,
    });
    const operation = startOperation(context, input);
    try {
      await dispatchOperation(operation);
    } catch (error) {
      applySyntheticError(operation, error);
    }
  },

  async sendA2uiAction(context: SessionRuntimeContext, action: A2uiAction) {
    const previous = getOperation(context.sessionId);
    if (isOperationBusy(previous)) return;
    const runId = crypto.randomUUID();
    const input: RunAgentInput = {
      context: [],
      forwardedProps: {
        ...(previous?.input.forwardedProps ?? {
          agentId: context.agentId,
          fab: context.fab,
          group: context.group,
          mentionAgents: context.mentionAgents,
        }),
        a2uiAction: action,
        action: 'a2uiAction',
        sessionId: context.sessionId,
      },
      messages: [],
      parentRunId: previous?.runId,
      runId,
      state: {},
      threadId: context.threadId,
      tools: [],
    };
    const operation = startOperation(context, input);
    try {
      await dispatchOperation(operation);
    } catch (error) {
      applySyntheticError(operation, error);
    }
  },

  setViewingSession(sessionId?: string) {
    useSessionOperationStore.getState().setViewingSession(sessionId);
  },

  async stop(sessionId: string) {
    const operation = getOperation(sessionId);
    if (!operation || !isOperationBusy(operation)) return;
    const existingStop = stopPromises.get(operation.runId);
    if (existingStop) {
      await existingStop;
      return;
    }
    stoppingRuns.add(operation.runId);
    const stopPromise = (async () => {
      // UI 先按本地 Operation 立即终态化；远端 stop 只负责尽力释放后端执行。
      cancelPendingCheckpoint(operation.runId);
      applySyntheticError(operation, new Error('Run cancelled by user.'), 'CANCELLED');
      try {
        if (getChatServiceMode() === 'http') {
          const runtime = sessionRuntimeRegistry.get(sessionId);
          if (runtime?.isReady()) {
            await waitForRemoteStop(runtime.stop());
          } else {
            // 启动阶段没有可停止的远端 handle：直接终止 whenReady 等待，避免停止/删除卡 15 秒。
            sessionRuntimeRegistry.reset(sessionId, 'Run stopped before runtime became ready.');
          }
        } else {
          mockControllers.get(operation.runId)?.abort();
        }
      } catch (error) {
        // A failed remote cancellation must not leak an unhandled rejection from the UI.
        // The local operation is still terminalized below; a late backend terminal event is
        // safely ignored by the reducer once that cancellation has been projected.
        console.error('[AgentDock] runtime stop failed; cancelling local operation', {
          error,
          runId: operation.runId,
          sessionId,
        });
      }
    })();
    stopPromises.set(operation.runId, stopPromise);
    try {
      await stopPromise;
    } finally {
      if (stopPromises.get(operation.runId) === stopPromise) stopPromises.delete(operation.runId);
      stoppingRuns.delete(operation.runId);
    }
  },
};
