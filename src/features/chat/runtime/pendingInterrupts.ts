import type { Interrupt } from '@ag-ui/core';

export interface PendingInterruptOwner {
  pendingInterrupts: Interrupt[];
}

export const snapshotPendingInterruptIds = (agent: PendingInterruptOwner): string[] =>
  agent.pendingInterrupts.map((interrupt) => interrupt.id);

/** Remove only interrupts acknowledged by the cancel transaction; preserve unrelated newer ones. */
export const clearAcknowledgedPendingInterrupts = (
  agent: PendingInterruptOwner,
  interruptIds: Iterable<string>,
): number => {
  const acknowledged = new Set(interruptIds);
  const previousLength = agent.pendingInterrupts.length;
  agent.pendingInterrupts = agent.pendingInterrupts.filter(
    (interrupt) => !acknowledged.has(interrupt.id),
  );
  return previousLength - agent.pendingInterrupts.length;
};
