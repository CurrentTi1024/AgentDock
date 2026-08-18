import { memoryMockData } from '@/mock-data/memory';
import { mockDelay } from '@/services/core/mock';
import { postApi } from '@/services/core/httpClient';
import { selectService } from '@/services/core/serviceMode';
type MemoryItem = (typeof memoryMockData)[number];
interface MemoryService { getMemorySettings(): Promise<{ autoInject: boolean }>; getMemoryItems(): Promise<MemoryItem[]>; updateMemoryItem(id: string, value: Partial<MemoryItem>): Promise<MemoryItem>; deleteMemoryItem(id: string): Promise<{ id: string }> }
export const memoryHttpService: MemoryService = { getMemorySettings: () => postApi('getMemorySettings', {}), getMemoryItems: () => postApi('getMemoryItems', {}), updateMemoryItem: (id, value) => postApi('updateMemoryItem', { id, ...value }), deleteMemoryItem: (id) => postApi('deleteMemoryItem', { id }) };
export const memoryMockService: MemoryService = { getMemorySettings: async () => ({ autoInject: true }), getMemoryItems: async () => { await mockDelay(); return structuredClone(memoryMockData); }, updateMemoryItem: async (id, value) => ({ ...memoryMockData.find((item) => item.id === id)!, ...value }), deleteMemoryItem: async (id) => ({ id }) };
export const memoryService = selectService(memoryHttpService, memoryMockService);
