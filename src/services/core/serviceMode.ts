export type ServiceMode = 'http' | 'mock';
export const serviceMode: ServiceMode = import.meta.env.VITE_SERVICE_MODE === 'http' ? 'http' : 'mock';
export const selectService = <T>(httpService: T, mockService: T): T => serviceMode === 'http' ? httpService : mockService;
