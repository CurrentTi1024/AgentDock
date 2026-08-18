// Adapted from: src/features/NavHeader/index.tsx (LobeHub canary)
import { Flexbox, TooltipGroup } from '@lobehub/ui';
import { type CSSProperties, type ReactNode } from 'react';
import { memo } from 'react';

export interface NavHeaderProps {
  children?: ReactNode;
  className?: string;
  left?: ReactNode;
  right?: ReactNode;
  style?: CSSProperties;
}

const NavHeader = memo<NavHeaderProps>(({ children, className, left, right, style }) => (
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
));

NavHeader.displayName = 'NavHeader';

export default NavHeader;
