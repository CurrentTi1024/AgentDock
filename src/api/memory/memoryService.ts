import { mockDelay } from '@/lib/mock';
import { postApi } from '@/lib/httpClient';
import { selectService } from '@/api/core/serviceMode';
import {
  memoryMockData,
  memoryPersonaMock,
  type MemoryAnalysisResult,
  type MemoryItem,
  type MemoryKind,
  type MemoryPersona,
} from '@/mock-data/memory';

export type { MemoryItem, MemoryKind, MemoryPersona, MemoryAnalysisResult };

interface MemoryService {
  getMemorySettings(): Promise<{ autoInject: boolean }>;
  updateMemorySettings(value: { autoInject: boolean }): Promise<{ autoInject: boolean }>;
  getMemoryItems(params?: { kind?: MemoryKind; keyword?: string }): Promise<MemoryItem[]>;
  getMemoryDetailById(id: string): Promise<MemoryItem | null>;
  createMemoryItem(value: Omit<MemoryItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<MemoryItem>;
  updateMemoryItem(id: string, value: Partial<MemoryItem>): Promise<MemoryItem>;
  deleteMemoryItem(id: string): Promise<{ id: string }>;
  getPersona(): Promise<MemoryPersona | null>;
  getRoleTags(): Promise<string[]>;
  getMemoryAnalysis(): Promise<MemoryAnalysisResult>;
}

export const memoryHttpService: MemoryService = {
  getMemorySettings: () => postApi('getMemorySettings', {}),
  updateMemorySettings: (value) => postApi('updateMemorySettings', value),
  getMemoryItems: (params) => postApi('getMemoryItems', { ...params }),
  getMemoryDetailById: (id) => postApi('getMemoryDetailById', { id }),
  createMemoryItem: (value) => postApi('createMemoryItem', value),
  updateMemoryItem: (id, value) => postApi('updateMemoryItem', { id, ...value }),
  deleteMemoryItem: (id) => postApi('deleteMemoryItem', { id }),
  getPersona: () => postApi('getMemoryPersona', {}),
  getRoleTags: () => postApi('getMemoryRoleTags', {}),
  getMemoryAnalysis: () => postApi('getMemoryAnalysis', {}),
};

export const memoryMockService: MemoryService = {
  getMemorySettings: async () => {
    await mockDelay();
    return { autoInject: true };
  },
  updateMemorySettings: async (value) => {
    await mockDelay();
    return value;
  },
  getMemoryItems: async (params) => {
    await mockDelay();
    let items = structuredClone(memoryMockData);
    if (params?.kind) items = items.filter((item) => item.kind === params.kind);
    const keyword = params?.keyword?.toLowerCase();
    if (keyword) {
      items = items.filter((item) =>
        `${item.title}${item.content}${item.tags.join(' ')}`.toLowerCase().includes(keyword),
      );
    }
    return items;
  },
  getMemoryDetailById: async (id) => {
    await mockDelay();
    return structuredClone(memoryMockData.find((item) => item.id === id) || null);
  },
  createMemoryItem: async (value) => {
    await mockDelay();
    const now = new Date().toISOString();
    const item: MemoryItem = { ...value, id: `memory-${crypto.randomUUID().slice(0, 8)}`, createdAt: now, updatedAt: now };
    memoryMockData.unshift(item);
    return structuredClone(item);
  },
  updateMemoryItem: async (id, value) => {
    await mockDelay();
    const index = memoryMockData.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Memory ${id} not found`);
    const next = { ...memoryMockData[index], ...value, id, updatedAt: new Date().toISOString() };
    memoryMockData[index] = next;
    return structuredClone(next);
  },
  deleteMemoryItem: async (id) => {
    await mockDelay();
    const index = memoryMockData.findIndex((item) => item.id === id);
    if (index >= 0) memoryMockData.splice(index, 1);
    return { id };
  },
  getPersona: async () => {
    await mockDelay();
    return structuredClone(memoryPersonaMock);
  },
  getRoleTags: async () => {
    await mockDelay();
    return structuredClone([
      ...new Set(memoryMockData.flatMap((item) => item.tags)),
    ]);
  },
  getMemoryAnalysis: async () => {
    await mockDelay();
    return {
      summary: '近 7 天新增 4 条记忆，主要围绕 FAB 环境、评审结构与飞行异常。',
      tags: ['FAB', '评审', '飞行'],
      suggestions: ['把 F18B 联调环境沉淀为长期上下文', '将评审结构经验固化为偏好'],
      range: {
        from: new Date(Date.now() - 7 * 86_400_000).toISOString(),
        to: new Date().toISOString(),
      },
    };
  },
};

export const memoryService = selectService(memoryHttpService, memoryMockService);
