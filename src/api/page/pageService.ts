import { mockDelay } from '@/lib/mock';
import { postApi } from '@/lib/httpClient';
import { selectService } from '@/api/core/serviceMode';
import { pageMockData, type PageItem } from '@/mock-data/page';

export type { PageItem };

interface PageService {
  getPagesList(params?: { keyword?: string; status?: PageItem['status'] }): Promise<PageItem[]>;
  getPageDetailById(id: string): Promise<PageItem | null>;
  createPage(value: { title: string; content?: string }): Promise<PageItem>;
  updatePage(id: string, value: Partial<PageItem>): Promise<PageItem>;
  deletePage(id: string): Promise<{ id: string }>;
}

export const pageHttpService: PageService = {
  getPagesList: (params) => postApi('getPagesList', { ...params }),
  getPageDetailById: (id) => postApi('getPageDetailById', { id }),
  createPage: (value) => postApi('createPage', value),
  updatePage: (id, value) => postApi('updatePage', { id, ...value }),
  deletePage: (id) => postApi('deletePage', { id }),
};

export const pageMockService: PageService = {
  getPagesList: async (params) => {
    await mockDelay();
    let items = structuredClone(pageMockData);
    const keyword = params?.keyword?.toLowerCase();
    if (keyword) items = items.filter((item) => item.title.toLowerCase().includes(keyword));
    if (params?.status) items = items.filter((item) => item.status === params.status);
    return items;
  },
  getPageDetailById: async (id) => {
    await mockDelay();
    return structuredClone(pageMockData.find((item) => item.id === id) || null);
  },
  createPage: async (value) => {
    await mockDelay();
    const now = new Date().toISOString();
    const page: PageItem = {
      id: `page-${crypto.randomUUID().slice(0, 8)}`,
      title: value.title,
      content: value.content ?? '# 新页面\n\n',
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    pageMockData.unshift(page);
    return structuredClone(page);
  },
  updatePage: async (id, value) => {
    await mockDelay();
    const index = pageMockData.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Page ${id} not found`);
    const next = { ...pageMockData[index], ...value, id, updatedAt: new Date().toISOString() };
    pageMockData[index] = next;
    return structuredClone(next);
  },
  deletePage: async (id) => {
    await mockDelay();
    const index = pageMockData.findIndex((item) => item.id === id);
    if (index >= 0) pageMockData.splice(index, 1);
    return { id };
  },
};

export const pageService = selectService(pageHttpService, pageMockService);
