import { getServiceMode } from '@/api/core/serviceMode';

export type RuntimeTransport = 'direct' | 'proxy';
const parseEndpoints = (): Record<string, string> => {
  try { return JSON.parse(import.meta.env.VITE_AGENT_ORCHESTRATION_ENDPOINTS_JSON || '{}') as Record<string, string>; }
  catch { throw new Error('VITE_AGENT_ORCHESTRATION_ENDPOINTS_JSON is not valid JSON'); }
};
const endpoints = parseEndpoints();
const appendAgUi = (baseUrl: string) => `${baseUrl.replace(/\/+$/, '')}/ag-ui`;
export const runtimeConfig = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '/api',
  copilotRuntimeUrl: '/api/copilotkit',
  transport: (import.meta.env.VITE_AGENT_RUNTIME_TRANSPORT === 'direct' ? 'direct' : 'proxy') as RuntimeTransport,
  resolveAgentRuntimeUrl(fab: string) {
    if (this.transport === 'proxy') return this.copilotRuntimeUrl;
    const baseUrl = endpoints[fab];
    if (!baseUrl) {
      if (getServiceMode() !== 'http') return `/mock-orchestration/${fab}/ag-ui`;
      throw new Error(`FAB_ENDPOINT_NOT_CONFIGURED: ${fab}`);
    }
    return appendAgUi(baseUrl);
  },
};
