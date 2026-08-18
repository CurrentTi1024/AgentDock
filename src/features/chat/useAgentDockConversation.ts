// AgentDock 对话 hook：
// - proxy（生产）走官方 CopilotKit v2 headless（useAgent + useCopilotKit）
// - mock / direct 走自研 SSE + reducer（runStore），direct 仅用于本地联调
// 官方事件经 agent.subscribe 投影为 RuntimeRunState，并写入 IndexedDB 检查点。
import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2';
import type { Message } from '@ag-ui/client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { createRunInput } from '@/api/runtime/agentRuntimeService';
import { createRunState, reduceRunEvent } from '@/api/runtime/runReducer';
import type { AgUiEvent, RunAgentInput, RuntimeRunState } from '@/api/runtime/types';
import { getServiceMode } from '@/api/core/serviceMode';
import { runtimeConfig } from '@/api/runtimeConfig';
import { sessionHistoryService } from '@/api/session/sessionHistoryService';
import { useRunStore } from '@/stores/runStore';

export interface AgentDockConversationOptions {
  agentId: string;
  fab: string;
  group?: RunAgentInput['forwardedProps']['group'];
  sessionId: string;
  threadId?: string;
}

const toStreamedEvent = (event: AgUiEvent) => ({
  event,
  streamId:
    event && typeof event === 'object' && 'rawEvent' in event
      ? ((event as { rawEvent?: { streamId?: string } }).rawEvent?.streamId)
      : undefined,
});

export const useAgentDockConversation = (options: AgentDockConversationOptions) => {
  // 官方 CopilotKit 仅在生产 proxy 形态启用；direct 属本地联调，保留自研 transport。
  const useOfficial = getServiceMode() === 'http' && runtimeConfig.transport === 'proxy';
  const resolvedThreadId = options.threadId || `thread-${options.sessionId}`;
  const localAgentId = `agentdock-${options.sessionId}`;

  const mock = useRunStore();
  const { agent, isReady } = useAgent({
    agentId: localAgentId,
    runtimeAgentId: 'orchestration',
    threadId: resolvedThreadId,
  });
  const { copilotkit } = useCopilotKit();
  const [httpRun, setHttpRun] = useState<RuntimeRunState>();
  const runRef = useRef<RuntimeRunState | undefined>(undefined);
  const inputRef = useRef<RunAgentInput | undefined>(undefined);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const applyEvent = useCallback((event: AgUiEvent) => {
    if (!useOfficial) return;
    const threadId = optionsRef.current.threadId || `thread-${optionsRef.current.sessionId}`;
    const current = runRef.current ?? createRunState(String(event.runId || crypto.randomUUID()), threadId);
    const next = reduceRunEvent(current, toStreamedEvent(event));
    runRef.current = next;
    setHttpRun(next);
    const input = inputRef.current;
    if (input) void sessionHistoryService.saveRunCheckpoint(optionsRef.current.sessionId, input, next);
  }, [useOfficial]);

  useEffect(() => {
    if (!useOfficial || !isReady) return;
    const subscription = agent.subscribe({
      onActivityDeltaEvent: ({ event }) => applyEvent(event),
      onActivitySnapshotEvent: ({ event }) => applyEvent(event),
      onCustomEvent: ({ event }) => {
        applyEvent(event);
        // legacy HITL wire：CustomEvent(name=on_interrupt)
        const custom = event as { name?: string; value?: { id?: string; message?: string } };
        if (custom.name === 'on_interrupt') {
          const requestId = custom.value?.id ?? '';
          applyEvent({
            activityType: 'agentDock.hitl',
            content: { description: custom.value?.message ?? 'Agent requests your confirmation.', requestId },
            messageId: `hitl-${requestId || Date.now()}`,
            type: 'ACTIVITY_SNAPSHOT',
          });
        }
      },
      onMessagesSnapshotEvent: ({ event }) => applyEvent(event),
      onRawEvent: ({ event }) => applyEvent(event),
      onReasoningMessageContentEvent: ({ event }) => applyEvent(event),
      onReasoningMessageEndEvent: ({ event }) => applyEvent(event),
      onReasoningMessageStartEvent: ({ event }) => applyEvent(event),
      onRunErrorEvent: ({ event }) => applyEvent(event),
      onRunFinishedEvent: (params) => {
        applyEvent(params.event);
        // 标准 AG-UI HITL：RUN_FINISHED outcome=interrupt → 投影为暂停活动块
        if (params.outcome === 'interrupt') {
          for (const interrupt of params.interrupts) {
            applyEvent({
              activityType: 'agentDock.hitl',
              content: { description: interrupt.message ?? 'Agent requests your confirmation.', requestId: interrupt.id },
              messageId: `hitl-${interrupt.id}`,
              type: 'ACTIVITY_SNAPSHOT',
            });
          }
        }
      },
      onRunStartedEvent: ({ event }) => applyEvent(event),
      onStateDeltaEvent: ({ event }) => applyEvent(event),
      onStateSnapshotEvent: ({ event }) => applyEvent(event),
      onStepFinishedEvent: ({ event }) => applyEvent(event),
      onStepStartedEvent: ({ event }) => applyEvent(event),
      onTextMessageContentEvent: ({ event }) => applyEvent(event),
      onTextMessageEndEvent: ({ event }) => applyEvent(event),
      onTextMessageStartEvent: ({ event }) => applyEvent(event),
      onToolCallArgsEvent: ({ event }) => applyEvent(event),
      onToolCallEndEvent: ({ event }) => applyEvent(event),
      onToolCallResultEvent: ({ event }) => applyEvent(event),
      onToolCallStartEvent: ({ event }) => applyEvent(event),
    });
    return () => subscription.unsubscribe();
  }, [agent, applyEvent, isReady, useOfficial]);

  const restore = useCallback(async () => {
    if (!useOfficial) {
      await mock.restoreSession(optionsRef.current.sessionId);
      return;
    }
    const checkpoint = await sessionHistoryService.getLatestRun(optionsRef.current.sessionId);
    if (!checkpoint) return;
    runRef.current = checkpoint.snapshot;
    inputRef.current = checkpoint.input;
    setHttpRun(checkpoint.snapshot);
    // 回填 agent 可见消息，保证下一次 run 携带完整上下文（与 LobeHub 本地历史一致）
    const restoredMessages = [
      ...(checkpoint.input.messages || []),
      ...Object.values(checkpoint.snapshot.messages || {}),
    ]
      .filter((message) => message?.role === 'user' || message?.role === 'assistant')
      .map((message) => ({ content: message.content, id: message.id, role: message.role }));
    if (restoredMessages.length) agent.setMessages(restoredMessages as Message[]);
  }, [agent, mock, useOfficial]);

  useEffect(() => {
    void restore();
  }, [options.sessionId, restore]);

  const send = useCallback(
    async (message: string) => {
      const { agentId, fab, group, sessionId } = optionsRef.current;
      const threadId = optionsRef.current.threadId || `thread-${sessionId}`;
      if (!useOfficial) {
        await mock.execute(createRunInput({ agentId, fab, group, message, sessionId, threadId }));
        return;
      }
      const runId = crypto.randomUUID();
      const input: RunAgentInput = {
        context: [],
        forwardedProps: { action: 'run', agentId, fab, group, sessionId },
        messages: [{ content: message, id: crypto.randomUUID(), role: 'user' }],
        runId,
        state: {},
        threadId,
        tools: [],
      };
      inputRef.current = input;
      runRef.current = createRunState(runId, threadId);
      setHttpRun(runRef.current);
      agent.addMessage({ content: message, id: input.messages[0].id, role: 'user' });
      await copilotkit.runAgent({
        agent,
        forwardedProps: input.forwardedProps as Record<string, unknown>,
        runId,
      });
    },
    [agent, copilotkit, mock, useOfficial],
  );

  const stop = useCallback(async () => {
    if (!useOfficial) {
      await mock.stop();
      return;
    }
    copilotkit.stopAgent({ agent });
    if (runRef.current?.status === 'running' || runRef.current?.status === 'paused') {
      applyEvent({
        code: 'CANCELLED',
        message: 'Run cancelled by user.',
        runId: runRef.current.runId,
        threadId: optionsRef.current.threadId || `thread-${optionsRef.current.sessionId}`,
        type: 'RUN_ERROR',
      });
    }
  }, [agent, applyEvent, copilotkit, mock, useOfficial]);

  const respondToHitl = useCallback(
    async (hitlResponse: NonNullable<RunAgentInput['forwardedProps']['hitlResponse']>) => {
      if (!useOfficial) {
        await mock.respondToHitl(hitlResponse);
        return;
      }
      const pending = agent.pendingInterrupts || [];
      if (pending.length > 0) {
        const interrupt = pending[0];
        await copilotkit.runAgent({
          agent,
          resume: [{
            interruptId: interrupt.id,
            payload: { decision: hitlResponse.decision, input: hitlResponse.input },
            status: hitlResponse.decision === 'reject' ? 'cancelled' : 'resolved',
          }],
        });
        return;
      }
      const previous = inputRef.current;
      if (!previous) return;
      await copilotkit.runAgent({
        agent,
        forwardedProps: {
          ...(previous.forwardedProps as Record<string, unknown>),
          action: 'hitlResponse',
          hitlResponse,
        },
      });
    },
    [agent, copilotkit, mock, useOfficial],
  );

  const sendA2uiAction = useCallback(
    async (a2uiAction: NonNullable<RunAgentInput['forwardedProps']['a2uiAction']>) => {
      if (!useOfficial) {
        await mock.sendA2uiAction(a2uiAction);
        return;
      }
      const previous = inputRef.current;
      try {
        // 官方 A2UI middleware 读取 forwardedProps.a2uiAction.userAction
        copilotkit.setProperties({ ...copilotkit.properties, a2uiAction: { userAction: a2uiAction } });
        await copilotkit.runAgent({
          agent,
          forwardedProps: {
            ...(previous?.forwardedProps as Record<string, unknown> | undefined),
            action: 'a2uiAction',
          },
          runId: crypto.randomUUID(),
        });
      } finally {
        if (copilotkit.properties) {
          const { a2uiAction: _, ...rest } = copilotkit.properties;
          copilotkit.setProperties(rest);
        }
      }
    },
    [agent, copilotkit, mock, useOfficial],
  );

  return {
    agent,
    isReady: useOfficial ? isReady : true,
    respondToHitl,
    restore,
    run: useOfficial ? httpRun : mock.run,
    send,
    sendA2uiAction,
    stop,
  };
};
