// Adapted from: src/features/AgentSidebar (LobeHub canary)
// Agent 会话页侧边栏：Header（Agent 名 + 切换）+ Body（新话题/搜索/话题折叠）。
import { Flexbox } from '@lobehub/ui';
import { memo, useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { agentMarketService, type MentionAgent } from '@/api/market/agentMarketService';
import { sessionHistoryService } from '@/api/session/sessionHistoryService';
import SideBarLayout from '@/components/shell/SideBarLayout';
import { useI18n } from '@/i18n';

import Body from './Body';
import Header from './Header';

const AgentSidebar = memo(() => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [agentName, setAgentName] = useState(t('nav.chat'));
  const [agentId, setAgentId] = useState('flight-analysis');
  const [fab, setFab] = useState('F15B');
  const [agents, setAgents] = useState<MentionAgent[]>([]);

  useEffect(() => {
    if (!id) return;
    void sessionHistoryService.getSession(id).then((session) => {
      if (!session) return;
      setAgentName(session.agentName || session.title);
      setAgentId(session.agentId || 'flight-analysis');
      setFab(session.fab);
    });
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
            onSwitchAgent={openAgentChat}
          />
        }
      />
    </Flexbox>
  );
});

AgentSidebar.displayName = 'AgentSidebar';

export default AgentSidebar;
