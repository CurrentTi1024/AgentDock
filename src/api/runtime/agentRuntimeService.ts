import { createAgentRuntimeMockEvents } from '@/mock-data/agentRuntime';
import { getChatServiceMode } from '@/api/core/serviceMode';
import { runtimeConfig } from '@/api/runtimeConfig';
import { parseSseStream } from './sse';
import type { RunAgentInput, StreamedEvent } from './types';
export interface RuntimeOptions { signal?: AbortSignal }
export interface AgentRuntimeService { stream(input: RunAgentInput, options?: RuntimeOptions): AsyncGenerator<StreamedEvent> }
export class CopilotHeadlessHttpService implements AgentRuntimeService {
  async *stream(input: RunAgentInput, options: RuntimeOptions = {}) {
    const response = await fetch(runtimeConfig.resolveAgentRuntimeUrl(input.forwardedProps.fab), { body: JSON.stringify(input), credentials: 'include', headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' }, method: 'POST', signal: options.signal });
    if (!response.ok || !response.body) throw new Error(`COPILOT_RUNTIME_HTTP_${response.status}`);
    yield* parseSseStream(response.body, options.signal);
  }
}
export class CopilotHeadlessMockService implements AgentRuntimeService {
  async *stream(input: RunAgentInput, options: RuntimeOptions = {}) { for await (const event of createAgentRuntimeMockEvents(input, options.signal)) yield { event, eventId: event.rawEvent?.eventId }; }
}
const selectRuntimeService = (): AgentRuntimeService =>
  getChatServiceMode() === 'http' ? new CopilotHeadlessHttpService() : new CopilotHeadlessMockService();

export const agentRuntimeService: AgentRuntimeService = new Proxy({} as AgentRuntimeService, {
  get(_target, prop) {
    const current = selectRuntimeService();
    const value = (current as unknown as Record<PropertyKey, unknown>)[prop];
    return typeof value === 'function' ? value.bind(current) : value;
  },
});
export const createRunInput = (input: { agentId?: string; fab: string; group?: RunAgentInput['forwardedProps']['group']; message: string; parentRunId?: string; sessionId: string; threadId: string }): RunAgentInput => {
  const runId = crypto.randomUUID();
  return { context: [], messages: [{ content: input.message, id: crypto.randomUUID(), role: 'user' }], parentRunId: input.parentRunId, runId, state: {}, threadId: input.threadId, tools: [], forwardedProps: { action: 'run', agentId: input.agentId, fab: input.fab, group: input.group, sessionId: input.sessionId } };
};
export const createRuntimeAction = (original: RunAgentInput, action: RunAgentInput['forwardedProps']['action'], payload: Partial<RunAgentInput['forwardedProps']> = {}): RunAgentInput => ({ ...original, forwardedProps: { ...original.forwardedProps, ...payload, action } });
