import type { Interrupt } from '@ag-ui/client';
import assert from 'node:assert/strict';
import test from 'node:test';

import { resumeCopilotRun } from './runtime/resumeCopilotRun.ts';

const interrupt = (id: string): Interrupt => ({ id, value: {} });
const resume = [{ interruptId: 'old', status: 'cancelled' as const }];

test('successful HITL resume clears the acknowledged interrupt and preserves a newer interrupt', async () => {
  const agent = { pendingInterrupts: [interrupt('old')] };
  const result = await resumeCopilotRun({
    agent,
    resume,
    run: async () => {
      agent.pendingInterrupts = [interrupt('new')];
      return 'done';
    },
  });

  assert.equal(result, 'done');
  assert.deepEqual(agent.pendingInterrupts.map(({ id }) => id), ['new']);
});

test('failed HITL resume keeps the pending interrupt available for retry', async () => {
  const agent = { pendingInterrupts: [interrupt('old')] };

  await assert.rejects(
    resumeCopilotRun({
      agent,
      resume,
      run: async () => { throw new Error('resume unavailable'); },
    }),
    /resume unavailable/,
  );

  assert.deepEqual(agent.pendingInterrupts.map(({ id }) => id), ['old']);
});
