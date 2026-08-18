import type { ApiEnvelope, ServiceRequestOptions } from '@/api/core/types';

export class ApiError extends Error {
  constructor(message: string, readonly code: number | string, readonly status?: number) { super(message); this.name = 'ApiError'; }
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api';

export async function postApi<TRequest extends object, TResponse>(endpoint: string, body: TRequest, options: ServiceRequestOptions = {}): Promise<TResponse> {
  const response = await fetch(`${apiBaseUrl}/${endpoint}`, {
    body: JSON.stringify(body),
    credentials: 'include',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    method: 'POST',
    signal: options.signal,
  });
  if (!response.ok) throw new ApiError(`HTTP ${response.status}`, 'HTTP_ERROR', response.status);
  const envelope = await response.json() as ApiEnvelope<TResponse>;
  if (envelope.code !== 0) throw new ApiError(envelope.message || 'Business request failed', envelope.code, response.status);
  return envelope.data;
}
