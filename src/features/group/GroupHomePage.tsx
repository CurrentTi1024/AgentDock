// Group home — LobeHub group list / create entry (adapted, slim)
import { Block, Button, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Plus, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { sessionHistoryService, type SessionRecord } from '@/api/session/sessionHistoryService';
import { useI18n } from '@/i18n';

const styles = createStaticStyles(({ css, cssVar }) => ({
  section: css`
    padding: 8px 4px 4px;
    color: ${cssVar.colorTextDescription};
    font-size: 11px;
    font-weight: 500;
  `,
}));

const GroupHomePage = () => {
  const navigate = useNavigate();
  const { t } = useI18n();
  const location = useLocation();
  const [groups, setGroups] = useState<SessionRecord[]>([]);
  const [groupLimit, setGroupLimit] = useState(10);
  const pendingSession = (location.state as { pendingSession?: SessionRecord } | null)?.pendingSession;

  useEffect(() => {
    const load = () => {
      void sessionHistoryService.listGroupSessions().then(setGroups);
    };
    load();
    window.addEventListener('agentdock:sessions-changed', load);
    return () => window.removeEventListener('agentdock:sessions-changed', load);
  }, []);

  const effectiveGroups = useMemo(() => {
    if (!pendingSession || pendingSession.type !== 'group') return groups;
    return groups.some((group) => group.id === pendingSession.id)
      ? groups
      : [pendingSession, ...groups];
  }, [groups, pendingSession]);
  const visibleGroups = effectiveGroups.slice(0, groupLimit);
  const hasMoreGroups = effectiveGroups.length > groupLimit;

  const createGroup = () => {
    const id = `group-${crypto.randomUUID()}`;
    const record = {
      agentId: 'group',
      agentName: 'FlightAnalysis_Group',
      fab: 'F15B',
      id,
      pinned: false,
      threadId: crypto.randomUUID(),
      title: t('nav.newGroup'),
      type: 'group' as const,
      version: '2.1.0',
    };
    // 与创建向导一致：先跳转、配置随路由状态携带；会话后台异步落库。
    navigate(`/group/${id}`, { state: { pendingSession: record } });
    void sessionHistoryService.createSession(record).catch((reason) => {
      console.warn('[AgentDock] group session persist failed', reason);
    });
  };

  return (
    <Flexbox style={{ height: '100%', overflowY: 'auto' }}>
      <Flexbox gap={16} style={{ margin: 'auto', maxWidth: 720, padding: '48px 24px', width: '100%' }}>
        <Flexbox align="center" gap={10}>
          <Icon color="inherit" icon={Users} size={40} />
          <Flexbox align="center" gap={4}>
            <Text as="h1" fontSize={24} weight={600}>
              {t('nav.group')}
            </Text>
            <Text type="secondary">{t('group.home.desc')}</Text>
          </Flexbox>
        </Flexbox>
        <Button block icon={Plus} size="large" type="primary" onClick={() => void createGroup()}>
          {t('group.home.create')}
        </Button>
        <div className={styles.section}>{t('nav.recentGroups')}</div>
        {visibleGroups.length === 0 ? (
          <Text fontSize={13} type="secondary" style={{ padding: '12px 4px' }}>
            {t('nav.emptyGroups')}
          </Text>
        ) : (
          visibleGroups.map((group) => (
            <Block
              clickable
              key={group.id}
              padding={16}
              variant="outlined"
              onClick={() => navigate(`/group/${group.id}`)}
            >
              <Flexbox horizontal align="center" justify="space-between">
                <Flexbox horizontal align="center" gap={10} style={{ minWidth: 0 }}>
                  <Icon color="inherit" icon={Users} size={20} />
                  <Flexbox style={{ minWidth: 0 }}>
                    <Text ellipsis weight={500}>
                      {group.title}
                    </Text>
                    <Text fontSize={12} type="secondary">
                      {new Date(group.updatedAt).toLocaleString()}
                    </Text>
                  </Flexbox>
                </Flexbox>
                <Tag>{t('workspace.group.members')}</Tag>
              </Flexbox>
            </Block>
          ))
        )}
        {hasMoreGroups && (
          <Button block onClick={() => setGroupLimit((current) => current + 10)}>
            {t('common.loadMore')}
          </Button>
        )}
      </Flexbox>
    </Flexbox>
  );
};

export default GroupHomePage;
