import { buildSkillMcpDetailMockData, marketItemsMockData as marketItems } from './marketShared';
export const skillMarketMockData = {
  categories: [{ categoryId: 'all', categoryName: '全部', icon: '✨', count: marketItems.skill.length }, { categoryId: 'documents', categoryName: '文档', icon: '📄', count: 1 }, { categoryId: 'development', categoryName: '开发', icon: '🧩', count: 1 }],
  items: marketItems.skill,
  details: Object.fromEntries(marketItems.skill.map((item) => [item.id, buildSkillMcpDetailMockData('skill', item)])),
  referencingAgents: marketItems.agent.filter((agent) => 'agentFullName' in agent).map((agent) => ({ agentId: agent.id, agentFullName: agent.agentFullName, icon: agent.icon, description: agent.description, ownerId: agent.ownerId, ownerName: agent.ownerName, ownerType: agent.ownerType, category: agent.category, knowledgeCount: 2, agentVersion: agent.version, skillVersion: '1.0.0', fab: agent.fabPermission.fab, callPermission: agent.fabPermission.callPermission })),
};
