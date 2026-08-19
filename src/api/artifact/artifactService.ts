import { mockDelay } from '@/lib/mock';
import { postApi } from '@/lib/httpClient';
import { selectService } from '@/api/core/serviceMode';
import { artifactMockData, type ArtifactItem, type ArtifactType } from '@/mock-data/artifact';

export type { ArtifactItem, ArtifactType };

interface ArtifactService {
  getArtifactsListBySessionId(params?: {
    sessionId?: string;
    keyword?: string;
  }): Promise<ArtifactItem[]>;
  getArtifactDetailById(id: string): Promise<ArtifactItem | null>;
  createArtifact(value: Omit<ArtifactItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<ArtifactItem>;
  deleteArtifact(id: string): Promise<{ id: string }>;
}

export const artifactHttpService: ArtifactService = {
  getArtifactsListBySessionId: (params) => postApi('getArtifactsListBySessionId', { ...params }),
  getArtifactDetailById: (id) => postApi('getArtifactDetailById', { id }),
  createArtifact: (value) => postApi('createArtifact', value),
  deleteArtifact: (id) => postApi('deleteArtifact', { id }),
};

export const artifactMockService: ArtifactService = {
  getArtifactsListBySessionId: async (params) => {
    await mockDelay();
    let items = structuredClone(artifactMockData);
    if (params?.sessionId) items = items.filter((item) => item.sessionId === params.sessionId);
    const keyword = params?.keyword?.toLowerCase();
    if (keyword) {
      items = items.filter((item) => `${item.title}${item.sessionTitle}`.toLowerCase().includes(keyword));
    }
    return items;
  },
  getArtifactDetailById: async (id) => {
    await mockDelay();
    return structuredClone(artifactMockData.find((item) => item.id === id) || null);
  },
  createArtifact: async (value) => {
    await mockDelay();
    const now = new Date().toISOString();
    const item: ArtifactItem = {
      ...value,
      id: `artifact-${crypto.randomUUID().slice(0, 8)}`,
      createdAt: now,
      updatedAt: now,
    };
    artifactMockData.unshift(item);
    return structuredClone(item);
  },
  deleteArtifact: async (id) => {
    await mockDelay();
    const index = artifactMockData.findIndex((item) => item.id === id);
    if (index >= 0) artifactMockData.splice(index, 1);
    return { id };
  },
};

export const artifactService = selectService(artifactHttpService, artifactMockService);
