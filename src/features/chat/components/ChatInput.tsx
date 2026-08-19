// Adapted from: src/features/ChatInput/Desktop + SendArea (LobeHub canary)
// 桌面输入区：边框圆角容器 + 自动高度输入 + 底部操作栏（attach/@Agent/键盘提示/发送或停止）。
import { ActionIcon, Avatar, Button, Flexbox, Text, TextArea } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowBigUp, AtSign, CornerDownLeft, Paperclip, Send, Square } from 'lucide-react';
import { type KeyboardEvent, memo, useRef, useState } from 'react';

import { type MentionAgent } from '@/api/market/agentMarketService';
import { useI18n } from '@/i18n';

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  composer: css`
    overflow: hidden;
    border: 1px solid ${token.colorBorder};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorBgContainer};
    box-shadow: ${token.boxShadowSecondary};
    transition: border-color 200ms ${token.motionEaseOut}, box-shadow 200ms ${token.motionEaseOut};
    &:focus-within {
      border-color: ${token.colorPrimary};
      box-shadow: 0 0 0 2px ${token.colorPrimaryBg};
    }
  `,
  mentionMenu: css`
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
  mentionItem: css`
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
      <Flexbox className={styles.composer} gap={4} padding={12} style={{ position: 'relative' }}>
        {mentionOpen && (
          <Flexbox className={styles.mentionMenu} gap={3}>
            {mentions.length === 0 ? (
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
              </>
            )}
          </Flexbox>
        )}
        <TextArea
          autoSize={{ minRows: 2, maxRows: 8 }}
          data-testid="chat-input"
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
          <Flexbox horizontal align="center" gap={12}>
            {!running && (
              <Flexbox
                horizontal
                gap={4}
                style={{ color: cssVar.colorTextDescription, fontSize: 12 }}
              >
                <CornerDownLeft size={13} />
                {t('chat.input.sendHint')}
                <span>/</span>
                <ArrowBigUp size={13} />
                <CornerDownLeft size={13} />
                {t('chat.input.warpHint')}
              </Flexbox>
            )}
            {running ? (
              <Button
                data-testid="chat-stop"
                icon={Square}
                onClick={onStop}
                size="small"
                type="primary"
              >
                {t('chat.stop')}
              </Button>
            ) : (
              <Button
                data-testid="chat-send"
                icon={Send}
                onClick={onSend}
                size="small"
                type="primary"
              >
                {t('chat.send')}
              </Button>
            )}
          </Flexbox>
        </Flexbox>
      </Flexbox>
    );
  },
);

ChatInput.displayName = 'ChatInput';

export default ChatInput;
