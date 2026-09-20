import type { AbstractAgent } from '@ag-ui/client';

import type { CancelAgentRunResult } from '../../../api/runtime/runControlService.ts';

import {
  clearAcknowledgedPendingInterrupts,
  snapshotPendingInterruptIds,
} from './pendingInterrupts.ts';

type CancelCopilotRunOptions = {
  agent: Pick<AbstractAgent, 'pendingInterrupts'>;
  cancelRemote: () => Promise<CancelAgentRunResult>;
  stopLocal: () => Promise<void>;
};

/**
 * Cancels the authoritative workflow before updating CopilotKit's local lifecycle.
 * A local transport-stop failure must not resurrect a run already cancelled remotely.
 */
export const cancelCopilotRun = async ({
  agent,
  cancelRemote,
  stopLocal,
}: CancelCopilotRunOptions): Promise<CancelAgentRunResult> => {
  const pendingAtCancelStart = snapshotPendingInterruptIds(agent);
  const result = await cancelRemote();

  try {
    await stopLocal();
  } catch (error) {
    console.warn('[AgentDock] local CopilotKit transport stop failed after remote cancellation', {
      error,
      runId: result.runId,
    });
  }

  clearAcknowledgedPendingInterrupts(agent, [
    ...pendingAtCancelStart,
    ...result.interruptIds,
  ]);
  return result;
};
