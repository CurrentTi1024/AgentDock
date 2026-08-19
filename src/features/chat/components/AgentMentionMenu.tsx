// LobeHub mention 菜单（@Agent 快速选择）：首页 hub 与对话输入区共用。
import { Avatar, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import { type MentionAgent } from '@/api/market/agentMarketService';
import { useI18n } from '@/i18n';

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  item: css`
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 8px;
    cursor: pointer;
    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  menu: css`
    position: absolute;
    z-index: 10;
    inset-inline: 0;
    inset-block-end: calc(100% + 8px);
    overflow-y: auto;
    max-height: 280px;
    padding: 6px;
    border: 1px solid ${token.colorBorder};
    border-radius: 12px;
    background: ${token.colorBgElevated};
    box-shadow: ${token.boxShadowSecondary};
  `,
}));

interface AgentMentionMenuProps {
  loading?: boolean;
  mentions: MentionAgent[];
  onSelect: (mention: MentionAgent) => void;
}

const AgentMentionMenu = memo<AgentMentionMenuProps>(({ loading = false, mentions, onSelect }) => {
  const { t } = useI18n();
  return (
    <Flexbox className={styles.menu} gap={3}>
      {loading ? (
        <Text fontSize={12} type="secondary" style={{ padding: '8px 10px' }}>
          {t('common.loading')}
        </Text>
      ) : mentions.length === 0 ? (
        <Text fontSize={12} type="secondary" style={{ padding: '8px 10px' }}>
          {t('chat.mentionEmpty')}
        </Text>
      ) : (
        <>
          <Text fontSize={11} type="secondary" style={{ padding: '6px 10px' }}>
            {t('chat.mentionHint')}
          </Text>
          {mentions.map((mention) => (
            <div
              className={styles.item}
              key={`${mention.agentId}-${mention.fab}`}
              onClick={() => onSelect(mention)}
            >
              <Avatar avatar={mention.icon} size={30} />
              <Flexbox flex={1} style={{ minWidth: 0 }}>
                <Text ellipsis weight={500}>
                  {mention.agentFullName}
                </Text>
                <Text ellipsis fontSize={11} type="secondary">
                  v{mention.version} · {mention.fab}
                </Text>
              </Flexbox>
            </div>
          ))}
        </>
      )}
    </Flexbox>
  );
});

AgentMentionMenu.displayName = 'AgentMentionMenu';

export default AgentMentionMenu;
