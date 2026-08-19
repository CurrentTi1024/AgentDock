import { mockDelay } from '@/lib/mock';
import { postApi } from '@/lib/httpClient';
import { selectService } from '@/api/core/serviceMode';
import {
  channelMockData,
  type ChannelPlatform,
  type ChannelRuntimeStatus,
} from '@/mock-data/channel';

export type { ChannelPlatform, ChannelRuntimeStatus };

interface ChannelService {
  getChannelsList(): Promise<ChannelPlatform[]>;
  getChannelDetailById(id: string): Promise<ChannelPlatform | null>;
  connectChannel(id: string, config: Record<string, unknown>): Promise<ChannelPlatform>;
  disconnectChannel(id: string): Promise<ChannelPlatform>;
  updateChannel(id: string, value: Partial<ChannelPlatform>): Promise<ChannelPlatform>;
}

export const channelHttpService: ChannelService = {
  getChannelsList: () => postApi('getChannelsList', {}),
  getChannelDetailById: (id) => postApi('getChannelDetailById', { id }),
  connectChannel: (id, config) => postApi('connectChannel', { id, config }),
  disconnectChannel: (id) => postApi('disconnectChannel', { id }),
  updateChannel: (id, value) => postApi('updateChannel', { id, ...value }),
};

export const channelMockService: ChannelService = {
  getChannelsList: async () => {
    await mockDelay();
    return structuredClone(channelMockData);
  },
  getChannelDetailById: async (id) => {
    await mockDelay();
    return structuredClone(channelMockData.find((item) => item.id === id) || null);
  },
  connectChannel: async (id, config) => {
    await mockDelay();
    const index = channelMockData.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Channel ${id} not found`);
    const next: ChannelPlatform = {
      ...channelMockData[index],
      config,
      enabled: true,
      status: 'connected',
      connectedAt: new Date().toISOString(),
    };
    channelMockData[index] = next;
    return structuredClone(next);
  },
  disconnectChannel: async (id) => {
    await mockDelay();
    const index = channelMockData.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Channel ${id} not found`);
    const next: ChannelPlatform = {
      ...channelMockData[index],
      enabled: false,
      status: 'disconnected',
      config: undefined,
      connectedAt: undefined,
    };
    channelMockData[index] = next;
    return structuredClone(next);
  },
  updateChannel: async (id, value) => {
    await mockDelay();
    const index = channelMockData.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Channel ${id} not found`);
    const next = { ...channelMockData[index], ...value, id };
    channelMockData[index] = next;
    return structuredClone(next);
  },
};

export const channelService = selectService(channelHttpService, channelMockService);
