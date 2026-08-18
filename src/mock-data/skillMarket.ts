import { buildMarketDetailMockData, marketItemsMockData as marketItems } from './marketShared';
export const skillMarketMockData = {
  categories: [{ categoryId: 'all', categoryName: '全部', icon: '✨', count: marketItems.skill.length }, { categoryId: 'documents', categoryName: '文档', icon: '📄', count: 1 }, { categoryId: 'development', categoryName: '开发', icon: '🧩', count: 1 }],
  items: marketItems.skill,
  details: Object.fromEntries(marketItems.skill.map((item) => [item.id, buildMarketDetailMockData('skill', item)])),
  referencingAgents: marketItems.agent.map((agent) => ({ agentId: agent.id, name: agent.name, icon: agent.icon, description: agent.description, ownerId: agent.ownerId, ownerName: agent.ownerName, ownerType: agent.ownerType, category: agent.category, knowledgeCount: 2, agentVersion: agent.versions[0].version, skillVersion: '1.0.0', fab: agent.versions[0].fab, callPermission: agent.versions[0].callPermission })),
};
