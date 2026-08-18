import { artifactMockData } from '@/mock-data/artifact';
import { mockDelay } from '@/lib/mock';
import { postApi } from '@/lib/httpClient';
import { selectService } from '@/api/core/serviceMode';
type ArtifactItem = (typeof artifactMockData)[number];
interface ArtifactService { getArtifactsListBySessionId(sessionId: string): Promise<ArtifactItem[]>; getArtifactDetailById(id: string): Promise<ArtifactItem | null> }
export const artifactHttpService: ArtifactService = { getArtifactsListBySessionId: (sessionId) => postApi('getArtifactsListBySessionId', { sessionId }), getArtifactDetailById: (id) => postApi('getArtifactDetailById', { id }) };
export const artifactMockService: ArtifactService = { getArtifactsListBySessionId: async (sessionId) => { await mockDelay(); return structuredClone(artifactMockData.filter((item) => item.sessionId === sessionId)); }, getArtifactDetailById: async (id) => structuredClone(artifactMockData.find((item) => item.id === id) || null) };
export const artifactService = selectService(artifactHttpService, artifactMockService);
