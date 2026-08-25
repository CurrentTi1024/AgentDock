// @ 提及解析：@lobehub/editor 序列化为 `<mention name=".." id=".." />` 节点，
// 同时兼容旧版纯文本 `@Name`，统一映射为 forwardedProps.mentionAgents。
import type { MentionAgent } from '@/api/market/agentMarketService';
import type { MentionAgentRef } from '@/api/runtime/types';

const MENTION_TAG_REGEX = /<mention\s+name="([^"]*)"\s+id="([^"]*)"\s*\/?>/g;
const TEXT_MENTION_REGEX = /@([^\s@<]+)/g;

const stripTrailingPunctuation = (token: string) =>
  token.replace(/[，。；：！？,.;:!?)\]}]+$/g, '');

/**
 * 从消息文本解析全部 @ 提及，映射到候选 Agent 并去重。
 * 文本保留 <mention> 节点（LLM 可见），结构化结果用于 forwardedProps.mentionAgents。
 */
export const parseMentionedAgents = (
  content: string,
  candidates: MentionAgent[],
): MentionAgentRef[] => {
  const result: MentionAgentRef[] = [];
  const seen = new Set<string>();
  const push = (candidate: MentionAgent) => {
    const key = `${candidate.agentId}@${candidate.fab}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({
      agentId: candidate.agentId,
      agentName: candidate.agentFullName,
      fab: candidate.fab,
      version: candidate.version,
    });
  };

  // 1) 编辑器序列化的 <mention name id /> 节点
  let match: RegExpExecArray | null;
  while ((match = MENTION_TAG_REGEX.exec(content)) !== null) {
    const id = match[2];
    const tagName = match[1];
    const [agentId, fab] = id.split('@');
    const candidate =
      candidates.find((agent) => agent.agentId === agentId && agent.fab === fab) ??
      candidates.find((agent) => agent.agentFullName === tagName);
    if (candidate) push(candidate);
  }

  // 2) 兼容旧版纯文本 @Name（历史消息 / 手输）
  while ((match = TEXT_MENTION_REGEX.exec(content)) !== null) {
    const token = stripTrailingPunctuation(match[1]).toLowerCase();
    if (!token) continue;
    const candidate = candidates.find(
      (agent) =>
        agent.agentFullName.toLowerCase() === token || agent.agentId.toLowerCase() === token,
    );
    if (candidate) push(candidate);
  }
  return result;
};

/** 把 <mention name id /> 标记还原为 @Name 文本（用于会话标题等纯文本场景）。 */
export const sanitizeMentionMarkup = (content: string): string => {
  const complete = content.replace(
    /<mention\s+name="([^"]*)"\s+id="[^"]*"\s*\/?>/g,
    '@$1',
  );
  // 兼容早期被 slice 截断在标签中间的残缺 <mention 片段（旧数据标题）。
  return complete.replace(/<mention[^>]*/g, '');
};

/** 会话标题默认值：首条消息清理 <mention> 标记、折叠空白后取前 20 字符；空内容回退。 */
export const buildSessionTitle = (content: string, fallback: string): string => {
  const clean = sanitizeMentionMarkup(content).replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, 20) : fallback;
};
