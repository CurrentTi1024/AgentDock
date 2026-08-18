// Selective adaptation of LobeHub main layout, NavigationBar, NavPanelDraggable
// and SideBarLayout. AgentDock changes only the product information architecture.
import { ActionIcon, Avatar, Flexbox, Icon, SearchBar, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Brain, FileText, LayoutGrid, ListTodo, MessageSquare, PanelLeftClose, Plus, Settings, Store, Users } from 'lucide-react';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { sessionHistoryService, type SessionRecord } from '@/services/session/sessionHistoryService';

const styles = createStaticStyles(({ css, cssVar }) => ({
  active: css`color: ${cssVar.colorText} !important; background: ${cssVar.colorFillSecondary} !important;`,
  nav: css`flex: none; border-inline-end: 1px solid ${cssVar.colorBorderSecondary}; background: ${cssVar.colorBgLayout};`,
  panel: css`flex: none; border-inline-end: 1px solid ${cssVar.colorBorderSecondary}; color: ${cssVar.colorTextSecondary}; background: ${cssVar.colorBgLayout}; @media (max-width: 900px) { display: none; }`,
  panelItem: css`cursor: pointer; border-radius: ${cssVar.borderRadius}px; color: ${cssVar.colorTextSecondary}; &:hover { color: ${cssVar.colorText}; background: ${cssVar.colorFillTertiary}; }`,
  section: css`padding: 8px 10px 4px; color: ${cssVar.colorTextDescription}; font-size: 11px; font-weight: 500;`,
  stage: css`position: relative; min-width: 0; flex: 1; background: ${cssVar.colorBgContainer};`,
}));

const primaryNav = [
  { icon: MessageSquare, label: 'Chat', path: '/chat' },
  { icon: Users, label: 'Chat Group', path: '/group' },
  { icon: ListTodo, label: '任务', path: '/tasks' },
  { icon: FileText, label: '文档', path: '/documents' },
  { icon: Brain, label: '记忆', path: '/memory' },
  { icon: Store, label: '商场', path: '/market' },
] as const;

const panelConfig = {
  chat: { action: '新建对话', items: [] as Array<readonly [string, string]>, search: '搜索历史对话', title: 'Chat' },
  group: { action: '新建 Chat Group', items: [['/group/flight-review', '飞行评审小组'], ['/group/code-quality', '代码质量小组']], search: '搜索 Chat Group', title: 'Chat Group' },
  tasks: { action: '新建任务', items: [['/tasks/today', '今天'], ['/tasks/scheduled', '定时任务'], ['/tasks/completed', '已完成']], search: '搜索任务', title: '任务' },
  documents: { action: '新建文档', items: [['/documents/recent', '最近文档'], ['/documents/shared', '共享给我']], search: '搜索文档', title: '文档' },
  memory: { action: '新建记忆', items: [['/memory/all', '全部记忆'], ['/memory/profile', '个人信息'], ['/memory/preferences', '偏好']], search: '搜索记忆', title: '记忆' },
  market: { action: undefined, items: [['/market/agent', 'Agent'], ['/market/skill', 'Skill'], ['/market/mcp', 'MCP']], search: '搜索商场', title: '商场' },
  settings: { action: undefined, items: [['/settings/general', '通用设置'], ['/settings/appearance', '外观'], ['/settings/about', '关于']], search: '搜索设置', title: '设置' },
} as const;

type PanelKey = keyof typeof panelConfig;

const resolvePanelKey = (pathname: string): PanelKey => {
  const first = pathname.split('/')[1] as PanelKey;
  return first in panelConfig ? first : 'chat';
};

export default function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [panelVisible, setPanelVisible] = useState(true);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const panelKey = resolvePanelKey(location.pathname);
  const panel = panelConfig[panelKey];
  const activePrimary = useMemo(() => primaryNav.find((item) => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`))?.path, [location.pathname]);
  useEffect(() => { if (panelKey === 'chat') void sessionHistoryService.listSessions().then(setSessions); }, [location.pathname, panelKey]);
  const panelItems: ReadonlyArray<readonly [string, string]> = panelKey === 'chat' ? sessions.filter((session) => session.type === 'agent').map((session) => [`/chat/${session.id}`, session.title] as const) : panel.items;
  const createForPanel = async () => {
    if (panelKey !== 'chat') { navigate(`/${panelKey}/new`); return; }
    const session = await sessionHistoryService.createSession({ agentId: 'flight-analysis', agentName: 'FlightAnalysis_Agent', fab: 'F15B', pinned: false, threadId: crypto.randomUUID(), title: '新对话', type: 'agent', version: '2.1.0' });
    setSessions((value) => [session, ...value]); navigate(`/chat/${session.id}`);
  };

  return <Flexbox horizontal height="100%" width="100%">
    <Flexbox align="center" className={styles.nav} justify="space-between" paddingBlock={12} width={64}>
      <Flexbox align="center" gap={8}>
        <Avatar avatar="◉" shape="square" size={36} />
        {primaryNav.map(({ path, label, icon }) => <Tooltip key={path} placement="right" title={label}><ActionIcon aria-label={label} className={activePrimary === path ? styles.active : undefined} icon={icon} size="large" onClick={() => { setPanelVisible(true); navigate(path); }} /></Tooltip>)}
      </Flexbox>
      <Flexbox align="center" gap={8}>
        <Tooltip placement="right" title="设置"><ActionIcon aria-label="设置" className={panelKey === 'settings' ? styles.active : undefined} icon={Settings} size="large" onClick={() => { setPanelVisible(true); navigate('/settings/general'); }} /></Tooltip>
        <Avatar avatar="LC" size={32} />
      </Flexbox>
    </Flexbox>

    {panelVisible && <Flexbox className={styles.panel} gap={1} width={260} style={{ overflow: 'hidden' }}>
      <Flexbox horizontal align="center" height={56} justify="space-between" paddingInline={12}><Text weight="bold">{panel.title}</Text><ActionIcon icon={PanelLeftClose} size="small" onClick={() => setPanelVisible(false)} /></Flexbox>
      <Flexbox paddingBlock={4} paddingInline={12}><SearchBar placeholder={panel.search} /></Flexbox>
      <Flexbox flex={1} gap={2} padding={8} style={{ overflowY: 'auto' }}>
        {panel.action && <Flexbox horizontal align="center" className={styles.panelItem} gap={10} padding="9px 10px" onClick={() => void createForPanel()}><Icon icon={Plus} size={16} /><Text>{panel.action}</Text></Flexbox>}
        <div className={styles.section}>{panelKey === 'market' ? '资源类型' : panelKey === 'chat' ? '最近对话' : panel.title}</div>
        {panelItems.map(([path, label]) => <Flexbox key={path} horizontal align="center" className={`${styles.panelItem} ${location.pathname === path || location.pathname.startsWith(`${path}/`) ? styles.active : ''}`} gap={10} padding="9px 10px" onClick={() => navigate(path)}><Icon icon={LayoutGrid} size={15} /><Text ellipsis>{label}</Text></Flexbox>)}
      </Flexbox>
    </Flexbox>}
    <Flexbox className={styles.stage}>{children}</Flexbox>
  </Flexbox>;
}
