// Adapted from: src/features/NavHeader/index.tsx (LobeHub canary)
import { ActionIcon, Flexbox, TooltipGroup } from '@lobehub/ui';
import { PanelLeftOpen } from 'lucide-react';
import { type CSSProperties, type ReactNode } from 'react';
import { memo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useI18n } from '@/i18n';
import { useUiStore } from '@/stores/uiStore';

export interface NavHeaderProps {
  children?: ReactNode;
  className?: string;
  left?: ReactNode;
  right?: ReactNode;
  showTogglePanelButton?: boolean;
  style?: CSSProperties;
}

const NavHeader = memo<NavHeaderProps>(
  ({ children, className, left, right, showTogglePanelButton = true, style }) => {
    const { t } = useI18n();
    const [expand, toggleLeftPanel] = useUiStore(
      useShallow((s) => [s.leftPanelExpand, s.toggleLeftPanel]),
    );

    return (
      <Flexbox
        allowShrink
        horizontal
        align="center"
        flex="none"
        gap={4}
        height={44}
        justify="space-between"
        padding={8}
        className={className}
        style={style}
      >
        <TooltipGroup>
          <Flexbox
            allowShrink
            horizontal
            align="center"
            flex={1}
            gap={2}
            justify="flex-start"
            style={{ minWidth: 0 }}
          >
            {showTogglePanelButton && !expand && (
              <ActionIcon
                aria-label={t('nav.togglePanel')}
                icon={PanelLeftOpen}
                size="small"
                title={t('nav.togglePanel')}
                onClick={toggleLeftPanel}
              />
            )}
            {left}
          </Flexbox>
          {children && (
            <Flexbox flex={1} style={{ minWidth: 0 }}>
              {children}
            </Flexbox>
          )}
          <Flexbox horizontal align="center" gap={2} justify="flex-end">
            {right}
          </Flexbox>
        </TooltipGroup>
      </Flexbox>
    );
  },
);

NavHeader.displayName = 'NavHeader';

export default NavHeader;
