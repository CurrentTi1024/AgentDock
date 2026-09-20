import assert from 'node:assert/strict';
import test from 'node:test';

import { handleRunCancelRequest } from '../../../server/copilot-runtime/runControlProxy.ts';

test('control gateway routes FAB and forwards only the authoritative runId', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamUrl = '';
  let upstreamBody = '';
  globalThis.fetch = async (url, init) => {
    upstreamUrl = String(url);
    upstreamBody = String(init?.body);
    return new Response(JSON.stringify({ interruptIds: ['int-1'], status: 'cancelled' }));
  };
  try {
    const response = await handleRunCancelRequest(new Request(
      'http://agentdock.test/api/agent-runtime/runs/run%2F1/cancel',
      {
        body: JSON.stringify({ fab: 'FAB-A', sessionId: 'session-1', threadId: 'thread-1' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    ), { 'FAB-A': 'https://orchestration.example/base/' });
    assert.equal(response.status, 200);
    assert.equal(upstreamUrl, 'https://orchestration.example/base/ag-ui/cancel');
    assert.deepEqual(JSON.parse(upstreamBody), { runId: 'run/1' });
    assert.deepEqual(await response.json(), {
      code: 0,
      data: { interruptIds: ['int-1'], runId: 'run/1', status: 'cancelled' },
      message: 'ok',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('control gateway rejects an unknown FAB before calling upstream', async () => {
  const response = await handleRunCancelRequest(new Request(
    'http://agentdock.test/api/agent-runtime/runs/run-1/cancel',
    {
      body: JSON.stringify({ fab: 'UNKNOWN', sessionId: 'session-1', threadId: 'thread-1' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
  ), {});
  assert.equal(response.status, 422);
});
