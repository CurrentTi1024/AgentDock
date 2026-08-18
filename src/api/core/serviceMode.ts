export type ServiceMode = 'http' | 'mock';

const DEFAULT_SERVICE_MODE: ServiceMode = import.meta.env.VITE_SERVICE_MODE === 'http' ? 'http' : 'mock';
const STORAGE_KEY = 'agentdock-service-mode';

export const getServiceMode = (): ServiceMode => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'http' || stored === 'mock') return stored;
  } catch {
    // ignore unavailable storage
  }
  return DEFAULT_SERVICE_MODE;
};

export const setServiceMode = (mode: ServiceMode): void => {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
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
