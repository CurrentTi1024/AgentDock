// Adapted from: src/routes/(main)/community/(list)/agent|skill|mcp/features/List/Item.tsx (LobeHub canary)
import { MCP } from '@lobehub/icons';
import { Avatar, Block, Flexbox, Icon, Tag, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { BookTextIcon, ClockIcon } from 'lucide-react';
import { memo } from 'react';
import { useNavigate } from 'react-router-dom';

import { useI18n } from '@/i18n';
import { isAgentMarketItem, type MarketItem as MarketItemType, type MarketKind } from '@/types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  desc: css`flex: 1; margin: 0 !important; color: ${cssVar.colorTextSecondary};`,
  footer: css`margin-block-start: 16px; border-block-start: 1px dashed ${cssVar.colorBorder}; background: ${cssVar.colorBgContainer};`,
  meta: css`font-size: 12px; color: ${cssVar.colorTextDescription};`,
  countTag: css`
    border-radius: 4px;
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextSecondary};
    background: ${cssVar.colorFillTertiary};
  `,
  title: css`margin: 0 !important; font-size: 16px !important; font-weight: 500 !important; &:hover { color: ${cssVar.colorLink}; }`,
}));

interface MarketItemProps {
  fab: string;
  item: MarketItemType;
  kind: MarketKind;
}

export default memo(function MarketItem({ fab, item, kind }: MarketItemProps) {
  const navigate = useNavigate();
  const { locale, t } = useI18n();
  const name = isAgentMarketItem(item) ? item.agentFullName : item.name;
  const versions = isAgentMarketItem(item)
    ? [{ callPermission: item.fabPermission.callPermission, fab: item.fabPermission.fab, version: item.version }]
    : item.versions;

  return (
    <Block
      clickable
      height="100%"
      variant="outlined"
      width="100%"
      style={{ overflow: 'hidden', position: 'relative' }}
      onClick={() => navigate(`/market/${kind}/${item.id}?fab=${fab}`)}
    >
      <Flexbox horizontal align="flex-start" gap={16} justify="space-between" padding={16} width="100%">
        <Flexbox horizontal gap={12} style={{ minWidth: 0, overflow: 'hidden' }}>
          <Avatar avatar={item.icon} background="transparent" shape="square" size={40} style={{ flex: 'none' }} />
          <Flexbox flex={1} gap={2} style={{ minWidth: 0, overflow: 'hidden' }}>
            <Text ellipsis as="h2" className={styles.title}>
              {name}
            </Text>
          </Flexbox>
        </Flexbox>
        <Flexbox
          horizontal
          align="center"
          gap={4}
          style={{ flex: 'none', justifyContent: 'flex-end', maxWidth: '55%' }}
          wrap="wrap"
        >
          {versions.map((v) => (
            <Tag key={`${v.fab}-${v.version}`} color={v.callPermission ? 'success' : undefined} size="small" variant="filled">
              {v.fab} · v{v.version}
            </Tag>
          ))}
        </Flexbox>
      </Flexbox>
      <Flexbox flex={1} gap={12} paddingInline={16}>
        <Text as="p" className={styles.desc} ellipsis={{ rows: 3 }}>
          {item.description}
        </Text>
        {isAgentMarketItem(item) && (item.skillCount || item.mcpCount) ? (
          <Flexbox horizontal align="center" gap={4}>
            {item.skillCount ? (
              <Tooltip placement="right" styles={{ root: { pointerEvents: 'none' } }} title={t('market.withSkills')}>
                <Tag className={styles.countTag} icon={<Icon icon={BookTextIcon} />}>
                  {item.skillCount}
                </Tag>
              </Tooltip>
            ) : null}
            {item.mcpCount ? (
              <Tooltip placement="right" styles={{ root: { pointerEvents: 'none' } }} title={t('market.withMcps')}>
                <Tag className={styles.countTag} icon={<Icon fill={cssVar.colorTextSecondary} icon={MCP} />}>
                  {item.mcpCount}
                </Tag>
              </Tooltip>
            ) : null}
          </Flexbox>
        ) : null}
      </Flexbox>
      <Flexbox horizontal align="center" className={styles.footer} justify="space-between" padding={16}>
        <Flexbox horizontal align="center" className={styles.meta} gap={4}>
          <Icon icon={ClockIcon} size={14} />
          {new Date(item.updatedAt).toLocaleString(locale, {
            day: 'numeric',
            hour: '2-digit',
            hour12: false,
            minute: '2-digit',
            month: 'numeric',
            year: 'numeric',
          })}
        </Flexbox>
        <Text ellipsis className={styles.meta} style={{ maxWidth: '55%' }}>
          {item.ownerName}
        </Text>
      </Flexbox>
    </Block>
  );
});
