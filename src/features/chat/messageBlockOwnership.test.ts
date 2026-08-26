import assert from 'node:assert/strict';
import test from 'node:test';

import type { SessionMessageRecord } from '@/api/session/sessionHistoryService';

import { findLiveProcessHostId, findStoredProcessHosts } from './messageBlockOwnership.ts';

const textRecord = (id: string, role: string, runId = 'run-1'): SessionMessageRecord => ({
  content: id,
  createdAt: '2026-08-27T00:00:00.000Z',
  id,
  kind: 'text',
  role,
  runId,
  sessionId: 'session-1',
});

test('the final assistant owns persisted process blocks exactly once', () => {
  const records = [
    textRecord('group', 'assistantGroup'),
    textRecord('assistant-1', 'assistant'),
    textRecord('assistant-2', 'assistant'),
  ];

  assert.equal(findStoredProcessHosts(records).get('run-1'), 'assistant-2');
});

test('assistantGroup and supervisor are fallback process hosts', () => {
  assert.equal(
    findStoredProcessHosts([textRecord('group', 'assistantGroup')]).get('run-1'),
    'group',
  );
  assert.equal(
    findLiveProcessHostId([textRecord('task', 'task'), textRecord('supervisor', 'supervisor')], false),
    'supervisor',
  );
  assert.equal(findLiveProcessHostId([textRecord('group', 'assistantGroup')], true), undefined);
});
