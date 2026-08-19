import Dexie, { type EntityTable } from 'dexie';
import type { RunAgentInput, RuntimeMessage, RuntimeRunState } from '@/api/runtime/types';
export interface SessionRecord { agentId?: string; agentName?: string; createdAt: string; fab: string; group?: unknown; id: string; pinned: boolean; threadId: string; title: string; type: 'agent' | 'group'; updatedAt: string; version?: string }
export type SessionMessageKind = 'activity' | 'reasoning' | 'step' | 'surface' | 'text' | 'tool';
export interface SessionMessageRecord { content?: string; createdAt: string; id: string; kind: SessionMessageKind; payload?: Record<string, unknown>; role?: RuntimeMessage['role']; runId?: string; sequence: number; sessionId: string; streamId?: string }
export interface RunCheckpointRecord { input: RunAgentInput; latestStreamId?: string; runId: string; sessionId: string; snapshot: RuntimeRunState; status: RuntimeRunState['status']; threadId: string; updatedAt: string }
class SessionDatabase extends Dexie {
  sessions!: EntityTable<SessionRecord, 'id'>; messages!: EntityTable<SessionMessageRecord, 'id'>; checkpoints!: EntityTable<RunCheckpointRecord, 'runId'>;
  constructor() { super('agentdock-session-v3'); this.version(1).stores({ sessions: 'id,threadId,updatedAt,pinned,type', messages: 'id,sessionId,runId,createdAt,sequence', checkpoints: 'runId,sessionId,threadId,status,updatedAt' }); }
}
const db = new SessionDatabase();

db.on('blocked', () => {
  console.warn('[AgentDock] IndexedDB 升级被其他标签页阻塞，请关闭旧标签页后刷新。');
  window.dispatchEvent(new CustomEvent('agentdock:indexeddb-blocked'));
});
db.on('versionchange', () => {
  // 其他标签页升级/删除数据库时主动释放连接，避免反过来阻塞对方。
  void db.close();
});

let sequenceSeed = 0;
const nextSequence = () => Date.now() * 1000 + (sequenceSeed = (sequenceSeed + 1) % 1000);
let pendingCheckpoint: { input: RunAgentInput; sessionId: string; snapshot: RuntimeRunState } | undefined;
let checkpointTimer: ReturnType<typeof setTimeout> | undefined;
const CHECKPOINT_DEBOUNCE_MS = 350;

const BLOCKED_WARN_MS = 3000;
const notifySessionsChanged = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('agentdock:sessions-changed'));
};
const withBlockedDiagnostic = async <T>(label: string, task: Promise<T>): Promise<T> => {
  const timer = setTimeout(() => {
    console.warn(
      `[AgentDock] ${label} 超过 ${BLOCKED_WARN_MS / 1000}s 未完成，IndexedDB 可能被旧标签页阻塞或存储异常，请关闭旧标签页后刷新重试。`,
    );
  }, BLOCKED_WARN_MS);
  try {
    return await task;
  } finally {
    clearTimeout(timer);
  }
};

export const sessionHistoryService = {
  async createSession(input: Omit<SessionRecord, 'createdAt' | 'id' | 'updatedAt'> & { id?: string }) { const now = new Date().toISOString(); const record = { ...input, id: input.id ?? crypto.randomUUID(), createdAt: now, updatedAt: now }; await withBlockedDiagnostic('createSession', db.sessions.put(record)); notifySessionsChanged(); return record; },
  async getSession(id: string) { return db.sessions.get(id); },
  async listSessions() { return db.sessions.orderBy('updatedAt').reverse().toArray(); },
  async searchSessions(keyword: string) { const sessions = await this.listSessions(); const query = keyword.toLowerCase(); return sessions.filter((session) => `${session.title}${session.agentName || ''}`.toLowerCase().includes(query)); },
  async updateSession(id: string, value: Partial<SessionRecord>) { await db.sessions.update(id, { ...value, updatedAt: new Date().toISOString() }); notifySessionsChanged(); return db.sessions.get(id); },
  async removeSession(id: string) { await db.transaction('rw', db.sessions, db.messages, db.checkpoints, async () => { await db.sessions.delete(id); await db.messages.where('sessionId').equals(id).delete(); await db.checkpoints.where('sessionId').equals(id).delete(); }); },
  async appendMessages(records: SessionMessageRecord[]) { await db.messages.bulkPut(records); },
  async getMessages(sessionId: string) { return db.messages.where('sessionId').equals(sessionId).sortBy('sequence'); },
  /**
   * 删除一条消息及其关联的过程块（reasoning/tool/step/activity/surface），
   * 同时删除包含该消息的 checkpoint，避免刷新后从快照复活已删消息。
   */
  async removeMessage(sessionId: string, id: string) {
    await db.transaction('rw', db.messages, db.checkpoints, async () => {
      const all = await db.messages.where('sessionId').equals(sessionId).sortBy('sequence');
      const targetIndex = all.findIndex((record) => record.id === `text:${id}` || record.id === id);
      if (targetIndex < 0) return;
      const idsToRemove = [all[targetIndex].id];
      for (let index = targetIndex + 1; index < all.length; index += 1) {
        const record = all[index];
        if (record.kind === 'text') break;
        idsToRemove.push(record.id);
      }
      await db.messages.bulkDelete(idsToRemove);
      const checkpoints = await db.checkpoints.where('sessionId').equals(sessionId).toArray();
      for (const checkpoint of checkpoints) {
        if (checkpoint.snapshot.messages[id]) {
          await db.checkpoints.delete(checkpoint.runId);
        }
      }
    });
    notifySessionsChanged();
  },
  async saveRunCheckpoint(sessionId: string, input: RunAgentInput, snapshot: RuntimeRunState) {
    const updatedAt = new Date().toISOString();
    const record: RunCheckpointRecord = { input, latestStreamId: snapshot.latestStreamId, runId: snapshot.runId, sessionId, snapshot, status: snapshot.status, threadId: snapshot.threadId, updatedAt };
    await db.checkpoints.put(record);
    await this.persistRunSnapshot(sessionId, snapshot);
    await db.sessions.update(sessionId, { updatedAt });
    notifySessionsChanged();
    return record;
  },
  async persistRunSnapshot(sessionId: string, snapshot: RuntimeRunState) {
    const records: SessionMessageRecord[] = [];
    const push = (kind: SessionMessageKind, id: string, value: Omit<SessionMessageRecord, 'createdAt' | 'id' | 'kind' | 'sequence' | 'sessionId'>) => records.push({ ...value, createdAt: new Date().toISOString(), id: `${kind}:${id}`, kind, sequence: nextSequence(), sessionId });
    for (const message of Object.values(snapshot.messages)) {
      if (!message || !message.id) continue;
      // 文本消息记录自己最后一次更新时的 streamId；其余类型记录 run 当前游标。
      push('text', message.id, { content: message.content, role: message.role, runId: snapshot.runId, streamId: message.streamId ?? snapshot.latestStreamId });
    }
    for (const [id, content] of Object.entries(snapshot.reasoning || {})) push('reasoning', id, { content, runId: snapshot.runId, streamId: snapshot.latestStreamId });
    for (const [id, call] of Object.entries(snapshot.toolCalls || {})) push('tool', id, { content: call.args, payload: { apiName: call.apiName, args: call.args, finishedAt: call.finishedAt, name: call.name, result: call.result, resultMsgId: call.resultMsgId, startedAt: call.startedAt, status: call.status }, runId: snapshot.runId, streamId: snapshot.latestStreamId });
    for (const [id, step] of Object.entries(snapshot.steps || {})) push('step', id, { payload: { finishedAt: step.finishedAt, name: step.name, startedAt: step.startedAt, status: step.status }, runId: snapshot.runId, streamId: snapshot.latestStreamId });
    for (const [id, activity] of Object.entries(snapshot.activities || {})) {
      const payload = (activity && typeof activity === 'object') ? (activity as Record<string, unknown>) : {};
      const activityType = String(payload.activityType || '');
      push('activity', id, { payload: { ...payload, activityType, messageId: id }, runId: snapshot.runId, streamId: snapshot.latestStreamId });
      if (activityType === 'a2ui.surface') push('surface', String(payload.surfaceId || id), { payload: { ...payload, surfaceId: payload.surfaceId || id }, runId: snapshot.runId, streamId: snapshot.latestStreamId });
    }
    for (const [surfaceId, surface] of Object.entries(snapshot.surfaces || {})) {
      const payload = (surface && typeof surface === 'object') ? (surface as Record<string, unknown>) : {};
      push('surface', surfaceId, { payload: { ...payload, surfaceId }, runId: snapshot.runId, streamId: snapshot.latestStreamId });
    }
    if (records.length) await db.messages.bulkPut(records);
  },
  async getLatestRun(sessionId: string) { const records = await db.checkpoints.where('sessionId').equals(sessionId).sortBy('updatedAt'); return records.at(-1); },
  async getLatestRecoverableRun(sessionId: string) { const records = await db.checkpoints.where('sessionId').equals(sessionId).sortBy('updatedAt'); return records.reverse().find((record) => ['running', 'paused'].includes(record.status)); },
};

/** 防抖写入：高频流式事件只保留最新快照，空闲 350ms 后落盘；终态时手动 flush。 */
export const scheduleRunCheckpoint = (sessionId: string, input: RunAgentInput, snapshot: RuntimeRunState) => {
  pendingCheckpoint = { input, sessionId, snapshot };
  if (checkpointTimer) clearTimeout(checkpointTimer);
  checkpointTimer = setTimeout(() => {
    void flushRunCheckpoint();
  }, CHECKPOINT_DEBOUNCE_MS);
};

export const flushRunCheckpoint = async () => {
  if (checkpointTimer) {
    clearTimeout(checkpointTimer);
    checkpointTimer = undefined;
  }
  if (!pendingCheckpoint) return;
  const job = pendingCheckpoint;
  pendingCheckpoint = undefined;
  await sessionHistoryService.saveRunCheckpoint(job.sessionId, job.input, job.snapshot);
};
