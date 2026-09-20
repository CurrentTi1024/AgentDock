import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearAcknowledgedPendingInterrupts,
  snapshotPendingInterruptIds,
} from './runtime/pendingInterrupts.ts';

const interrupt = (id: string) => ({ id, reason: 'human_input_required' });

test('successful HTTP cancel clears acknowledged CopilotKit interrupts without deleting newer ones', () => {
  const agent = { pendingInterrupts: [interrupt('old-1'), interrupt('old-2')] };
  const snapshot = snapshotPendingInterruptIds(agent);
  agent.pendingInterrupts.push(interrupt('new-1'));

  assert.equal(clearAcknowledgedPendingInterrupts(agent, snapshot), 2);
  assert.deepEqual(agent.pendingInterrupts.map((item) => item.id), ['new-1']);
});

test('failed HTTP cancel performs no eager mutation', () => {
  const agent = { pendingInterrupts: [interrupt('old-1')] };
  snapshotPendingInterruptIds(agent);
  assert.deepEqual(agent.pendingInterrupts.map((item) => item.id), ['old-1']);
});
