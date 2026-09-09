import assert from 'node:assert/strict';
import test from 'node:test';

import type { SessionMessageRecord } from '../../api/session/sessionHistoryService.ts';
import { buildDisplayUnits } from './messageTimeline.ts';

const text = (id: string, content: string, runId: string): SessionMessageRecord => ({
  content,
  createdAt: '2026-09-10T00:00:00.000Z',
  id: `text:${id}`,
  kind: 'text',
  role: 'assistant',
  runId,
  sequence: Number(id.replace(/\D/g, '')) || 1,
  sessionId: 'session-timeline',
});

test('同 Run 多个 assistant 宿主只保留最后一个且不复制旧正文', () => {
  const blocks: SessionMessageRecord[] = [
    {
      content: '正文 1',
      createdAt: '2026-09-10T00:00:00.000Z',
      id: 'narration:text-1',
      kind: 'narration',
      payload: { timelineText: true },
      runId: 'run-1',
      sequence: 2,
      sessionId: 'session-timeline',
    },
  ];
  const units = buildDisplayUnits([
    { blocks: [], record: text('text-1', '正文 1', 'run-1') },
    { blocks: [], record: text('text-2', '正文 2', 'run-1') },
    { blocks, record: text('text-3', '正文 3', 'run-1') },
  ]);

  assert.equal(units.length, 1);
  assert.equal(units[0].record.id, 'text:text-3');
  assert.equal(units[0].blocks, blocks);
  assert.equal('narration' in units[0], false, '展示单元不得保留旧版宿主正文聚合字段');
});

test('不同 Run 与不同角色保持独立展示单元', () => {
  const user: SessionMessageRecord = {
    content: '问题',
    createdAt: '2026-09-10T00:00:00.000Z',
    id: 'text:user',
    kind: 'text',
    role: 'user',
    runId: 'run-2',
    sequence: 4,
    sessionId: 'session-timeline',
  };
  const units = buildDisplayUnits([
    { blocks: [], record: text('text-1', '回答 1', 'run-1') },
    { blocks: [], record: user },
    { blocks: [], record: text('text-2', '回答 2', 'run-2') },
  ]);
  assert.deepEqual(units.map((unit) => unit.record.id), ['text:text-1', 'text:user', 'text:text-2']);
});
