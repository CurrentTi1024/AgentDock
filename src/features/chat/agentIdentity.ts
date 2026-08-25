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
 * 从 /chat/:id 路由 pathname 解析会话 id。
 * AgentSidebar 渲染在 <Routes> 外部（AppShell 侧栏），useParams() 拿不到路由参数，
 * 必须从 location.pathname 解析，否则会话永远加载不到、身份解析回退到「对话」。
 */
export const parseAgentChatSessionId = (pathname: string): string | undefined =>
  pathname.match(/^\/chat\/([^/?#]+)/)?.[1];

/** 按 agentId+fab 解析 Agent 图标（未匹配返回 undefined，由调用方兜底默认图标）。 */
export const resolveAgentIcon = (
  mentions: MentionAgent[],
  agentId?: string,
  fab?: string,
): string | undefined =>
  agentId && fab
    ? mentions.find((mention) => mention.agentId === agentId && mention.fab === fab)?.icon
    : undefined;

/** 构造 Agent 会话 URL：一律携带 agentId+fab，保证侧边栏/输入框/话题过滤一致。 */
export const buildAgentSessionPath = (
  sessionId: string,
  agentId?: string,
  fab?: string,
): string => {
  if (agentId && fab) {
    return `/chat/${sessionId}?agent=${encodeURIComponent(agentId)}&fab=${encodeURIComponent(fab)}`;
  }
  return `/chat/${sessionId}`;
};

/**
 * Agent 会话侧边栏身份解析，优先级：
 * 1. pendingSession：切换 Agent 后新会话尚未落库时立即生效，
 *    避免闪回旧 Agent 或显示默认「对话」；
 * 2. URL ?agent=&fab= 在可提及 Agent 列表中的匹配项：显式指定优先，
 *    避免「创建时 selectedAgent 未就绪、会话记录落成 flight-analysis 兜底」导致显示错 Agent；
 * 3. 已落库 session：普通会话（无显式指定）的权威记录。
 */
export const resolveAgentSidebarIdentity = (
  agents: MentionAgent[],
  sources: AgentIdentitySources,
): AgentIdentity | undefined => {
  const { pendingSession, queryAgent, queryFab, session } = sources;
  if (pendingSession) {
    // pendingSession 记录没有 icon 字段，按 agentId+fab 从候选列表补头像/名称，
    // 否则切换 Agent 后 Home 右侧头像回落到默认 🛩️。
    const match =
      pendingSession.agentId && pendingSession.fab
        ? agents.find(
            (agent) => agent.agentId === pendingSession.agentId && agent.fab === pendingSession.fab,
          )
        : undefined;
    return {
      agentId: pendingSession.agentId,
      agentName: match?.agentFullName || pendingSession.agentName || pendingSession.title,
      fab: pendingSession.fab,
      icon: match?.icon,
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
  if (session) {
    // agentName 尚未回填时用 agents 列表按 agentId+fab 补全名称与图标，
    // 避免新会话短暂显示「新对话」/「对话」。
    const match =
      session.agentId && session.fab
        ? agents.find((agent) => agent.agentId === session.agentId && agent.fab === session.fab)
        : undefined;
    return {
      agentId: session.agentId,
      agentName: match?.agentFullName || session.agentName || session.title,
      fab: session.fab,
      icon: match?.icon,
    };
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

export type ChatRouteQueryAction =
  | { type: 'keep' }
  | { type: 'strip' }
  | { type: 'set'; agent: string; fab: string };

/**
 * 会话 URL 的 agentId+fab 路由守卫与归一化：
 * - URL 已带参数：仅当 agentId+fab 在当前用户可用的 mentionAgents 列表中才保留，
 *   否则返回 strip（移除参数，防止手改 URL 访问无权限 Agent）；
 * - URL 未带参数且会话可解析：返回 set（补上会话的 agentId+fab，保证侧边栏/
 *   话题过滤/输入框默认选中三者一致）；会话 Agent 已无权限时不动 URL。
 * mentions 为空（候选尚未加载）时无法判断，返回 keep 由调用方在加载完成后重试。
 */
export const resolveChatRouteQuery = (
  mentions: MentionAgent[],
  params: { agent: string | null; fab: string | null },
  session?: Pick<SessionRecord, 'agentId' | 'fab'> | null,
): ChatRouteQueryAction => {
  if (!mentions.length) return { type: 'keep' };
  const { agent, fab } = params;
  if (agent && fab) {
    const allowed = mentions.some((item) => item.agentId === agent && item.fab === fab);
    return allowed ? { type: 'keep' } : { type: 'strip' };
  }
  if (session?.agentId && session.fab) {
    const allowed = mentions.some(
      (item) => item.agentId === session.agentId && item.fab === session.fab,
    );
    if (allowed) return { type: 'set', agent: session.agentId, fab: session.fab };
  }
  return { type: 'keep' };
};
