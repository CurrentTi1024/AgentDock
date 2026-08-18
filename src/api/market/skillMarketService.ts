import { skillMarketMockData } from '@/mock-data/skillMarket';
import { filterMarketItems, mockDelay, page } from '@/lib/mock';
import { postApi } from '@/lib/httpClient';
import { selectService } from '@/api/core/serviceMode';
import type { Category, ListMarketRequest, MarketListMode, PageResult, ServiceRequestOptions } from '@/api/core/types';
import type { MarketDetail, MarketItem } from '@/types';

export interface CreateSkillRequest {
  categoryId: string;
  changelogMarkdown: string;
  description: string;
  fabs: string[];
  homepageUrl?: string;
  icon: string;
  license: string;
  locale: string;
  name: string;
  repository: { branch: string; path: string; url: string };
  summary: string;
  version: string;
}

export interface SkillMarketService {
  getSkillCategories(input: { fab: string; locale: string; mode: MarketListMode }, options?: ServiceRequestOptions): Promise<{ categories: Category[] }>;
  getSkillsListByCategoryAndKW(input: ListMarketRequest, options?: ServiceRequestOptions): Promise<PageResult<MarketItem>>;
  getSkillDetailById(input: { fab: string; locale: string; skillId: string }, options?: ServiceRequestOptions): Promise<MarketDetail>;
  getAgentsReferencingSkillBySkillId(input: { fab: string; locale: string; page: number; pageSize: number; skillId: string }, options?: ServiceRequestOptions): Promise<PageResult<(typeof skillMarketMockData.referencingAgents)[number]>>;
  createAndPublishSkill(input: CreateSkillRequest, options?: ServiceRequestOptions): Promise<{ createdAt: string; detailUrl: string; fabs: string[]; publicationStatus: 'published'; skillId: string; version: string }>;
}

export const skillMarketHttpService: SkillMarketService = {
  getSkillCategories: (input, options) => postApi('getSkillCategories', input, options),
  getSkillsListByCategoryAndKW: (input, options) => postApi('getSkillsListByCategoryAndKW', input, options),
  getSkillDetailById: (input, options) => postApi('getSkillDetailById', input, options),
  getAgentsReferencingSkillBySkillId: (input, options) => postApi('getAgentsReferencingSkillBySkillId', input, options),
  createAndPublishSkill: (input, options) => postApi('createAndPublishSkill', input, options),
};

export const skillMarketMockService: SkillMarketService = {
  getSkillCategories: async (input, options) => {
    await mockDelay(options?.signal);
    const allowed = filterMarketItems(skillMarketMockData.items, { fab: input.fab, mode: input.mode }, {});
    return {
      categories: skillMarketMockData.categories.map((category) => ({
        ...category,
        count: category.categoryId === 'all' ? allowed.length : allowed.filter((item) => item.category === category.categoryName).length,
      })),
    };
  },
  getSkillsListByCategoryAndKW: async (input, options) => {
    await mockDelay(options?.signal);
    const categoryNames = Object.fromEntries(skillMarketMockData.categories.map((category) => [category.categoryId, category.categoryName]));
    return page(filterMarketItems(skillMarketMockData.items, input, categoryNames), input.page, input.pageSize);
  },
  getSkillDetailById: async (input, options) => {
    await mockDelay(options?.signal);
    const detail = skillMarketMockData.details[input.skillId];
    if (!detail) throw new Error('SKILL_NOT_FOUND');
    const next = structuredClone(detail);
    if (next.skillVersions) next.skillVersions = next.skillVersions.filter((version) => version.fab === input.fab);
    return next;
  },
  getAgentsReferencingSkillBySkillId: async (input, options) => {
    await mockDelay(options?.signal);
    return page(skillMarketMockData.referencingAgents.filter((item) => item.fab === input.fab), input.page, input.pageSize);
  },
  createAndPublishSkill: async (input, options) => {
    await mockDelay(options?.signal, 500);
    const slug = input.name.toLowerCase().replace(/\s+/g, '-');
    return {
      skillId: `skill-${slug}`,
      publicationStatus: 'published',
      version: input.version,
      fabs: input.fabs,
      createdAt: new Date().toISOString(),
      detailUrl: `/market/skill/skill-${slug}`,
    };
  },
};

export const skillMarketService = selectService(skillMarketHttpService, skillMarketMockService);
