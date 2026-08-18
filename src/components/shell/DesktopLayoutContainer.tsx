// Adapted from: src/routes/(main)/_layout/DesktopLayoutContainer.tsx (LobeHub canary)
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { type ReactNode } from 'react';
import { memo } from 'react';

import { useUiStore } from '@/stores/uiStore';

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  inner: css`
    position: relative;
    overflow: hidden;
    flex: 1;
    border: 1px solid ${token.colorBorder};
    border-radius: ${token.borderRadius};
    background: ${token.colorBgContainer};
  `,
  outer: css`
    position: relative;
    overflow: hidden;
    flex: 1;
    padding-block-start: 8px;
    background: ${cssVar.colorBgLayout};
  `,
}));

const DesktopLayoutContainer = memo<{ children: ReactNode }>(({ children }) => {
  const expand = useUiStore((s) => s.leftPanelExpand);

  return (
    <Flexbox className={styles.outer} height="100%" style={{ paddingInlineStart: expand ? 0 : 8 }} width="100%">
      <Flexbox className={styles.inner} height="100%" width="100%">
        {children}
      </Flexbox>
    </Flexbox>
  );
});

DesktopLayoutContainer.displayName = 'DesktopLayoutContainer';

export default DesktopLayoutContainer;
