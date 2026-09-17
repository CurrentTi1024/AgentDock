import assert from 'node:assert/strict';
import test from 'node:test';

import { projectHitlInterrupts, validateHitlResumeBatch } from './hitl.ts';

test('projects compact HITL metadata and preserves a structured resume payload', () => {
  const interrupts = projectHitlInterrupts([
    {
      id: 'choice-1',
      message: 'Choose dimensions',
      metadata: {
        hitl: {
          allowOther: true,
          kind: 'choice',
          multiple: true,
          options: [
            { label: 'Cost', value: 'cost' },
            { label: 'Quality', value: 'quality' },
          ],
        },
      },
      reason: 'human_input_required',
    },
  ]);
  const resume = [{
    interruptId: 'choice-1',
    payload: { action: 'submit' as const, answer: { other: 'Stability', selected: ['quality'] } },
    status: 'resolved' as const,
  }];

  assert.deepEqual(validateHitlResumeBatch(interrupts, resume), resume);
});

test('requires one ordered resume entry for every interrupt in the batch', () => {
  const interrupts = projectHitlInterrupts([
    { id: 'first', message: 'First?', metadata: { hitl: { kind: 'confirm' } }, reason: 'human_input_required' },
    { id: 'second', message: 'Second?', metadata: { hitl: { kind: 'text' } }, reason: 'human_input_required' },
  ]);

  assert.throws(
    () => validateHitlResumeBatch(interrupts, [{ interruptId: 'first', payload: { action: 'continue' }, status: 'resolved' }]),
    /HITL_INCOMPLETE_BATCH/,
  );
  assert.throws(
    () => validateHitlResumeBatch(interrupts, [
      { interruptId: 'second', payload: { action: 'submit', answer: 'answer' }, status: 'resolved' },
      { interruptId: 'first', payload: { action: 'continue' }, status: 'resolved' },
    ]),
    /order or identity/,
  );
});

test('rejects duplicate interrupt identities and unsupported reasons', () => {
  assert.throws(() => projectHitlInterrupts([
    { id: 'duplicate', reason: 'human_input_required' },
    { id: 'duplicate', reason: 'human_input_required' },
  ]), /Duplicate interrupt id/);
  assert.throws(() => projectHitlInterrupts([
    { id: 'approval', reason: 'tool_approval' },
  ]));
});

test('falls back to required text when presentation metadata is invalid', () => {
  const [interrupt] = projectHitlInterrupts([
    { id: 'fallback', message: 'Explain your choice', metadata: { hitl: { kind: 'unknown' } }, reason: 'human_input_required' },
  ]);
  assert.equal(interrupt.fallback, true);
  assert.equal(interrupt.spec.kind, 'text');
  assert.doesNotThrow(() => validateHitlResumeBatch([interrupt], [
    { interruptId: 'fallback', payload: { action: 'submit', answer: 'My answer' }, status: 'resolved' },
  ]));
});

test('rejects payload fields and options not declared by the pending interrupt', () => {
  const [interrupt] = projectHitlInterrupts([
    {
      id: 'form',
      message: 'Complete form',
      metadata: {
        hitl: {
          fields: [
            { kind: 'text', label: 'Name', name: 'name', required: true },
            {
              kind: 'choice',
              label: 'Market',
              name: 'market',
              options: [{ label: 'China', value: 'china' }, { label: 'Global', value: 'global' }],
            },
          ],
          kind: 'form',
        },
      },
      reason: 'human_input_required',
    },
  ]);
  assert.throws(() => validateHitlResumeBatch([interrupt], [{
    interruptId: 'form',
    payload: {
      action: 'submit',
      answer: { market: { selected: ['unknown'] }, name: 'Acme' },
    },
    status: 'resolved',
  }]), /unknown option/);
});

test('validates date and RFC 3339 datetime form answers', () => {
  const [interrupt] = projectHitlInterrupts([{
    id: 'schedule',
    message: 'Choose a schedule',
    metadata: { hitl: {
      fields: [
        { kind: 'date', label: 'Date', name: 'date', required: true },
        { kind: 'datetime', label: 'Start', name: 'start', required: true },
      ],
      kind: 'form',
    } },
    reason: 'human_input_required',
  }]);
  assert.doesNotThrow(() => validateHitlResumeBatch([interrupt], [{
    interruptId: 'schedule',
    payload: { action: 'submit', answer: { date: '2027-01-02', start: '2027-01-02T03:04:05.000Z' } },
    status: 'resolved',
  }]));
  assert.throws(() => validateHitlResumeBatch([interrupt], [{
    interruptId: 'schedule',
    payload: { action: 'submit', answer: { date: '02/01/2027', start: '2027-01-02T03:04' } },
    status: 'resolved',
  }]), /invalid date/);
});
