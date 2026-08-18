import { marketFabOptionsMockData } from '@/mock-data/marketShared';
import { postApi } from '@/lib/httpClient';
import { mockDelay } from '@/lib/mock';
import { selectService } from '@/api/core/serviceMode';
import type { MarketListMode, ServiceRequestOptions } from '@/api/core/types';

export type FabResourceType = 'agent' | 'mcp' | 'skill';

export interface FabOptionsRequest {
  locale: string;
  mode: MarketListMode;
  type: FabResourceType;
}

export interface FabOptionsService {
  getFabOptions(input: FabOptionsRequest, options?: ServiceRequestOptions): Promise<{ fabs: string[] }>;
}

export const marketHttpService: FabOptionsService = {
  getFabOptions: (input, options) => postApi('market/getFabOptions', input, options),
};

export const marketMockService: FabOptionsService = {
  getFabOptions: async (input, options) => {
    await mockDelay(options?.signal);
    const all = marketFabOptionsMockData[input.type];
    if (input.mode === 'all') return { fabs: all };
    // Mock 约定：permissioned 模式只返回 F15B（当前用户默认可调用 FAB）
    return { fabs: all.filter((fab) => fab === 'F15B') };
  },
};

export const marketService = selectService(marketHttpService, marketMockService);
