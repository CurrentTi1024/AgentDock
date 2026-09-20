import type { AbstractAgent } from '@ag-ui/client';

import type { HitlResumeEntry } from '../../../api/runtime/types.ts';

import { clearAcknowledgedPendingInterrupts } from './pendingInterrupts.ts';

type ResumeCopilotRunOptions<T> = {
  agent: Pick<AbstractAgent, 'pendingInterrupts'>;
  resume: HitlResumeEntry[];
  run: () => Promise<T>;
};

/**
 * Defensively closes only the interrupts covered by a successful resume request.
 * AG-UI normally replaces pendingInterrupts on RUN_FINISHED; this also covers runtimes that
 * finish without applying that local mutation while preserving any newly-issued interrupts.
 */
export const resumeCopilotRun = async <T>({
  agent,
  resume,
  run,
}: ResumeCopilotRunOptions<T>): Promise<T> => {
  const result = await run();
  clearAcknowledgedPendingInterrupts(agent, resume.map((entry) => entry.interruptId));
  return result;
};
