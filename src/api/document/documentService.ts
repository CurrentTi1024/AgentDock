import { documentMockData } from '@/mock-data/document';
import { mockDelay } from '@/lib/mock';
import { postApi } from '@/lib/httpClient';
import { selectService } from '@/api/core/serviceMode';
type DocumentItem = (typeof documentMockData)[number];
interface DocumentService { getDocumentsListByKW(keyword?: string): Promise<DocumentItem[]>; getDocumentDetailById(id: string): Promise<DocumentItem | null> }
export const documentHttpService: DocumentService = { getDocumentsListByKW: (keyword) => postApi('getDocumentsListByKW', { keyword: keyword || null }), getDocumentDetailById: (id) => postApi('getDocumentDetailById', { id }) };
export const documentMockService: DocumentService = { getDocumentsListByKW: async (keyword) => { await mockDelay(); return structuredClone(documentMockData.filter((item) => !keyword || item.title.includes(keyword))); }, getDocumentDetailById: async (id) => structuredClone(documentMockData.find((item) => item.id === id) || null) };
export const documentService = selectService(documentHttpService, documentMockService);
