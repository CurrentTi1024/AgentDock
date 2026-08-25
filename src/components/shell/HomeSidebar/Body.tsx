// Adapted from: src/features/HomeSidebar/Body + Home/Recents + Body/Agent (LobeHub canary)
// 侧边栏结构对齐 LobeHub 主页：顶部搜索 + 功能导航（chat/群聊/任务/文档/商城/记忆/channel/文件）、
// 下方「最近对话」手风琴、再下方「Agents」手风琴（直接展开有权限的全部 Agent，数据来自 getMentionAgentsList）。
import { ActionIcon, Avatar, Flexbox, SearchBar, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ArrowRight,
  Brain,
  ChevronRight,
  FileCode2,
  FileText,
  ListTodo,
  MessageSquare,
  Plug,
  Store,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { agentMarketService, type MentionAgent } from '@/api/market/agentMarketService';
import { sessionHistoryService, type SessionRecord } from '@/api/session/sessionHistoryService';
import NavItem from '@/components/shell/NavItem';
import SidebarSection from '@/components/shell/SidebarSection';
import { buildAgentSessionPath } from '@/features/chat/agentIdentity';
import { useI18n } from '@/i18n';
import { formatRelativeTime } from '@/lib/relativeTime';
import { useSessionStore } from '@/stores/sessionStore';
import { useUiStore } from '@/stores/uiStore';

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  section: css`
    padding: 8px 10px 4px;
    color: ${token.colorTextDescription};
    font-size: 11px;
    font-weight: 500;
  `,
}));

interface MenuItem {
  icon: typeof MessageSquare;
  key: string;
  label: string;
  month: boolean;
  path: string;
}

const moduleItems: MenuItem[] = [
  { icon: MessageSquare, key: 'chat', label: 'chat', month: true, path: '/chat' },
  { icon: Users, key: 'group', label: 'Chat Group', month: false, path: '/group' },
  { icon: ListTodo, key: 'tasks', label: 'tasks', month: false, path: '/tasks' },
  { icon: FileText, key: 'documents', label: 'documents', month: false, path: '/documents' },
  { icon: Brain, key: 'memory', label: 'memory', month: false, path: '/memory' },
  { icon: Plug, key: 'channel', label: 'Channel', month: false, path: '/channel' },
  { icon: FileCode2, key: 'page', label: 'Page', month: false, path: '/page' },
  { icon: FileCode2, key: 'files', label: 'files', month: false, path: '/artifact' },
];

const marketItems = [
  { label: 'Agent', path: '/market/agent' },
  { label: 'Skill', path: '/market/skill' },
  { label: 'MCP', path: '/market/mcp' },
] as const;

const isActive = (pathname: string, path: string) =>
  pathname === path || pathname.startsWith(`${path}/`);

const Body = () => {
  const { locale, t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const thisMonthOnly = useUiStore((s) => s.thisMonthOnly);
  const sessions = useSessionStore((state) => state.sessions);
  const hasMoreSessions = useSessionStore((state) => state.hasMoreSessions);
  const loadMoreSessions = useSessionStore((state) => state.loadMoreSessions);
  const [agents, setAgents] = useState<MentionAgent[]>([]);
  const [marketOpen, setMarketOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [searchResults, setSearchResults] = useState<SessionRecord[] | undefined>();
  // 侧栏展示条数独立递增：store 窗口（50/页）与侧栏可见数（20/次）解耦，
  // 避免“点了加载更多但列表不变”（store 已涨、slice 仍固定 20）。
  const [displayLimit, setDisplayLimit] = useState(20);
  const pendingSession = (location.state as { pendingSession?: SessionRecord } | null)?.pendingSession;

  // 会话列表由 sessionStore 统一维护（分页窗口 + 跨标签页同步），这里只做首次加载。
  useEffect(() => {
    void useSessionStore.getState().refreshSessions();
  }, []);

  // 搜索时全量扫标题/Agent 名（searchSessions），浏览态用 store 分页窗口。
  useEffect(() => {
    const query = keyword.trim().toLowerCase();
    if (!query) {
      setSearchResults(undefined);
      return;
    }
    let cancelled = false;
    void sessionHistoryService.searchSessions(query).then((items) => {
      if (!cancelled) setSearchResults(items);
    });
    return () => {
      cancelled = true;
    };
  }, [keyword]);

  // 直接展开有权限的全部 Agent（LobeHub Agents 手风琴）：数据走 Service（mock 返回 mock 数据）。
  useEffect(() => {
    void agentMarketService
      .getMentionAgentsList({ locale: 'zh-CN' })
      .then(({ items }) => setAgents(items))
      .catch(() => setAgents([]));
  }, []);

  const openAgentChat = (agent: MentionAgent) => {
    const id = `session-${crypto.randomUUID()}`;
    const record = {
      agentId: agent.agentId,
      agentName: agent.agentFullName,
      fab: agent.fab,
      id,
      pinned: false,
      threadId: crypto.randomUUID(),
      title: agent.agentFullName,
      type: 'agent' as const,
      version: agent.version,
    };
    navigate(`/chat/${id}?agent=${encodeURIComponent(agent.agentId)}&fab=${encodeURIComponent(agent.fab)}`, {
      state: { pendingSession: record },
    });
    void sessionHistoryService.createSession(record).catch((reason) => {
      console.warn('[AgentDock] agent session persist failed', reason);
    });
  };

  const effectiveSessions = useMemo(() => {
    if (!pendingSession) return sessions;
    return sessions.some((session) => session.id === pendingSession.id)
      ? sessions
      : [pendingSession, ...sessions];
  }, [pendingSession, sessions]);

  // 本月模式且不在 /chat 时不展示最近对话（沿用原行为）。
  const showRecents = !thisMonthOnly || isActive(location.pathname, '/chat');
  const visibleSessions = useMemo(() => {
    if (searchResults) return searchResults.slice(0, 50);
    if (!showRecents) return [];
    return effectiveSessions.slice(0, displayLimit);
  }, [displayLimit, effectiveSessions, searchResults, showRecents]);
  const canLoadMore = hasMoreSessions || displayLimit < effectiveSessions.length;

  const visibleModules = moduleItems.filter((item) => !thisMonthOnly || item.month);
  const menuLabels: Record<string, string> = {
    channel: t('nav.channel'),
    chat: t('nav.chat'),
    documents: t('nav.documents'),
    files: t('nav.files'),
    group: t('nav.group'),
    memory: t('nav.memory'),
    page: t('nav.page'),
    tasks: t('nav.tasks'),
  };
  const marketActive = location.pathname.startsWith('/market');
  const filteredAgents = keyword
    ? agents.filter((agent) =>
        `${agent.agentFullName}${agent.fab}`.toLowerCase().includes(keyword.toLowerCase()),
      )
    : agents;

  // 会话 → 展示身份：Agent 会话取 mention 里的头像/名称，群聊用群头像 + 群名。
  const sessionIdentity = (session: SessionRecord) => {
    if (session.type === 'group') {
      return { icon: '👥', name: session.title };
    }
    const agent = agents.find(
      (item) => item.agentId === session.agentId && item.fab === session.fab,
    );
    return {
      icon: agent?.icon || '🤖',
      name: agent?.agentFullName || session.agentName || session.title,
    };
  };

  return (
    <Flexbox gap={2} paddingBlock={4}>
      <Flexbox gap={6} paddingBlock={6} paddingInline={10}>
        <SearchBar
          placeholder={t('nav.searchHistory')}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
      </Flexbox>

      <div className={styles.section}>{t('nav.sections.functions')}</div>
      {visibleModules.map((item) => (
        <NavItem
          key={item.key}
          active={isActive(location.pathname, item.path)}
          icon={item.icon}
          title={menuLabels[item.key] || item.label}
          onClick={() => navigate(item.path)}
        />
      ))}

      <NavItem
        active={marketActive}
        extra={
          <ChevronRight
            size={14}
            style={{
              transform: marketOpen ? 'rotate(90deg)' : 'none',
              transition: 'transform 200ms ease',
            }}
          />
        }
        icon={Store}
        title={t('nav.market')}
        onClick={() => setMarketOpen((open) => !open)}
      />
      {marketOpen && (
        <Flexbox gap={1} paddingInline={8}>
          {marketItems.map((item) => (
            <NavItem
              active={isActive(location.pathname, item.path)}
              iconSize={15}
              key={item.path}
              title={
                item.label === 'Agent'
                  ? t('market.agent')
                  : item.label === 'Skill'
                    ? t('market.skill')
                    : t('market.mcp')
              }
              onClick={() => navigate(item.path)}
            />
          ))}
        </Flexbox>
      )}

      <SidebarSection title={t('nav.recent')}>
        <Flexbox gap={1} paddingBlock={1}>
          {visibleSessions.length === 0 ? (
            <Text fontSize={12} type="secondary" style={{ padding: '8px 12px' }}>
              {t('nav.emptySessions')}
            </Text>
          ) : (
            visibleSessions.map((session) => {
              const group = session.type === 'group';
              const identity = sessionIdentity(session);
              return (
                <NavItem
                  key={session.id}
                  active={isActive(location.pathname, group ? `/group/${session.id}` : `/chat/${session.id}`)}
                  iconNode={
                    <Avatar
                      avatar={identity.icon}
                      shape="square"
                      size={22}
                      style={{ flex: 'none' }}
                    />
                  }
                  title={session.title}
                  description={
                    <Flexbox horizontal align="center" gap={6} style={{ overflow: 'hidden' }}>
                      <Text ellipsis fontSize={11} type="secondary">
                        {identity.name}
                      </Text>
                      <Text fontSize={11} type="secondary" style={{ flex: 'none' }}>
                        {formatRelativeTime(session.updatedAt, locale)}
                      </Text>
                    </Flexbox>
                  }
                  onClick={() =>
                    navigate(
                      group
                        ? `/group/${session.id}`
                        : buildAgentSessionPath(session.id, session.agentId, session.fab),
                    )
                  }
                />
              );
            })
          )}
          {!searchResults && canLoadMore && (
            <NavItem
              icon={ArrowRight}
              title={t('common.loadMore')}
              onClick={() => {
                setDisplayLimit((current) => current + 20);
                void loadMoreSessions();
              }}
            />
          )}
        </Flexbox>
      </SidebarSection>

      <SidebarSection
        action={
          <ActionIcon
            aria-label={t('nav.agents')}
            icon={ArrowRight}
            size="small"
            title={t('nav.agents')}
            onClick={() => navigate('/market/agent')}
          />
        }
        title={t('nav.agents')}
      >
        <Flexbox gap={1} paddingBlock={1}>
          {filteredAgents.length === 0 ? (
            <Text fontSize={12} type="secondary" style={{ padding: '8px 12px' }}>
              {t('nav.emptyAgents')}
            </Text>
          ) : (
            filteredAgents.map((agent) => (
              <NavItem
                iconNode={
                  <Avatar avatar={agent.icon || '🤖'} shape="square" size={22} style={{ flex: 'none' }} />
                }
                key={`${agent.agentId}@${agent.fab}`}
                title={agent.agentFullName}
                description={
                  <Flexbox gap={3}>
                    <Text ellipsis fontSize={11} type="secondary">
                      v{agent.version} · {agent.fab}
                    </Text>
                    <Text ellipsis fontSize={11} type="secondary">
                      {agent.description}
                    </Text>
                  </Flexbox>
                }
                onClick={() => openAgentChat(agent)}
              />
            ))
          )}
        </Flexbox>
      </SidebarSection>
    </Flexbox>
  );
};

export default Body;
