export type MarketKind = 'agent' | 'skill' | 'mcp';

export interface FabVersion {
  fab: string;
  version: string;
  callPermission: boolean;
}

export interface FabPermission {
  fab: string;
  callPermission: boolean;
}

export interface MarketItemBase {
  id: string;
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
}

export interface AgentMarketItem extends MarketItemBase {
  agentFullName: string;
  version: string;
  fabPermission: FabPermission;
}

export interface SkillMcpMarketItem extends MarketItemBase {
  name: string;
  versions: FabVersion[];
}

export type MarketItem = AgentMarketItem | SkillMcpMarketItem;

export const isAgentMarketItem = (item: MarketItem): item is AgentMarketItem =>
  'agentFullName' in item;

export interface AgentResource {
  icon: string;
  mcpServerId?: string;
  name: string;
  skillId?: string;
  version: string;
  fab?: string;
}

export interface AgentExample {
  title: string;
  userMessage: string;
}

export interface AgentVersionInfo extends FabVersion {
  changeLog?: string;
  createAt?: string;
  updateAt?: string;
}

export interface RelatedAgent {
  agentFullName: string;
  agentId: string;
  category: string;
  description: string;
  icon: string;
  knowledgeCount: number;
  ownerId: string;
  ownerName: string;
  ownerType: 'NT' | 'Organization';
}

export interface AgentDetail extends AgentMarketItem {
  summary: string;
  homepageUrl?: string;
  overview: string;
  systemRoleMarkdown: string;
  capabilities: string[];
  examples: AgentExample[];
  skills: AgentResource[];
  mcpServers: AgentResource[];
  versionInfo: AgentVersionInfo;
  relatedAgents: RelatedAgent[];
}

export interface SkillFabDetail extends FabVersion {
  changelog: string[];
  content: string;
  permissions: string[];
  resources: Array<{ path: string; size: string }>;
  summary: string;
}

export interface McpFabDetail extends FabVersion {
  changelog: string[];
  connectionType: 'HTTP' | 'SSE' | 'STDIO';
  deploymentOptions: Array<{ description: string; label: string; recommended?: boolean }>;
  overview: string;
  prompts: Array<{ description: string; name: string }>;
  resources: Array<{ description: string; name: string; uri: string }>;
  tools: Array<{ description: string; name: string; schema: string }>;
}

export interface ReferencingAgent {
  agentFullName?: string;
  agentId: string;
  agentVersion: string;
  callPermission: boolean;
  category: string;
  description: string;
  fab: string;
  icon: string;
  knowledgeCount: number;
  name?: string;
  ownerId: string;
  ownerName: string;
  ownerType: 'NT' | 'Organization';
}

export interface SkillMcpDetail extends SkillMcpMarketItem {
  summary: string;
  tags: string[];
  homepageUrl?: string;
  repositoryUrl?: string;
  skillVersions?: SkillFabDetail[];
  mcpVersions?: McpFabDetail[];
  related: MarketItem[];
  referencingAgents?: ReferencingAgent[];
}

export type MarketDetail = AgentDetail | SkillMcpDetail;
