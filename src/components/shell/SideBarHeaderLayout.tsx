// Adapted from: src/features/NavPanel/SideBarHeaderLayout.tsx (LobeHub canary)
import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ChevronLeftIcon, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';

import { useI18n } from '@/i18n';
import { useUiStore } from '@/stores/uiStore';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow: hidden;
  `,
}));

interface SideBarHeaderLayoutProps {
  backTo?: string;
  left?: ReactNode;
  right?: ReactNode;
  showBack?: boolean;
  showTogglePanelButton?: boolean;
}

const SideBarHeaderLayout = memo<SideBarHeaderLayoutProps>(
  ({ backTo = '/', left, right, showBack = true, showTogglePanelButton = true }) => {
    const navigate = useNavigate();
    const { t } = useI18n();
    const [expand, toggleLeftPanel] = useUiStore(
      useShallow((s) => [s.leftPanelExpand, s.toggleLeftPanel]),
    );

    return (
      <Flexbox
        horizontal
        align="center"
        className={styles.container}
        flex="none"
        justify="space-between"
        padding="8px 6px"
      >
        <Flexbox horizontal align="center" flex={1} gap={2} style={{ minWidth: 0 }}>
          {showBack && (
            <ActionIcon icon={ChevronLeftIcon} size="small" onClick={() => navigate(backTo)} />
          )}
          {left && typeof left === 'string' ? (
            <Text ellipsis fontSize={16} weight={500}>
              {left}
            </Text>
          ) : (
            left
          )}
        </Flexbox>
        <Flexbox horizontal align="center" gap={2} justify="flex-end">
          {showTogglePanelButton && (
            <ActionIcon
              aria-label={t('nav.togglePanel')}
              icon={expand ? PanelLeftClose : PanelLeftOpen}
              size="small"
              title={t('nav.togglePanel')}
              onClick={toggleLeftPanel}
            />
          )}
          {right}
        </Flexbox>
      </Flexbox>
    );
  },
);

SideBarHeaderLayout.displayName = 'SideBarHeaderLayout';

export default SideBarHeaderLayout;
