import { create } from 'zustand';

import type {
  SessionOperation,
  SessionRuntimeDescriptor,
} from '../features/chat/runtime/types';

interface SessionOperationStore {
  activeRunBySession: Record<string, string | undefined>;
  operationsById: Record<string, SessionOperation>;
  runtimeBySession: Record<string, SessionRuntimeDescriptor>;
  viewingSessionId?: string;
  addOperation: (operation: SessionOperation) => void;
  markRuntimeReady: (sessionId: string) => void;
  removeOperation: (runId: string) => void;
  removeRuntime: (sessionId: string, key?: string) => void;
  setViewingSession: (sessionId?: string) => void;
  updateOperation: (runId: string, value: Partial<SessionOperation>) => void;
  upsertRuntime: (descriptor: SessionRuntimeDescriptor) => void;
}

export const useSessionOperationStore = create<SessionOperationStore>((set) => ({
  activeRunBySession: {},
  operationsById: {},
  runtimeBySession: {},
  viewingSessionId: undefined,

  addOperation: (operation) =>
    set((state) => ({
      activeRunBySession: {
        ...state.activeRunBySession,
        [operation.sessionId]: operation.runId,
      },
      operationsById: { ...state.operationsById, [operation.runId]: operation },
    })),

  markRuntimeReady: (sessionId) =>
    set((state) => {
      const runtime = state.runtimeBySession[sessionId];
      if (!runtime || runtime.status === 'ready') return state;
      return {
        runtimeBySession: {
          ...state.runtimeBySession,
          [sessionId]: { ...runtime, status: 'ready' },
        },
      };
    }),

  removeOperation: (runId) =>
    set((state) => {
      const operation = state.operationsById[runId];
      if (!operation) return state;
      const operationsById = { ...state.operationsById };
      delete operationsById[runId];
      const activeRunBySession = { ...state.activeRunBySession };
      if (activeRunBySession[operation.sessionId] === runId) {
        delete activeRunBySession[operation.sessionId];
      }
      return { activeRunBySession, operationsById };
    }),

  removeRuntime: (sessionId, key) =>
    set((state) => {
      const current = state.runtimeBySession[sessionId];
      if (!current || (key && current.key !== key)) return state;
      const runtimeBySession = { ...state.runtimeBySession };
      delete runtimeBySession[sessionId];
      return { runtimeBySession };
    }),

  setViewingSession: (sessionId) => set({ viewingSessionId: sessionId }),

  updateOperation: (runId, value) =>
    set((state) => {
      const current = state.operationsById[runId];
      if (!current) return state;
      return {
        operationsById: {
          ...state.operationsById,
          [runId]: { ...current, ...value },
        },
      };
    }),

  upsertRuntime: (descriptor) =>
    set((state) => {
      const current = state.runtimeBySession[descriptor.sessionId];
      if (current?.key === descriptor.key) return state;
      return {
        runtimeBySession: {
          ...state.runtimeBySession,
          [descriptor.sessionId]: descriptor,
        },
      };
    }),
}));

export const selectSessionOperation = (sessionId: string) =>
  (state: SessionOperationStore): SessionOperation | undefined => {
    const runId = state.activeRunBySession[sessionId];
    return runId ? state.operationsById[runId] : undefined;
  };

export const selectSessionRun = (sessionId: string) =>
  (state: SessionOperationStore) => selectSessionOperation(sessionId)(state)?.snapshot;

export const isOperationBusy = (operation?: SessionOperation): boolean =>
  operation?.status === 'booting' ||
  operation?.status === 'running' ||
  operation?.status === 'paused';
