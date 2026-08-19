// Adapted from: src/routes/(main)/_layout + src/features/NavPanel/Shell (LobeHub canary)
import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { message } from 'antd';
import { type ReactNode, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import DesktopLayoutContainer from '@/components/shell/DesktopLayoutContainer';
import AgentSidebar from '@/components/shell/AgentSidebar';
import GroupSidebar from '@/components/shell/GroupSidebar';
import HomeSidebar from '@/components/shell/HomeSidebar';
import NavPanelDraggable from '@/components/shell/NavPanelDraggable';
import GroupCreateModal from '@/features/group/GroupCreateModal';
import { useI18n } from '@/i18n';

export default function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { t } = useI18n();
  const isGroup = location.pathname.startsWith('/group');
  // 进入具体 Agent 会话（/chat/:id，非默认 inbox）时展示 Agent 侧边栏（LobeHub agent chat 布局）。
  const isAgentChat = location.pathname.startsWith('/chat/') && !location.pathname.startsWith('/chat/session-inbox');

  useEffect(() => {
    const onBlocked = () => {
      message.warning(t('common.indexeddbBlocked'));
    };
    window.addEventListener('agentdock:indexeddb-blocked', onBlocked);
    return () => window.removeEventListener('agentdock:indexeddb-blocked', onBlocked);
  }, [t]);

  return (
    <Flexbox horizontal height="100%" style={{ background: cssVar.colorBgLayout }} width="100%">
      <NavPanelDraggable>
        {isGroup ? <GroupSidebar /> : isAgentChat ? <AgentSidebar /> : <HomeSidebar />}
      </NavPanelDraggable>
      <DesktopLayoutContainer>{children}</DesktopLayoutContainer>
      <GroupCreateModal />
    </Flexbox>
  );
}
