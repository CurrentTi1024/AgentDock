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
import type { StorageUsage } from '@/api/session/sessionStorageService';

export default function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { t } = useI18n();
  const isGroup = location.pathname.startsWith('/group');
  // /chat 为首页 hub（主页侧边栏）；进入具体 Agent 会话 /chat/:id 时展示 Agent 侧边栏。
  const isAgentChat = location.pathname.startsWith('/chat/');

  useEffect(() => {
    const onBlocked = () => {
      message.warning(t('common.indexeddbBlocked'));
    };
    const onStorageWarning = (event: Event) => {
      const detail = (event as CustomEvent<StorageUsage>).detail;
      message.warning(t('settings.storage.warningBanner', { percent: Math.round(detail.percent * 100) }));
    };
    const onStorageError = () => {
      message.error(t('settings.storage.error'));
    };
    window.addEventListener('agentdock:indexeddb-blocked', onBlocked);
    window.addEventListener('agentdock:storage-warning', onStorageWarning);
    window.addEventListener('agentdock:storage-error', onStorageError);
    return () => {
      window.removeEventListener('agentdock:indexeddb-blocked', onBlocked);
      window.removeEventListener('agentdock:storage-warning', onStorageWarning);
      window.removeEventListener('agentdock:storage-error', onStorageError);
    };
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
