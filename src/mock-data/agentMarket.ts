import { buildMarketDetailMockData, marketItemsMockData as marketItems } from './marketShared';
export const agentMarketMockData = {
  categories: [{ categoryId: 'all', categoryName: '全部', icon: '✨', count: marketItems.agent.length }, { categoryId: 'analysis', categoryName: '数据分析', icon: '📊', count: 1 }, { categoryId: 'programming', categoryName: '编程', icon: '💻', count: 1 }, { categoryId: 'office', categoryName: '办公', icon: '📝', count: 1 }],
  items: marketItems.agent,
  details: Object.fromEntries(marketItems.agent.map((item) => [item.id, buildMarketDetailMockData('agent', item)])),
  mentions: marketItems.agent.flatMap((agent) => agent.versions.filter((version) => version.callPermission).map((version) => ({ agentId: agent.id, name: `${agent.name}-${version.fab}`, icon: agent.icon, description: agent.description, version: version.version, fab: version.fab }))),
};
