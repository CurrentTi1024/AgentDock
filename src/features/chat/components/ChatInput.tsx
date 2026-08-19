// Adapted from: src/features/ChatInput/Desktop + SendArea + ControlBar (LobeHub canary)
// 桌面输入区：圆角容器 + 自动高度输入 + 底部发送/停止 + 外部功能行（左工具、右审批模式）。
import { ActionIcon, Avatar, Button, Flexbox, Select, Tag, Text, TextArea } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowBigUp, AtSign, CornerDownLeft, Mic, Paperclip, Send, Slash, Square } from 'lucide-react';
import { type KeyboardEvent, memo, useRef, useState } from 'react';

import { type MentionAgent } from '@/api/market/agentMarketService';
import AgentMentionMenu from '@/features/chat/components/AgentMentionMenu';
import { useI18n } from '@/i18n';

export type ApprovalMode = 'auto' | 'manual';

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  composer: css`
    overflow: hidden;
    border: 1px solid ${token.colorBorder};
    border-radius: 16px;
    background: ${token.colorBgContainer};
    box-shadow: ${token.boxShadowSecondary};
    transition: border-color 200ms ${token.motionEaseOut}, box-shadow 200ms ${token.motionEaseOut};
    &:focus-within {
      border-color: ${token.colorPrimary};
      box-shadow: 0 0 0 2px ${token.colorPrimaryBg};
    }
  `,
  footer: css`
    padding-block: 8px 2px;
  `,
  menuItem: css`
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
  slashMenu: css`
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

const SLASH_COMMAND_KEYS = ['chat.suggestion.analyze', 'chat.suggestion.compare', 'chat.suggestion.summary'] as const;

interface ChatInputProps {
  agentName?: string;
  approvalMode?: ApprovalMode;
  fab?: string;
  mentions: MentionAgent[];
  mentionsLoading?: boolean;
  onChange: (value: string) => void;
  onApprovalModeChange?: (mode: ApprovalMode) => void;
  onMentionTrigger: () => void;
  onSend: () => void;
  onSelectMention: (mention: MentionAgent) => void;
  onStop: () => void;
  running: boolean;
  value: string;
}

const ChatInput = memo<ChatInputProps>(
  ({
    agentName,
    approvalMode = 'manual',
    fab,
    mentions,
    mentionsLoading = false,
    onChange,
    onApprovalModeChange,
    onMentionTrigger,
    onSelectMention,
    onSend,
    onStop,
    running,
    value,
  }) => {
    const { t } = useI18n();
    const [mentionOpen, setMentionOpen] = useState(false);
    const [slashOpen, setSlashOpen] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (!running) onSend();
      }
    };

    const openMentionMenu = () => {
      setMentionOpen(true);
      onMentionTrigger();
    };

    const handleSlashSelect = (key: (typeof SLASH_COMMAND_KEYS)[number]) => {
      onChange(t(key));
      setSlashOpen(false);
    };

    return (
      <Flexbox gap={0}>
        <Flexbox className={styles.composer} gap={4} padding={12} style={{ position: 'relative' }}>
          {slashOpen && (
            <Flexbox className={styles.slashMenu} gap={3}>
              <Text fontSize={11} type="secondary" style={{ padding: '6px 10px' }}>
                {t('chat.slashHint')}
              </Text>
              {SLASH_COMMAND_KEYS.map((key) => (
                <div
                  className={styles.menuItem}
                  key={key}
                  onClick={() => handleSlashSelect(key)}
                >
                  <Slash size={14} />
                  <Flexbox flex={1} style={{ minWidth: 0 }}>
                    <Text ellipsis weight={500}>
                      /{t(key)}
                    </Text>
                  </Flexbox>
                </div>
              ))}
            </Flexbox>
          )}
          {mentionOpen && (
            <AgentMentionMenu
              loading={mentionsLoading}
              mentions={mentions}
              onSelect={(mention) => {
                setMentionOpen(false);
                onSelectMention(mention);
              }}
            />
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
              setSlashOpen(next.startsWith('/'));
              if (timerRef.current) clearTimeout(timerRef.current);
              if (next.startsWith('@') || next.startsWith('/')) {
                timerRef.current = setTimeout(() => {
                  if (next.startsWith('@')) {
                    setMentionOpen(true);
                    onMentionTrigger();
                  } else {
                    setSlashOpen(true);
                  }
                }, 80);
              }
            }}
          />
          <Flexbox horizontal align="center" justify="space-between">
            <Flexbox horizontal gap={2} style={{ minHeight: 24 }}>
              <ActionIcon aria-label={t('chat.attach')} disabled icon={Paperclip} title={t('chat.attach')} />
              <ActionIcon aria-label={t('chat.voice')} disabled icon={Mic} title={t('chat.voice')} />
              <Button size="small" type="text" onClick={() => setSlashOpen((open) => !open)}>
                <Slash size={14} />
              </Button>
              <Button size="small" type="text" onClick={() => openMentionMenu()}>
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
        <Flexbox
          className={styles.footer}
          horizontal
          align="center"
          justify="space-between"
          paddingInline={4}
        >
          <Flexbox horizontal gap={8}>
            {agentName && (
              <>
                <Avatar avatar="🛩️" shape="square" size={20} />
                <Text ellipsis fontSize={12} weight={500} style={{ maxWidth: 180 }}>
                  {agentName}
                </Text>
              </>
            )}
            {fab && <Tag color="info" size="small">{fab}</Tag>}
            <Text fontSize={12} type="secondary" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t('chat.footer.hint')}
            </Text>
          </Flexbox>
          {onApprovalModeChange && (
            <Flexbox horizontal align="center" gap={8}>
              <Text fontSize={12} type="secondary">
                {t('chat.approval.label')}
              </Text>
              <Select
                data-testid="approval-mode"
                options={[
                  { label: t('chat.approval.manual'), value: 'manual' },
                  { label: t('chat.approval.auto'), value: 'auto' },
                ]}
                size="small"
                value={approvalMode}
                onChange={(mode) => onApprovalModeChange(mode as ApprovalMode)}
              />
            </Flexbox>
          )}
        </Flexbox>
      </Flexbox>
    );
  },
);

ChatInput.displayName = 'ChatInput';

export default ChatInput;
