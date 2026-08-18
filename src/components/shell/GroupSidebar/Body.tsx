// Adapted from: src/routes/(main)/group/_layout/Sidebar/Body + Topic (LobeHub canary, slim)
import { Flexbox, SearchBar, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { MessageSquare, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import NavItem from '@/components/shell/NavItem';
import { sessionHistoryService, type SessionRecord } from '@/api/session/sessionHistoryService';
import { useI18n } from '@/i18n';

const styles = createStaticStyles(({ css, cssVar }) => ({
  section: css`
    padding: 8px 10px 4px;
    color: ${cssVar.colorTextDescription};
    font-size: 11px;
    font-weight: 500;
  `,
}));

const GroupSidebarBody = () => {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<SessionRecord[]>([]);
  const [keyword, setKeyword] = useState('');

  useEffect(() => {
    const load = () => {
      void sessionHistoryService.listSessions().then(setGroups);
    };
    load();
    window.addEventListener('agentdock:sessions-changed', load);
    return () => window.removeEventListener('agentdock:sessions-changed', load);
  }, [location.pathname]);

  const visibleGroups = useMemo(() => {
    const query = keyword.toLowerCase();
    return groups
      .filter((session) => session.type === 'group')
      .filter((session) => !query || session.title.toLowerCase().includes(query))
      .slice(0, 20);
  }, [groups, keyword]);

  return (
    <Flexbox gap={2} paddingBlock={4}>
      <NavItem
        active={location.pathname.startsWith('/chat')}
        icon={MessageSquare}
        iconSize={15}
        title={t('nav.chat')}
        onClick={() => navigate('/chat/session-inbox')}
      />
      <Flexbox gap={6} paddingBlock={8} paddingInline={10}>
        <SearchBar
          placeholder={t('nav.searchHistory')}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
      </Flexbox>
      <div className={styles.section}>{t('nav.recentGroups')}</div>
      {visibleGroups.length === 0 ? (
        <Text fontSize={12} type="secondary" style={{ padding: '8px 12px' }}>
          {t('nav.emptyGroups')}
        </Text>
      ) : (
        visibleGroups.map((group) => (
          <NavItem
            key={group.id}
            active={location.pathname === `/group/${group.id}`}
            icon={Users}
            iconSize={15}
            title={group.title}
            onClick={() => navigate(`/group/${group.id}`)}
          />
        ))
      )}
    </Flexbox>
  );
};

export default GroupSidebarBody;
