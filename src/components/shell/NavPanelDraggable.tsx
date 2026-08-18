// Adapted from: src/features/NavPanel/components/NavPanelDraggable.tsx (LobeHub canary)
import { DraggablePanel } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type ReactNode } from 'react';
import { memo } from 'react';

import { useUiStore } from '@/stores/uiStore';

const styles = createStaticStyles(({ css, cssVar }) => ({
  panel: css`
    user-select: none;
    height: 100%;
    color: ${cssVar.colorTextSecondary};
    background: ${cssVar.colorBgLayout};
  `,
}));

const NavPanelDraggable = memo<{ children: ReactNode }>(({ children }) => {
  const expand = useUiStore((s) => s.leftPanelExpand);
  const width = useUiStore((s) => s.leftPanelWidth);
  const setWidth = useUiStore((s) => s.setLeftPanelWidth);
  const toggleLeftPanel = useUiStore((s) => s.toggleLeftPanel);

  return (
    <DraggablePanel
      className={styles.panel}
      defaultSize={{ height: '100%', width }}
      expand={expand}
      expandable={false}
      maxWidth={480}
      minWidth={240}
      placement="left"
      showBorder={false}
      onExpandChange={toggleLeftPanel}
      onSizeDragging={(_, size) => {
        if (size && typeof size.width === 'number') setWidth(size.width);
      }}
    >
      {children}
    </DraggablePanel>
  );
});

NavPanelDraggable.displayName = 'NavPanelDraggable';

export default NavPanelDraggable;
