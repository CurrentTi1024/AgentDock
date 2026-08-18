import { channelMockData } from '@/mock-data/channel';
import { mockDelay } from '@/lib/mock';
import { postApi } from '@/lib/httpClient';
import { selectService } from '@/api/core/serviceMode';
type ChannelItem = (typeof channelMockData)[number];
interface ChannelService { getChannelsList(): Promise<ChannelItem[]>; getChannelDetailById(id: string): Promise<ChannelItem | null> }
export const channelHttpService: ChannelService = { getChannelsList: () => postApi('getChannelsList', {}), getChannelDetailById: (id) => postApi('getChannelDetailById', { id }) };
export const channelMockService: ChannelService = { getChannelsList: async () => { await mockDelay(); return structuredClone(channelMockData); }, getChannelDetailById: async (id) => structuredClone(channelMockData.find((item) => item.id === id) || null) };
export const channelService = selectService(channelHttpService, channelMockService);
