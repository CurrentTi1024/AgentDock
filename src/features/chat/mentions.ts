// @ 提及工具：输入框联想（token 提取/替换）与发送前解析（@Name → mentionAgents）。
// 对齐 LobeHub：@ 选择只插入 @AgentName 文本，不改当前会话 Agent；发送时把结构化
// mentionAgents 放进 forwardedProps，后端据此启用 callAgent 委派。
import type { MentionAgent } from '@/api/market/agentMarketService';
import type { MentionAgentRef } from '@/api/runtime/types';

/** 去掉 token 尾部常见标点，避免 “@AgentName，请…” 匹配失败。 */
const stripTrailingPunctuation = (token: string) =>
  token.replace(/[，。；：！？,.;:!?)\]}]+$/g, '');

/**
 * 提取输入末尾的 @ 联想词：文本以“最后一个 @ + 无空白后缀”结尾时返回该后缀，
 * 否则返回 null（菜单关闭）。选中插入 @Name + 空格后自然关闭。
 */
export const extractMentionToken = (value: string): string | null => {
  const at = value.lastIndexOf('@');
  if (at < 0) return null;
  const token = value.slice(at + 1);
  if (/\s/.test(token)) return null;
  return stripTrailingPunctuation(token);
};

/** 用选中的 Agent 替换输入末尾的 @ 联想词，保留正文与多 @。 */
export const replaceMentionToken = (value: string, agentFullName: string): string => {
  const at = value.lastIndexOf('@');
  if (at < 0) return `${value}@${agentFullName} `;
  return `${value.slice(0, at)}@${agentFullName} `;
};

export interface MentionSegment {
  mention?: MentionAgent;
  text: string;
  type: 'mention' | 'text';
}

/**
 * 把输入文本切分为普通文本与 @提及 片段，供输入框叠加层渲染蓝色 chip。
 * 已匹配候选列表的 token 标记为 mention（显示 Agent 名），未匹配的按普通文本显示。
 */
export const tokenizeMentions = (value: string, candidates: MentionAgent[]): MentionSegment[] => {
  const segments: MentionSegment[] = [];
  const regex = /(@[^\s@]+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    if (match.index > last) segments.push({ text: value.slice(last, match.index), type: 'text' });
    const token = match[1];
    const name = stripTrailingPunctuation(token.slice(1)).toLowerCase();
    const mention = name
      ? candidates.find(
          (agent) =>
            agent.agentFullName.toLowerCase() === name || agent.agentId.toLowerCase() === name,
        )
      : undefined;
    segments.push(
      mention
        ? { mention, text: token, type: 'mention' }
        : { text: token, type: 'text' },
    );
    last = match.index + token.length;
  }
  if (last < value.length) segments.push({ text: value.slice(last), type: 'text' });
  return segments;
};

/**
 * 从消息文本解析全部 @Agent 提及，映射到候选 Agent 并去重。
 * 文本保留 @Name（LLM 可见），结构化结果用于 forwardedProps.mentionAgents。
 */
export const parseMentionedAgents = (
  content: string,
  candidates: MentionAgent[],
): MentionAgentRef[] => {
  const result: MentionAgentRef[] = [];
  const seen = new Set<string>();
  const regex = /@([^\s@]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const token = stripTrailingPunctuation(match[1]).toLowerCase();
    if (!token) continue;
    const candidate = candidates.find(
      (agent) =>
        agent.agentFullName.toLowerCase() === token || agent.agentId.toLowerCase() === token,
    );
    if (!candidate) continue;
    const key = `${candidate.agentId}@${candidate.fab}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      agentId: candidate.agentId,
      agentName: candidate.agentFullName,
      fab: candidate.fab,
      version: candidate.version,
    });
  }
  return result;
};
