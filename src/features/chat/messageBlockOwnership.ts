import type { SessionMessageRecord } from '../../api/session/sessionHistoryService.ts';

const FALLBACK_PROCESS_HOST_ROLES = new Set(['assistantGroup', 'supervisor']);

/**
 * Resolve exactly one process-block host for every persisted run.
 *
 * LobeHub normally attaches reasoning/tools to the final assistant message. AgentDock can also
 * receive a native assistantGroup/supervisor message without a plain assistant message, so those
 * roles are the fallback host. Choosing only one host prevents duplicated process folds.
 */
export const findStoredProcessHosts = (
  records: SessionMessageRecord[],
): Map<string, string> => {
  const assistantHosts = new Map<string, string>();
  const fallbackHosts = new Map<string, string>();

  for (const record of records) {
    if (record.kind !== 'text' || !record.runId) continue;
    if (record.role === 'assistant') assistantHosts.set(record.runId, record.id);
    if (FALLBACK_PROCESS_HOST_ROLES.has(record.role || '')) {
      fallbackHosts.set(record.runId, record.id);
    }
  }

  for (const [runId, recordId] of fallbackHosts) {
    if (!assistantHosts.has(runId)) assistantHosts.set(runId, recordId);
  }
  return assistantHosts;
};

/** Native group/supervisor messages host live process blocks only when no plain assistant exists. */
export const findLiveProcessHostId = (
  records: SessionMessageRecord[],
  hasAssistantMessage: boolean,
): string | undefined => {
  if (hasAssistantMessage) return undefined;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record && FALLBACK_PROCESS_HOST_ROLES.has(record.role || '')) return record.id;
  }
  return undefined;
};
