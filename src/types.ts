export type MarketKind = 'agent' | 'skill' | 'mcp';

export interface FabVersion {
  fab: string;
  version: string;
  callPermission: boolean;
}

export interface AgentFabDetail extends FabVersion {
  overview: string;
  systemRole: string;
  openingMessage: string;
  openingQuestions: string[];
  examples: Array<{ content: string; role: 'assistant' | 'user' }>;
  capabilities: string[];
  skills: Array<{ icon: string; name: string; version: string }>;
  mcpServers: Array<{ icon: string; name: string; version: string }>;
}

export interface SkillFabDetail extends FabVersion {
  summary: string;
  content: string;
  changelog: string[];
  permissions: string[];
  resources: Array<{ path: string; size: string }>;
}

export interface McpFabDetail extends FabVersion {
  overview: string;
  changelog: string[];
  connectionType: 'HTTP' | 'SSE' | 'STDIO';
  deploymentOptions: Array<{ description: string; label: string; recommended?: boolean }>;
  tools: Array<{ description: string; name: string; schema: string }>;
  resources: Array<{ description: string; name: string; uri: string }>;
  prompts: Array<{ description: string; name: string }>;
}

export interface MarketDetail extends MarketItem {
  summary: string;
  tags: string[];
  homepageUrl?: string;
  repositoryUrl?: string;
  agentVersions?: AgentFabDetail[];
  skillVersions?: SkillFabDetail[];
  mcpVersions?: McpFabDetail[];
  related: MarketItem[];
  referencingAgents?: Array<{
    agentId: string;
    agentVersion: string;
    fab: string;
    icon: string;
    name: string;
  }>;
}

export interface MarketItem {
  id: string;
  name: string;
  icon: string;
  description: string;
  ownerId: string;
  ownerName: string;
  ownerType: 'NT' | 'Organization';
  category: string;
  isFeatured?: boolean;
  isValidated?: boolean;
  createTimeAt: string;
  updatedAt: string;
  metric: string;
  versions: FabVersion[];
}
