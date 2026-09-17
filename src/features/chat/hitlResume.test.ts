import assert from 'node:assert/strict';
import test from 'node:test';

import type { RunAgentInput } from '../../api/runtime/types.ts';
import { createCopilotHitlRunOptions } from './runtime/hitlResume.ts';

test('CopilotKit resume options preserve the complete HITL batch and nested payload', () => {
  const input = {
    context: [],
    forwardedProps: { action: 'hitlResponse', fab: 'FAB', sessionId: 'session-1' },
    messages: [],
    runId: 'run-1',
    state: {},
    threadId: 'thread-1',
    tools: [],
  } satisfies RunAgentInput;
  const resume = [{
    interruptId: 'interrupt-1',
    payload: {
      action: 'submit' as const,
      answer: {
        destination: { other: 'Moon base', selected: ['custom'] },
        passengers: 3,
        travelDate: '2027-01-02',
      },
    },
    status: 'resolved' as const,
  }];

  const options = createCopilotHitlRunOptions(input, resume);

  assert.equal(options.resume, resume);
  assert.equal(options.resume[0].payload, resume[0].payload);
  assert.deepEqual(options.resume, resume);
});
