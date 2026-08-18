export type RunAction = 'a2uiAction' | 'hitlResponse' | 'resume' | 'run' | 'stop';
export interface RuntimeMessage { content: string; id: string; role: 'assistant' | 'system' | 'tool' | 'user'; streamId?: string }
export interface AgentGroupInput { config?: Record<string, unknown>; members: Array<{ agentId: string; fab: string; version?: string }>; orchestrationMode: string }
export interface RunAgentInput {
  context: unknown[]; messages: RuntimeMessage[]; parentRunId?: string; runId: string; state: unknown; threadId: string; tools: unknown[];
  forwardedProps: { action: RunAction; agentId?: string; fab: string; sessionId: string; group?: AgentGroupInput; resume?: { lastStreamId: string }; hitlResponse?: { requestId: string; mode: string; decision?: 'approve' | 'reject'; editedArguments?: Record<string, unknown>; input?: string; selectedValues?: string[]; formValues?: Record<string, unknown> }; a2uiAction?: { actionName: string; context?: Record<string, unknown>; sourceComponentId?: string; surfaceId: string } };
}
export interface AgUiEvent { type: string; rawEvent?: { runId?: string; streamId?: string }; [key: string]: unknown }
export interface StreamedEvent { event: AgUiEvent; streamId?: string }
export type RunStatus = 'cancelled' | 'error' | 'idle' | 'paused' | 'running' | 'success';
export type RuntimeBlockKind = 'activity' | 'error' | 'reasoning' | 'step' | 'surface' | 'tool';
export interface RuntimeBlockRef { id: string; kind: RuntimeBlockKind }
export interface RuntimeStep { finishedAt?: number; id: string; name?: string; startedAt?: number; status: 'completed' | 'error' | 'running' }
export interface RuntimeRunState { activities: Record<string, unknown>; error?: { code?: string; message: string }; latestStreamId?: string; messages: Record<string, RuntimeMessage>; orderedBlocks: RuntimeBlockRef[]; processedStreamIds: string[]; rawEvents: AgUiEvent[]; reasoning: Record<string, string>; runId: string; state: unknown; status: RunStatus; steps: Record<string, RuntimeStep>; surfaces: Record<string, unknown>; threadId: string; toolCalls: Record<string, { args: string; name?: string; result?: unknown; status: string }> }
