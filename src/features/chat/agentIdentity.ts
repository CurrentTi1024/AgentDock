// Agent 会话身份解析（纯函数，node:test 可测）：
// - resolveAgentSidebarIdentity：Agent 侧边栏头部/话题列表的当前 Agent 身份。
// - resolveSessionAgent：输入框左下角「切换 Agent」默认选中的 Agent。
// 切换 Agent 时新会话是「先跳转、后异步落库」，身份必须能从导航 state / URL 立即解析，
// 否则侧边栏会闪回旧 Agent 或显示「对话」，话题列表也按错 agentId+fab 过滤。
import type { MentionAgent } from '@/api/market/agentMarketService';
import type { SessionRecord } from '@/api/session/sessionHistoryService';

export interface AgentIdentity {
  agentId?: string;
  agentName?: string;
  fab?: string;
  icon?: string;
}

export interface AgentIdentitySources {
  /** 当前路由会话的已落库记录（权威；切换后异步落库未完成时可能为 undefined）。 */
  session?: SessionRecord | null;
  /** 导航携带的待落库会话（仅当 id 与当前路由一致时传入）。 */
  pendingSession?: SessionRecord | null;
  /** URL 查询参数 ?agent=&fab=（刷新/直达链接）。 */
  queryAgent?: string | null;
  queryFab?: string | null;
}

/**
 * Agent 会话侧边栏身份解析，优先级：
 * 1. pendingSession：切换 Agent 后新会话尚未落库时立即生效，
 *    避免闪回旧 Agent 或显示默认「对话」；
 * 2. 已落库 session：权威记录（与 pendingSession 是同一 Agent，落库后自然覆盖）；
 * 3. URL ?agent=&fab= 在可提及 Agent 列表中的匹配项（刷新/直达链接）。
 */
export const resolveAgentSidebarIdentity = (
  agents: MentionAgent[],
  sources: AgentIdentitySources,
): AgentIdentity | undefined => {
  const { pendingSession, queryAgent, queryFab, session } = sources;
  if (pendingSession) {
    return {
      agentId: pendingSession.agentId,
      agentName: pendingSession.agentName || pendingSession.title,
      fab: pendingSession.fab,
    };
  }
  if (session) {
    return {
      agentId: session.agentId,
      agentName: session.agentName || session.title,
      fab: session.fab,
    };
  }
  if (queryAgent && queryFab) {
    const match = agents.find(
      (agent) => agent.agentId === queryAgent && agent.fab === queryFab,
    );
    if (match) {
      return {
        agentId: match.agentId,
        agentName: match.agentFullName,
        fab: match.fab,
        icon: match.icon,
      };
    }
  }
  return undefined;
};

/**
 * 从可提及 Agent 列表解析当前会话应绑定的 Agent：
 * - 会话已有 agentId+fab：精确匹配（找不到返回 undefined，绝不误绑列表第一项）；
 * - 会话还没有身份（新会话）：取列表第一项作为默认。
 */
export const resolveSessionAgent = (
  mentions: MentionAgent[],
  session?: Pick<SessionRecord, 'agentId' | 'fab'> | null,
): MentionAgent | undefined => {
  if (!mentions.length) return undefined;
  if (session?.agentId && session.fab) {
    return mentions.find(
      (mention) => mention.agentId === session.agentId && mention.fab === session.fab,
    );
  }
  return mentions[0];
};
