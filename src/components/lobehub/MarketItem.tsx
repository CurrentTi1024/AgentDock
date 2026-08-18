// Adapted directly from:
// src/routes/(main)/community/(list)/agent|skill|mcp/features/List/Item.tsx
import { Avatar, Block, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ClockIcon, DownloadIcon } from 'lucide-react';
import { memo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MarketItem as Item, MarketKind } from '@/types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  author: css`color: ${cssVar.colorTextDescription};`,
  desc: css`flex: 1; margin: 0 !important; color: ${cssVar.colorTextSecondary};`,
  footer: css`margin-block-start: 16px; border-block-start: 1px dashed ${cssVar.colorBorder}; background: ${cssVar.colorBgContainer};`,
  meta: css`font-size: 12px; color: ${cssVar.colorTextDescription};`,
  title: css`margin: 0 !important; font-size: 16px !important; font-weight: 500 !important; &:hover { color: ${cssVar.colorLink}; }`,
}));

export default memo(({ item, kind }: { item: Item; kind: MarketKind }) => {
  const navigate = useNavigate();
  return <Block clickable height="100%" variant="outlined" width="100%" style={{ overflow: 'hidden', position: 'relative' }} onClick={() => navigate(`/market/${kind}/${item.id}`)}>
    <Flexbox horizontal align="flex-start" gap={16} justify="space-between" padding={16} width="100%">
      <Flexbox horizontal gap={12} style={{ minWidth: 0, overflow: 'hidden' }}>
        <Avatar avatar={item.icon} background="transparent" shape="square" size={40} style={{ flex: 'none' }} />
        <Flexbox flex={1} gap={2} style={{ minWidth: 0, overflow: 'hidden' }}>
          <Flexbox horizontal align="center" gap={8} style={{ overflow: 'hidden' }}><Text ellipsis as="h2" className={styles.title}>{item.name}</Text>{item.isValidated && <Tag size="small" variant="filled">已验证</Tag>}</Flexbox>
          <div className={styles.author}>{item.ownerName}</div>
        </Flexbox>
      </Flexbox>
    </Flexbox>
    <Flexbox flex={1} gap={12} paddingInline={16}>
      <Text as="p" className={styles.desc} ellipsis={{ rows: 3 }}>{item.description}</Text>
      <Flexbox horizontal align="center" gap={6} wrap="wrap">{item.versions.map((v) => <Tag key={`${v.fab}-${v.version}`} color={v.callPermission ? 'success' : undefined} size="small" variant="filled">{v.fab} · v{v.version}</Tag>)}</Flexbox>
    </Flexbox>
    <Flexbox horizontal align="center" className={styles.footer} justify="space-between" padding={16}>
      <Flexbox horizontal align="center" className={styles.meta} gap={4}><Icon icon={ClockIcon} size={14} />{new Date(item.updatedAt).toLocaleDateString('zh-CN')}</Flexbox>
      <Flexbox horizontal align="center" className={styles.meta} gap={4}><Icon icon={DownloadIcon} size={14} />{item.metric}</Flexbox>
    </Flexbox>
  </Block>;
});
