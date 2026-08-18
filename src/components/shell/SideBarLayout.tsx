// Adapted from: src/features/NavPanel/SideBarLayout.tsx (LobeHub canary)
import { Flexbox, ScrollShadow, TooltipGroup } from '@lobehub/ui';
import { type CSSProperties, type ReactNode } from 'react';
import { memo, Suspense } from 'react';

export const SkeletonItem = memo<{ height?: number; style?: CSSProperties }>(
  ({ height = 36, style }) => (
    <div
      style={{
        ...style,
        height,
        borderRadius: 8,
        background: 'var(--lobe-colorFillQuaternary, rgba(0, 0, 0, 0.06))',
      }}
    />
  ),
);

interface SideBarLayoutProps {
  body?: ReactNode;
  header?: ReactNode;
}

const SideBarLayout = memo<SideBarLayoutProps>(({ body, header }) => (
  <Flexbox gap={1} style={{ height: '100%', overflow: 'hidden' }}>
    <Suspense fallback={<SkeletonItem height={44} style={{ marginTop: 8 }} />}>{header}</Suspense>
    <ScrollShadow size={2} style={{ height: '100%' }}>
      <TooltipGroup>
        <Suspense fallback={<SkeletonItem height={44} style={{ marginBlock: 8 }} />}>
          {body}
        </Suspense>
      </TooltipGroup>
    </ScrollShadow>
  </Flexbox>
));

SideBarLayout.displayName = 'SideBarLayout';

export default SideBarLayout;
