import assert from 'node:assert/strict';
import test from 'node:test';

import { getHistoryWindowLimit, shouldReloadPersistedRun } from './historyWindow.ts';

test('a terminal run in a new empty conversation reloads at least one complete run', () => {
  assert.equal(getHistoryWindowLimit(0), 1);
  assert.equal(getHistoryWindowLimit(50), 50);
});

test('streaming persistence does not rebuild live DOM; terminal persistence does', () => {
  assert.equal(shouldReloadPersistedRun('running'), false);
  assert.equal(shouldReloadPersistedRun('paused'), false);
  assert.equal(shouldReloadPersistedRun('success'), true);
  assert.equal(shouldReloadPersistedRun('error'), true);
});
