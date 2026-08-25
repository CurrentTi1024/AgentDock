// Adapted from: src/features/AgentSidebar (LobeHub canary)
// Agent 会话页侧边栏：Header（Agent 名 + 切换）+ Body（新话题/搜索/话题折叠）。
// 切换 Agent 采用「先跳转 + 路由携带 pendingSession + 后台落库」，身份解析
// 必须同时覆盖 pendingSession / 已落库 session / URL ?agent=&fab= 三个来源，
// 否则切换瞬间头部闪回旧 Agent（或显示「对话」），话题列表也按错 agentId+fab 过滤。
import { Flexbox } from '@lobehub/ui';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { agentMarketService, type MentionAgent } from '@/api/market/agentMarketService';
import {
  sessionHistoryService,
  subscribeSessionChanges,
  type SessionRecord,
} from '@/api/session/sessionHistoryService';
import SideBarLayout from '@/components/shell/SideBarLayout';
import {
  parseAgentChatSessionId,
  resolveAgentSidebarIdentity,
} from '@/features/chat/agentIdentity';
import { useI18n } from '@/i18n';

import Body from './Body';
import Header from './Header';

const AgentSidebar = memo(() => {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  // 侧边栏渲染在 <Routes> 外部，useParams() 拿不到路由参数；
  // 会话 id 必须从 location.pathname 解析，否则 getSession/话题过滤永远不生效。
  const id = parseAgentChatSessionId(location.pathname);
  const [session, setSession] = useState<SessionRecord>();
  const [agents, setAgents] = useState<MentionAgent[]>([]);

  // 导航携带的待落库会话：切换 Agent 后新会话尚未写入 IndexedDB，
  // 不能只依赖 getSession(id)（异步竞态下会闪回旧 Agent / 默认「对话」）。
  const pendingSession = useMemo(() => {
    const pending = (location.state as { pendingSession?: SessionRecord } | null)?.pendingSession;
    return pending && id && pending.id === id ? pending : undefined;
  }, [id, location.state]);

  const identity = useMemo(
    () =>
      resolveAgentSidebarIdentity(agents, {
        pendingSession,
        queryAgent: searchParams.get('agent'),
        queryFab: searchParams.get('fab'),
        session,
      }),
    [agents, pendingSession, searchParams, session],
  );
  const agentName = identity?.agentName ?? t('nav.chat');
  const agentId = identity?.agentId ?? 'flight-analysis';
  const fab = identity?.fab ?? 'F15B';
  const icon = identity?.icon;

  // 已落库 session 是权威身份：进入会话时读取；切换 Agent 的 createSession 是异步的，
  // 订阅 sessions-changed 在落库完成后重读，让头部/话题列表跟随最新记录。
  useEffect(() => {
    if (!id) return;
    const load = () => {
      void sessionHistoryService.getSession(id).then((row) => setSession(row ?? undefined));
    };
    load();
    return subscribeSessionChanges(load);
  }, [id]);

  useEffect(() => {
    void agentMarketService
      .getMentionAgentsList({ locale: 'zh-CN' })
      .then(({ items }) => setAgents(items))
      .catch(() => setAgents([]));
  }, []);

  const openAgentChat = useCallback(
    (agent: MentionAgent) => {
      const newId = `session-${crypto.randomUUID()}`;
      const record = {
        agentId: agent.agentId,
        agentName: agent.agentFullName,
        fab: agent.fab,
        id: newId,
        pinned: false,
        threadId: crypto.randomUUID(),
        title: agent.agentFullName,
        type: 'agent' as const,
        version: agent.version,
      };
      navigate(`/chat/${newId}?agent=${encodeURIComponent(agent.agentId)}&fab=${encodeURIComponent(agent.fab)}`, {
        state: { pendingSession: record },
      });
      void sessionHistoryService.createSession(record).catch((reason) => {
        console.warn('[AgentDock] agent session persist failed', reason);
      });
    },
    [navigate],
  );

  const newTopic = useCallback(() => {
    const current = agents.find((agent) => agent.agentId === agentId && agent.fab === fab);
    if (current) {
      openAgentChat(current);
      return;
    }
    const newId = `session-${crypto.randomUUID()}`;
    const record = {
      agentId,
      agentName,
      fab,
      id: newId,
      pinned: false,
      threadId: crypto.randomUUID(),
      title: agentName,
      type: 'agent' as const,
    };
    navigate(`/chat/${newId}?agent=${encodeURIComponent(agentId)}&fab=${encodeURIComponent(fab)}`, {
      state: { pendingSession: record },
    });
    void sessionHistoryService.createSession(record).catch((reason) => {
      console.warn('[AgentDock] agent session persist failed', reason);
    });
  }, [agentId, agentName, agents, fab, navigate, openAgentChat]);

  return (
    <Flexbox height="100%" style={{ overflow: 'hidden' }}>
      <SideBarLayout
        body={
          <Body
            agentId={agentId}
            agentName={agentName}
            fab={fab}
            onNewTopic={newTopic}
          />
        }
        header={
          <Header
            agentName={agentName}
            agents={agents}
            fab={fab}
            icon={icon}
            onSwitchAgent={openAgentChat}
          />
        }
      />
    </Flexbox>
  );
});

AgentSidebar.displayName = 'AgentSidebar';

export default AgentSidebar;
