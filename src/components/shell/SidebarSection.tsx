// LobeHub Accordion 的轻量替代（framer-motion 未引入）：折叠区标题 + 展开箭头 + hover 操作。
import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronDown } from 'lucide-react';
import { type ReactNode, useState } from 'react';

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  title: css`
    font-size: 12px;
    font-weight: 500;
    color: ${token.colorTextSecondary};
  `,
}));

const SidebarSection = ({
  action,
  children,
  count,
  defaultExpand = true,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  count?: number;
  defaultExpand?: boolean;
  title: ReactNode;
}) => {
  const [open, setOpen] = useState(defaultExpand);
  return (
    <Flexbox gap={2}>
      <Flexbox
        horizontal
        align="center"
        justify="space-between"
        paddingBlock={7}
        paddingInline={10}
        style={{ cursor: 'pointer' }}
        onClick={() => setOpen((value) => !value)}
      >
        <Flexbox horizontal align="center" gap={4}>
          <ChevronDown
            size={12}
            style={{
              color: cssVar.colorTextDescription,
              transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 200ms ease',
            }}
          />
          <span className={styles.title}>{title}</span>
          {count !== undefined && (
            <Text fontSize={11} type="secondary">
              {count}
            </Text>
          )}
        </Flexbox>
        {action}
      </Flexbox>
      {open && children}
    </Flexbox>
  );
};

export default SidebarSection;
