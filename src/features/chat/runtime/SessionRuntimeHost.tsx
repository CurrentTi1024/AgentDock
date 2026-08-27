import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2';
import type { Message } from '@ag-ui/client';
import { Fragment, useEffect, useMemo, useRef } from 'react';

import type { AgUiEvent, RunAgentInput } from '@/api/runtime/types';
import { useSessionOperationStore } from '@/stores/sessionOperationStore';

import { sessionOperationService } from './sessionOperationService';
import { sessionRuntimeRegistry } from './sessionRuntimeRegistry';
import type {
  HitlResponse,
  SessionRuntimeDescriptor,
  SessionRuntimeHandle,
} from './types';

const SessionRuntimeWorker = ({ descriptor }: { descriptor: SessionRuntimeDescriptor }) => {
  const { sessionId, threadId } = descriptor;
  const { agent, isReady } = useAgent({
    agentId: `agentdock-${sessionId}`,
    runtimeAgentId: 'orchestration',
    threadId,
  });
  const { copilotkit } = useCopilotKit();
  const hydratedRef = useRef(false);
  const route = useMemo(() => ({ sessionId, threadId }), [sessionId, threadId]);

  useEffect(() => {
    if (!isReady) return;
    const emit = (event: AgUiEvent) => sessionOperationService.applyEvent(route, event);
    const subscription = agent.subscribe({
      onActivityDeltaEvent: ({ event }) => emit(event),
      onActivitySnapshotEvent: ({ event }) => emit(event),
      onCustomEvent: ({ event }) => sessionOperationService.applyCustomEvent(route, event),
      onMessagesSnapshotEvent: ({ event }) => emit(event),
      onRawEvent: ({ event }) => emit(event),
      onReasoningMessageContentEvent: ({ event }) => emit(event),
      onReasoningMessageEndEvent: ({ event }) => emit(event),
      onReasoningMessageStartEvent: ({ event }) => emit(event),
      onRunErrorEvent: ({ event }) => emit(event),
      onRunFinishedEvent: (params) =>
        sessionOperationService.applyRunFinished(
          route,
          params.event,
          params.outcome,
          params.outcome === 'interrupt' ? params.interrupts : undefined,
        ),
      onRunStartedEvent: ({ event }) => emit(event),
      onStateDeltaEvent: ({ event }) => emit(event),
      onStateSnapshotEvent: ({ event }) => emit(event),
      onStepFinishedEvent: ({ event }) => emit(event),
      onStepStartedEvent: ({ event }) => emit(event),
      onTextMessageContentEvent: ({ event }) => emit(event),
      onTextMessageEndEvent: ({ event }) => emit(event),
      onTextMessageStartEvent: ({ event }) => emit(event),
      onToolCallArgsEvent: ({ event }) => emit(event),
      onToolCallEndEvent: ({ event }) => emit(event),
      onToolCallResultEvent: ({ event }) => emit(event),
      onToolCallStartEvent: ({ event }) => emit(event),
    });
    return () => subscription.unsubscribe();
  }, [agent, isReady, route]);

  useEffect(() => {
    if (!isReady) return;
    let disposed = false;

    const respondToHitl = async (
      input: RunAgentInput,
      hitlResponse: HitlResponse,
      legacyInterruptId?: string,
    ) => {
      const pending = agent.pendingInterrupts || [];
      const interrupt = pending.find((item) => item.id === hitlResponse.requestId);
      if (interrupt) {
        await copilotkit.runAgent({
          agent,
          forwardedProps: input.forwardedProps as Record<string, unknown>,
          resume: [{
            interruptId: interrupt.id,
            payload: { decision: hitlResponse.decision, input: hitlResponse.input },
            status: hitlResponse.decision === 'reject' ? 'cancelled' : 'resolved',
          }],
          runId: input.runId,
        });
        return;
      }
      if (legacyInterruptId) {
        await copilotkit.runAgent({
          agent,
          forwardedProps: input.forwardedProps as Record<string, unknown>,
          resume: [{
            interruptId: legacyInterruptId,
            payload: {
              decisions: [{ type: hitlResponse.decision === 'reject' ? 'reject' : 'approve' }],
            },
            status: hitlResponse.decision === 'reject' ? 'cancelled' : 'resolved',
          }],
          runId: input.runId,
        });
        return;
      }
      if (pending.length > 0) {
        throw new Error(`Pending interrupt ${hitlResponse.requestId} was not found.`);
      }
      await copilotkit.runAgent({
        agent,
        forwardedProps: {
          ...(input.forwardedProps as Record<string, unknown>),
          action: 'hitlResponse',
          hitlResponse,
        },
        runId: input.runId,
      });
    };

    const handle: SessionRuntimeHandle = {
      isReady: () => hydratedRef.current && !disposed,
      respondToHitl,
      run: async (input) => {
        const userMessage = input.messages.at(-1);
        if (userMessage && !agent.messages.some((message) => message.id === userMessage.id)) {
          agent.addMessage(userMessage as Message);
        }
        await copilotkit.runAgent({
          agent,
          forwardedProps: input.forwardedProps as Record<string, unknown>,
          runId: input.runId,
        });
      },
      stop: async () => copilotkit.stopAgent({ agent }),
    };

    void sessionOperationService
      .hydrateRuntime(sessionId)
      .then((messages) => {
        if (disposed) return;
        agent.setMessages(messages);
        hydratedRef.current = true;
        sessionRuntimeRegistry.register(sessionId, handle);
        useSessionOperationStore.getState().markRuntimeReady(sessionId);
      })
      .catch((error) => {
        console.error('[AgentDock] runtime hydration failed', { error, sessionId });
      });

    return () => {
      disposed = true;
      hydratedRef.current = false;
      sessionRuntimeRegistry.unregister(sessionId, handle);
    };
  }, [agent, copilotkit, isReady, sessionId]);

  return null;
};

export default function SessionRuntimeHost() {
  const runtimeBySession = useSessionOperationStore((state) => state.runtimeBySession);
  const descriptors = useMemo(() => Object.values(runtimeBySession), [runtimeBySession]);
  return (
    <>
      {descriptors.map((descriptor) => (
        <Fragment key={descriptor.key}>
          <SessionRuntimeWorker descriptor={descriptor} />
        </Fragment>
      ))}
    </>
  );
}
