type CancelRequestBody = {
  agentId?: string;
  fab?: string;
  reason?: string;
  sessionId?: string;
  threadId?: string;
};

const CANCEL_PATH = /^\/api\/agent-runtime\/runs\/([^/]+)\/cancel$/;

const getForwardHeaders = (request: Request) => {
  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/json; charset=utf-8',
  });
  for (const name of ['authorization', 'cookie', 'x-request-id', 'traceparent']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
};

const json = (body: unknown, status: number) => Response.json(body, { status });

/** Same-origin control gateway for the company's ordinary POST /ag-ui/cancel endpoint. */
export const handleRunCancelRequest = async (
  request: Request,
  endpoints: Record<string, string>,
): Promise<Response> => {
  if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED', message: 'POST required.' }, 405);
  const match = new URL(request.url).pathname.match(CANCEL_PATH);
  if (!match) return json({ code: 'NOT_FOUND', message: 'Unknown run control endpoint.' }, 404);
  let body: CancelRequestBody;
  try {
    body = await request.json() as CancelRequestBody;
  } catch {
    return json({ code: 'INVALID_REQUEST', message: 'Request body must be JSON.' }, 400);
  }
  let runId: string;
  try {
    runId = decodeURIComponent(match[1]);
  } catch {
    return json({ code: 'INVALID_REQUEST', message: 'runId must be URL encoded.' }, 400);
  }
  if (!runId || !body.fab || !body.sessionId || !body.threadId) {
    return json({ code: 'INVALID_REQUEST', message: 'Missing runId, threadId, sessionId or fab.' }, 400);
  }
  const baseUrl = endpoints[body.fab];
  if (!baseUrl) {
    return json({ code: 'FAB_ENDPOINT_NOT_CONFIGURED', message: `No endpoint configured for FAB ${body.fab}.` }, 422);
  }
  try {
    const upstream = await fetch(`${baseUrl.replace(/\/+$/, '')}/ag-ui/cancel`, {
      body: JSON.stringify({ runId }),
      headers: getForwardHeaders(request),
      method: 'POST',
      signal: request.signal,
    });
    const text = await upstream.text();
    let payload: unknown;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
    if (!upstream.ok) {
      return json({
        code: 'RUN_CANCEL_FAILED',
        message: typeof payload === 'object' && payload && 'message' in payload
          ? String(payload.message)
          : `Orchestration cancel failed with HTTP ${upstream.status}.`,
      }, upstream.status);
    }
    const record = typeof payload === 'object' && payload ? payload as Record<string, unknown> : {};
    const status = record.status === 'cancel_requested' || upstream.status === 202
      ? 'cancel_requested'
      : 'cancelled';
    return json({
      code: 0,
      data: {
        interruptIds: Array.isArray(record.interruptIds) ? record.interruptIds : [],
        runId,
        status,
      },
      message: 'ok',
    }, upstream.status === 202 ? 202 : 200);
  } catch (error) {
    return json({
      code: 'RUN_CANCEL_UNAVAILABLE',
      message: error instanceof Error ? error.message : 'Orchestration cancel unavailable.',
    }, 502);
  }
};
