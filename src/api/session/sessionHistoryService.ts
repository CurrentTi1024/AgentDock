import Dexie, { type EntityTable, type Table } from 'dexie';
import { LOBE_VISIBLE_MESSAGE_ROLES, type RunAgentInput, type RuntimeMessage, type RuntimeRunState } from '../runtime/types.ts';
import { findLogicalSurfaceId } from '../runtime/runReducer.ts';
export interface SessionRecord { agentId?: string; agentName?: string; createdAt: string; deletedMessageIds?: string[]; fab: string; group?: unknown; id: string; lastMessageAt?: string; pinned: boolean; threadId: string; title: string; type: 'agent' | 'group'; updatedAt: string; version?: string }
export type SessionMessageKind = 'activity' | 'narration' | 'reasoning' | 'step' | 'surface' | 'text' | 'tool';
export interface SessionMessageRecord { content?: string; createdAt: string; id: string; kind: SessionMessageKind; payload?: Record<string, unknown>; role?: RuntimeMessage['role']; runId?: string; sequence: number; sessionId: string; eventId?: string }
export interface RunCheckpointRecord { input: RunAgentInput; latestEventId?: string; runId: string; sessionId: string; snapshot: RuntimeRunState; status: RuntimeRunState['status']; threadId: string; updatedAt: string }
export interface MessagesPage {
  hasMore: boolean;
  nextBeforeSequence?: number;
  records: SessionMessageRecord[];
}
/** 会话内消息分页：每页最多包含的文本消息条数（过程块随所属 run 一并加载）。 */
const MESSAGES_PAGE_TEXT_LIMIT = 50;
class SessionDatabase extends Dexie {
  sessions!: EntityTable<SessionRecord, 'id'>;
  /** v1-v3 旧表，仅供 v4 升级迁移。 */
  messages!: EntityTable<SessionMessageRecord, 'id'>;
  sessionMessages!: Table<SessionMessageRecord, [string, string]>;
  checkpoints!: EntityTable<RunCheckpointRecord, 'runId'>;
  constructor() {
    super('agentdock-session-v3');
    this.version(1).stores({ sessions: 'id,threadId,updatedAt,pinned,type', messages: 'id,sessionId,runId,createdAt,sequence', checkpoints: 'runId,sessionId,threadId,status,updatedAt' });
    // v2：Agent Space 复合索引 [agentId+fab] + lastMessageAt（会话内最后一条消息时间，
    // 供容量清理“按最后消息时间”选择）。升级时从 messages 的 text 行回填，空会话回退 createdAt。
    this.version(2)
      .stores({
        sessions: 'id,threadId,updatedAt,pinned,type,agentId,fab,[agentId+fab],createdAt,lastMessageAt',
        messages: 'id,sessionId,runId,createdAt,sequence',
        checkpoints: 'runId,sessionId,threadId,status,updatedAt',
      })
      .upgrade(async (trans) => {
        const sessionRows = await trans.table('sessions').toArray();
        const messageRows = await trans.table('messages').toArray();
        const maxBySession = new Map<string, number>();
        for (const row of messageRows) {
          if (row.kind !== 'text') continue;
          const timestamp = new Date(row.createdAt).getTime();
          if (timestamp > (maxBySession.get(row.sessionId) ?? 0)) maxBySession.set(row.sessionId, timestamp);
        }
        for (const session of sessionRows) {
          const timestamp = maxBySession.get(session.id);
          const lastMessageAt = timestamp ? new Date(timestamp).toISOString() : session.createdAt;
          if (session.lastMessageAt !== lastMessageAt) {
            await trans.table('sessions').update(session.id, { lastMessageAt });
          }
        }
      });
    // v3：messages 增加 [sessionId+sequence] 复合索引，支撑会话内消息按 sequence 游标分页
    // （首屏最近 N 条 + 加载更早），避免每次进会话全量拉取长历史。
    this.version(3).stores({
      sessions: 'id,threadId,updatedAt,pinned,type,agentId,fab,[agentId+fab],createdAt,lastMessageAt',
      messages: 'id,sessionId,runId,createdAt,sequence,[sessionId+sequence]',
      checkpoints: 'runId,sessionId,threadId,status,updatedAt',
    });
    // v4：新建复合主键表（Dexie 不支持原表直接更换主键），升级时无损复制旧历史。
    // AG-UI 只保证 id 在线程内唯一；不同 Session 合法复用 plan、step-1 等 id。
    this.version(4).stores({
      sessions: 'id,threadId,updatedAt,pinned,type,agentId,fab,[agentId+fab],createdAt,lastMessageAt',
      messages: 'id,sessionId,runId,createdAt,sequence,[sessionId+sequence]',
      sessionMessages: '[sessionId+id],id,sessionId,runId,createdAt,sequence,[sessionId+sequence]',
      checkpoints: 'runId,sessionId,threadId,status,updatedAt',
    }).upgrade(async (trans) => {
      const legacyRows = await trans.table('messages').toArray();
      if (legacyRows.length) await trans.table('sessionMessages').bulkPut(legacyRows);
    });
  }
}
export const sessionDatabase = new SessionDatabase();
const db = sessionDatabase;

db.on('blocked', () => {
  console.warn('[AgentDock] IndexedDB 升级被其他标签页阻塞，请关闭旧标签页后刷新。');
  window.dispatchEvent(new CustomEvent('agentdock:indexeddb-blocked'));
});
db.on('versionchange', () => {
  // 其他标签页升级/删除数据库时主动释放连接，避免反过来阻塞对方。
  void db.close();
});

let sequenceSeed = Math.floor(Math.random() * 1000);
let lastSequence = 0;
/**
 * 会话内单调递增的 sequence（时间戳 ×1000 + 递增种子）：
 * 种子以随机偏移起步且不取模，保证同一标签页内严格单调（消除同毫秒回绕）；
 * lastSequence 兜底：即使系统时钟回拨（NTP 校时），新行也强制大于已分配的最大 sequence，
 * 从结构上保证“后落库的消息一定排在前面消息之后”（错误消息因此恒为该轮最后一条）。
 * 跨标签页同毫秒并发写同一会话时碰撞概率从“必然”降到约 1/1000（随机偏移相同才撞）。
 * 注：同一会话的多标签页并发流式写本身不是产品支持场景（防重入门禁在同一标签页内），
 * 该随机化只是把“理论上可能撞”压到可忽略。
 */
const nextSequence = () => {
  sequenceSeed = sequenceSeed + 1;
  const candidate = Date.now() * 1000 + sequenceSeed;
  const sequence = candidate > lastSequence ? candidate : lastSequence + 1;
  lastSequence = sequence;
  return sequence;
};
// 按 runId 分槽的待落盘快照：多轮 run 并发/快速连续发送时互不覆盖，
// 防抖空闲后统一 flush，避免只落最后一段或丢消息。
let pendingCheckpoints = new Map<string, { input: RunAgentInput; sessionId: string; snapshot: RuntimeRunState }>();
const checkpointTimers = new Map<string, ReturnType<typeof setTimeout>>();
const checkpointMaxTimers = new Map<string, ReturnType<typeof setTimeout>>();
const checkpointWriteChains = new Map<string, Promise<void>>();
const CHECKPOINT_DEBOUNCE_MS = 350;
const CHECKPOINT_MAX_WAIT_MS = 500;
// 终态 checkpoint 不再存储：历史渲染以 messages 表为权威（isActiveRun 仅对 running/paused 为真），
// checkpoints 表只保留 running/paused 供断线/HITL 续传；存量终态行由剪枝与启动清扫回收。

/**
 * 压缩 checkpoint 快照：只保留“渲染 + 断线续传”真正消费的字段。
 * 丢弃项：rawEvents（完整 AG-UI 事件日志，占空间最大且 UI 不消费，
 * reducer 从空数组继续追加）、state（仅 STATE_SNAPSHOT 时更新，恢复后为 undefined 也正常工作）。
 */
const compactRunSnapshot = (snapshot: RuntimeRunState): RuntimeRunState => ({
  activities: snapshot.activities,
  error: snapshot.error,
  latestEventId: snapshot.latestEventId,
  messageOrder: snapshot.messageOrder,
  messages: snapshot.messages,
  orderedBlocks: snapshot.orderedBlocks,
  processedEventIds: snapshot.processedEventIds,
  rawEvents: [],
  reasoning: snapshot.reasoning,
  reasoningMeta: snapshot.reasoningMeta,
  runId: snapshot.runId,
  state: undefined,
  status: snapshot.status,
  steps: snapshot.steps,
  surfaces: snapshot.surfaces,
  threadId: snapshot.threadId,
  toolCalls: snapshot.toolCalls,
});

/**
 * 压缩 checkpoint 输入：resume/续跑只消费 forwardedProps + runId/threadId/messages；
 * context/state/tools 体积大且断线回放不读取，置空以省空间（类型上仍满足 RunAgentInput）。
 */
const compactRunInput = (input: RunAgentInput): RunAgentInput => ({
  ...input,
  context: [],
  state: {},
  tools: [],
});

/** 旧格式 checkpoint（rawEvents 非空）读取时惰性压缩并重写，一次性回收存量空间。 */
const maybeCompactCheckpoint = async (record: RunCheckpointRecord | undefined): Promise<RunCheckpointRecord | undefined> => {
  if (!record || record.snapshot.rawEvents.length === 0) return record;
  const compacted: RunCheckpointRecord = {
    ...record,
    input: compactRunInput(record.input),
    snapshot: compactRunSnapshot(record.snapshot),
  };
  await db.checkpoints.put(compacted);
  return compacted;
};

const BLOCKED_WARN_MS = 3000;
// 跨页面同步：BroadcastChannel 让其他标签页也能收到变更；同窗口仍发 CustomEvent（既有监听兼容）。
const sessionSyncChannel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('agentdock:session-sync')
  : undefined;
const sessionDeletionListeners = new Set<(ids: string[]) => void>();
const notifySessionsChanged = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('agentdock:sessions-changed'));
  sessionSyncChannel?.postMessage({ type: 'sessions-changed' });
};
const notifyRunPersisted = (detail: { runId: string; sessionId: string; status: RuntimeRunState['status'] }) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('agentdock:run-persisted', { detail }));
  sessionSyncChannel?.postMessage({ detail, type: 'run-persisted' });
};
/** 删除落库前通知所有标签页停止对应 Runtime；持久化层另有 orphan guard 兜底。 */
export const notifySessionsDeleting = (ids: string[]) => {
  if (ids.length === 0) return;
  for (const listener of sessionDeletionListeners) {
    try {
      listener(ids);
    } catch (error) {
      console.error('[AgentDock] session deletion listener failed', { error, ids });
    }
  }
  sessionSyncChannel?.postMessage({ ids, type: 'sessions-deleting' });
};
/** 落库失败（QuotaExceededError 等）时通知 UI 引导清理。 */
const notifyStorageError = (message: string) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('agentdock:storage-error', { detail: { message } }));
};
/**
 * 订阅会话数据变化（同窗口 CustomEvent + 跨标签页 BroadcastChannel 双通道）。
 * 返回退订函数；首页/侧栏列表应统一改用该订阅，避免跨标签页数据不同步。
 */
export const subscribeSessionChanges = (callback: () => void): (() => void) => {
  const onWindow = () => callback();
  const onChannel = (event: MessageEvent) => {
    const payload = event.data as { type?: string } | undefined;
    if (payload?.type === 'sessions-changed' || payload?.type === 'run-persisted') callback();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('agentdock:sessions-changed', onWindow);
    window.addEventListener('agentdock:run-persisted', onWindow);
  }
  sessionSyncChannel?.addEventListener('message', onChannel);
  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('agentdock:sessions-changed', onWindow);
      window.removeEventListener('agentdock:run-persisted', onWindow);
    }
    sessionSyncChannel?.removeEventListener('message', onChannel);
  };
};
export const subscribeSessionDeletions = (callback: (ids: string[]) => void): (() => void) => {
  sessionDeletionListeners.add(callback);
  const onChannel = (event: MessageEvent) => {
    const payload = event.data as { ids?: unknown; type?: string } | undefined;
    if (
      payload?.type === 'sessions-deleting' &&
      Array.isArray(payload.ids) &&
      payload.ids.every((id) => typeof id === 'string')
    ) callback(payload.ids);
  };
  sessionSyncChannel?.addEventListener('message', onChannel);
  return () => {
    sessionDeletionListeners.delete(callback);
    sessionSyncChannel?.removeEventListener('message', onChannel);
  };
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
/** 写库守卫：QuotaExceededError 等落库异常 dispatch storage-error 后原样抛出。 */
const guardWrite = async <T>(label: string, task: Promise<T>): Promise<T> => {
  try {
    return await task;
  } catch (error) {
    notifyStorageError(`${label} 落库失败：${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
};
const flushCheckpointBestEffort = (runId?: string) => {
  void flushRunCheckpoint(runId).catch((error) => {
    // guardWrite 已触发 storage-error；这里再吞掉定时器/pagehide 链的 rejection，
    // 避免升级成 window.unhandledrejection 干扰宿主应用的全局错误处理。
    console.error('[AgentDock] checkpoint flush failed', { error, runId });
  });
};

// 页面隐藏/关闭前兜底 flush：尽量把未落盘快照写入，避免刷新丢失最后一轮（best-effort）。
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const flushOnLeave = () => flushCheckpointBestEffort();
  window.addEventListener('pagehide', flushOnLeave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnLeave();
  });
}

/**
 * 启动清扫：删除全部终态 checkpoint（历史渲染以 messages 表为权威，终态快照无消费方）。
 * 幂等、只影响 checkpoints 表，messages/sessions 数据不动；返回清理条数。
 */
export const sweepTerminalCheckpoints = async (): Promise<number> => {
  const terminal = await db.checkpoints
    .filter((record) => record.status !== 'running' && record.status !== 'paused')
    .toArray();
  if (terminal.length) await db.checkpoints.bulkDelete(terminal.map((record) => record.runId));
  return terminal.length;
};
if (typeof window !== 'undefined') {
  void sweepTerminalCheckpoints();
}

export const sessionHistoryService = {
  async createSession(input: Omit<SessionRecord, 'createdAt' | 'id' | 'updatedAt'> & { id?: string }) {
    const now = new Date().toISOString();
    const record = { ...input, id: input.id ?? crypto.randomUUID(), createdAt: now, lastMessageAt: now, updatedAt: now };
    await guardWrite('createSession', withBlockedDiagnostic('createSession', db.sessions.put(record)));
    notifySessionsChanged();
    return record;
  },
  async getSession(id: string) { return db.sessions.get(id); },
  /** 会话是否已有可见文本消息（用户/助手），用于「首条消息」语义的标题默认值。 */
  async hasMessages(sessionId: string) {
    const row = await db.sessionMessages
      .where('sessionId')
      .equals(sessionId)
      .filter((record) => record.kind === 'text' && (record.role === 'user' || record.role === 'assistant'))
      .first();
    return row !== undefined;
  },
  /** 分页读取会话列表（按 createdAt 倒序）；会话有新消息时不改变侧边栏位置。 */
  async listSessions(options?: { limit?: number; offset?: number }) {
    let collection = db.sessions.orderBy('createdAt').reverse();
    if (options?.offset) collection = collection.offset(options.offset);
    if (options?.limit !== undefined) collection = collection.limit(options.limit);
    return collection.toArray();
  },
  async countSessions() { return db.sessions.count(); },
  /** 全部群组会话，按创建时间倒序，走 type 索引（群组数量有限，一次性取回）。 */
  async listGroupSessions() {
    const rows = await db.sessions.where('type').equals('group').toArray();
    return rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },
  /** 某 Agent（agentId + fab）的历史会话，按创建时间倒序，走 [agentId+fab] 索引。 */
  async listSessionsByAgent(agentId: string, fab: string) {
    const rows = await db.sessions.where('[agentId+fab]').equals([agentId, fab]).toArray();
    return rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },
  async searchSessions(keyword: string) { const sessions = await this.listSessions(); const query = keyword.toLowerCase(); return sessions.filter((session) => `${session.title}${session.agentName || ''}`.toLowerCase().includes(query)); },
  async updateSession(id: string, value: Partial<SessionRecord>) { await db.sessions.update(id, { ...value, updatedAt: new Date().toISOString() }); notifySessionsChanged(); return db.sessions.get(id); },
  async removeSession(id: string) {
    notifySessionsDeleting([id]);
    await guardWrite('removeSession', db.transaction('rw', db.sessions, db.sessionMessages, db.checkpoints, async () => {
      await db.sessions.delete(id);
      await db.sessionMessages.where('sessionId').equals(id).delete();
      await db.checkpoints.where('sessionId').equals(id).delete();
    }));
    notifySessionsChanged();
  },
  async appendMessages(records: SessionMessageRecord[]) { await db.sessionMessages.bulkPut(records); },
  async getMessages(sessionId: string) { return db.sessionMessages.where('sessionId').equals(sessionId).sortBy('sequence'); },
  /**
   * 会话内消息分页（懒加载）：以“文本消息所属的 run”为最小完整单位——
   * 每页取最近 limit 条文本及其整轮过程块，避免分页边界切断一轮导致块挂错/重复。
   * beforeSequence 为上一页最旧文本的 sequence（严格更早），返回下一页。
   */
  async getMessagesPage(sessionId: string, options?: { beforeSequence?: number; limit?: number }) {
    const limit = Math.max(1, options?.limit ?? MESSAGES_PAGE_TEXT_LIMIT);
    const upper = options?.beforeSequence === undefined
      ? ([sessionId, Number.MAX_SAFE_INTEGER] as [string, number])
      : ([sessionId, options.beforeSequence] as [string, number]);
    const includeUpper = options?.beforeSequence === undefined;
    const texts = await db.sessionMessages
      .where('[sessionId+sequence]')
      .between([sessionId, 0], upper, true, includeUpper)
      .reverse()
      .filter((record) => record.kind === 'text')
      .limit(limit)
      .toArray();
    if (texts.length === 0) return { hasMore: false, nextBeforeSequence: undefined, records: [] };
    // 按 runId 装载整轮（文本 + 过程块），保证每轮完整。
    const runIds = [...new Set(texts.map((record) => record.runId).filter((id): id is string => Boolean(id)))];
    const records: SessionMessageRecord[] = [];
    for (const runId of runIds) {
      const rows = await db.sessionMessages.where('runId').equals(runId).toArray();
      records.push(...rows.filter((record) => record.sessionId === sessionId));
    }
    // 防御兜底：历史数据中可能存在的无 runId 文本行（渲染仍有效），避免被分页漏掉。
    for (const text of texts) {
      if (!text.runId) records.push(text);
    }
    records.sort((a, b) => a.sequence - b.sequence);
    // 游标必须是“页内全局最小 sequence”（整轮的最旧行），而不是“最旧文本”：
    // 分页在轮中间截断时（如每轮 2 条文本、每页 7 条），最旧文本所在轮的用户文本/过程块
    // 早于该文本；若游标取最旧文本，下一页会把该轮剩余行再次纳入，造成跨页重复。
    const nextBeforeSequence = records[0]?.sequence;
    const older = nextBeforeSequence === undefined
      ? []
      : await db.sessionMessages
          .where('[sessionId+sequence]')
          .between([sessionId, 0], [sessionId, nextBeforeSequence], true, false)
          .reverse()
          .filter((record) => record.kind === 'text')
          .limit(1)
          .toArray();
    return { hasMore: older.length > 0, nextBeforeSequence, records };
  },
  /**
   * checkpoint 剪枝：删除全部终态（success/cancelled/error）行，只保留 running/paused
   * （断线续传与 HITL 恢复依赖，见 runStore.restoreSession / getLatestRecoverableRun）。
   */
  async pruneCheckpoints(sessionId: string) {
    const rows = await db.checkpoints.where('sessionId').equals(sessionId).sortBy('updatedAt');
    const recoverable = new Set(
      rows.filter((record) => record.status === 'running' || record.status === 'paused').map((record) => record.runId),
    );
    const terminal = rows.filter((record) => !recoverable.has(record.runId));
    // 终态不落 checkpoint（历史由 messages 表渲染）：存量终态行全部回收。
    if (terminal.length) await db.checkpoints.bulkDelete(terminal.map((record) => record.runId));
  },
  async saveRunCheckpoint(sessionId: string, input: RunAgentInput, snapshot: RuntimeRunState) {
    await this._writeCheckpoint(sessionId, input, snapshot);
  },
  async _writeCheckpoint(sessionId: string, input: RunAgentInput, snapshot: RuntimeRunState) {
    const discardOrphans = async () => {
      await Promise.all([
        db.checkpoints.where('sessionId').equals(sessionId).delete(),
        db.sessionMessages.where('sessionId').equals(sessionId).delete(),
      ]);
    };
    if (!(await db.sessions.get(sessionId))) {
      await discardOrphans();
      return;
    }
    const updatedAt = new Date().toISOString();
    const isRecoverable = snapshot.status === 'running' || snapshot.status === 'paused';
    if (isRecoverable) {
      const record: RunCheckpointRecord = {
        input: compactRunInput(input),
        latestEventId: snapshot.latestEventId,
        runId: snapshot.runId,
        sessionId,
        snapshot: compactRunSnapshot(snapshot),
        status: snapshot.status,
        threadId: snapshot.threadId,
        updatedAt,
      };
      await db.checkpoints.put(record);
      // 顺带回收本会话遗留的终态 checkpoint（旧格式存量）。
      await this.pruneCheckpoints(sessionId);
    } else {
      // 终态不落 checkpoint（历史由 messages 表渲染）：
      // 必须删除本 run 在流式期间残留的 running checkpoint，否则刷新后 restore()
      // 会把它当作“最新”快照并转 cancelled，误显示“已中断”。
      await db.checkpoints
        .where('sessionId')
        .equals(sessionId)
        .and((record) => record.runId === snapshot.runId)
        .delete();
    }
    // LobeHub 同款：占位创建 + 流式增量更新——每条 flush 都把当前快照投影到 messages 行
    // （空/部分内容也落行，后续 flush 用同一 id upsert 覆盖）。这样：
    // - 刷新/断线时 DB 里始终有该消息（部分内容可恢复）；
    // - 文本行保持“先于其过程块”的顺序（空占位也占据文本位置），历史按轮次不可变。
    await this.persistRunSnapshot(sessionId, snapshot);
    const updated = await db.sessions.update(sessionId, { updatedAt });
    if (updated === 0) {
      await discardOrphans();
      return;
    }
    notifySessionsChanged();
    // 落库完成后广播，供对话页确定性刷新历史（避免与异步落库竞态）。
    notifyRunPersisted({ runId: snapshot.runId, sessionId, status: snapshot.status });
  },
  async persistRunSnapshot(sessionId: string, snapshot: RuntimeRunState) {
    // 多轮 run 快照会累积完整会话（MESSAGES_SNAPSHOT），每轮 flush 都会重写全部行。
    // 已存在的消息必须保留原 sequence/createdAt/runId，否则后一轮 flush 会把
    // 早前消息重新排序、时间戳覆盖，导致聊天时间线错乱；新消息才分配新序号。
    const existingRows = await db.sessionMessages.where('sessionId').equals(sessionId).toArray();
    const existingById = new Map(existingRows.map((record) => [record.id, record]));
    // 已删消息墓碑：后端线程仍可能带回被删轮次，这里跳过不再写回。
    const sessionRow = await db.sessions.get(sessionId);
    const deletedKeys = new Set(sessionRow?.deletedMessageIds ?? []);
    const records: SessionMessageRecord[] = [];
    const push = (kind: SessionMessageKind, id: string, value: Omit<SessionMessageRecord, 'createdAt' | 'id' | 'kind' | 'sequence' | 'sessionId'>) => {
      const key = `${kind}:${id}`;
      if (deletedKeys.has(key)) return;
      const existing = existingById.get(key);
      records.push({
        ...value,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        id: key,
        kind,
        runId: existing?.runId ?? snapshot.runId,
        sequence: existing?.sequence ?? nextSequence(),
        sessionId,
      });
    };
    // 顶层消息时间线以 messageOrder 为准。当前 run 若产生多段 assistant 文本，
    // 只把最后一段作为最终答案，前面的段落按 orderedBlocks 转成 narration，
    // 与 reasoning/tool/step 保持真实到达顺序（LobeHub AssistantGroup 语义）。
    const messageIds = snapshot.messageOrder?.length
      ? snapshot.messageOrder
      : Object.keys(snapshot.messages);
    const currentAssistantIds = messageIds.filter((messageId) => {
      const message = snapshot.messages[messageId];
      return message?.role === 'assistant' && message.runId === snapshot.runId;
    });
    const hasOrderedTextBlocks = snapshot.orderedBlocks.some((block) => block.kind === 'text');
    const intermediateAssistantIds = new Set(
      hasOrderedTextBlocks && currentAssistantIds.length > 1
        ? currentAssistantIds.slice(0, -1)
        : [],
    );
    const obsoleteIntermediateTextKeys: string[] = [];
    const pushMessage = (message: RuntimeMessage) => {
      if (!message.id || String(message.id).startsWith('lc_run--')) return;
      if (!LOBE_VISIBLE_MESSAGE_ROLES.includes(message.role as never)) return;
      if (intermediateAssistantIds.has(message.id)) {
        obsoleteIntermediateTextKeys.push(`text:${message.id}`);
        return;
      }
      const {
        content: _content,
        createdAt: _createdAt,
        eventId: _eventId,
        id: _id,
        role: _role,
        runId: _runId,
        ...messagePayload
      } = message;
      push('text', message.id, {
        content: message.content,
        eventId: message.eventId ?? snapshot.latestEventId,
        payload: Object.keys(messagePayload).length ? messagePayload : undefined,
        role: message.role,
        runId: snapshot.runId,
      });
    };
    for (const messageId of messageIds) {
      const message = snapshot.messages[messageId];
      if (message) pushMessage(message);
    }
    // 兜底：messageOrder 未覆盖但存在于 messages 的消息（老状态/漏调用）追加到末尾，保证不丢。
    const ordered = new Set(messageIds);
    for (const messageId of Object.keys(snapshot.messages)) {
      if (ordered.has(messageId)) continue;
      const message = snapshot.messages[messageId];
      if (message) pushMessage(message);
    }

    const persistedBlocks = new Set<string>();
    const persistActivity = (id: string, activity: unknown) => {
      const payload = (activity && typeof activity === 'object') ? (activity as Record<string, unknown>) : {};
      if (payload.diagnosticOnly === true) return;
      const activityType = String(payload.activityType || '');
      push('activity', id, { payload: { ...payload, activityType, messageId: id }, runId: snapshot.runId, eventId: snapshot.latestEventId });
      if (activityType === 'a2ui.surface') {
        // 中间态（building/progress）无 UI 内容，不落 surface 行；否则正文出现 JSON 回退卡。
        if (
          !Array.isArray(payload.a2ui_operations) &&
          !Array.isArray(payload.components)
        ) {
          return;
        }
        // 与 snapshot.surfaces 共用“逻辑 surfaceId”键：a2ui.surface 活动与 render_a2ui
        // 工具的 components 版是同一界面，必须去重，否则历史出现重复 surface / JSON 回退卡。
        const surfaceId = findLogicalSurfaceId(payload) || String(payload.surfaceId || id);
        push('surface', surfaceId, { payload: { ...payload, surfaceId }, runId: snapshot.runId, eventId: snapshot.latestEventId });
      }
    };
    const persistSurface = (surfaceId: string, surface: unknown) => {
      const payload = (surface && typeof surface === 'object') ? (surface as Record<string, unknown>) : {};
      push('surface', surfaceId, { payload: { ...payload, surfaceId }, runId: snapshot.runId, eventId: snapshot.latestEventId });
    };
    const persistBlock = (kind: RuntimeRunState['orderedBlocks'][number]['kind'], id: string) => {
      const key = `${kind}:${id}`;
      if (persistedBlocks.has(key)) return;
      persistedBlocks.add(key);
      switch (kind) {
        case 'text': {
          if (!intermediateAssistantIds.has(id)) return;
          const message = snapshot.messages[id];
          if (message?.content) {
            push('narration', id, { content: message.content, runId: snapshot.runId, eventId: message.eventId ?? snapshot.latestEventId });
          }
          return;
        }
        case 'reasoning': {
          const content = snapshot.reasoning[id];
          if (content !== undefined) push('reasoning', id, { content, runId: snapshot.runId, eventId: snapshot.latestEventId });
          return;
        }
        case 'tool': {
          const call = snapshot.toolCalls[id];
          if (call) push('tool', id, { content: call.args, payload: { apiName: call.apiName, args: call.args, finishedAt: call.finishedAt, name: call.name, result: call.result, resultMsgId: call.resultMsgId, startedAt: call.startedAt, status: call.status }, runId: snapshot.runId, eventId: snapshot.latestEventId });
          return;
        }
        case 'step': {
          const step = snapshot.steps[id];
          if (step) push('step', id, { payload: { finishedAt: step.finishedAt, name: step.name, startedAt: step.startedAt, status: step.status }, runId: snapshot.runId, eventId: snapshot.latestEventId });
          return;
        }
        case 'activity':
          persistActivity(id, snapshot.activities[id]);
          return;
        case 'surface':
          persistSurface(id, snapshot.surfaces[id]);
          return;
      }
    };
    for (const block of snapshot.orderedBlocks) persistBlock(block.kind, block.id);
    for (const id of Object.keys(snapshot.reasoning || {})) persistBlock('reasoning', id);
    for (const id of Object.keys(snapshot.toolCalls || {})) persistBlock('tool', id);
    for (const id of Object.keys(snapshot.steps || {})) persistBlock('step', id);
    for (const id of Object.keys(snapshot.activities || {})) persistBlock('activity', id);
    for (const id of Object.keys(snapshot.surfaces || {})) persistBlock('surface', id);

    if (obsoleteIntermediateTextKeys.length) {
      await db.sessionMessages.bulkDelete(obsoleteIntermediateTextKeys.map((id) => [sessionId, id]));
    }
    if (records.length) await db.sessionMessages.bulkPut(records);
    // 维护 lastMessageAt：取“现有行 + 本次写入行”的 text 最大 createdAt
    // （快照可能只含部分轮次，不能只按本次 records 计算）。
    let maxText = 0;
    for (const row of existingRows) if (row.kind === 'text') maxText = Math.max(maxText, new Date(row.createdAt).getTime());
    for (const row of records) if (row.kind === 'text') maxText = Math.max(maxText, new Date(row.createdAt).getTime());
    if (maxText > 0) {
      const lastMessageAt = new Date(maxText).toISOString();
      const session = await db.sessions.get(sessionId);
      // 单调守卫：仅当新值更晚才更新。重叠 flush 时后到的 flush 基于旧 rows 计算，
      // 可能覆盖并发 flush 已更新的更高值，导致 lastMessageAt 回退。
      if (session && new Date(lastMessageAt).getTime() > new Date(session.lastMessageAt ?? 0).getTime()) {
        await db.sessions.update(sessionId, { lastMessageAt });
      }
    }
  },
  async getLatestRun(sessionId: string) {
    const records = await db.checkpoints.where('sessionId').equals(sessionId).sortBy('updatedAt');
    return maybeCompactCheckpoint(records.at(-1));
  },
  async getLatestRecoverableRun(sessionId: string) {
    const records = await db.checkpoints.where('sessionId').equals(sessionId).sortBy('updatedAt');
    const recoverable = records.reverse().find((record) => ['running', 'paused'].includes(record.status));
    return maybeCompactCheckpoint(recoverable);
  },
};

/** 防抖写入：每 run 一槽，空闲 350ms 后统一落盘；终态时手动 flush。 */
export const scheduleRunCheckpoint = (sessionId: string, input: RunAgentInput, snapshot: RuntimeRunState) => {
  const runId = snapshot.runId;
  pendingCheckpoints.set(runId, { input, sessionId, snapshot });
  const currentTimer = checkpointTimers.get(runId);
  if (currentTimer) clearTimeout(currentTimer);
  checkpointTimers.set(runId, setTimeout(() => {
    flushCheckpointBestEffort(runId);
  }, CHECKPOINT_DEBOUNCE_MS));
  // 连续 token 会不断推迟尾部防抖；最大等待保证运行中的游标也定期落盘，刷新可续传。
  if (!checkpointMaxTimers.has(runId)) {
    checkpointMaxTimers.set(runId, setTimeout(() => {
      flushCheckpointBestEffort(runId);
    }, CHECKPOINT_MAX_WAIT_MS));
  }
};

const enqueueCheckpointWrite = (
  runId: string,
  job: { input: RunAgentInput; sessionId: string; snapshot: RuntimeRunState },
) => {
  // 同 run 严格串行：防止较早的 running 写在较新的 terminal 删除之后完成，复活陈旧 checkpoint。
  const previous = checkpointWriteChains.get(runId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => sessionHistoryService.saveRunCheckpoint(job.sessionId, job.input, job.snapshot));
  checkpointWriteChains.set(runId, next);
  const cleanup = () => {
    if (checkpointWriteChains.get(runId) === next) checkpointWriteChains.delete(runId);
  };
  void next.then(cleanup, cleanup);
  return next;
};

export const flushRunCheckpoint = async (runId?: string) => {
  const runIds = runId ? [runId] : [...pendingCheckpoints.keys()];
  const jobs = runIds.flatMap((id) => {
    const timer = checkpointTimers.get(id);
    if (timer) clearTimeout(timer);
    checkpointTimers.delete(id);
    const maxTimer = checkpointMaxTimers.get(id);
    if (maxTimer) clearTimeout(maxTimer);
    checkpointMaxTimers.delete(id);
    const job = pendingCheckpoints.get(id);
    pendingCheckpoints.delete(id);
    return job ? [{ id, job }] : [];
  });
  const results = await Promise.allSettled(
    jobs.map(({ id, job }) => enqueueCheckpointWrite(id, job)),
  );
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
};

/**
 * 取消某 run 的待落盘快照：错误兜底后丢弃陈旧 running 快照，
 * 避免稍后防抖 flush 把“已终态报错”的 run 重新写回 running checkpoint。
 * 待落盘队列清空时同时取消定时器，防止空转。
 */
export const cancelPendingCheckpoint = (runId: string): void => {
  pendingCheckpoints.delete(runId);
  const timer = checkpointTimers.get(runId);
  if (timer) clearTimeout(timer);
  checkpointTimers.delete(runId);
  const maxTimer = checkpointMaxTimers.get(runId);
  if (maxTimer) clearTimeout(maxTimer);
  checkpointMaxTimers.delete(runId);
};

/** 等待某 run 已进入 IndexedDB 的串行写完成；删除 Session 前用于避免晚到写产生孤儿行。 */
export const waitForRunCheckpoint = async (runId: string): Promise<void> => {
  const pending = checkpointWriteChains.get(runId);
  if (!pending) return;
  try {
    await pending;
  } catch {
    // 调用方只需要等待写链停止；实际写错误已由 operation 完成路径记录并决定是否重试。
  }
};

export { notifySessionsChanged };
