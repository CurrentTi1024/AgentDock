import Dexie, { type EntityTable } from 'dexie';
import type { RunAgentInput, RuntimeMessage, RuntimeRunState } from '@/api/runtime/types';
export interface SessionRecord { agentId?: string; agentName?: string; createdAt: string; deletedMessageIds?: string[]; fab: string; group?: unknown; id: string; lastMessageAt?: string; pinned: boolean; threadId: string; title: string; type: 'agent' | 'group'; updatedAt: string; version?: string }
export type SessionMessageKind = 'activity' | 'reasoning' | 'step' | 'surface' | 'text' | 'tool';
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
  sessions!: EntityTable<SessionRecord, 'id'>; messages!: EntityTable<SessionMessageRecord, 'id'>; checkpoints!: EntityTable<RunCheckpointRecord, 'runId'>;
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
/**
 * 会话内单调递增的 sequence（时间戳 ×1000 + 递增种子）：
 * 种子以随机偏移起步且不取模，保证同一标签页内严格单调（消除同毫秒回绕）；
 * 跨标签页同毫秒并发写同一会话时碰撞概率从“必然”降到约 1/1000（随机偏移相同才撞）。
 * 注：同一会话的多标签页并发流式写本身不是产品支持场景（防重入门禁在同一标签页内），
 * 该随机化只是把“理论上可能撞”压到可忽略。
 */
const nextSequence = () => {
  sequenceSeed = sequenceSeed + 1;
  return Date.now() * 1000 + sequenceSeed;
};
// 按 runId 分槽的待落盘快照：多轮 run 并发/快速连续发送时互不覆盖，
// 防抖空闲后统一 flush，避免只落最后一段或丢消息。
let pendingCheckpoints = new Map<string, { input: RunAgentInput; sessionId: string; snapshot: RuntimeRunState }>();
let checkpointTimer: ReturnType<typeof setTimeout> | undefined;
const CHECKPOINT_DEBOUNCE_MS = 350;
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
const notifySessionsChanged = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('agentdock:sessions-changed'));
  sessionSyncChannel?.postMessage({ type: 'sessions-changed' });
};
const notifyRunPersisted = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('agentdock:run-persisted'));
  sessionSyncChannel?.postMessage({ type: 'run-persisted' });
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
// 页面隐藏/关闭前兜底 flush：尽量把未落盘快照写入，避免刷新丢失最后一轮（best-effort）。
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const flushOnLeave = () => { void flushRunCheckpoint(); };
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
  /** 分页读取会话列表（按 updatedAt 倒序）；不传 limit 时保持旧行为返回全部。 */
  async listSessions(options?: { limit?: number; offset?: number }) {
    let collection = db.sessions.orderBy('updatedAt').reverse();
    if (options?.offset) collection = collection.offset(options.offset);
    if (options?.limit !== undefined) collection = collection.limit(options.limit);
    return collection.toArray();
  },
  async countSessions() { return db.sessions.count(); },
  /** 全部群组会话，按更新时间倒序，走 type 索引（群组数量有限，一次性取回）。 */
  async listGroupSessions() {
    const rows = await db.sessions.where('type').equals('group').toArray();
    return rows.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  },
  /** 某 Agent（agentId + fab）的历史会话，按更新时间倒序，走 [agentId+fab] 索引。 */
  async listSessionsByAgent(agentId: string, fab: string) {
    const rows = await db.sessions.where('[agentId+fab]').equals([agentId, fab]).toArray();
    return rows.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  },
  async searchSessions(keyword: string) { const sessions = await this.listSessions(); const query = keyword.toLowerCase(); return sessions.filter((session) => `${session.title}${session.agentName || ''}`.toLowerCase().includes(query)); },
  async updateSession(id: string, value: Partial<SessionRecord>) { await db.sessions.update(id, { ...value, updatedAt: new Date().toISOString() }); notifySessionsChanged(); return db.sessions.get(id); },
  async removeSession(id: string) {
    await guardWrite('removeSession', db.transaction('rw', db.sessions, db.messages, db.checkpoints, async () => {
      await db.sessions.delete(id);
      await db.messages.where('sessionId').equals(id).delete();
      await db.checkpoints.where('sessionId').equals(id).delete();
    }));
    notifySessionsChanged();
  },
  async appendMessages(records: SessionMessageRecord[]) { await db.messages.bulkPut(records); },
  async getMessages(sessionId: string) { return db.messages.where('sessionId').equals(sessionId).sortBy('sequence'); },
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
    const texts = await db.messages
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
      const rows = await db.messages.where('runId').equals(runId).toArray();
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
      : await db.messages
          .where('[sessionId+sequence]')
          .between([sessionId, 0], [sessionId, nextBeforeSequence], true, false)
          .reverse()
          .filter((record) => record.kind === 'text')
          .limit(1)
          .toArray();
    return { hasMore: older.length > 0, nextBeforeSequence, records };
  },
  /** 删除后重算 lastMessageAt：取会话内 text 行最大 createdAt，无消息回退 createdAt。 */
  async recomputeLastMessageAt(sessionId: string) {
    const session = await db.sessions.get(sessionId);
    if (!session) return;
    const rows = await db.messages.where('sessionId').equals(sessionId).toArray();
    let max = 0;
    for (const row of rows) if (row.kind === 'text') max = Math.max(max, new Date(row.createdAt).getTime());
    await db.sessions.update(sessionId, { lastMessageAt: max > 0 ? new Date(max).toISOString() : session.createdAt });
  },
  /**
   * 删除一条消息及其关联的过程块（reasoning/tool/step/activity/surface），
   * 同时删除包含该消息的 checkpoint，避免刷新后从快照复活已删消息。
   */
  async removeMessage(sessionId: string, id: string) {
    await this.removeMessages(sessionId, [id]);
  },
  /**
   * 批量删除消息行及其关联过程块；同时删除包含任一消息的 checkpoint，避免刷新后复活。
   */
  async removeMessages(sessionId: string, ids: string[]) {
    // 快照 messages 的 key 是裸 rawId；调用方可能传 text: 前缀，需归一化后再匹配 checkpoint。
    const rawIdSet = new Set(ids.map((id) => id.replace(/^text:/, '')));
    await db.transaction('rw', db.messages, db.checkpoints, async () => {
      const all = await db.messages.where('sessionId').equals(sessionId).sortBy('sequence');
      const idsToRemove = new Set<string>();
      for (const id of ids) {
        const targetIndex = all.findIndex((record) => record.id === `text:${id}` || record.id === id);
        if (targetIndex < 0) continue;
        idsToRemove.add(all[targetIndex].id);
        for (let index = targetIndex + 1; index < all.length; index += 1) {
          const record = all[index];
          if (record.kind === 'text') break;
          idsToRemove.add(record.id);
        }
      }
      if (idsToRemove.size) await db.messages.bulkDelete([...idsToRemove]);
      const checkpoints = await db.checkpoints.where('sessionId').equals(sessionId).toArray();
      for (const checkpoint of checkpoints) {
        if (Object.keys(checkpoint.snapshot.messages).some((key) => rawIdSet.has(key))) {
          await db.checkpoints.delete(checkpoint.runId);
        }
      }
    });
    await this.recomputeLastMessageAt(sessionId);
    notifySessionsChanged();
  },
  /**
   * 分支替换：删除以该用户消息开始的整轮（用户文本 + 助手回复 + 全部过程块 + checkpoint）。
   * 存储顺序是文本在前、过程块在后，不能按「下一条文本即止」切分，必须按 runId 整轮删除。
   */
  async removeTurn(sessionId: string, userMessageId: string) {
    await db.transaction('rw', db.messages, db.checkpoints, db.sessions, async () => {
      const target = await db.messages.get(`text:${userMessageId}`);
      if (!target?.runId) return;
      // 记录被删轮次的全部消息 key（text:/tool:/step:/activity:/surface:/reasoning:），
      // 作为墓碑持久化：后端线程仍携带该轮，新 run 的 MESSAGES_SNAPSHOT 会把它带回来，
      // persistRunSnapshot 据此跳过，避免「删除并重新生成」把已删消息复活污染历史。
      const turnRecords = await db.messages
        .where('sessionId')
        .equals(sessionId)
        .filter((record) => record.runId === target.runId)
        .toArray();
      await db.messages.bulkDelete(turnRecords.map((record) => record.id));
      await db.checkpoints.where('sessionId').equals(sessionId).and((checkpoint) => checkpoint.runId === target.runId).delete();
      if (turnRecords.length) {
        const session = await db.sessions.get(sessionId);
        const merged = [...new Set([...(session?.deletedMessageIds ?? []), ...turnRecords.map((record) => record.id)])];
        await db.sessions.update(sessionId, { deletedMessageIds: merged });
      }
    });
    await this.recomputeLastMessageAt(sessionId);
    notifySessionsChanged();
  },
  /** 编辑消息内容：同步更新消息行与 checkpoint 中的快照。 */
  async updateMessageContent(sessionId: string, id: string, content: string) {
    const rawId = id.replace(/^text:/, '');
    await db.transaction('rw', db.messages, db.checkpoints, async () => {
      const target = await db.messages.get(`text:${rawId}`);
      if (target) {
        await db.messages.update(`text:${rawId}`, { content });
      } else {
        const record = await db.messages.get(rawId);
        if (record) await db.messages.update(rawId, { content });
      }
      const checkpoints = await db.checkpoints.where('sessionId').equals(sessionId).toArray();
      for (const checkpoint of checkpoints) {
        const message = checkpoint.snapshot.messages[rawId];
        if (message) {
          checkpoint.snapshot.messages[rawId] = { ...message, content };
          await db.checkpoints.put(checkpoint);
        }
      }
    });
    notifySessionsChanged();
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
    if (terminal.length) await db.checkpoints.bulkDelete(terminal.map((record) => record.runId));
  },
  async saveRunCheckpoint(sessionId: string, input: RunAgentInput, snapshot: RuntimeRunState) {
    const updatedAt = new Date().toISOString();
    const isRecoverable = snapshot.status === 'running' || snapshot.status === 'paused';
    let record: RunCheckpointRecord | undefined;
    if (isRecoverable) {
      record = {
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
    }
    await this.persistRunSnapshot(sessionId, snapshot);
    await db.sessions.update(sessionId, { updatedAt });
    notifySessionsChanged();
    // 落库完成后广播，供对话页确定性刷新历史（避免与异步落库竞态）。
    notifyRunPersisted();
    return record;
  },
  async persistRunSnapshot(sessionId: string, snapshot: RuntimeRunState) {
    // 多轮 run 快照会累积完整会话（MESSAGES_SNAPSHOT），每轮 flush 都会重写全部行。
    // 已存在的消息必须保留原 sequence/createdAt/runId，否则后一轮 flush 会把
    // 早前消息重新排序、时间戳覆盖，导致聊天时间线错乱；新消息才分配新序号。
    const existingRows = await db.messages.where('sessionId').equals(sessionId).toArray();
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
    // 时间线顺序以协议的权威顺序（messageOrder，来自 MESSAGES_SNAPSHOT 数组）为准，
    // 新消息按其首次出现位置分配序号；旧 checkpoint 无 messageOrder 时回退 map 迭代序。
    const messageIds = snapshot.messageOrder?.length
      ? snapshot.messageOrder
      : Object.keys(snapshot.messages);
    for (const messageId of messageIds) {
      const message = snapshot.messages[messageId];
      if (!message || !message.id) continue;
      // 流式占位 id（lc_run--）不落库：快照规范 UUID 才是唯一权威行，
      // 避免同一回复以两个 id 各渲染一次（“我”+全文两个气泡）。
      if (String(message.id).startsWith('lc_run--')) continue;
      // 只持久化用户与助手文本；system/developer 上下文消息（如 A2UI catalog）
      // 不进入可见历史，避免以 assistant 气泡误渲染。
      if (message.role !== 'user' && message.role !== 'assistant') continue;
      // 文本消息记录自己最后一次更新时的 eventId；其余类型记录 run 当前游标。
      push('text', message.id, { content: message.content, role: message.role, runId: snapshot.runId, eventId: message.eventId ?? snapshot.latestEventId });
    }
    // 兜底：messageOrder 未覆盖但存在于 messages 的消息（老状态/漏调用）追加到末尾，保证不丢。
    const ordered = new Set(messageIds);
    for (const messageId of Object.keys(snapshot.messages)) {
      if (ordered.has(messageId)) continue;
      const message = snapshot.messages[messageId];
      if (!message || !message.id) continue;
      if (message.role !== 'user' && message.role !== 'assistant') continue;
      if (String(message.id).startsWith('lc_run--')) continue;
      push('text', message.id, { content: message.content, role: message.role, runId: snapshot.runId, eventId: message.eventId ?? snapshot.latestEventId });
    }
    for (const [id, content] of Object.entries(snapshot.reasoning || {})) push('reasoning', id, { content, runId: snapshot.runId, eventId: snapshot.latestEventId });
    for (const [id, call] of Object.entries(snapshot.toolCalls || {})) push('tool', id, { content: call.args, payload: { apiName: call.apiName, args: call.args, finishedAt: call.finishedAt, name: call.name, result: call.result, resultMsgId: call.resultMsgId, startedAt: call.startedAt, status: call.status }, runId: snapshot.runId, eventId: snapshot.latestEventId });
    for (const [id, step] of Object.entries(snapshot.steps || {})) push('step', id, { payload: { finishedAt: step.finishedAt, name: step.name, startedAt: step.startedAt, status: step.status }, runId: snapshot.runId, eventId: snapshot.latestEventId });
    for (const [id, activity] of Object.entries(snapshot.activities || {})) {
      const payload = (activity && typeof activity === 'object') ? (activity as Record<string, unknown>) : {};
      const activityType = String(payload.activityType || '');
      push('activity', id, { payload: { ...payload, activityType, messageId: id }, runId: snapshot.runId, eventId: snapshot.latestEventId });
      if (activityType === 'a2ui.surface') push('surface', String(payload.surfaceId || id), { payload: { ...payload, surfaceId: payload.surfaceId || id }, runId: snapshot.runId, eventId: snapshot.latestEventId });
    }
    for (const [surfaceId, surface] of Object.entries(snapshot.surfaces || {})) {
      const payload = (surface && typeof surface === 'object') ? (surface as Record<string, unknown>) : {};
      push('surface', surfaceId, { payload: { ...payload, surfaceId }, runId: snapshot.runId, eventId: snapshot.latestEventId });
    }
    if (records.length) await db.messages.bulkPut(records);
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
  pendingCheckpoints.set(snapshot.runId, { input, sessionId, snapshot });
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
  const jobs = [...pendingCheckpoints.values()];
  pendingCheckpoints.clear();
  for (const job of jobs) {
    await sessionHistoryService.saveRunCheckpoint(job.sessionId, job.input, job.snapshot);
  }
};

export { notifySessionsChanged };
