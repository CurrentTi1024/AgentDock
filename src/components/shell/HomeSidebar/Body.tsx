// Adapted from: src/features/HomeSidebar/Body + Home/Recents + Body/Agent (LobeHub canary)
// 侧边栏结构对齐 LobeHub 主页：顶部搜索 + 功能导航（chat/群聊/任务/文档/商城/记忆/channel/文件）、
// 下方「最近对话」手风琴、再下方「Agents」手风琴（直接展开有权限的全部 Agent，数据来自 getMentionAgentsList）。
import {
  ActionIcon,
  Avatar,
  Flexbox,
  SearchBar,
  Text,
} from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ArrowRight,
  Brain,
  ChevronDown,
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
import { useI18n } from '@/i18n';
import { useUiStore } from '@/stores/uiStore';

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  section: css`
    padding: 8px 10px 4px;
    color: ${token.colorTextDescription};
    font-size: 11px;
    font-weight: 500;
  `,
  accordionTitle: css`
    font-size: 12px;
    font-weight: 500;
    color: ${token.colorTextSecondary};
  `,
}));

// LobeHub Accordion 的轻量替代（framer-motion 未引入）：折叠区标题 + 展开箭头 + hover 操作。
const SidebarSection = ({
  action,
  children,
  defaultExpand = true,
  title,
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
  defaultExpand?: boolean;
  title: React.ReactNode;
}) => {
  const [open, setOpen] = useState(defaultExpand);
  return (
    <Flexbox gap={2}>
      <Flexbox
        horizontal
        align="center"
        justify="space-between"
        paddingBlock={7}
        paddingInline={10}
        style={{ cursor: 'pointer' }}
        onClick={() => setOpen((value) => !value)}
      >
        <Flexbox horizontal align="center" gap={4}>
          <ChevronDown
            size={12}
            style={{
              color: cssVar.colorTextDescription,
              transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 200ms ease',
            }}
          />
          {title}
        </Flexbox>
        {action}
      </Flexbox>
      {open && children}
    </Flexbox>
  );
};

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
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const thisMonthOnly = useUiStore((s) => s.thisMonthOnly);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [agents, setAgents] = useState<MentionAgent[]>([]);
  const [marketOpen, setMarketOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const pendingSession = (location.state as { pendingSession?: SessionRecord } | null)?.pendingSession;

  useEffect(() => {
    const load = () => {
      if (!thisMonthOnly || isActive(location.pathname, '/chat')) {
        void sessionHistoryService.listSessions().then(setSessions);
      }
    };
    const applyPending = () => {
      if (!pendingSession) return;
      setSessions((current) =>
        current.some((session) => session.id === pendingSession.id)
          ? current
          : [pendingSession, ...current],
      );
    };
    const refresh = () => {
      applyPending();
      load();
    };
    applyPending();
    load();
    window.addEventListener('agentdock:sessions-changed', load);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('agentdock:sessions-changed', load);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [location.pathname, pendingSession, thisMonthOnly]);

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

  const visibleSessions = useMemo(() => {
    const query = keyword.toLowerCase();
    return sessions
      .filter((session) => !query || `${session.title}${session.agentName || ''}`.toLowerCase().includes(query))
      .slice(0, 20);
  }, [keyword, sessions]);

  const visibleModules = moduleItems.filter((item) => !thisMonthOnly || item.month);
  const menuLabels: Record<string, string> = {
    channel: t('nav.channel'),
    chat: t('nav.chat'),
    documents: t('nav.documents'),
    files: t('nav.files'),
    group: t('nav.group'),
    memory: t('nav.memory'),
    tasks: t('nav.tasks'),
  };
  const marketActive = location.pathname.startsWith('/market');
  const filteredAgents = keyword
    ? agents.filter((agent) =>
        `${agent.agentFullName}${agent.fab}`.toLowerCase().includes(keyword.toLowerCase()),
      )
    : agents;

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

      <SidebarSection title={<span className={styles.accordionTitle}>{t('nav.recent')}</span>}>
        <Flexbox gap={1} paddingBlock={1}>
          {visibleSessions.length === 0 ? (
            <Text fontSize={12} type="secondary" style={{ padding: '8px 12px' }}>
              {t('nav.emptySessions')}
            </Text>
          ) : (
            visibleSessions.map((session) => {
              const group = session.type === 'group';
              return (
                <NavItem
                  key={session.id}
                  active={isActive(location.pathname, group ? `/group/${session.id}` : `/chat/${session.id}`)}
                  icon={group ? Users : MessageSquare}
                  iconSize={15}
                  title={session.title}
                  onClick={() => navigate(group ? `/group/${session.id}` : `/chat/${session.id}`)}
                />
              );
            })
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
        title={<span className={styles.accordionTitle}>{t('nav.agents')}</span>}
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
                  <Text ellipsis fontSize={11} type="secondary">
                    v{agent.version} · {agent.fab}
                  </Text>
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
