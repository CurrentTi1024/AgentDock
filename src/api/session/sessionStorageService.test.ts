import 'fake-indexeddb/auto';

import assert from 'node:assert/strict';
import test from 'node:test';

import { createRunState } from '../runtime/runReducer.ts';
import type { RunAgentInput } from '../runtime/types.ts';
import {
  flushRunCheckpoint,
  sessionDatabase,
  sessionHistoryService,
} from './sessionHistoryService.ts';
import {
  buildSessionExport,
  deleteSessions,
  exportAndDeleteSessions,
  selectCleanupCandidates,
} from './sessionStorageService.ts';

const makeSession = async (id: string, createdAt: string, lastMessageAt: string) => {
  await sessionHistoryService.createSession({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent',
    fab: 'F15B',
    id,
    pinned: false,
    threadId: `thread-${id}`,
    title: id,
    type: 'agent',
  });
  await sessionDatabase.sessions.update(id, { createdAt, lastMessageAt, updatedAt: lastMessageAt });
  return id;
};

const seedMessages = async (sessionId: string, count: number) => {
  const rows = Array.from({ length: count }, (_, index) => ({
    content: `msg-${index}`,
    createdAt: new Date(2024, 0, index + 1).toISOString(),
    id: `text:msg-${sessionId}-${index}`,
    kind: 'text' as const,
    role: 'user' as const,
    sequence: index + 1,
    sessionId,
  }));
  await sessionDatabase.sessionMessages.bulkPut(rows);
};

const seedCheckpoint = async (sessionId: string, runId: string) => {
  const input: RunAgentInput = {
    context: [],
    forwardedProps: { action: 'run', agentId: 'flight-analysis', fab: 'F15B', sessionId },
    messages: [],
    runId,
    state: {},
    threadId: `thread-${sessionId}`,
    tools: [],
  };
  await sessionDatabase.checkpoints.put({
    input,
    runId,
    sessionId,
    snapshot: { ...createRunState(runId, `thread-${sessionId}`), status: 'success' },
    status: 'success',
    threadId: `thread-${sessionId}`,
    updatedAt: new Date().toISOString(),
  });
};

test('daysAgo 按最后消息时间筛选（不是创建时间）', async () => {
  await flushRunCheckpoint();
  await makeSession('cleanup-old-msg', '2024-01-01T00:00:00.000Z', '2024-01-10T00:00:00.000Z');
  await makeSession('cleanup-new-msg', '2024-01-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z');
  await makeSession('cleanup-fresh', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');

  const selection = await selectCleanupCandidates({ daysAgo: 30 });
  const ids = selection.candidates.map((candidate) => candidate.session.id);
  assert.deepEqual(ids, ['cleanup-old-msg'], '只有最后消息早于 30 天前的会话被选中');
  assert.equal(selection.total, 1);
});

test('oldestCount 取最旧 N 个（按最后消息时间升序）', async () => {
  // 重置库，避免上一用例的旧会话干扰“最旧 N 个”的全局排序。
  await sessionDatabase.delete();
  await sessionDatabase.open();
  await makeSession('oldest-a', '2024-01-01T00:00:00.000Z', '2024-05-01T00:00:00.000Z');
  await makeSession('oldest-b', '2024-01-02T00:00:00.000Z', '2024-06-01T00:00:00.000Z');
  await makeSession('oldest-c', '2024-01-03T00:00:00.000Z', '2024-07-01T00:00:00.000Z');

  const selection = await selectCleanupCandidates({ oldestCount: 2 });
  const ids = selection.candidates.map((candidate) => candidate.session.id);
  assert.deepEqual(ids, ['oldest-a', 'oldest-b']);
  assert.equal(selection.total, 2, '最旧 2 个，命中总数=2');
});

test('缺 lastMessageAt 的旧会话按 updatedAt 兜底可被清理', async () => {
  await sessionDatabase.sessions.put({
    agentId: 'flight-analysis',
    createdAt: '2024-01-01T00:00:00.000Z',
    fab: 'F15B',
    id: 'legacy-no-last-message',
    pinned: false,
    threadId: 'thread-legacy-no-last-message',
    title: 'legacy',
    type: 'agent',
    updatedAt: '2024-02-01T00:00:00.000Z',
  });

  const selection = await selectCleanupCandidates({ daysAgo: 30 });
  assert.ok(
    selection.candidates.some((candidate) => candidate.session.id === 'legacy-no-last-message'),
    '缺 lastMessageAt 且 updatedAt 很旧的会话应被兜底选中',
  );
});

test('buildSessionExport：按 ids 导出 sessions/messages/checkpoints；无命中返回空文件', async () => {
  const sessionId = 'export-session-1';
  await makeSession(sessionId, '2024-01-01T00:00:00.000Z', '2024-01-10T00:00:00.000Z');
  await seedMessages(sessionId, 3);
  await seedCheckpoint(sessionId, 'export-run-1');

  const { file, total } = await buildSessionExport({ ids: [sessionId] });
  assert.equal(total, 1);
  assert.equal(file.app, 'agentdock');
  assert.equal(file.exportType, 'sessions');
  assert.equal(file.version, 1);
  assert.equal(file.sessions.length, 1);
  assert.equal(file.sessions[0].id, sessionId);
  assert.equal(file.messages.length, 3);
  assert.ok(file.messages.every((record) => record.sessionId === sessionId));
  assert.equal(file.checkpoints.length, 1);
  assert.equal(file.checkpoints[0].runId, 'export-run-1');

  const empty = await buildSessionExport({ ids: ['missing-session'] });
  assert.equal(empty.total, 0);
  assert.equal(empty.file.sessions.length, 0);
});

test('deleteSessions：会话/消息/检查点级联删除', async () => {
  const sessionId = 'delete-cascade-session';
  await makeSession(sessionId, '2024-01-01T00:00:00.000Z', '2024-01-10T00:00:00.000Z');
  await seedMessages(sessionId, 2);
  await seedCheckpoint(sessionId, 'delete-run-1');

  const deleted = await deleteSessions([sessionId]);
  assert.equal(deleted, 1);
  assert.equal(await sessionDatabase.sessions.get(sessionId), undefined);
  assert.equal(await sessionDatabase.sessionMessages.where('sessionId').equals(sessionId).count(), 0);
  assert.equal(await sessionDatabase.checkpoints.where('sessionId').equals(sessionId).count(), 0);
});

test('exportAndDeleteSessions：先导出后删除，返回导出/删除数量', async () => {
  const sessionId = 'export-and-delete-session';
  await makeSession(sessionId, '2024-01-01T00:00:00.000Z', '2024-01-10T00:00:00.000Z');
  await seedMessages(sessionId, 1);
  await seedCheckpoint(sessionId, 'export-delete-run-1');

  const result = await exportAndDeleteSessions({ ids: [sessionId] });
  assert.equal(result.exported, 1);
  assert.equal(result.deleted, 1);
  assert.ok(result.filename.endsWith('.json'));
  assert.equal(await sessionDatabase.sessions.get(sessionId), undefined);
  assert.equal(await sessionDatabase.sessionMessages.where('sessionId').equals(sessionId).count(), 0);
  assert.equal(await sessionDatabase.checkpoints.where('sessionId').equals(sessionId).count(), 0);
});
