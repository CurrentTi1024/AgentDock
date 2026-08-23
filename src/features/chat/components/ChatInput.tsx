// Adapted from: src/features/ChatInput/Desktop + SendArea + ControlBar (LobeHub canary)
// 桌面输入区：圆角容器 + 自动高度输入 + 底部发送/停止 + 外部功能行（左工具、右审批模式）。
import { ActionIcon, Alert, Avatar, Button, Flexbox, Select, Tag, Text, TextArea } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowBigUp, CornerDownLeft, Mic, Paperclip, Send, Square } from 'lucide-react';
import { type KeyboardEvent, memo, useMemo, useRef, useState } from 'react';

import { type MentionAgent } from '@/api/market/agentMarketService';
import type { RunStatus } from '@/api/runtime/types';
import AgentMentionMenu from '@/features/chat/components/AgentMentionMenu';
import OpStatusTray, { type OpStatusActivity } from '@/features/chat/components/OpStatusTray';
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
  compactDropdown: css`
    .ant-select-item {
      font-size: 12px !important;
      line-height: 20px !important;
    }
    .ant-select-item-option {
      font-size: 12px !important;
      line-height: 20px !important;
    }
  `,
  compactSelect: css`
    /* antd v6 DOM：外层 wrapper 高度受 flex 拉伸影响，需显式锁高。 */
    height: 22px !important;
    min-height: 22px !important;
    .ant-select-selector {
      height: 22px !important;
      min-height: 22px !important;
      font-size: 12px !important;
    }
    .ant-select-content {
      height: 22px !important;
      min-height: 22px !important;
      font-size: 12px !important;
      line-height: 22px !important;
      align-items: center;
    }
    .ant-select-selection-item,
    .ant-select-selection-placeholder,
    .ant-select-selection-search {
      font-size: 12px !important;
      line-height: 22px !important;
    }
    .ant-select-input {
      font-size: 12px !important;
      line-height: 22px !important;
    }
    .ant-select-arrow {
      font-size: 10px !important;
    }
  `,
  footer: css`
    padding-block: 8px 2px;
  `,
}));

interface ChatInputProps {
  /** 当前活动（官方 OpStatusTray 的 activity 等价物）。 */
  activity?: OpStatusActivity;
  agentName?: string;
  approvalMode?: ApprovalMode;
  fab?: string;
  /** 关闭 @ 提及（输入 @ 不再弹出菜单），群聊等无需选 Agent 的场景使用。 */
  mentionEnabled?: boolean;
  mentions: MentionAgent[];
  mentionsLoading?: boolean;
  onChange: (value: string) => void;
  onApprovalModeChange?: (mode: ApprovalMode) => void;
  onMentionTrigger: () => void;
  onSend: () => void;
  onSelectMention: (mention: MentionAgent) => void;
  onStop: () => void;
  onSwitchAgent?: (agent: MentionAgent) => void;
  placeholder?: string;
  runStatus?: RunStatus;
  running: boolean;
  sendDisabled?: boolean;
  /** 本轮 run 开始时间，用于状态条计时。 */
  startTime?: number;
  /** 工具步骤数，>1 时状态条右侧显示步数。 */
  stepCount?: number;
  switchAgents?: MentionAgent[];
  value: string;
}

const ChatInput = memo<ChatInputProps>(
  ({
    activity,
    agentName,
    approvalMode = 'manual',
    fab,
    mentionEnabled = true,
    mentions,
    mentionsLoading = false,
    onChange,
    onApprovalModeChange,
    onMentionTrigger,
    onSelectMention,
    onSend,
    onStop,
    onSwitchAgent,
    placeholder,
    runStatus,
    running,
    sendDisabled = false,
    startTime,
    stepCount,
    switchAgents,
    value,
  }) => {
    const { t } = useI18n();
    const [mentionOpen, setMentionOpen] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 切换 Agent 下拉：选中态显示当前 Agent（头像+名称），无边框紧凑样式。
  const switchValue = useMemo(() => {
    if (!switchAgents?.length || !agentName) return undefined;
    const current = switchAgents.find(
      (agent) => agent.agentFullName === agentName && agent.fab === fab,
    );
    return current ? `${current.agentId}@${current.fab}` : undefined;
  }, [agentName, fab, switchAgents]);

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey && !sendDisabled) {
        event.preventDefault();
        if (!running) onSend();
      }
    };

    return (
      <Flexbox gap={0}>
        {(runStatus === 'running' || runStatus === 'paused') && (
          <OpStatusTray
            activity={activity}
            runStatus={runStatus}
            startTime={startTime}
            steps={stepCount}
          />
        )}
        {runStatus === 'cancelled' && (
          <Alert
            description={t('chat.notice.interruptedHint')}
            showIcon
            title={t('chat.notice.interrupted')}
            type="warning"
            variant="borderless"
          />
        )}
        <Flexbox className={styles.composer} gap={4} padding={12} style={{ position: 'relative' }}>
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
            placeholder={placeholder ?? t('chat.placeholder')}
            value={value}
            variant="borderless"
            onChange={(event) => {
              const next = event.target.value;
              onChange(next);
              setMentionOpen(mentionEnabled && next.startsWith('@'));
              if (timerRef.current) clearTimeout(timerRef.current);
              if (mentionEnabled && next.startsWith('@')) {
                timerRef.current = setTimeout(() => {
                  setMentionOpen(true);
                  onMentionTrigger();
                }, 80);
              }
            }}
          />
          <Flexbox horizontal align="center" justify="space-between">
            <Flexbox horizontal gap={2} style={{ minHeight: 24 }}>
              {switchAgents && onSwitchAgent && (
                <Select
                  className={styles.compactSelect}
                  options={switchAgents.map((agent) => ({
                    label: `${agent.icon} ${agent.agentFullName}`,
                    value: `${agent.agentId}@${agent.fab}`,
                  }))}
                  placeholder={t('agentSidebar.switchAgent')}
                  popupClassName={styles.compactDropdown}
                  size="small"
                  value={switchValue}
                  variant="borderless"
                  style={{ maxWidth: 148, minWidth: 92 }}
                  onChange={(value) => {
                    const agent = switchAgents.find(
                      (item) => `${item.agentId}@${item.fab}` === value,
                    );
                    if (agent) onSwitchAgent(agent);
                  }}
                />
              )}
              <ActionIcon aria-label={t('chat.attach')} disabled icon={Paperclip} title={t('chat.attach')} />
              <ActionIcon aria-label={t('chat.voice')} disabled icon={Mic} title={t('chat.voice')} />
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
                  disabled={sendDisabled}
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
                className={styles.compactSelect}
                data-testid="approval-mode"
                options={[
                  { label: t('chat.approval.manual'), value: 'manual' },
                  { label: t('chat.approval.auto'), value: 'auto' },
                ]}
                size="small"
                popupClassName={styles.compactDropdown}
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
