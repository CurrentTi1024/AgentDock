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
import {
  extractMentionToken,
  removeMentionBeforeCaret,
  replaceMentionToken,
  tokenizeMentions,
} from '@/features/chat/mentions';
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
  // 真实输入层：文字透明、光标可见，叠加层在其下方渲染 chip。
  ghostInput: css`
    position: relative;
    z-index: 1;
    color: transparent !important;
    caret-color: ${cssVar.colorText};
    background: transparent !important;
    font-size: 14px !important;
    line-height: 22px !important;
  `,
  inputLayer: css`
    position: relative;
    font-size: 14px;
    line-height: 22px;

    .ant-input {
      padding: 0 !important;
      font-size: 14px !important;
      line-height: 22px !important;
    }
  `,
  mentionChip: css`
    display: inline;
    padding: 1px 5px;
    /* LobeHub mention chip 使用蓝色系 token（bg blue1 / border blue3 / text blue9），
       不走主题 primary（当前为中性色），保证与官网 @ 联想一致。 */
    border: 1px solid ${cssVar.blue3};
    border-radius: 6px;
    color: ${cssVar.blue9};
    background: ${cssVar.blue1};
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  `,
  mentionChipIcon: css`
    margin-inline-end: 2px;
  `,
  mentionOverlay: css`
    position: absolute;
    inset: 0;
    overflow: hidden;
    color: ${cssVar.colorText};
    white-space: pre-wrap;
    word-break: break-word;
    pointer-events: none;
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
    const [mentionQuery, setMentionQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const overlayRef = useRef<HTMLDivElement>(null);

    // 联想列表：按 @ 后输入的后缀过滤（名称/FAB/描述）。
    const filteredMentions = useMemo(() => {
      const query = mentionQuery.trim().toLowerCase();
      if (!query) return mentions;
      return mentions.filter((mention) =>
        `${mention.agentFullName} ${mention.fab} ${mention.description}`
          .toLowerCase()
          .includes(query),
      );
    }, [mentionQuery, mentions]);

    const openMention = (query: string) => {
      setMentionQuery(query);
      setActiveIndex(0);
      setMentionOpen(true);
      onMentionTrigger();
    };

    const closeMention = () => {
      setMentionOpen(false);
    };

    // 选中后把末尾 @query 替换为 @AgentFullName + 空格，正文与其它 @ 保留。
    const selectMention = (mention: MentionAgent) => {
      setMentionOpen(false);
      onChange(replaceMentionToken(value, mention.agentFullName));
      onSelectMention(mention);
    };

    // 叠加层把 @提及渲染成蓝色 chip（真实输入框文字透明，光标仍可见）。
    const overlaySegments = useMemo(
      () => tokenizeMentions(value, mentions),
      [mentions, value],
    );

  // 切换 Agent 下拉：选中态显示当前 Agent（头像+名称），无边框紧凑样式。
  const switchValue = useMemo(() => {
    if (!switchAgents?.length || !agentName) return undefined;
    const current = switchAgents.find(
      (agent) => agent.agentFullName === agentName && agent.fab === fab,
    );
    return current ? `${current.agentId}@${current.fab}` : undefined;
  }, [agentName, fab, switchAgents]);

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // @ 联想菜单打开时：方向键移动、Enter/Tab 选中、Escape 关闭。
      if (mentionOpen && filteredMentions.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setActiveIndex((index) => (index + 1) % filteredMentions.length);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setActiveIndex(
            (index) => (index - 1 + filteredMentions.length) % filteredMentions.length,
          );
          return;
        }
        if ((event.key === 'Enter' || event.key === 'Tab') && !event.nativeEvent.isComposing) {
          event.preventDefault();
          selectMention(filteredMentions[activeIndex] ?? filteredMentions[0]);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          closeMention();
          return;
        }
      }
      // 光标紧贴完整 @提及 时整块删除（LobeHub chip 删除语义），否则退回逐字删除。
      if (event.key === 'Backspace' && !event.nativeEvent.isComposing) {
        const target = event.currentTarget;
        const start = target.selectionStart ?? 0;
        const end = target.selectionEnd ?? 0;
        if (start === end) {
          const removed = removeMentionBeforeCaret(value, start, mentions);
          if (removed) {
            event.preventDefault();
            onChange(removed.nextValue);
            requestAnimationFrame(() => {
              target.setSelectionRange(removed.caret, removed.caret);
            });
          }
        }
      }
      // IME 组合中按 Enter 是确认候选词：跳过发送，避免消息已发出后输入法把文字重新写回输入框。
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !sendDisabled &&
        !event.nativeEvent.isComposing
      ) {
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
        {/* 联想菜单必须放在 overflow:hidden 的 composer 之外，否则会被整体裁掉。 */}
        <Flexbox style={{ position: 'relative' }}>
          <Flexbox className={styles.composer} gap={4} padding={12}>
            <div className={styles.inputLayer}>
              <TextArea
                autoSize={{ minRows: 2, maxRows: 8 }}
                className={styles.ghostInput}
                data-testid="chat-input"
                onKeyDown={handleKeyDown}
                onScroll={(event) => {
                  if (overlayRef.current) {
                    overlayRef.current.scrollTop = event.currentTarget.scrollTop;
                  }
                }}
                placeholder={placeholder ?? t('chat.placeholder')}
                value={value}
                variant="borderless"
                onChange={(event) => {
                  const next = event.target.value;
                  onChange(next);
                  if (timerRef.current) clearTimeout(timerRef.current);
                  if (mentionEnabled) {
                    const token = extractMentionToken(next);
                    if (token !== null) {
                      setMentionQuery(token);
                      setActiveIndex(0);
                      setMentionOpen(true);
                      // 输入时只做一次懒加载（页面缓存 mentions 列表），延迟触发避免连打抖动。
                      timerRef.current = setTimeout(onMentionTrigger, 80);
                    } else {
                      setMentionOpen(false);
                    }
                  } else {
                    setMentionOpen(false);
                  }
                }}
              />
              <div aria-hidden className={styles.mentionOverlay} ref={overlayRef}>
                {overlaySegments.map((segment, index) =>
                  segment.type === 'mention' && segment.mention ? (
                    <span className={styles.mentionChip} key={index}>
                      <span className={styles.mentionChipIcon}>{segment.mention.icon}</span>
                      {segment.mention.agentFullName}
                    </span>
                  ) : (
                    <span key={index}>{segment.text}</span>
                  ),
                )}
              </div>
            </div>
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
          {mentionOpen && (
            <AgentMentionMenu
              activeIndex={activeIndex}
              loading={mentionsLoading}
              mentions={filteredMentions}
              onActiveChange={setActiveIndex}
              onSelect={selectMention}
            />
          )}
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
