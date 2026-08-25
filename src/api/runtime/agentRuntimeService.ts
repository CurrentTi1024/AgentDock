import { createAgentRuntimeMockEvents } from '@/mock-data/agentRuntime';
import type { MentionAgentRef, RunAgentInput, StreamedEvent } from './types';
export interface RuntimeOptions { signal?: AbortSignal }
export interface AgentRuntimeService { stream(input: RunAgentInput, options?: RuntimeOptions): AsyncGenerator<StreamedEvent> }
// Chat 运行时：proxy 走官方 CopilotKit（useOfficialConversation），不经过本服务；
// 本服务仅供 mock（离线 UI 测试）路径使用。direct（自研 SSE 直连上游）已移除。
export class CopilotHeadlessMockService implements AgentRuntimeService {
  async *stream(input: RunAgentInput, options: RuntimeOptions = {}) { for await (const event of createAgentRuntimeMockEvents(input, options.signal)) yield { event, eventId: event.rawEvent?.eventId }; }
}
export const agentRuntimeService: AgentRuntimeService = new CopilotHeadlessMockService();
export const createRunInput = (input: { agentId?: string; fab: string; group?: RunAgentInput['forwardedProps']['group']; mentionAgents?: MentionAgentRef[]; message: string; parentRunId?: string; sessionId: string; threadId: string }): RunAgentInput => {
  const runId = crypto.randomUUID();
  return { context: [], messages: [{ content: input.message, id: crypto.randomUUID(), role: 'user' }], parentRunId: input.parentRunId, runId, state: {}, threadId: input.threadId, tools: [], forwardedProps: { action: 'run', agentId: input.agentId, fab: input.fab, group: input.group, mentionAgents: input.mentionAgents, sessionId: input.sessionId } };
};
export const createRuntimeAction = (original: RunAgentInput, action: RunAgentInput['forwardedProps']['action'], payload: Partial<RunAgentInput['forwardedProps']> = {}): RunAgentInput => ({ ...original, forwardedProps: { ...original.forwardedProps, ...payload, action } });
