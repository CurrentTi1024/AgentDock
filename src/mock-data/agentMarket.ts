import { buildAgentDetailMockData, marketItemsMockData } from './marketShared';

const agentItems = marketItemsMockData.agent.filter(
  (item): item is Extract<typeof item, { agentFullName: string }> => 'agentFullName' in item,
);

export const agentMarketMockData = {
  categories: [
    { categoryId: 'all', categoryName: '全部', icon: '✨', count: agentItems.length },
    { categoryId: 'analysis', categoryName: '数据分析', icon: '📊', count: 1 },
    { categoryId: 'programming', categoryName: '编程', icon: '💻', count: 1 },
    { categoryId: 'office', categoryName: '办公', icon: '📝', count: 1 },
  ],
  details: Object.fromEntries(
    agentItems.map((item) => [`${item.id}@${item.fabPermission.fab}`, buildAgentDetailMockData(item)]),
  ),
  items: agentItems,
  mentions: agentItems
    .filter((item) => item.fabPermission.callPermission)
    .map((item) => ({
      agentId: item.id,
      agentFullName: item.agentFullName,
      description: item.description,
      fab: item.fabPermission.fab,
      icon: item.icon,
      ownerName: item.ownerName,
      version: item.version,
    })),
};
