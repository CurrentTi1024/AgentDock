/**
 * Framework-neutral core for POST /api/copilotkit.
 * Mount handleCopilotRuntimeRequest from the AgentDock App Server adapter.
 */
type ForwardedProps = { action: string; fab: string; sessionId: string };
type RunAgentInput = { forwardedProps: ForwardedProps; runId: string; threadId: string; [key: string]: unknown };

const appendAgUi = (baseUrl: string) => `${baseUrl.replace(/\/+$/, '')}/ag-ui`;
const allowedActions = new Set(['run', 'resume', 'stop', 'hitlResponse', 'a2uiAction']);
const getServerEnv = () => (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env || {};

export function parseFabEndpoints(serialized = getServerEnv().AGENT_ORCHESTRATION_BASE_URLS_JSON || ''): Record<string, string> {
  const endpoints = JSON.parse(serialized) as Record<string, string>;
  for (const [fab, value] of Object.entries(endpoints)) {
    const url = new URL(value);
    if (url.protocol !== 'https:' && getServerEnv().NODE_ENV === 'production') throw new Error(`FAB endpoint ${fab} must use HTTPS`);
  }
  return endpoints;
}

export async function handleCopilotRuntimeRequest(request: Request, endpoints = parseFabEndpoints()): Promise<Response> {
  let input: RunAgentInput;
  try { input = await request.json() as RunAgentInput; }
  catch { return Response.json({ code: 'INVALID_REQUEST', message: 'Request body must be JSON.' }, { status: 400 }); }
  const { forwardedProps, runId, threadId } = input;
  if (!forwardedProps?.fab || !forwardedProps.sessionId || !runId || !threadId || !allowedActions.has(forwardedProps.action)) return Response.json({ code: 'INVALID_REQUEST', message: 'Missing run, thread, session, FAB or action.' }, { status: 400 });
  const baseUrl = endpoints[forwardedProps.fab];
  if (!baseUrl) return Response.json({ code: 'FAB_ENDPOINT_NOT_CONFIGURED', message: `No endpoint configured for FAB ${forwardedProps.fab}.` }, { status: 422 });
  const headers = new Headers({ Accept: 'text/event-stream', 'Content-Type': 'application/json' });
  for (const name of ['authorization', 'cookie', 'x-request-id', 'traceparent']) { const value = request.headers.get(name); if (value) headers.set(name, value); }
  try {
    const upstream = await fetch(appendAgUi(baseUrl), { body: JSON.stringify(input), headers, method: 'POST', signal: request.signal });
    if (!upstream.ok || !upstream.body) return Response.json({ code: 'FAB_ENDPOINT_UNAVAILABLE', message: `FAB ${forwardedProps.fab} orchestration request failed.` }, { status: 502 });
    return new Response(upstream.body, { status: upstream.status, headers: { 'Cache-Control': 'no-cache', 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
  } catch (error) {
    if (request.signal.aborted) return Response.json({ code: 'CANCELLED', message: 'Request cancelled.' }, { status: 499 });
    return Response.json({ code: 'FAB_ENDPOINT_UNAVAILABLE', message: error instanceof Error ? error.message : 'Upstream unavailable.' }, { status: 502 });
  }
}
