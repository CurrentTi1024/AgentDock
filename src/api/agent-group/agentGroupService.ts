import { agentGroupMockData } from '@/mock-data/agentGroup';
import { mockDelay } from '@/lib/mock';
import { postApi } from '@/lib/httpClient';
import { selectService } from '@/api/core/serviceMode';
import type { ServiceRequestOptions } from '@/api/core/types';
export type AgentGroupModes = typeof agentGroupMockData;
export interface AgentGroupService { getSupportedAgentGroupOrchestrationModes(input: { locale: string }, options?: ServiceRequestOptions): Promise<AgentGroupModes> }
export const agentGroupHttpService: AgentGroupService = { getSupportedAgentGroupOrchestrationModes: (input, options) => postApi('getSupportedAgentGroupOrchestrationModes', input, options) };
export const agentGroupMockService: AgentGroupService = { getSupportedAgentGroupOrchestrationModes: async (_, options) => { await mockDelay(options?.signal); return structuredClone(agentGroupMockData); } };
export const agentGroupService = selectService(agentGroupHttpService, agentGroupMockService);
