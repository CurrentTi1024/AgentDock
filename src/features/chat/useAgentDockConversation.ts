// AgentDock 对话 hook：mock 模式走自研 SSE/reducer，http 模式走官方 CopilotKit v2 headless。
// 官方路径：useAgent(thread-scoped) + useCopilotKit().runAgent，事件经 agent.subscribe 投影为 RuntimeRunState。
import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2';
import { useCallback, useEffect, useRef, useState } from 'react';

import { createRunInput } from '@/api/runtime/agentRuntimeService';
import { createRunState, reduceRunEvent } from '@/api/runtime/runReducer';
import type { AgUiEvent, RunAgentInput, RuntimeRunState } from '@/api/runtime/types';
import { getServiceMode } from '@/api/core/serviceMode';
import {
  sessionHistoryService,
} from '@/api/session/sessionHistoryService';
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
  const isHttp = getServiceMode() === 'http';
  const threadId = options.threadId || `thread-${options.sessionId}`;
  const localAgentId = `agentdock-${options.sessionId}`;

  // mock 路径：沿用自研 runStore（SSE + reducer + checkpoint）
  const mock = useRunStore();
  // http 路径：官方 CopilotKit
  const { agent, isReady } = useAgent({
    agentId: localAgentId,
    runtimeAgentId: 'orchestration',
    threadId,
  });
  const { copilotkit } = useCopilotKit();
  const [httpRun, setHttpRun] = useState<RuntimeRunState>();
  const runRef = useRef<RuntimeRunState | undefined>(undefined);
  const inputRef = useRef<RunAgentInput | undefined>(undefined);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const applyEvent = useCallback(
    (event: AgUiEvent) => {
      if (getServiceMode() !== 'http') return;
      const current = runRef.current ?? createRunState(String(event.runId || crypto.randomUUID()), threadId);
      const next = reduceRunEvent(current, toStreamedEvent(event));
      runRef.current = next;
      setHttpRun(next);
      const input = inputRef.current;
      if (input) void sessionHistoryService.saveRunCheckpoint(optionsRef.current.sessionId, input, next);
    },
    [threadId],
  );

  useEffect(() => {
    if (!isHttp || !isReady) return;
    const subscription = agent.subscribe({
      onActivityDeltaEvent: ({ event }) => applyEvent(event),
      onActivitySnapshotEvent: ({ event }) => applyEvent(event),
      onMessagesSnapshotEvent: ({ event }) => applyEvent(event),
      onRawEvent: ({ event }) => applyEvent(event),
      onReasoningMessageContentEvent: ({ event }) => applyEvent(event),
      onReasoningMessageEndEvent: ({ event }) => applyEvent(event),
      onReasoningMessageStartEvent: ({ event }) => applyEvent(event),
      onRunErrorEvent: ({ event }) => applyEvent(event),
      onRunFinishedEvent: ({ event }) => applyEvent(event),
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
  }, [agent, applyEvent, isHttp, isReady]);

  const restore = useCallback(async () => {
    if (getServiceMode() !== 'http') {
      await mock.restoreSession(optionsRef.current.sessionId);
      return;
    }
    const checkpoint = await sessionHistoryService.getLatestRun(optionsRef.current.sessionId);
    if (!checkpoint) return;
    runRef.current = checkpoint.snapshot;
    inputRef.current = checkpoint.input;
    setHttpRun(checkpoint.snapshot);
  }, [mock]);

  useEffect(() => {
    void restore();
  }, [options.sessionId, restore]);

  const send = useCallback(
    async (message: string) => {
      const { agentId, fab, group, sessionId } = optionsRef.current;
      const resolvedThreadId = optionsRef.current.threadId || `thread-${sessionId}`;
      if (getServiceMode() !== 'http') {
        await mock.execute(createRunInput({ agentId, fab, group, message, sessionId, threadId: resolvedThreadId }));
        return;
      }
      const runId = crypto.randomUUID();
      const input: RunAgentInput = {
        context: [],
        forwardedProps: { action: 'run', agentId, fab, group, sessionId },
        messages: [{ content: message, id: crypto.randomUUID(), role: 'user' }],
        runId,
        state: {},
        threadId: resolvedThreadId,
        tools: [],
      };
      inputRef.current = input;
      runRef.current = createRunState(runId, resolvedThreadId);
      setHttpRun(runRef.current);
      agent.addMessage({ content: message, id: input.messages[0].id, role: 'user' });
      await copilotkit.runAgent({
        agent,
        forwardedProps: input.forwardedProps as Record<string, unknown>,
        runId,
      });
    },
    [agent, copilotkit, mock],
  );

  const stop = useCallback(async () => {
    if (getServiceMode() !== 'http') {
      await mock.stop();
      return;
    }
    copilotkit.stopAgent({ agent });
  }, [agent, copilotkit, mock]);

  const respondToHitl = useCallback(
    async (hitlResponse: NonNullable<RunAgentInput['forwardedProps']['hitlResponse']>) => {
      if (getServiceMode() !== 'http') {
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
    [agent, copilotkit, mock],
  );

  const sendA2uiAction = useCallback(
    async (a2uiAction: NonNullable<RunAgentInput['forwardedProps']['a2uiAction']>) => {
      if (getServiceMode() !== 'http') {
        await mock.sendA2uiAction(a2uiAction);
        return;
      }
      const previous = inputRef.current;
      try {
        copilotkit.setProperties({ ...copilotkit.properties, a2uiAction });
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
    [agent, copilotkit, mock],
  );

  return {
    agent,
    isReady: isHttp ? isReady : true,
    respondToHitl,
    restore,
    run: isHttp ? httpRun : mock.run,
    send,
    sendA2uiAction,
    stop,
  };
};
