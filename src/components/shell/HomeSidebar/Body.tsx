// Adapted from: src/routes/(main)/home/_layout/Body + Header/components/Nav (LobeHub canary)
import { ActionIcon, Avatar, Flexbox, Icon, SearchBar, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import {
  Brain,
  FileCode2,
  FileText,
  LayoutGrid,
  ListTodo,
  MessageSquare,
  Plug,
  Store,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import NavItem from '@/components/shell/NavItem';
import { sessionHistoryService, type SessionRecord } from '@/api/session/sessionHistoryService';
import { useI18n } from '@/i18n';
import { useUiStore } from '@/stores/uiStore';

const styles = createStaticStyles(({ css, cssVar }) => ({
  section: css`
    padding: 8px 10px 4px;
    color: ${cssVar.colorTextDescription};
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
  { icon: FileCode2, key: 'artifact', label: 'Artifact', month: false, path: '/artifact' },
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

  const visibleSessions = useMemo(() => {
    const query = keyword.toLowerCase();
    return sessions
      .filter((session) => !query || `${session.title}${session.agentName || ''}`.toLowerCase().includes(query))
      .slice(0, 20);
  }, [keyword, sessions]);

  const visibleModules = moduleItems.filter((item) => !thisMonthOnly || item.month);
  const menuLabels: Record<string, string> = {
    artifact: t('nav.artifact'),
    channel: t('nav.channel'),
    chat: t('nav.chat'),
    documents: t('nav.documents'),
    group: t('nav.group'),
    memory: t('nav.memory'),
    tasks: t('nav.tasks'),
  };

  return (
    <Flexbox gap={2} paddingBlock={4}>
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

      <div className={styles.section}>{t('nav.sections.market')}</div>
      {marketItems.map((item) => (
        <NavItem
          key={item.path}
          active={isActive(location.pathname, item.path)}
          icon={Store}
          title={item.label === 'Agent' ? t('market.agent') : item.label === 'Skill' ? t('market.skill') : t('market.mcp')}
          onClick={() => navigate(item.path)}
        />
      ))}

      <Flexbox gap={6} paddingBlock={8} paddingInline={10}>
        <SearchBar
          placeholder={t('nav.searchHistory')}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
      </Flexbox>
      <div className={styles.section}>{t('nav.recent')}</div>
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
  );
};

export default Body;
