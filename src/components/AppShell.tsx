// Adapted from: src/routes/(main)/_layout + src/features/NavPanel/Shell (LobeHub canary)
import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import DesktopLayoutContainer from '@/components/shell/DesktopLayoutContainer';
import GroupSidebar from '@/components/shell/GroupSidebar';
import HomeSidebar from '@/components/shell/HomeSidebar';
import NavPanelDraggable from '@/components/shell/NavPanelDraggable';

export default function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const isGroup = location.pathname.startsWith('/group');

  return (
    <Flexbox horizontal height="100%" style={{ background: cssVar.colorBgLayout }} width="100%">
      <NavPanelDraggable>{isGroup ? <GroupSidebar /> : <HomeSidebar />}</NavPanelDraggable>
      <DesktopLayoutContainer>{children}</DesktopLayoutContainer>
    </Flexbox>
  );
}
