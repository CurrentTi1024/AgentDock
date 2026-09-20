import { ApiError } from '../../lib/httpClient.ts';

export interface CancelAgentRunInput {
  agentId?: string;
  fab: string;
  reason: 'user_requested';
  runId: string;
  sessionId: string;
  threadId: string;
}

export interface CancelAgentRunResult {
  interruptIds: string[];
  runId: string;
  status: 'cancel_requested' | 'cancelled';
}

type ApiEnvelope<T> = { code: number | string; data?: T; message?: string };

const buildEnv = (import.meta as ImportMeta & { env?: ImportMetaEnv }).env;
const apiBaseUrl = buildEnv?.VITE_API_BASE_URL || '/api';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const parseCancelResult = (
  input: CancelAgentRunInput,
  responseStatus: number,
  payload: unknown,
): CancelAgentRunResult => {
  const envelope = isRecord(payload) && 'code' in payload
    ? payload as ApiEnvelope<unknown>
    : undefined;
  if (envelope && envelope.code !== 0) {
    throw new ApiError(envelope.message || 'Run cancellation failed.', envelope.code, responseStatus);
  }
  const candidate = envelope?.data ?? payload;
  const result = isRecord(candidate) ? candidate : {};
  const status = result.status === 'cancelled' || result.status === 'cancel_requested'
    ? result.status
    : responseStatus === 202
      ? 'cancel_requested'
      : 'cancelled';
  return {
    interruptIds: Array.isArray(result.interruptIds)
      ? result.interruptIds.filter((id): id is string => typeof id === 'string')
      : [],
    runId: typeof result.runId === 'string' ? result.runId : input.runId,
    status,
  };
};

export const cancelAgentRunWithFetch = async (
  fetcher: typeof fetch,
  input: CancelAgentRunInput,
  options: { baseUrl?: string; signal?: AbortSignal } = {},
): Promise<CancelAgentRunResult> => {
  const response = await fetcher(
    `${options.baseUrl ?? apiBaseUrl}/agent-runtime/runs/${encodeURIComponent(input.runId)}/cancel`,
    {
      body: JSON.stringify({
        agentId: input.agentId,
        fab: input.fab,
        reason: input.reason,
        sessionId: input.sessionId,
        threadId: input.threadId,
      }),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      method: 'POST',
      signal: options.signal,
    },
  );
  const text = await response.text();
  let payload: unknown;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.message === 'string'
      ? payload.message
      : `HTTP ${response.status}`;
    throw new ApiError(message, 'RUN_CANCEL_FAILED', response.status);
  }
  return parseCancelResult(input, response.status, payload);
};

export const runControlService = {
  cancelRun: (input: CancelAgentRunInput, options?: { signal?: AbortSignal }) =>
    cancelAgentRunWithFetch(fetch, input, options),
};
