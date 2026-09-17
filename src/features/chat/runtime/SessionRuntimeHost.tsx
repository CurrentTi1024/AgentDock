import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2';
import type { Message } from '@ag-ui/client';
import { Fragment, useEffect, useMemo, useRef } from 'react';

import type { AgUiEvent, RunAgentInput } from '@/api/runtime/types';
import { useSessionOperationStore } from '@/stores/sessionOperationStore';

import { bindEventToRun, sessionOperationService } from './sessionOperationService';
import { createCopilotHitlRunOptions } from './hitlResume';
import { sessionRuntimeRegistry } from './sessionRuntimeRegistry';
import type {
  HitlResumeBatch,
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
    const emit = (event: AgUiEvent, input: Pick<RunAgentInput, 'runId' | 'threadId'>) =>
      sessionOperationService.applyEvent(route, bindEventToRun(event, input));
    const subscription = agent.subscribe({
      onActivityDeltaEvent: ({ event, input }) => emit(event, input),
      onActivitySnapshotEvent: ({ event, input }) => emit(event, input),
      onCustomEvent: ({ event, input }) =>
        sessionOperationService.applyCustomEvent(route, bindEventToRun(event, input)),
      onMessagesSnapshotEvent: ({ event, input }) => emit(event, input),
      onRawEvent: ({ event, input }) => emit(event, input),
      onReasoningMessageContentEvent: ({ event, input }) => emit(event, input),
      onReasoningMessageEndEvent: ({ event, input }) => emit(event, input),
      onReasoningMessageStartEvent: ({ event, input }) => emit(event, input),
      onRunErrorEvent: ({ event, input }) => emit(event, input),
      onRunFinishedEvent: (params) =>
        sessionOperationService.applyRunFinished(
          route,
          bindEventToRun(params.event, params.input),
          params.outcome,
          params.outcome === 'interrupt' ? params.interrupts : undefined,
        ),
      onRunStartedEvent: ({ event, input }) => emit(event, input),
      onStateDeltaEvent: ({ event, input }) => emit(event, input),
      onStateSnapshotEvent: ({ event, input }) => emit(event, input),
      onStepFinishedEvent: ({ event, input }) => emit(event, input),
      onStepStartedEvent: ({ event, input }) => emit(event, input),
      onTextMessageContentEvent: ({ event, input }) => emit(event, input),
      onTextMessageEndEvent: ({ event, input }) => emit(event, input),
      onTextMessageStartEvent: ({ event, input }) => emit(event, input),
      onToolCallArgsEvent: ({ event, input }) => emit(event, input),
      onToolCallEndEvent: ({ event, input }) => emit(event, input),
      onToolCallResultEvent: ({ event, input }) => emit(event, input),
      onToolCallStartEvent: ({ event, input }) => emit(event, input),
    });
    return () => subscription.unsubscribe();
  }, [agent, isReady, route]);

  useEffect(() => {
    if (!isReady) return;
    let disposed = false;

    const respondToHitl = async (
      input: RunAgentInput,
      resume: HitlResumeBatch,
      legacyInterruptId?: string,
    ) => {
      if (legacyInterruptId) {
        if (resume.length !== 1 || resume[0].interruptId !== legacyInterruptId) {
          throw new Error('Legacy HITL accepts exactly one matching interrupt response.');
        }
        const entry = resume[0];
        await copilotkit.runAgent({
          agent,
          forwardedProps: input.forwardedProps as Record<string, unknown>,
          resume: [{
            interruptId: legacyInterruptId,
            payload: {
              decisions: [{ type: entry.status === 'cancelled' ? 'reject' : 'approve' }],
            },
            status: entry.status,
          }],
          runId: input.runId,
        });
        return;
      }
      // Do not reconstruct or narrow payload here. CopilotKit's runAgent accepts AG-UI
      // ResumeEntry.payload as unknown, so the validated action/answer object must pass through
      // byte-for-byte at the object level to the Runtime and upstream AG-UI agent.
      await copilotkit.runAgent({ agent, ...createCopilotHitlRunOptions(input, resume) });
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
