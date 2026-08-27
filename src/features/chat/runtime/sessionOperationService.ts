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
const renderTimers = new Map<string, ReturnType<typeof setTimeout>>();
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
const hotSnapshots = new Map<string, RuntimeRunState>();
const mockControllers = new Map<string, AbortController>();

const isTerminal = (status: RuntimeRunState['status']) =>
  status === 'success' || status === 'error' || status === 'cancelled';
const toOperationStatus = (status: RuntimeRunState['status']): OperationStatus =>
  status === 'idle' ? 'booting' : status;

const toStreamedEvent = (event: AgUiEvent): StreamedEvent => ({
  event,
  eventId:
    event && typeof event === 'object' && 'rawEvent' in event
      ? (event.rawEvent?.eventId)
      : undefined,
});

const getOperation = (sessionId: string): SessionOperation | undefined => {
  const state = useSessionOperationStore.getState();
  const runId = state.activeRunBySession[sessionId];
  return runId ? state.operationsById[runId] : undefined;
};

const runtimeKey = (context: SessionRuntimeContext) =>
  `${context.sessionId}:${context.threadId}`;

const ensureRuntime = (context: SessionRuntimeContext) => {
  useSessionOperationStore.getState().upsertRuntime({
    ...context,
    key: runtimeKey(context),
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
  const history = await sessionHistoryService.getMessages(sessionId);
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

const scheduleCleanup = (operation: SessionOperation) => {
  const previous = cleanupTimers.get(operation.runId);
  if (previous) clearTimeout(previous);
  cleanupTimers.set(operation.runId, setTimeout(() => {
    cleanupTimers.delete(operation.runId);
    const state = useSessionOperationStore.getState();
    if (state.activeRunBySession[operation.sessionId] !== operation.runId) {
      state.removeOperation(operation.runId);
      hotSnapshots.delete(operation.runId);
      return;
    }
    const current = state.operationsById[operation.runId];
    if (!current || isOperationBusy(current)) return;
    state.removeOperation(operation.runId);
    state.removeRuntime(operation.sessionId, runtimeKey({
      agentId: current.input.forwardedProps.agentId || '',
      fab: current.input.forwardedProps.fab,
      group: current.input.forwardedProps.group,
      mentionAgents: current.input.forwardedProps.mentionAgents,
      sessionId: current.sessionId,
      threadId: current.threadId,
    }));
    hotSnapshots.delete(operation.runId);
  }, OPERATION_RETAIN_MS));
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
  try {
    await flushRunCheckpoint(runId);
  } catch (error) {
    console.error('[AgentDock] operation checkpoint failed', {
      error,
      runId,
      sessionId: operation.sessionId,
    });
  }
  scheduleCleanup({ ...operation, completedAt, snapshot, status: toOperationStatus(snapshot.status) });
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
    return;
  }
  useSessionOperationStore.getState().markRuntimeReady(operation.sessionId);
  useSessionOperationStore.getState().updateOperation(operation.runId, { status: 'running' });
  await executeMock(operation);
};

const startOperation = (
  context: SessionRuntimeContext,
  input: RunAgentInput,
  initialSnapshot?: RuntimeRunState,
) => {
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
    for (const interrupt of interrupts) {
      applyStreamedEvent(route, {
        event: {
          activityType: 'agentDock.hitl',
          content: {
            description: interrupt.message ?? 'Agent requests your confirmation.',
            requestId: interrupt.id,
          },
          messageId: `hitl-${interrupt.id}`,
          type: 'ACTIVITY_SNAPSHOT',
        },
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
    hotSnapshots.set(operation.runId, running);
    useSessionOperationStore.getState().updateOperation(operation.runId, {
      snapshot: running,
      status: 'running',
    });
    if (getChatServiceMode() === 'http') {
      const runtime = await sessionRuntimeRegistry.whenReady(sessionId);
      await runtime.respondToHitl(operation.input, response, operation.legacyInterruptId);
      return;
    }
    const resumed: SessionOperation = {
      ...operation,
      input: {
        ...operation.input,
        forwardedProps: {
          ...operation.input.forwardedProps,
          action: 'hitlResponse',
          hitlResponse: response,
        },
      },
      snapshot: running,
      status: 'running',
    };
    useSessionOperationStore.getState().updateOperation(operation.runId, {
      input: resumed.input,
    });
    await executeMock(resumed);
  },

  async restore(context: SessionRuntimeContext) {
    if (getOperation(context.sessionId)) return;
    const checkpoint = await sessionHistoryService.getLatestRecoverableRun(context.sessionId);
    if (!checkpoint) return;
    if (checkpoint.status === 'running') {
      const cancelled = finalizeReasoningMeta({
        ...checkpoint.snapshot,
        error: {
          code: 'CANCELLED',
          message: 'Run interrupted by reload; stream resume is not supported yet.',
        },
        status: 'cancelled',
      });
      await sessionHistoryService.saveRunCheckpoint(context.sessionId, checkpoint.input, cancelled);
      return;
    }
    startOperation(context, checkpoint.input, checkpoint.snapshot);
    pushRenderSnapshot(checkpoint.runId, checkpoint.snapshot, true);
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
    try {
      if (getChatServiceMode() === 'http') {
        const runtime = await sessionRuntimeRegistry.whenReady(sessionId);
        await runtime.stop();
      } else {
        mockControllers.get(operation.runId)?.abort();
      }
    } finally {
      cancelPendingCheckpoint(operation.runId);
      applySyntheticError(operation, new Error('Run cancelled by user.'), 'CANCELLED');
    }
  },
};
