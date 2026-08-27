import type {
  AgUiEvent,
  MentionAgentRef,
  RunAgentInput,
  RuntimeRunState,
} from '@/api/runtime/types';

export type OperationStatus =
  | 'booting'
  | 'cancelled'
  | 'error'
  | 'paused'
  | 'running'
  | 'success';

export interface SessionRuntimeContext {
  agentId: string;
  fab: string;
  group?: RunAgentInput['forwardedProps']['group'];
  mentionAgents?: MentionAgentRef[];
  sessionId: string;
  threadId: string;
}

export interface SessionRuntimeDescriptor extends SessionRuntimeContext {
  key: string;
  status: 'booting' | 'ready';
}

export interface SessionOperation {
  completedAt?: number;
  input: RunAgentInput;
  latestEventId?: string;
  legacyInterruptId?: string;
  operationId: string;
  runId: string;
  sessionId: string;
  snapshot: RuntimeRunState;
  startedAt: number;
  status: OperationStatus;
  threadId: string;
}

export interface EventRoute {
  sessionId: string;
  threadId: string;
}

export type HitlResponse = NonNullable<RunAgentInput['forwardedProps']['hitlResponse']>;
export type A2uiAction = NonNullable<RunAgentInput['forwardedProps']['a2uiAction']>;

export interface SessionRuntimeHandle {
  isReady(): boolean;
  run(input: RunAgentInput): Promise<void>;
  respondToHitl(input: RunAgentInput, response: HitlResponse, legacyInterruptId?: string): Promise<void>;
  stop(): Promise<void>;
}

export interface AgentEventSink {
  applyEvent(route: EventRoute, event: AgUiEvent): void;
  applyRunFinished(
    route: EventRoute,
    event: AgUiEvent,
    outcome?: string,
    interrupts?: Array<{ id: string; message?: string }>,
  ): void;
  applyCustomEvent(route: EventRoute, event: AgUiEvent): void;
}
