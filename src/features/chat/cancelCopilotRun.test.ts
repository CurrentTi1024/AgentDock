import type { Interrupt } from '@ag-ui/client';
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { cancelCopilotRun } from './runtime/cancelCopilotRun.ts';

const interrupt = (id: string): Interrupt => ({ id, value: {} });

describe('cancelCopilotRun', () => {
  it('远端取消成功后清理开始时已 pending 的 interrupt，并保留并发新增项', async () => {
    const agent = { pendingInterrupts: [interrupt('old')] };
    const cancelRemote = mock.fn(async () => {
      agent.pendingInterrupts.push(interrupt('new'));
      return { interruptIds: ['old'], runId: 'run-1', status: 'cancelled' as const };
    });
    const stopLocal = mock.fn(async () => undefined);

    const result = await cancelCopilotRun({ agent, cancelRemote, stopLocal });

    assert.equal(result.runId, 'run-1');
    assert.equal(result.status, 'cancelled');
    assert.equal(stopLocal.mock.callCount(), 1);
    assert.deepEqual(agent.pendingInterrupts.map(({ id }) => id), ['new']);
  });

  it('远端取消失败时不停止本地 transport，也不修改 pending interrupt', async () => {
    const agent = { pendingInterrupts: [interrupt('pending')] };
    const stopLocal = mock.fn(async () => undefined);

    await assert.rejects(
      cancelCopilotRun({
        agent,
        cancelRemote: async () => { throw new Error('cancel unavailable'); },
        stopLocal,
      }),
      /cancel unavailable/,
    );

    assert.equal(stopLocal.mock.callCount(), 0);
    assert.deepEqual(agent.pendingInterrupts.map(({ id }) => id), ['pending']);
  });

  it('远端已成功时，即使本地 stop 失败也会闭合 interrupt 并返回成功', async () => {
    const agent = { pendingInterrupts: [interrupt('pending')] };

    const result = await cancelCopilotRun({
      agent,
      cancelRemote: async () => ({
        interruptIds: ['pending'],
        runId: 'run-1',
        status: 'cancelled',
      }),
      stopLocal: async () => { throw new Error('transport already closed'); },
    });

    assert.equal(result.runId, 'run-1');
    assert.deepEqual(agent.pendingInterrupts, []);
  });
});
