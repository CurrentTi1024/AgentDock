import { mcpMarketMockData } from '@/mock-data/mcpMarket';
import { filterMarketItems, mockDelay, page } from '@/lib/mock';
import { postApi } from '@/lib/httpClient';
import { selectService } from '@/api/core/serviceMode';
import type { Category, ListMarketRequest, MarketListMode, PageResult, ServiceRequestOptions } from '@/api/core/types';
import type { MarketDetail, MarketItem } from '@/types';

export interface McpListRequest extends ListMarketRequest {
  connectionType?: 'http' | 'sse' | 'stdio' | null;
}

export interface McpMarketService {
  getMcpServerCategories(input: { fab: string; locale: string; mode: MarketListMode }, options?: ServiceRequestOptions): Promise<{ categories: Category[] }>;
  getMcpServersListByCategoryAndKW(input: McpListRequest, options?: ServiceRequestOptions): Promise<PageResult<MarketItem>>;
  getMcpServerDetailById(input: { fab: string; locale: string; mcpServerId: string }, options?: ServiceRequestOptions): Promise<MarketDetail>;
  getAgentsReferencingMcpServerByMcpServerId(input: { fab: string; locale: string; mcpServerId: string; page: number; pageSize: number }, options?: ServiceRequestOptions): Promise<PageResult<(typeof mcpMarketMockData.referencingAgents)[number]>>;
}

export const mcpMarketHttpService: McpMarketService = {
  getMcpServerCategories: (input, options) => postApi('getMcpServerCategories', input, options),
  getMcpServersListByCategoryAndKW: (input, options) => postApi('getMcpServersListByCategoryAndKW', input, options),
  getMcpServerDetailById: (input, options) => postApi('getMcpServerDetailById', input, options),
  getAgentsReferencingMcpServerByMcpServerId: (input, options) => postApi('getAgentsReferencingMcpServerByMcpServerId', input, options),
};

export const mcpMarketMockService: McpMarketService = {
  getMcpServerCategories: async (input, options) => {
    await mockDelay(options?.signal);
    const allowed = filterMarketItems(mcpMarketMockData.items, { fab: input.fab, mode: input.mode }, {});
    return {
      categories: mcpMarketMockData.categories.map((category) => ({
        ...category,
        count: category.categoryId === 'all' ? allowed.length : allowed.filter((item) => item.category === category.categoryName).length,
      })),
    };
  },
  getMcpServersListByCategoryAndKW: async (input, options) => {
    await mockDelay(options?.signal);
    const categoryNames = Object.fromEntries(mcpMarketMockData.categories.map((category) => [category.categoryId, category.categoryName]));
    const filtered = filterMarketItems(mcpMarketMockData.items, input, categoryNames).filter(
      (item) => !input.connectionType || (input.connectionType === 'http' && item.id === 'company-git'),
    );
    return page(filtered, input.page, input.pageSize);
  },
  getMcpServerDetailById: async (input, options) => {
    await mockDelay(options?.signal);
    const detail = mcpMarketMockData.details[input.mcpServerId];
    if (!detail) throw new Error('MCP_NOT_FOUND');
    const next = structuredClone(detail);
    if (next.mcpVersions) next.mcpVersions = next.mcpVersions.filter((version) => version.fab === input.fab);
    return next;
  },
  getAgentsReferencingMcpServerByMcpServerId: async (input, options) => {
    await mockDelay(options?.signal);
    return page(mcpMarketMockData.referencingAgents.filter((item) => item.fab === input.fab), input.page, input.pageSize);
  },
};

export const mcpMarketService = selectService(mcpMarketHttpService, mcpMarketMockService);
