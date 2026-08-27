import {
  notifySessionsChanged,
  sessionDatabase,
  type RunCheckpointRecord,
  type SessionMessageRecord,
  type SessionRecord,
} from './sessionHistoryService.ts';

const DAY_MS = 86_400_000;
/** 估算单条消息（文本 + 关联过程块）的平均字节数，仅用于预览提示，不参与删除逻辑。 */
const ESTIMATED_BYTES_PER_MESSAGE = 800;

/** 容量预警阈值：使用率 >= 70% 提醒，>= 90% 高危。 */
export const STORAGE_WARNING_THRESHOLD = 0.7;
export const STORAGE_CRITICAL_THRESHOLD = 0.9;

export type StorageHealthLevel = 'ok' | 'warning' | 'critical';

export interface StorageTableStats {
  checkpoints: number;
  messages: number;
  sessions: number;
}

export interface StorageUsage {
  health: StorageHealthLevel;
  /** usage / quota，0 < 值 < 1% 时按 1% 显示（LobeHub 同款）。 */
  percent: number;
  quota: number;
  tables: StorageTableStats;
  usage: number;
}

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
};

/** 读取 origin 级存储用量（navigator.storage.estimate）+ 本库三表行数。 */
export const getStorageUsage = async (): Promise<StorageUsage> => {
  let usage = 0;
  let quota = 0;
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      usage = estimate.usage ?? 0;
      quota = estimate.quota ?? 0;
    } catch {
      // estimate 失败时降级为仅行数统计，不影响预警流程。
    }
  }
  const [sessions, messages, checkpoints] = await Promise.all([
    sessionDatabase.sessions.count(),
    sessionDatabase.sessionMessages.count(),
    sessionDatabase.checkpoints.count(),
  ]);
  const rawPercent = quota > 0 ? usage / quota : 0;
  const percent = rawPercent > 0 && rawPercent < 0.01 ? 0.01 : rawPercent;
  const health: StorageHealthLevel =
    percent >= STORAGE_CRITICAL_THRESHOLD
      ? 'critical'
      : percent >= STORAGE_WARNING_THRESHOLD
        ? 'warning'
        : 'ok';
  return { health, percent, quota, tables: { checkpoints, messages, sessions }, usage };
};

let lastDispatchedLevel: StorageHealthLevel | undefined;
let lastHealthCheckAt = 0;
const HEALTH_CHECK_INTERVAL_MS = 10_000;

/**
 * 容量健康检查（10s 节流）：跨级（ok→warning/critical、降回 ok）时 dispatch
 * `agentdock:storage-warning`（detail 为 StorageUsage）；同一级别只提示一次。
 */
export const checkStorageHealth = async (options?: { force?: boolean }): Promise<StorageUsage> => {
  const now = Date.now();
  if (!options?.force && now - lastHealthCheckAt < HEALTH_CHECK_INTERVAL_MS) return getStorageUsage();
  lastHealthCheckAt = now;
  const usage = await getStorageUsage();
  if (usage.health !== lastDispatchedLevel) {
    lastDispatchedLevel = usage.health;
    if (usage.health !== 'ok' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('agentdock:storage-warning', { detail: usage }));
    }
  }
  return usage;
};

export type CleanupCriteria =
  /** 最后一条消息时间早于 now - daysAgo * 24h。 */
  | { daysAgo: number }
  /** 按最后一条消息时间升序取最旧 N 个会话。 */
  | { oldestCount: number };

export interface CleanupCandidate {
  lastMessageAt: string;
  messageCount: number;
  session: SessionRecord;
  sizeEstimateBytes: number;
}

export interface CleanupSelection {
  candidates: CleanupCandidate[];
  sizeEstimateBytes: number;
  total: number;
}

/** 清理选择一律以 lastMessageAt 为准；v2 之前遗留缺字段的会话回退 updatedAt。 */
const effectiveLastTime = (session: SessionRecord): number => {
  const timestamp = session.lastMessageAt
    ? new Date(session.lastMessageAt).getTime()
    : new Date(session.updatedAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

/**
 * 按清理条件选出会话候选（用于预览），返回候选明细 + 命中总数 + 估算体积。
 * daysAgo 走 lastMessageAt 索引；缺字段回退项单独兜底扫描，避免漏选旧数据。
 */
export const selectCleanupCandidates = async (
  criteria: CleanupCriteria,
  options?: { limit?: number },
): Promise<CleanupSelection> => {
  const now = Date.now();
  let sessions: SessionRecord[];
  if ('daysAgo' in criteria) {
    const boundTime = now - Math.max(0, criteria.daysAgo) * DAY_MS;
    const bound = new Date(boundTime).toISOString();
    const indexed = await sessionDatabase.sessions.where('lastMessageAt').below(bound).toArray();
    const missing = await sessionDatabase.sessions
      .filter((session) => !session.lastMessageAt && effectiveLastTime(session) < boundTime)
      .toArray();
    sessions = [...indexed, ...missing];
  } else {
    const count = Math.max(0, Math.floor(criteria.oldestCount));
    const indexed = await sessionDatabase.sessions.orderBy('lastMessageAt').limit(count).toArray();
    const missing = await sessionDatabase.sessions.filter((session) => !session.lastMessageAt).toArray();
    sessions = [...indexed, ...missing];
    sessions.sort((a, b) => effectiveLastTime(a) - effectiveLastTime(b));
    sessions = sessions.slice(0, count);
  }
  sessions.sort((a, b) => effectiveLastTime(a) - effectiveLastTime(b));

  const selected = options?.limit ? sessions.slice(0, options.limit) : sessions;
  const candidates: CleanupCandidate[] = [];
  let sizeEstimateBytes = 0;
  for (const session of selected) {
    const messageCount = await sessionDatabase.sessionMessages.where('sessionId').equals(session.id).count();
    const estimate = JSON.stringify(session).length + messageCount * ESTIMATED_BYTES_PER_MESSAGE;
    sizeEstimateBytes += estimate;
    candidates.push({
      lastMessageAt: session.lastMessageAt ?? session.updatedAt,
      messageCount,
      session,
      sizeEstimateBytes: estimate,
    });
  }
  return { candidates, sizeEstimateBytes, total: sessions.length };
};

export interface SessionExportFile {
  app: 'agentdock';
  criteria: CleanupCriteria | { ids: string[] };
  exportType: 'sessions';
  exportedAt: string;
  version: 1;
  sessions: SessionRecord[];
  messages: SessionMessageRecord[];
  checkpoints: RunCheckpointRecord[];
}

/**
 * 构建导出 JSON（纯数据，可测试）：按条件/ids 读取 sessions + messages + checkpoints。
 * 导出失败时不删除任何数据；checkpoints 默认包含（完整备份），可通过 includeCheckpoints: false 裁剪。
 */
export const buildSessionExport = async (
  criteria: CleanupCriteria | { ids: string[] },
  options?: { includeCheckpoints?: boolean },
): Promise<{ file: SessionExportFile; sizeBytes: number; total: number }> => {
  const exportedAt = new Date().toISOString();
  const ids = 'ids' in criteria
    ? criteria.ids
    : (await selectCleanupCandidates(criteria)).candidates.map((candidate) => candidate.session.id);
  if (ids.length === 0) {
    return {
      file: { app: 'agentdock', criteria, exportType: 'sessions', exportedAt, version: 1, sessions: [], messages: [], checkpoints: [] },
      sizeBytes: 0,
      total: 0,
    };
  }
  const includeCheckpoints = options?.includeCheckpoints !== false;
  const { sessions, messages, checkpoints } = await sessionDatabase.transaction(
    'r',
    [sessionDatabase.sessions, sessionDatabase.sessionMessages, sessionDatabase.checkpoints],
    async () => {
      const sessionRows = (await sessionDatabase.sessions.bulkGet(ids)).filter((row): row is SessionRecord => Boolean(row));
      const messageRows: SessionMessageRecord[] = [];
      const checkpointRows: RunCheckpointRecord[] = [];
      for (const session of sessionRows) {
        messageRows.push(...(await sessionDatabase.sessionMessages.where('sessionId').equals(session.id).toArray()));
        if (includeCheckpoints) {
          checkpointRows.push(...(await sessionDatabase.checkpoints.where('sessionId').equals(session.id).toArray()));
        }
      }
      return { checkpoints: checkpointRows, messages: messageRows, sessions: sessionRows };
    },
  );
  const file: SessionExportFile = { app: 'agentdock', criteria, exportType: 'sessions', exportedAt, version: 1, sessions, messages, checkpoints };
  return { file, sizeBytes: new Blob([JSON.stringify(file)]).size, total: sessions.length };
};

export const defaultExportFilename = (): string => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `agentdock-sessions-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
};

const downloadJSON = (file: SessionExportFile, filename: string): void => {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** 触发浏览器下载；Node 测试环境无 document 时静默跳过，返回文件名。 */
export const exportSessionFile = (file: SessionExportFile, filename = defaultExportFilename()): string => {
  const name = filename.endsWith('.json') ? filename : `${filename}.json`;
  downloadJSON(file, name);
  return name;
};

/** 级联删除会话（sessions + messages + checkpoints），完成后广播变更（含跨标签页）。 */
export const deleteSessions = async (ids: string[]): Promise<number> => {
  if (ids.length === 0) return 0;
  await sessionDatabase.transaction(
    'rw',
    [sessionDatabase.sessions, sessionDatabase.sessionMessages, sessionDatabase.checkpoints],
    async () => {
      for (const id of ids) {
        await sessionDatabase.sessions.delete(id);
        await sessionDatabase.sessionMessages.where('sessionId').equals(id).delete();
        await sessionDatabase.checkpoints.where('sessionId').equals(id).delete();
      }
    },
  );
  notifySessionsChanged();
  return ids.length;
};

export interface ExportAndDeleteResult {
  deleted: number;
  exported: number;
  filename: string;
  sizeBytes: number;
}

/**
 * 先导出、后删除：导出失败（含 0 条命中）不删除；删除失败时已下载的 JSON 仍可保留。
 */
export const exportAndDeleteSessions = async (
  criteria: CleanupCriteria | { ids: string[] },
  options?: {
    /** 删除前停止对应运行时；回调失败时保留全部数据。 */
    beforeDelete?: (ids: string[]) => Promise<void>;
    includeCheckpoints?: boolean;
  },
): Promise<ExportAndDeleteResult> => {
  const { file, sizeBytes, total } = await buildSessionExport(criteria, options);
  if (total === 0) return { deleted: 0, exported: 0, filename: '', sizeBytes: 0 };
  const filename = exportSessionFile(file);
  const ids = file.sessions.map((session) => session.id);
  await options?.beforeDelete?.(ids);
  const deleted = await deleteSessions(ids);
  return { deleted, exported: total, filename, sizeBytes };
};
