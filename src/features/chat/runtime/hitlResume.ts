import type { RunAgentInput } from '@/api/runtime/types';

import type { HitlResumeBatch } from './types';

/**
 * Keep AG-UI resume entries opaque on the last application-owned boundary. CopilotKit accepts
 * ResumeEntry.payload as unknown, so projecting selected fields here would silently discard
 * valid current or future backend payload properties.
 */
export const createCopilotHitlRunOptions = (
  input: RunAgentInput,
  resume: HitlResumeBatch,
) => ({
  forwardedProps: input.forwardedProps as Record<string, unknown>,
  resume,
  runId: input.runId,
});
