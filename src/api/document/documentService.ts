import { mockDelay } from '@/lib/mock';
import { postApi } from '@/lib/httpClient';
import { selectService } from '@/api/core/serviceMode';
import { documentMockData, type DocumentItem } from '@/mock-data/document';

export type { DocumentItem };

export type DocumentFilter = 'recent' | 'mine' | 'shared';

interface DocumentService {
  getDocumentsListByKW(params?: {
    keyword?: string;
    filter?: DocumentFilter;
  }): Promise<DocumentItem[]>;
  getDocumentDetailById(id: string): Promise<DocumentItem | null>;
  createDocument(value: {
    title: string;
    content?: string;
    category?: DocumentItem['category'];
  }): Promise<DocumentItem>;
  updateDocument(id: string, value: Partial<DocumentItem>): Promise<DocumentItem>;
  deleteDocument(id: string): Promise<{ id: string }>;
}

export const documentHttpService: DocumentService = {
  getDocumentsListByKW: (params) => postApi('getDocumentsListByKW', { ...params }),
  getDocumentDetailById: (id) => postApi('getDocumentDetailById', { id }),
  createDocument: (value) => postApi('createDocument', value),
  updateDocument: (id, value) => postApi('updateDocument', { id, ...value }),
  deleteDocument: (id) => postApi('deleteDocument', { id }),
};

export const documentMockService: DocumentService = {
  getDocumentsListByKW: async (params) => {
    await mockDelay();
    let items = structuredClone(documentMockData);
    const keyword = params?.keyword?.toLowerCase();
    if (keyword) {
      items = items.filter((item) => `${item.title}${item.owner}`.toLowerCase().includes(keyword));
    }
    switch (params?.filter) {
      case 'mine':
        items = items.filter((item) => item.ownerId === 'user' || item.agentName);
        break;
      case 'shared':
        items = items.filter((item) => item.shared);
        break;
      default:
        items = [...items].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
    }
    return items;
  },
  getDocumentDetailById: async (id) => {
    await mockDelay();
    return structuredClone(documentMockData.find((item) => item.id === id) || null);
  },
  createDocument: async (value) => {
    await mockDelay();
    const now = new Date().toISOString();
    const doc: DocumentItem = {
      id: `doc-${crypto.randomUUID().slice(0, 8)}`,
      title: value.title,
      content: value.content ?? '# 新文档\n\n开始写作…',
      category: value.category ?? 'notes',
      mediaType: 'text/markdown',
      size: new Blob([value.content ?? '']).size,
      owner: 'Me',
      ownerId: 'user',
      createdAt: now,
      updatedAt: now,
    };
    documentMockData.unshift(doc);
    return structuredClone(doc);
  },
  updateDocument: async (id, value) => {
    await mockDelay();
    const index = documentMockData.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Document ${id} not found`);
    const next = { ...documentMockData[index], ...value, id, updatedAt: new Date().toISOString() };
    documentMockData[index] = next;
    return structuredClone(next);
  },
  deleteDocument: async (id) => {
    await mockDelay();
    const index = documentMockData.findIndex((item) => item.id === id);
    if (index >= 0) documentMockData.splice(index, 1);
    return { id };
  },
};

export const documentService = selectService(documentHttpService, documentMockService);
