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
