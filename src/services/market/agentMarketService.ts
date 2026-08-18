import { agentMarketMockData } from '@/mock-data/agentMarket';
import { filterMarketItems, mockDelay, page } from '@/services/core/mock';
import { postApi } from '@/services/core/httpClient';
import { selectService } from '@/services/core/serviceMode';
import type { Category, ListMarketRequest, MarketListMode, PageResult, ServiceRequestOptions } from '@/services/core/types';
import type { MarketDetail, MarketItem } from '@/types';
export interface MentionAgent { agentId: string; description: string; fab: string; icon: string; name: string; version: string }
export interface AgentMarketService {
  getAgentCategories(input: { locale: string; mode: MarketListMode }, options?: ServiceRequestOptions): Promise<{ categories: Category[] }>;
  getAgentsListByCategoryAndKW(input: ListMarketRequest, options?: ServiceRequestOptions): Promise<PageResult<MarketItem>>;
  getAgentDetailById(input: { agentId: string; locale: string }, options?: ServiceRequestOptions): Promise<MarketDetail>;
  getMentionAgentsList(input: { keyword?: string; limit: number; locale: string }, options?: ServiceRequestOptions): Promise<{ items: MentionAgent[] }>;
}
export const agentMarketHttpService: AgentMarketService = {
  getAgentCategories: (input, options) => postApi('getAgentCategories', input, options),
  getAgentsListByCategoryAndKW: (input, options) => postApi('getAgentsListByCategoryAndKW', input, options),
  getAgentDetailById: (input, options) => postApi('getAgentDetailById', input, options),
  getMentionAgentsList: (input, options) => postApi('getMentionAgentsList', input, options),
};
export const agentMarketMockService: AgentMarketService = {
  getAgentCategories: async (input, options) => { await mockDelay(options?.signal); const allowed = filterMarketItems(agentMarketMockData.items, { mode: input.mode }, {}); return { categories: agentMarketMockData.categories.map((category) => ({ ...category, count: category.categoryId === 'all' ? allowed.length : allowed.filter((item) => item.category === category.categoryName).length })) }; },
  getAgentsListByCategoryAndKW: async (input, options) => { await mockDelay(options?.signal); const categoryNames = Object.fromEntries(agentMarketMockData.categories.map((category) => [category.categoryId, category.categoryName])); return page(filterMarketItems(agentMarketMockData.items, input, categoryNames), input.page, input.pageSize); },
  getAgentDetailById: async (input, options) => { await mockDelay(options?.signal); const detail = agentMarketMockData.details[input.agentId]; if (!detail) throw new Error('AGENT_NOT_FOUND'); return structuredClone(detail); },
  getMentionAgentsList: async (input, options) => { await mockDelay(options?.signal); const keyword = input.keyword?.toLowerCase(); return { items: agentMarketMockData.mentions.filter((item) => !keyword || `${item.name}${item.fab}`.toLowerCase().includes(keyword)).slice(0, input.limit) }; },
};
export const agentMarketService = selectService(agentMarketHttpService, agentMarketMockService);
