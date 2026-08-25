// Adapted from: src/features/AgentSidebar/Header/Nav + Body/Topic (LobeHub canary)
// Agent 会话侧边栏：开启新话题 / 搜索 / 话题折叠区（该 Agent 的历史会话，IndexedDB 落库）。
import { Flexbox, SearchBar, Text } from '@lobehub/ui';
import { MessageSquarePlus } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import NavItem from '@/components/shell/NavItem';
import SidebarSection from '@/components/shell/SidebarSection';
import { sessionHistoryService, type SessionRecord } from '@/api/session/sessionHistoryService';
import { buildAgentSessionPath } from '@/features/chat/agentIdentity';
import { sanitizeMentionMarkup } from '@/features/chat/mentions';
import { useI18n } from '@/i18n';

const TOPIC_PAGE_SIZE = 30;

interface AgentSidebarBodyProps {
  agentId: string;
  agentName: string;
  fab: string;
  onNewTopic: () => void;
}

const AgentSidebarBody = memo<AgentSidebarBodyProps>(
  ({ agentId, agentName, fab, onNewTopic }) => {
    const { t } = useI18n();
    const location = useLocation();
    const navigate = useNavigate();
    const [sessions, setSessions] = useState<SessionRecord[]>([]);
    const [keyword, setKeyword] = useState('');
    const [topicLimit, setTopicLimit] = useState(TOPIC_PAGE_SIZE);

    useEffect(() => {
      const load = () => {
        void sessionHistoryService.listSessionsByAgent(agentId, fab).then(setSessions);
      };
      load();
      window.addEventListener('agentdock:sessions-changed', load);
      window.addEventListener('focus', load);
      document.addEventListener('visibilitychange', load);
      return () => {
        window.removeEventListener('agentdock:sessions-changed', load);
        window.removeEventListener('focus', load);
        document.removeEventListener('visibilitychange', load);
      };
    }, [agentId, fab]);

    // 话题 = 同一 Agent（agentId + fab）的历史会话，走 [agentId+fab] 索引；分页展示。
    useEffect(() => {
      setTopicLimit(TOPIC_PAGE_SIZE);
    }, [agentId, fab]);

    const filteredAll = useMemo(() => {
      const query = keyword.toLowerCase();
      return sessions
        .filter((session) => !query || `${session.title}${agentName}`.toLowerCase().includes(query));
    }, [agentName, keyword, sessions]);
    const filteredTopics = filteredAll.slice(0, topicLimit);
    const hasMoreTopics = filteredAll.length > topicLimit;

    return (
      <Flexbox gap={2} paddingBlock={4}>
        <NavItem
          icon={MessageSquarePlus}
          title={t('agentSidebar.newTopic')}
          onClick={onNewTopic}
        />
        <Flexbox gap={6} paddingBlock={6} paddingInline={10}>
          <SearchBar
            placeholder={t('nav.searchHistory')}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </Flexbox>
        <SidebarSection count={filteredTopics.length} title={t('agentSidebar.topics')}>
          <Flexbox gap={1} paddingBlock={1}>
            {filteredTopics.length === 0 ? (
              <Text fontSize={12} type="secondary" style={{ padding: '8px 12px' }}>
                {t('nav.emptySessions')}
              </Text>
            ) : (
              <>
                {filteredTopics.map((session) => (
                  <NavItem
                    active={location.pathname === `/chat/${session.id}`}
                    iconSize={15}
                    key={session.id}
                    title={sanitizeMentionMarkup(session.title)}
                    onClick={() =>
                      navigate(buildAgentSessionPath(session.id, session.agentId, session.fab))
                    }
                  />
                ))}
                {hasMoreTopics && (
                  <NavItem
                    iconSize={15}
                    title={t('common.loadMore')}
                    onClick={() => setTopicLimit((current) => current + TOPIC_PAGE_SIZE)}
                  />
                )}
              </>
            )}
          </Flexbox>
        </SidebarSection>
      </Flexbox>
    );
  },
);

AgentSidebarBody.displayName = 'AgentSidebarBody';

export default AgentSidebarBody;
