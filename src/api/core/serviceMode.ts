export type ServiceMode = 'http' | 'mock';

// 普通业务 API（市场/用户/反馈等）：VITE_SERVICE_MODE + agentdock-service-mode
const DEFAULT_SERVICE_MODE: ServiceMode = import.meta.env.VITE_SERVICE_MODE === 'http' ? 'http' : 'mock';
const STORAGE_KEY = 'agentdock-service-mode';

// 对话运行时（CopilotKit / AG-UI）：VITE_CHAT_MODE + agentdock-chat-mode
// 未单独配置时回退到 VITE_SERVICE_MODE，保证旧项目只配一个开关也能用。
const DEFAULT_CHAT_MODE: ServiceMode =
  import.meta.env.VITE_CHAT_MODE === 'http' ? 'http' : DEFAULT_SERVICE_MODE;
const CHAT_STORAGE_KEY = 'agentdock-chat-mode';

const readMode = (key: string, fallback: ServiceMode): ServiceMode => {
  try {
    const stored = localStorage.getItem(key);
    if (stored === 'http' || stored === 'mock') return stored;
  } catch {
    // ignore unavailable storage
  }
  return fallback;
};

export const getServiceMode = (): ServiceMode => readMode(STORAGE_KEY, DEFAULT_SERVICE_MODE);

export const setServiceMode = (mode: ServiceMode): void => {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore quota / private-mode storage errors
  }
};

export const getChatServiceMode = (): ServiceMode => readMode(CHAT_STORAGE_KEY, DEFAULT_CHAT_MODE);

export const setChatServiceMode = (mode: ServiceMode): void => {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, mode);
  } catch {
    // ignore quota / private-mode storage errors
  }
};

const createDelegatingService = <T>(httpService: T, mockService: T): T =>
  new Proxy({} as Record<PropertyKey, unknown>, {
    get(_target, prop) {
      const current = getServiceMode() === 'http' ? httpService : mockService;
      const value = (current as unknown as Record<PropertyKey, unknown>)[prop];
      return typeof value === 'function' ? value.bind(current) : value;
    },
  }) as unknown as T;

export const selectService = <T>(httpService: T, mockService: T): T =>
  createDelegatingService(httpService, mockService);
