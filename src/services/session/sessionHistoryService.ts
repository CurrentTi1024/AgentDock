import Dexie, { type EntityTable } from 'dexie';
import { sessionHistoryMockData } from '@/mock-data/sessionHistory';
import type { RunAgentInput, RuntimeMessage, RuntimeRunState } from '@/services/runtime/types';
export interface SessionRecord { agentId?: string; agentName?: string; createdAt: string; fab: string; group?: unknown; id: string; pinned: boolean; threadId: string; title: string; type: 'agent' | 'group'; updatedAt: string; version?: string }
export interface SessionMessageRecord extends RuntimeMessage { createdAt: string; runId?: string; sessionId: string; streamId?: string }
export interface RunCheckpointRecord { input: RunAgentInput; latestStreamId?: string; runId: string; sessionId: string; snapshot: RuntimeRunState; status: RuntimeRunState['status']; threadId: string; updatedAt: string }
class SessionDatabase extends Dexie {
  sessions!: EntityTable<SessionRecord, 'id'>; messages!: EntityTable<SessionMessageRecord, 'id'>; checkpoints!: EntityTable<RunCheckpointRecord, 'runId'>;
  constructor() { super('agentdock-session-v2'); this.version(1).stores({ sessions: 'id,threadId,updatedAt,pinned,type', messages: 'id,sessionId,runId,createdAt,streamId', checkpoints: 'runId,sessionId,threadId,status,updatedAt' }); }
}
const db = new SessionDatabase(); let seeded = false;
const ensureSeeded = async () => { if (seeded) return; seeded = true; if (await db.sessions.count() === 0) await db.sessions.bulkPut(sessionHistoryMockData); };
export const sessionHistoryService = {
  async createSession(input: Omit<SessionRecord, 'createdAt' | 'id' | 'updatedAt'>) { await ensureSeeded(); const now = new Date().toISOString(); const record = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now }; await db.sessions.put(record); return record; },
  async getSession(id: string) { await ensureSeeded(); return db.sessions.get(id); },
  async listSessions() { await ensureSeeded(); return db.sessions.orderBy('updatedAt').reverse().toArray(); },
  async searchSessions(keyword: string) { const sessions = await this.listSessions(); const query = keyword.toLowerCase(); return sessions.filter((session) => `${session.title}${session.agentName || ''}`.toLowerCase().includes(query)); },
  async updateSession(id: string, value: Partial<SessionRecord>) { await db.sessions.update(id, { ...value, updatedAt: new Date().toISOString() }); return db.sessions.get(id); },
  async removeSession(id: string) { await db.transaction('rw', db.sessions, db.messages, db.checkpoints, async () => { await db.sessions.delete(id); await db.messages.where('sessionId').equals(id).delete(); await db.checkpoints.where('sessionId').equals(id).delete(); }); },
  async appendMessages(records: SessionMessageRecord[]) { await db.messages.bulkPut(records); },
  async getMessages(sessionId: string) { return db.messages.where('sessionId').equals(sessionId).sortBy('createdAt'); },
  async saveRunCheckpoint(sessionId: string, input: RunAgentInput, snapshot: RuntimeRunState) { const record: RunCheckpointRecord = { input, latestStreamId: snapshot.latestStreamId, runId: snapshot.runId, sessionId, snapshot, status: snapshot.status, threadId: snapshot.threadId, updatedAt: new Date().toISOString() }; await db.checkpoints.put(record); const messages = Object.values(snapshot.messages).map((message) => ({ ...message, sessionId, runId: snapshot.runId, streamId: snapshot.latestStreamId, createdAt: new Date().toISOString() })); if (messages.length) await db.messages.bulkPut(messages); await db.sessions.update(sessionId, { updatedAt: record.updatedAt }); return record; },
  async getLatestRun(sessionId: string) { const records = await db.checkpoints.where('sessionId').equals(sessionId).sortBy('updatedAt'); return records.at(-1); },
  async getLatestRecoverableRun(sessionId: string) { const records = await db.checkpoints.where('sessionId').equals(sessionId).sortBy('updatedAt'); return records.reverse().find((record) => ['running', 'paused'].includes(record.status)); },
};
