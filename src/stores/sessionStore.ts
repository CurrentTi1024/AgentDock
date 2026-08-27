// Session 本地存储的操作中间层（zustand）：把 Dexie service 的读写、容量监控、
// 导出清理统一收敛到 store，页面只消费状态与 action，不再各自挂事件监听。
import { create } from 'zustand';

import {
  sessionHistoryService,
  subscribeSessionChanges,
  type SessionRecord,
} from '@/api/session/sessionHistoryService';
import {
  buildSessionExport,
  checkStorageHealth,
  exportAndDeleteSessions,
  exportSessionFile,
  getStorageUsage,
  selectCleanupCandidates,
  type CleanupCriteria,
  type CleanupSelection,
  type StorageUsage,
} from '@/api/session/sessionStorageService';
import { sessionOperationService } from '@/features/chat/runtime/sessionOperationService';

/** 会话列表分页：首屏加载页大小，点击“加载更多”每次追加一页。 */
const SESSIONS_PAGE_SIZE = 50;

interface SessionStore {
  /** 会话列表（按 createdAt 倒序，更新消息不会让已有会话跳位）。 */
  sessions: SessionRecord[];
  hasMoreSessions: boolean;
  sessionLimit: number;
  storageUsage?: StorageUsage;
  cleanupSelection?: CleanupSelection;
  busy: boolean;
  refreshSessions: () => Promise<void>;
  loadMoreSessions: () => Promise<void>;
  refreshStorageUsage: (options?: { force?: boolean }) => Promise<void>;
  /** 预览清理候选（最多 50 条明细 + 命中总数）。 */
  previewCleanup: (criteria: CleanupCriteria) => Promise<void>;
  /** 仅导出 JSON，返回导出会话数（0 = 无命中）。 */
  exportCleanup: (criteria: CleanupCriteria) => Promise<number>;
  /** 导出并删除，返回导出/删除数量。 */
  exportAndDeleteCleanup: (criteria: CleanupCriteria) => Promise<{ deleted: number; exported: number }>;
  removeSession: (id: string) => Promise<void>;
  resetCleanup: () => void;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  hasMoreSessions: false,
  sessionLimit: SESSIONS_PAGE_SIZE,
  storageUsage: undefined,
  cleanupSelection: undefined,
  busy: false,

  refreshSessions: async () => {
    const [sessions, total] = await Promise.all([
      sessionHistoryService.listSessions({ limit: get().sessionLimit }),
      sessionHistoryService.countSessions(),
    ]);
    set({ sessions, hasMoreSessions: sessions.length < total });
  },

  loadMoreSessions: async () => {
    set({ sessionLimit: get().sessionLimit + SESSIONS_PAGE_SIZE });
    await get().refreshSessions();
  },

  refreshStorageUsage: async (options) => {
    const usage = await getStorageUsage();
    set({ storageUsage: usage });
    // 容量检查自带 10s 节流与跨级去重；force 用于设置页手动刷新/清理后。
    if (options?.force) {
      void checkStorageHealth({ force: true });
    } else {
      void checkStorageHealth();
    }
  },

  previewCleanup: async (criteria) => {
    set({ busy: true });
    try {
      const selection = await selectCleanupCandidates(criteria, { limit: 50 });
      set({ cleanupSelection: selection });
    } finally {
      set({ busy: false });
    }
  },

  exportCleanup: async (criteria) => {
    set({ busy: true });
    try {
      const { file, total } = await buildSessionExport(criteria);
      if (total === 0) return 0;
      exportSessionFile(file);
      return total;
    } finally {
      set({ busy: false });
    }
  },

  exportAndDeleteCleanup: async (criteria) => {
    set({ busy: true });
    try {
      const result = await exportAndDeleteSessions(criteria);
      set({ cleanupSelection: undefined });
      await get().refreshSessions();
      await get().refreshStorageUsage({ force: true });
      return { deleted: result.deleted, exported: result.exported };
    } finally {
      set({ busy: false });
    }
  },

  removeSession: async (id) => {
    await sessionOperationService.disposeSession(id);
    await sessionHistoryService.removeSession(id);
    // removeSession 会广播 sessions-changed，模块级订阅统一 refreshSessions。
  },

  resetCleanup: () => set({ cleanupSelection: undefined }),
}));

// 模块级订阅：同窗口 CustomEvent + 跨标签页 BroadcastChannel 双通道，
// 任何会话数据变化都统一刷新列表与容量，页面无需再各自挂监听。
if (typeof window !== 'undefined') {
  // 启动即刷一次容量：侧栏设置入口的橙/红角标不依赖首次变更事件。
  void useSessionStore.getState().refreshStorageUsage();
  subscribeSessionChanges(() => {
    const store = useSessionStore.getState();
    void store.refreshSessions();
    void store.refreshStorageUsage();
  });
  const onFocus = () => {
    void useSessionStore.getState().refreshStorageUsage();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') onFocus();
  };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibility);
}
