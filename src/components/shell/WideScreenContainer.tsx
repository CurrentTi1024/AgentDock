// Adapted from: src/features/WideScreenContainer/index.tsx (LobeHub canary)
import { Flexbox, type FlexboxProps } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { type CSSProperties, type ReactNode } from 'react';
import { memo } from 'react';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    flex-grow: 1;
    align-self: center;
    transition: width 0.25s ${cssVar.motionEaseInOut};
  `,
}));

interface WideScreenContainerProps extends Omit<FlexboxProps, 'children'> {
  children: ReactNode;
  minWidth?: number;
  wrapperStyle?: CSSProperties;
}

const WideScreenContainer = memo<WideScreenContainerProps>(
  ({ children, className, minWidth = 1024, wrapperStyle, ...rest }) => (
    <Flexbox style={wrapperStyle} width="100%">
      <Flexbox
        className={`${styles.container} ${className ?? ''}`}
        paddingInline={16}
        width={`min(${minWidth}px, 100%)`}
        {...rest}
      >
        {children}
      </Flexbox>
    </Flexbox>
  ),
);

WideScreenContainer.displayName = 'WideScreenContainer';

export default WideScreenContainer;
