// 输入区：真实迁移 @lobehub/editor（LobeHub ChatInput/InputEditor 同款）。
// @ 联想菜单、蓝色 mention chip、整块删除、`<mention name id />` markdown 序列化
// 全部由官方编辑器实现，不再使用 TextArea + 叠加层方案。
import { ActionIcon, Alert, Avatar, Button, Flexbox, Select, Tag, Text } from '@lobehub/ui';
import { INSERT_MARKDOWN_COMMAND, INSERT_MENTION_COMMAND, type IEditor } from '@lobehub/editor';
import { Editor } from '@lobehub/editor/react';
import { createStaticStyles, cssVar } from 'antd-style';
import { COMMAND_PRIORITY_HIGH, KEY_DOWN_COMMAND } from 'lexical';
import { ArrowBigUp, CornerDownLeft, Mic, Paperclip, Send, Square } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';

import { type MentionAgent } from '@/api/market/agentMarketService';
import type { RunStatus } from '@/api/runtime/types';
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
  editor: css`
    min-height: 44px;
    max-height: 200px;
    overflow-y: auto;
    padding: 0;
    font-size: 14px;
    line-height: 1.4;
  `,
  footer: css`
    padding-block: 8px 2px;
  `,
  // LobeHub mention chip 视觉：扁平填充蓝色（对齐官网截图，不走主题 primary 中性色）。
  mentionOverride: css`
    .editor_mention {
      border: none;
      color: ${cssVar.blue9};
      background: ${cssVar.blue1};
    }
  `,
}));

interface ChatInputProps {
  /** 当前活动（官方 OpStatusTray 的 activity 等价物）。 */
  activity?: OpStatusActivity;
  agentName?: string;
  approvalMode?: ApprovalMode;
  fab?: string;
  /** 关闭 @ 提及（输入 @ 不再弹出菜单）。 */
  mentionEnabled?: boolean;
  mentions: MentionAgent[];
  onChange: (value: string) => void;
  onApprovalModeChange?: (mode: ApprovalMode) => void;
  /** 发送输入区内容（markdown，含 <mention> 标签）。 */
  onSend: (content: string) => void;
  onStop: () => void;
  onSwitchAgent?: (agent: MentionAgent) => void;
  placeholder?: string;
  runStatus?: RunStatus;
  running: boolean;
  sendDisabled?: boolean;
  /** 本轮 run 开始时间，用于状态条计时。 */
  startTime?: number;
  stepCount?: number;
  switchAgents?: MentionAgent[];
  value: string;
}

const MentionItemLabel = memo<{ mention: MentionAgent }>(({ mention }) => (
  <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0, overflow: 'hidden' }}>
    <Avatar avatar={mention.icon} shape="square" size={24} style={{ flex: 'none' }} />
    <Flexbox style={{ minWidth: 0 }}>
      <Text ellipsis fontSize={13} weight={500}>
        {mention.agentFullName}
      </Text>
      <Text ellipsis fontSize={11} type="secondary">
        v{mention.version} · {mention.fab}
      </Text>
    </Flexbox>
  </Flexbox>
));

MentionItemLabel.displayName = 'MentionItemLabel';

const ChatInput = memo<ChatInputProps>(
  ({
    activity,
    agentName,
    approvalMode = 'manual',
    fab,
    mentionEnabled = true,
    mentions,
    onChange,
    onApprovalModeChange,
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
    const editorRef = useRef<IEditor | null>(null);
    // 发送后编辑器缓存的 markdown 可能在下一次 onTextChange 回写，导致输入框“复活”。
    // 记录最近一次已发送内容，相同内容回写时忽略一次。
    const lastSentRef = useRef<string>('');

    const getMarkdown = useCallback((editor?: IEditor | null) => {
      if (!editor) return '';
      return String(editor.getDocument('markdown') || '').trimEnd();
    }, []);

    const handleEditorInit = useCallback(
      (editor: IEditor) => {
        editorRef.current = editor;
      },
      [],
    );

    const handleTextChange = useCallback(
      (editor: IEditor) => {
        const markdown = getMarkdown(editor);
        if (lastSentRef.current && markdown === lastSentRef.current) {
          lastSentRef.current = '';
          return;
        }
        onChange(markdown);
      },
      [getMarkdown, onChange],
    );

    // 外部受控 value（发送后清空 / 候选问题 / 恢复草稿）同步进编辑器。
    // setDocument('markdown') 不受支持，改用 cleanDocument + INSERT_MARKDOWN_COMMAND。
    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const current = getMarkdown(editor);
      if (value === current) return;
      editor.cleanDocument();
      if (value) {
        editor.dispatchCommand(INSERT_MARKDOWN_COMMAND, { historyState: null, markdown: value });
      }
    }, [getMarkdown, value]);

    // Enter 发送：注册在 COMMAND_PRIORITY_HIGH。
    // 菜单打开时菜单的 CRITICAL 处理器先消费 Enter（选中）；Lexical 默认换行在 EDITOR
    // 优先级，晚于我们，因此能可靠拦截发送且不影响菜单选中与 Shift+Enter 换行。
    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      return editor.registerHighCommand(
        KEY_DOWN_COMMAND,
        (event) => {
          if (event.key !== 'Enter' || event.isComposing || event.shiftKey || sendDisabled) {
            return false;
          }
          const content = getMarkdown(editor);
          if (!content) return false;
          lastSentRef.current = content;
          onSend(content);
          editor.cleanDocument();
          requestAnimationFrame(() => editor.focus());
          event.preventDefault();
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      );
    }, [getMarkdown, onSend, sendDisabled]);

    const handleSendContent = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const content = getMarkdown(editor);
      if (!content) return;
      lastSentRef.current = content;
      onSend(content);
      editor.cleanDocument();
      requestAnimationFrame(() => editor.focus());
    }, [getMarkdown, onSend]);

    // 当前 Agent（按名称+fab 匹配候选列表）：切换下拉选中态与底部 icon 共用，
    // 保证切换 Agent 后头像跟随变化，不再硬编码 🛩️。
    const currentAgent = useMemo(
      () =>
        switchAgents?.length && agentName
          ? switchAgents.find(
              (agent) => agent.agentFullName === agentName && agent.fab === fab,
            )
          : undefined,
      [agentName, fab, switchAgents],
    );
    // 切换 Agent 下拉：选中态显示当前 Agent（头像+名称），无边框紧凑样式。
    const switchValue = currentAgent ? `${currentAgent.agentId}@${currentAgent.fab}` : undefined;

    // 对齐 LobeHub：items 为函数（挂载即注册 @ trigger，数据就绪后返回列表），
    // 避免数组形式在 mentions 异步加载完成前导致 mention 插件未挂载。
    const mentionItems = useMemo(
      () =>
        mentions.map((mention) => {
          const searchText = `${mention.agentFullName} ${mention.fab} ${mention.description}`;
          return {
            key: `${mention.agentId}@${mention.fab}`,
            label: <MentionItemLabel mention={mention} />,
            metadata: {
              agentId: mention.agentId,
              fab: mention.fab,
              icon: mention.icon,
              id: `${mention.agentId}@${mention.fab}`,
              label: mention.agentFullName,
              searchText,
              version: mention.version,
            },
          };
        }),
      [mentions],
    );

    const mentionItemsFn = useCallback(
      async (search: { matchingString: string } | null) => {
        const query = (search?.matchingString || '').trim().toLowerCase();
        if (!query) return mentionItems;
        return mentionItems.filter((item) =>
          String(item.metadata?.searchText ?? item.key).toLowerCase().includes(query),
        );
      },
      [mentionItems],
    );

    const mentionOption = useMemo(
      () =>
        mentionEnabled
          ? {
              items: mentionItemsFn,
              maxLength: 50,
              markdownWriter: (node: { label: string; metadata?: Record<string, unknown> }) =>
                `<mention name="${node.label}" id="${String(node.metadata?.id ?? '')}" />`,
              onSelect: (editor: IEditor, option: { label?: unknown; metadata?: Record<string, unknown> }) => {
                editor.dispatchCommand(INSERT_MENTION_COMMAND, {
                  label: String(option.metadata?.label ?? option.label ?? ''),
                  metadata: option.metadata,
                });
              },
            }
          : undefined,
      [mentionEnabled, mentionItemsFn],
    );

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
        <Flexbox className={styles.composer} gap={4} padding={12}>
          <div className={styles.mentionOverride}>
            <Editor
              className={styles.editor}
              content={value}
              mentionOption={mentionOption}
              onInit={handleEditorInit}
              onChange={handleTextChange}
              onTextChange={handleTextChange}
              pasteAsPlainText
              placeholder={placeholder ?? t('chat.placeholder')}
              type="text"
              variant="chat"
            />
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
                  onChange={(next) => {
                    const agent = switchAgents.find(
                      (item) => `${item.agentId}@${item.fab}` === next,
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
                  onClick={handleSendContent}
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
                <Avatar avatar={currentAgent?.icon || '🛩️'} shape="square" size={20} />
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
