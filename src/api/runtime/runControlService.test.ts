import assert from 'node:assert/strict';
import test from 'node:test';

import { cancelAgentRunWithFetch } from './runControlService.ts';

const input = {
  agentId: 'agent-1',
  fab: 'FAB-A',
  reason: 'user_requested' as const,
  runId: 'run/with spaces',
  sessionId: 'session-1',
  threadId: 'thread-1',
};

test('ordinary HTTP cancel sends run identity through the same-origin control gateway', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const result = await cancelAgentRunWithFetch(async (url, init) => {
    requestUrl = String(url);
    requestInit = init;
    return new Response(JSON.stringify({
      code: 0,
      data: { interruptIds: ['int-1'], runId: input.runId, status: 'cancelled' },
    }), { headers: { 'content-type': 'application/json' }, status: 200 });
  }, input, { baseUrl: '/api' });

  assert.equal(requestUrl, '/api/agent-runtime/runs/run%2Fwith%20spaces/cancel');
  assert.equal(requestInit?.method, 'POST');
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    agentId: 'agent-1',
    fab: 'FAB-A',
    reason: 'user_requested',
    sessionId: 'session-1',
    threadId: 'thread-1',
  });
  assert.deepEqual(result, {
    interruptIds: ['int-1'],
    runId: input.runId,
    status: 'cancelled',
  });
});

test('ordinary HTTP cancel rejects business and HTTP failures', async () => {
  await assert.rejects(
    cancelAgentRunWithFetch(
      async () => new Response(JSON.stringify({ code: 'RUN_STILL_ACTIVE', message: 'still active' })),
      input,
    ),
    /still active/,
  );
  await assert.rejects(
    cancelAgentRunWithFetch(
      async () => new Response(JSON.stringify({ message: 'upstream unavailable' }), { status: 502 }),
      input,
    ),
    /upstream unavailable/,
  );
});
