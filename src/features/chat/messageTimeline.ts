import type { SessionMessageRecord } from '@/api/session/sessionHistoryService';

export interface StoredTextMessage {
  blocks: SessionMessageRecord[];
  record: SessionMessageRecord;
}

/**
 * 历史展示单元只选择同一 Run 的最后一个 assistant text 作为宿主。
 * 正文由 blocks 内的 timelineText 节点渲染，绝不从被合并的宿主复制内容。
 */
export interface DisplayUnit {
  blocks: SessionMessageRecord[];
  record: SessionMessageRecord;
}

export const buildDisplayUnits = (storedMessages: StoredTextMessage[]): DisplayUnit[] => {
  const units: DisplayUnit[] = [];
  for (const item of storedMessages) {
    const previous = units.at(-1);
    if (
      previous &&
      previous.record.role === 'assistant' &&
      item.record.role === 'assistant' &&
      previous.record.runId &&
      previous.record.runId === item.record.runId
    ) {
      previous.record = item.record;
      previous.blocks = item.blocks;
      continue;
    }
    units.push({ blocks: item.blocks, record: item.record });
  }
  return units;
};
