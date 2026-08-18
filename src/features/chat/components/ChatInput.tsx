// Adapted from: src/features/ChatInput/Desktop + SendArea (LobeHub canary)
import { ActionIcon, Avatar, Button, Flexbox, Text, TextArea } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { AtSign, Paperclip, Send, Square } from 'lucide-react';
import { type KeyboardEvent, memo, useRef, useState } from 'react';

import { type MentionAgent } from '@/api/market/agentMarketService';
import { useI18n } from '@/i18n';

const styles = createStaticStyles(({ css, cssVar }) => ({
  composer: css`
    position: relative;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusLG}px;
    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  mentionMenu: css`
    position: absolute;
    z-index: 10;
    inset-inline: 0;
    inset-block-end: calc(100% + 8px);
    overflow-y: auto;
    max-height: 280px;
    padding: 6px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 12px;
    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  mentionItem: css`
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 8px;
    cursor: pointer;
    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

interface ChatInputProps {
  mentions: MentionAgent[];
  onChange: (value: string) => void;
  onSend: () => void;
  onSelectMention: (mention: MentionAgent) => void;
  onStop: () => void;
  running: boolean;
  value: string;
}

const ChatInput = memo<ChatInputProps>(
  ({ mentions, onChange, onSelectMention, onSend, onStop, running, value }) => {
    const { t } = useI18n();
    const [mentionOpen, setMentionOpen] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (!running) onSend();
      }
    };

    return (
      <Flexbox className={styles.composer} gap={4} padding={10}>
        {mentionOpen && mentions.length > 0 && (
          <Flexbox className={styles.mentionMenu} gap={3}>
            <Text fontSize={11} type="secondary" style={{ padding: '6px 10px' }}>
              {t('chat.mentionHint')}
            </Text>
            {mentions.map((mention) => (
              <div
                className={styles.mentionItem}
                key={`${mention.agentId}-${mention.fab}`}
                onClick={() => {
                  setMentionOpen(false);
                  onSelectMention(mention);
                }}
              >
                <Avatar avatar={mention.icon} size={30} />
                <Flexbox flex={1} style={{ minWidth: 0 }}>
                  <Text ellipsis weight={500}>
                    {mention.agentFullName}
                  </Text>
                  <Text ellipsis fontSize={11} type="secondary">
                    v{mention.version} · {mention.description}
                  </Text>
                </Flexbox>
              </div>
            ))}
          </Flexbox>
        )}
        <TextArea
          autoSize={{ minRows: 2, maxRows: 6 }}
          onKeyDown={handleKeyDown}
          placeholder={t('chat.placeholder')}
          value={value}
          variant="borderless"
          onChange={(event) => {
            const next = event.target.value;
            onChange(next);
            setMentionOpen(next.startsWith('@'));
            if (timerRef.current) clearTimeout(timerRef.current);
            if (next.startsWith('@')) {
              timerRef.current = setTimeout(() => setMentionOpen(true), 80);
            }
          }}
        />
        <Flexbox horizontal align="center" justify="space-between">
          <Flexbox horizontal gap={2}>
            <ActionIcon aria-label={t('chat.attach')} disabled icon={Paperclip} title={t('chat.attach')} />
            <Button
              size="small"
              type="text"
              onClick={() => setMentionOpen((open) => !open && value.startsWith('@'))}
            >
              <AtSign size={14} /> {t('chat.mentionButton')}
            </Button>
          </Flexbox>
          {running ? (
            <ActionIcon aria-label={t('chat.stop')} icon={Square} title={t('chat.stop')} onClick={onStop} />
          ) : (
            <ActionIcon
              aria-label={t('chat.send')}
              icon={Send}
              title={t('chat.send')}
              onClick={onSend}
            />
          )}
        </Flexbox>
      </Flexbox>
    );
  },
);

ChatInput.displayName = 'ChatInput';

export default ChatInput;
