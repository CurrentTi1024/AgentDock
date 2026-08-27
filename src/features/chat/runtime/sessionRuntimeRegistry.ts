import type { SessionRuntimeHandle } from './types';

const handles = new Map<string, SessionRuntimeHandle>();
const waiters = new Map<
  string,
  Set<{ reject: (reason: Error) => void; resolve: (handle: SessionRuntimeHandle) => void; timer: ReturnType<typeof setTimeout> }>
>();

const READY_TIMEOUT_MS = 15_000;

export const sessionRuntimeRegistry = {
  get(sessionId: string) {
    return handles.get(sessionId);
  },

  register(sessionId: string, handle: SessionRuntimeHandle) {
    handles.set(sessionId, handle);
    const pending = waiters.get(sessionId);
    if (!pending || !handle.isReady()) return;
    for (const waiter of pending) {
      clearTimeout(waiter.timer);
      waiter.resolve(handle);
    }
    waiters.delete(sessionId);
  },

  unregister(sessionId: string, handle: SessionRuntimeHandle) {
    if (handles.get(sessionId) === handle) handles.delete(sessionId);
  },

  /**
   * Session 的 thread 被替换或会话被删除时立即失效旧 handle，并终止所有等待者。
   * 否则 React 完成 Worker 换代前，whenReady() 可能拿到上一条 thread 的 handle。
   */
  reset(sessionId: string, reason = 'Session runtime was reset.') {
    handles.delete(sessionId);
    const pending = waiters.get(sessionId);
    if (!pending) return;
    for (const waiter of pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
    }
    waiters.delete(sessionId);
  },

  whenReady(sessionId: string): Promise<SessionRuntimeHandle> {
    const current = handles.get(sessionId);
    if (current?.isReady()) return Promise.resolve(current);
    return new Promise((resolve, reject) => {
      const entry = {
        reject,
        resolve,
        timer: setTimeout(() => {
          const pending = waiters.get(sessionId);
          if (pending) {
            pending.delete(entry);
            if (pending.size === 0) waiters.delete(sessionId);
          }
          reject(new Error(`Runtime for session ${sessionId} did not become ready in time.`));
        }, READY_TIMEOUT_MS),
      };
      const pending = waiters.get(sessionId) ?? new Set();
      pending.add(entry);
      waiters.set(sessionId, pending);
    });
  },
};
