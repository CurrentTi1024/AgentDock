// Adapted from: src/features/NavPanel/components/NavItem.tsx (LobeHub canary)
import { Block, Center, Flexbox, Icon, Text, type IconProps } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { type ReactNode } from 'react';
import { memo } from 'react';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    user-select: none;
    overflow: hidden;
    min-width: 32px;
  `,
}));

export interface NavItemProps {
  active?: boolean;
  description?: ReactNode;
  disabled?: boolean;
  extra?: ReactNode;
  icon?: IconProps['icon'];
  /** 直接渲染的图标节点（如 Avatar），优先于 icon。 */
  iconNode?: ReactNode;
  iconSize?: number;
  onClick?: () => void;
  title: ReactNode;
}

const NavItem = memo<NavItemProps>(
  ({ active, description, disabled, extra, icon, iconNode, iconSize = 18, onClick, title }) => {
    const iconColor = active ? cssVar.colorText : cssVar.colorTextDescription;
    const textColor = active ? cssVar.colorText : cssVar.colorTextSecondary;

    return (
      <Block
        horizontal
        align="center"
        className={styles.container}
        clickable={!disabled}
        gap={8}
        height={description ? undefined : 36}
        paddingBlock={description ? 8 : undefined}
        paddingInline={4}
        variant={active ? 'filled' : 'borderless'}
        style={disabled ? { cursor: 'not-allowed', opacity: 0.5 } : undefined}
        onClick={disabled ? undefined : onClick}
      >
        {iconNode ?? (icon && (
          <Center
            flex="none"
            height={description ? 22 : 28}
            style={description ? { alignSelf: 'flex-start' } : undefined}
            width={28}
          >
            <Icon color={iconColor} icon={icon} size={iconSize} />
          </Center>
        ))}
        <Flexbox horizontal align="center" flex={1} gap={8} style={{ overflow: 'hidden' }}>
          {description ? (
            <Flexbox flex={1} gap={3} style={{ overflow: 'hidden' }}>
              <Text color={textColor} ellipsis={{ tooltipWhenOverflow: true }}>
                {title}
              </Text>
              {description}
            </Flexbox>
          ) : (
            <Text color={textColor} ellipsis={{ tooltipWhenOverflow: true }} style={{ flex: 1 }}>
              {title}
            </Text>
          )}
          {extra}
        </Flexbox>
      </Block>
    );
  },
);

NavItem.displayName = 'NavItem';

export default NavItem;
