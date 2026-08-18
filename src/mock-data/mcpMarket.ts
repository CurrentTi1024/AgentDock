import { buildSkillMcpDetailMockData, marketItemsMockData as marketItems } from './marketShared';
export const mcpMarketMockData = {
  categories: [{ categoryId: 'all', categoryName: '全部', icon: '✨', count: marketItems.mcp.length }, { categoryId: 'developer', categoryName: '开发工具', icon: '🛠️', count: 1 }, { categoryId: 'data', categoryName: '数据', icon: '📡', count: 1 }],
  items: marketItems.mcp,
  details: Object.fromEntries(marketItems.mcp.map((item) => [item.id, buildSkillMcpDetailMockData('mcp', item)])),
  referencingAgents: marketItems.agent.filter((agent) => 'agentFullName' in agent).slice(0, 2).map((agent) => ({ agentId: agent.id, agentFullName: agent.agentFullName, icon: agent.icon, description: agent.description, ownerId: agent.ownerId, ownerName: agent.ownerName, ownerType: agent.ownerType, category: agent.category, knowledgeCount: 2, agentVersion: agent.version, mcpServerVersion: '2.0.0', fab: agent.fabPermission.fab, callPermission: agent.fabPermission.callPermission })),
};
