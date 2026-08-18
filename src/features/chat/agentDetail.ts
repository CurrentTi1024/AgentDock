export const resolveChatAgentId = (selectedAgentId?: string, sessionAgentId?: string): string =>
  selectedAgentId || sessionAgentId || 'flight-analysis';

export const buildAgentDetailPath = (agentId: string, fab: string): string =>
  `/market/agent/${encodeURIComponent(agentId)}?fab=${encodeURIComponent(fab)}`;
