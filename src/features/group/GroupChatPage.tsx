// Group conversation — LobeHub group Conversation + Portal adaptation (slim)
import { ActionIcon, Avatar, Block, Button, Flexbox, Icon, Segmented, Tabs, Tag, Text } from '@lobehub/ui';
import { DropdownMenu } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { message } from 'antd';
import { ChevronLeft, Clock3, Info, Play, Plus, Users, X } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { agentGroupService } from '@/api/agent-group/agentGroupService';
import { agentMarketService, type MentionAgent } from '@/api/market/agentMarketService';
import {
  sessionHistoryService,
  type SessionMessageRecord,
  type SessionRecord,
} from '@/api/session/sessionHistoryService';
import ChatInput from '@/features/chat/components/ChatInput';
import ChatItem from '@/features/chat/components/ChatItem';
import FeedbackModal, { type FeedbackTarget } from '@/features/chat/components/FeedbackModal';
import { MessageActions } from '@/features/chat/components/MessageActions';
import { buildSessionTitle, parseMentionedAgents } from '@/features/chat/mentions';
import type { OpStatusActivity } from '@/features/chat/components/OpStatusTray';
import NavHeader from '@/components/shell/NavHeader';
import {
  buildDisplayUnits,
  HistoryDivider,
  renderRunBlocks,
  renderStoredBlocks,
  stripRunErrorText,
  type StoredTextMessage,
} from '@/features/chat/components/MessageBlocks';
import { useAgentDockConversation } from '@/features/chat/useAgentDockConversation';
import { useChatScroll } from '@/features/chat/hooks/useChatScroll';
import { useLoadEarlierVisibility } from '@/features/chat/hooks/useLoadEarlierVisibility';
import {
  getHistoryWindowLimit,
  shouldReloadPersistedRun,
} from '@/features/chat/historyWindow';
import {
  findLiveProcessHostId,
  findStoredProcessHosts,
} from '@/features/chat/messageBlockOwnership';
import { messageFeedbackService } from '@/api/conversation/messageFeedbackService';
import type { RuntimeStep } from '@/api/runtime/types';
import { useI18n } from '@/i18n';
import { useUiStore } from '@/stores/uiStore';
import {
  runtimeMessageToSessionRecord,
  SpecialMessage,
} from '@/features/chat/components/lobehub/SpecialMessages';

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  panel: css`
    flex: none;
    width: 300px;
    overflow-y: auto;
    border-inline-start: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
  `,
  scroll: css`
    overflow-y: auto;
    flex: 1;
  `,
  surface: css`
    position: absolute;
    inset-inline: 0;
    inset-block-end: 0;
    padding: 12px 24px 16px;
    background: linear-gradient(transparent, ${token.colorBgContainer} 24%);
    /* 透明渐变区不拦截点击：最后一条消息的悬浮操作栏可被真实鼠标点击。 */
    pointer-events: none;
  `,
}));

const DEFAULT_GROUP_MEMBERS = [
  { agentId: 'flight-analysis', fab: 'F15B', version: '2.1.0' },
  { agentId: 'data-check', fab: 'F15B' },
  { agentId: 'report-writer', fab: 'F15B' },
];

const HISTORY_DIVIDER_MS = 30 * 60 * 1000;

interface StoredGroupConfig {
  config?: { maxIterations?: number };
  members?: Array<{ agentId: string; fab: string; version?: string }>;
  orchestrationMode?: string;
}

const GroupChatPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const sessionId = id || '';
  const showReasoning = useUiStore((s) => s.showReasoning);

  const pendingSession = (location.state as { pendingSession?: SessionRecord } | null)?.pendingSession;
  const [session, setSession] = useState<SessionRecord | undefined>(
    pendingSession?.id === sessionId ? pendingSession : undefined,
  );
  const [history, setHistory] = useState<SessionMessageRecord[]>([]);
  // 会话内消息懒加载：首屏最近一页，加载更早按文本所属 run 整轮追加。
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadEarlierVisibility = useLoadEarlierVisibility(sessionId);
  const nextCursorRef = useRef<number | undefined>(undefined);
  const loadedTextCountRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const [input, setInput] = useState('');
  const [runStartedAt, setRunStartedAt] = useState<number>();
  const [feedbackModal, setFeedbackModal] = useState<FeedbackTarget>();
  const [modes, setModes] = useState<Array<{ modeId: string; name: string }>>([]);
  const [mode, setMode] = useState('supervisor');
  const [members, setMembers] = useState(DEFAULT_GROUP_MEMBERS);
  const [mentions, setMentions] = useState<MentionAgent[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [composerHeight, setComposerHeight] = useState(0);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const currentSessionIdRef = useRef(sessionId);
  currentSessionIdRef.current = sessionId;

  const groupConfig = useMemo<StoredGroupConfig | undefined>(() => {
    const value = session?.group;
    return value && typeof value === 'object'
      ? (value as StoredGroupConfig)
      : undefined;
  }, [session?.group]);
  const configuredMembers = groupConfig?.members?.length ? groupConfig.members : undefined;

  const loadInitialHistory = useCallback(async () => {
    const targetSessionId = sessionId;
    const page = await sessionHistoryService.getMessagesPage(targetSessionId);
    if (currentSessionIdRef.current !== targetSessionId) return;
    setHistory(page.records);
    setHasMoreOlder(page.hasMore);
    nextCursorRef.current = page.nextBeforeSequence;
    loadedTextCountRef.current = page.records.filter((record) => record.kind === 'text').length;
  }, [sessionId]);

  const loadOlderHistory = useCallback(async () => {
    if (loadingOlderRef.current || nextCursorRef.current === undefined) return;
    const targetSessionId = sessionId;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const page = await sessionHistoryService.getMessagesPage(targetSessionId, {
        beforeSequence: nextCursorRef.current,
      });
      if (currentSessionIdRef.current !== targetSessionId) return;
      setHistory((current) => [...page.records, ...current]);
      setHasMoreOlder(page.hasMore);
      nextCursorRef.current = page.nextBeforeSequence;
      loadedTextCountRef.current += page.records.filter((record) => record.kind === 'text').length;
    } finally {
      if (currentSessionIdRef.current === targetSessionId) {
        loadingOlderRef.current = false;
        setLoadingOlder(false);
      }
    }
  }, [sessionId]);

  /** 变更/终态后刷新：按当前已加载文本数重取“最新 N 条文本窗口”，保留已加载的更早内容。 */
  const reloadHistoryWindow = useCallback(async () => {
    // 新群聊的初始计数为 0，终态也必须重取至少一整轮，否则 live→history
    // 切换时会回到欢迎页。分页服务按 run 整组返回。
    const targetSessionId = sessionId;
    const target = getHistoryWindowLimit(loadedTextCountRef.current);
    const page = await sessionHistoryService.getMessagesPage(targetSessionId, { limit: target });
    if (currentSessionIdRef.current !== targetSessionId) return;
    setHistory(page.records);
    setHasMoreOlder(page.hasMore);
    nextCursorRef.current = page.nextBeforeSequence;
    loadedTextCountRef.current = page.records.filter((record) => record.kind === 'text').length;
  }, [sessionId]);

  const mentionByMember = (member: { agentId: string; fab: string }) =>
    mentions.find((item) => item.agentId === member.agentId && item.fab === member.fab);
  const availableMentions = mentions.filter(
    (item) => !members.some((member) => member.agentId === item.agentId && member.fab === item.fab),
  );

  const fab = session?.fab || 'F15B';
  const { respondToHitl, restore, run, send, sendA2uiAction, stop } = useAgentDockConversation({
    agentId: 'group',
    fab,
    group: {
      members,
      orchestrationMode: mode,
      config: groupConfig?.config ?? { maxIterations: 6 },
    },
    sessionId,
    threadId: session?.threadId,
  });

  // 运行中与 HITL 暂停都视为忙态：发送按钮切换为停止、Enter 不发送、草稿保留。
  const running = run?.status === 'running' || run?.status === 'paused';
  // 完成/取消/失败的 run 刷新后按历史渲染（可编辑/操作），只有进行中才走 live 渲染。
  const isActiveRun = run?.status === 'running' || run?.status === 'paused';
  // 已删消息墓碑：删除并重新生成时后端线程仍会带回被删轮次，展示与落库都需跳过。
  const deletedKeys = useMemo(() => new Set(session?.deletedMessageIds ?? []), [session?.deletedMessageIds]);
  const orderedLiveMessages = run?.messageOrder?.length
    ? run.messageOrder.map((messageId) => run.messages[messageId]).filter(Boolean)
    : Object.values(run?.messages || {});
  const liveMessages = orderedLiveMessages.filter(
    (message) =>
      !String(message.id).startsWith('lc_run--') &&
      !deletedKeys.has(`text:${message.id}`) &&
      !deletedKeys.has(`tool:${message.id}`),
  );
  const answer = liveMessages
    .filter((message) => message.role === 'assistant')
    .at(-1)?.content;
  const currentUserMessage = liveMessages
    .filter((message) => message.role === 'user')
    .at(-1)?.content;
  const liveSpecialRecords = liveMessages
    .filter((message) => message.role !== 'user' && message.role !== 'assistant')
    .map((message, index) =>
      runtimeMessageToSessionRecord(message, run?.runId || '', index, runStartedAt),
    );
  // RUN_ERROR：剥离消息末尾的错误文本，由 agentDock.error 活动渲染错误卡。
  const displayAnswer = stripRunErrorText(answer || '', run?.error?.message);
  const surface = Object.entries(run?.surfaces || {}).at(-1);
  // 错误重试：重新发送该轮最后一条用户消息。
  const regenerateError = useCallback(
    (runId?: string) => {
      const prompt = runId
        ? history.find((record) => record.runId === runId && record.role === 'user')?.content
        : currentUserMessage;
      if (prompt) void sendMessage(prompt);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUserMessage, history],
  );

  // LobeHub OpStatusTray 的 activity 等价物：只认真实工具调用（排除 A2UI 内部工具）。
  const opStatusActivity: OpStatusActivity = useMemo(() => {
    if (!run) return 'generating';
    const anyToolRunning = Object.values(run.toolCalls || {}).some(
      (call) =>
        (call.status === 'running' || call.status === 'called') &&
        call.apiName !== 'generate_a2ui' &&
        call.apiName !== 'render_a2ui',
    );
    if (anyToolRunning) return 'toolCalling';
    const anyReasoningStreaming = Object.values(run.reasoningMeta || {}).some(
      (meta) => meta?.streaming,
    );
    if (anyReasoningStreaming) return 'reasoning';
    return 'generating';
  }, [run]);
  const opStepCount = useMemo(() => Object.values(run?.steps || {}).length, [run]);
  const lastLiveMessageId = Object.keys(run?.messages || {}).at(-1) || '';

  useEffect(() => {
    loadingOlderRef.current = false;
    setLoadingOlder(false);
    setHistory([]);
    setSession(pendingSession?.id === sessionId ? pendingSession : undefined);
    setRunStartedAt(undefined);
    // pendingSession 只在切换到新 id 时用于首帧，避免旧群聊历史残留。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      navigate('/group', { replace: true });
      return;
    }
    const targetSessionId = sessionId;
    void sessionHistoryService.getSession(targetSessionId).then((value) => {
      if (currentSessionIdRef.current !== targetSessionId) return;
      if (!value) {
        if (pendingSession?.id === targetSessionId) {
          setSession(pendingSession);
          return;
        }
        navigate('/group', { replace: true });
        return;
      }
      setSession(value);
    });
    void loadInitialHistory();
    void restore();
  }, [loadInitialHistory, navigate, pendingSession?.id, restore, sessionId]);

  useEffect(() => {
    void agentGroupService
      .getSupportedAgentGroupOrchestrationModes({ locale: 'zh-CN' })
      .then((data) => {
        setModes(data.modes);
        setMode(data.defaultModeId);
      });
  }, []);

  useEffect(() => {
    void agentMarketService.getMentionAgentsList({ locale: 'zh-CN' }).then(({ items }) => setMentions(items));
  }, []);

  useEffect(() => {
    if (configuredMembers?.length) setMembers(configuredMembers);
  }, [configuredMembers]);

  useEffect(() => {
    if (
      groupConfig?.orchestrationMode &&
      modes.some((item) => item.modeId === groupConfig.orchestrationMode)
    ) {
      setMode(groupConfig.orchestrationMode);
    }
  }, [groupConfig?.orchestrationMode, modes]);

  const storedMessages = useMemo<StoredTextMessage[]>(() => {
    const liveTextIds = isActiveRun ? new Set(Object.keys(run?.messages || {})) : new Set<string>();
    // 块按 runId 归属（等价 LobeHub 的 messageId 归属），助手文本拿到该 run 的全部块。
    const blocksByRun = new Map<string, SessionMessageRecord[]>();
    for (const record of history) {
      if (record.kind === 'text' || !record.runId) continue;
      const bucket = blocksByRun.get(record.runId) ?? [];
      bucket.push(record);
      blocksByRun.set(record.runId, bucket);
    }
    const processHosts = findStoredProcessHosts(history);
    const result: StoredTextMessage[] = [];
    for (const record of history) {
      if (record.id.startsWith('lc_run--')) continue;
      const rawTextId = record.id.replace(/^text:/, '');
      if (record.kind !== 'text' || liveTextIds.has(rawTextId) || deletedKeys.has(record.id)) continue;
      // 空占位隐藏：assistant 行无内容且无过程块（如 START 后即停止/刷新）不渲染空气泡；
      // 有工具/推理块的空气泡保留（块需要 assistant 文本作宿主）。
      if (record.role === 'assistant' && !record.content && !(record.runId && (blocksByRun.get(record.runId)?.length ?? 0) > 0)) continue;
      const blocks = record.runId && processHosts.get(record.runId) === record.id
        ? (blocksByRun.get(record.runId) ?? [])
        : [];
      result.push({ blocks, record });
    }
    return result;
  }, [deletedKeys, history, isActiveRun, run?.messages]);

  // 同一轮 run 的连续助手文本合并为单个气泡（与单聊共用 buildDisplayUnits）。
  const displayUnits = useMemo(() => buildDisplayUnits(storedMessages), [storedMessages]);

  const { scrollRef, stickToBottom } = useChatScroll({
    answer,
    composerHeight,
    contentVersion: displayUnits,
    historyLength: history.length,
    runStatus: run?.status,
  });

  // 只在 IndexedDB 确认终态落库完成后重建 live→history DOM。
  // RUN_FINISHED 状态本身早于 flush；若在状态变化时立刻读取，新群聊只会读到
  // paused 快照中的用户消息，助手答复会消失直到刷新页面。
  const runStatusRef = useRef(run?.status);
  runStatusRef.current = run?.status;
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (detail?.sessionId && detail.sessionId !== sessionId) return;
      if (!shouldReloadPersistedRun(runStatusRef.current)) return;
      void reloadHistoryWindow().then(() => {
        stickToBottom();
        // 终态后内容可能延迟增高：强制贴底直到高度连续 1s 稳定（或 12s 上限）。
        let stableTicks = 0;
        let lastHeight = -1;
        const settleTimer = window.setInterval(() => {
          const node = scrollRef.current;
          if (!node) return;
          node.scrollTop = node.scrollHeight;
          if (node.scrollHeight === lastHeight) {
            stableTicks += 1;
            if (stableTicks >= 4) window.clearInterval(settleTimer);
          } else {
            stableTicks = 0;
            lastHeight = node.scrollHeight;
          }
        }, 250);
        window.setTimeout(() => window.clearInterval(settleTimer), 12_000);
      });
    };
    window.addEventListener('agentdock:run-persisted', refresh);
    return () => window.removeEventListener('agentdock:run-persisted', refresh);
  }, [reloadHistoryWindow, scrollRef, sessionId, stickToBottom]);

  const blocks = renderRunBlocks(run, {
    onApproveHitl: (requestId, payload) =>
      void respondToHitl({
        mode: String(payload?.mode || 'toolAuthorization'),
        decision: 'approve',
        requestId,
        ...(payload?.editedArguments !== undefined ? { editedArguments: payload.editedArguments as Record<string, unknown> } : {}),
        ...(payload?.input !== undefined ? { input: String(payload.input) } : {}),
        ...(payload?.selectedValues !== undefined ? { selectedValues: payload.selectedValues as string[] } : {}),
        ...(payload?.formValues !== undefined ? { formValues: payload.formValues as Record<string, unknown> } : {}),
      }),
    onRejectHitl: (requestId) =>
      void respondToHitl({ mode: 'toolAuthorization', decision: 'reject', requestId }),
    onSurfaceAction: () =>
      surface &&
      void sendA2uiAction({
        actionName: 'open_report',
        context: { reportId: 'artifact-report' },
        sourceComponentId: 'open',
        surfaceId: surface[0],
      }),
    onRegenerateError: () => regenerateError(),
  }, { deletedKeys, showReasoning });
  const hasLiveAssistant = liveMessages.some((message) => message.role === 'assistant');
  const liveProcessHostId = findLiveProcessHostId(liveSpecialRecords, hasLiveAssistant);
  const hasLiveBlocks = Array.isArray(blocks) && blocks.length > 0;
  const showLiveAssistant = Boolean(answer) || (
    !liveProcessHostId && (hasLiveBlocks || liveSpecialRecords.length === 0)
  );

  const hasAnyMessage = storedMessages.length > 0 || (isActiveRun && Boolean(answer || running || run?.status));

  // 消息列底部留白跟随输入区实际高度（textarea 自动变高时也能滚到最后一条）。
  useEffect(() => {
    const node = surfaceRef.current;
    if (!node) return;
    const update = () => setComposerHeight(node.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const sendMessage = async (message: string) => {
    if (!session) return false;
    const mentionAgents = parseMentionedAgents(message, mentions);
    stickToBottom();
    setRunStartedAt(Date.now());
    await sessionHistoryService.updateSession(session.id, {
      title: session.title === t('nav.newGroup') ? buildSessionTitle(message, session.title) : session.title,
    });
    void send(message, { mentionAgents }).catch((reason) => {
      console.error('[AgentDock] group run start failed', reason);
    });
    return true;
  };

  // 发送输入框内容后立即清空输入框（与单聊一致）；示例消息走 sendMessage 不清空。
  const handleSend = async (content: string) => {
    const prompt = content.trim();
    if (!prompt || !session) return false;
    return sendMessage(prompt);
  };

  const commitMembers = (next: typeof members) => {
    setMembers(next);
    if (!session) return;
    void sessionHistoryService
      .updateSession(session.id, {
        group: {
          members: next,
          orchestrationMode: mode,
          config: groupConfig?.config ?? { maxIterations: 6 },
        },
      })
      .catch((reason) => console.warn('[AgentDock] group members persist failed', reason));
  };

  const addMember = (mention: MentionAgent) => {
    if (members.some((member) => member.agentId === mention.agentId && member.fab === mention.fab)) return;
    commitMembers([...members, { agentId: mention.agentId, fab: mention.fab, version: mention.version }]);
  };

  const removeMember = (member: { agentId: string; fab: string }) => {
    if (members.length <= 2) {
      message.warning(t('group.chat.needAtLeastTwo'));
      return;
    }
    commitMembers(members.filter((item) => !(item.agentId === member.agentId && item.fab === member.fab)));
  };

  return (
    <Flexbox horizontal height="100%">
      <Flexbox flex={1} height="100%" style={{ minWidth: 0, position: 'relative' }}>
        <NavHeader
          left={
            <Flexbox horizontal align="center" gap={10} style={{ minWidth: 0 }}>
              <ActionIcon
                aria-label={t('nav.chat')}
                icon={ChevronLeft}
                onClick={() => navigate('/chat/session-inbox')}
                title={t('nav.chat')}
              />
              <Avatar avatar="👥" shape="square" size={32} />
              <Flexbox style={{ minWidth: 0 }}>
                <Flexbox horizontal align="center" gap={8}>
                  <Text ellipsis fontSize={15} weight={500}>
                    {session?.title || t('nav.group')}
                  </Text>
                  <Tag color="info" size="small">
                    {t('workspace.group.members', { count: members.length })}
                  </Tag>
                  {run && (
                    <Tag
                      color={run.status === 'running' ? 'processing' : run.status === 'error' ? 'error' : run.status === 'cancelled' ? 'default' : 'success'}
                      size="small"
                    >
                      {run.status}
                    </Tag>
                  )}
                </Flexbox>
              </Flexbox>
            </Flexbox>
          }
          right={
            <Flexbox horizontal align="center" gap={4}>
              {run && (
                <Tag
                  color={run.status === 'running' ? 'processing' : run.status === 'error' ? 'error' : run.status === 'cancelled' ? 'default' : 'success'}
                  size="small"
                >
                  {run.status}
                </Tag>
              )}
              <ActionIcon
                active={settingsOpen}
                aria-label={t('group.chat.settings')}
                icon={Info}
                onClick={() => setSettingsOpen((open) => !open)}
                title={t('group.chat.settings')}
              />
            </Flexbox>
          }
        />
        <Flexbox
          horizontal
          align="center"
          gap={6}
          paddingBlock={8}
          paddingInline={16}
          style={{ borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}`, flexWrap: 'wrap', overflow: 'hidden' }}
        >
          {members.map((member) => {
            const mention = mentionByMember(member);
            return (
              <Tag
                closable
                key={`${member.agentId}@${member.fab}`}
                style={{ maxWidth: 220 }}
                onClose={(event) => {
                  event.preventDefault();
                  removeMember(member);
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    maxWidth: 170,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    verticalAlign: 'bottom',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {mention?.icon ?? '🤖'} {mention?.agentFullName ?? member.agentId} · {member.fab}
                </span>
              </Tag>
            );
          })}
          <DropdownMenu
            items={availableMentions.map((mention) => ({
              key: `${mention.agentId}@${mention.fab}`,
              label: `${mention.icon} ${mention.agentFullName} · ${mention.fab}`,
              onClick: () => addMember(mention),
            }))}
            nativeButton
            placement="bottomLeft"
          >
            <Button icon={Plus} size="small">
              {t('group.chat.addMember')}
            </Button>
          </DropdownMenu>
        </Flexbox>
        <Flexbox
          className={styles.scroll}
          data-testid="chat-scroll"
          ref={scrollRef}
          onTouchMove={loadEarlierVisibility.onTouchMove}
          onTouchStart={loadEarlierVisibility.onTouchStart}
          onWheel={loadEarlierVisibility.onWheel}
        >
          <Flexbox
            gap={8}
            style={{
              marginInline: 'auto',
              maxWidth: 840,
              padding: '24px 24px',
              paddingBottom: composerHeight + 32,
              width: '100%',
            }}
          >
            {hasMoreOlder && loadEarlierVisibility.visible && (
              <Flexbox align="center" paddingBlock={10}>
                <Button loading={loadingOlder} size="small" onClick={() => void loadOlderHistory()}>
                  {t('chat.loadEarlier')}
                </Button>
              </Flexbox>
            )}
            {!hasAnyMessage && (
              <Flexbox align="center" gap={16} paddingBlock={48}>
                <Icon color={cssVar.colorPrimary} icon={Users} size={48} />
                <Flexbox align="center" gap={6}>
                  <Text as="h1" fontSize={22} weight={600}>
                    {t('group.welcome.title')}
                  </Text>
                  <Text type="secondary">{t('group.welcome.desc')}</Text>
                </Flexbox>
                <Button type="primary" onClick={() => void sendMessage(t('workspace.group.sampleMessage'))}>
                  {t('workspace.group.start')}
                </Button>
              </Flexbox>
            )}
            {displayUnits.map(({ blocks: storedBlocks, narration, record }, index) => {
              const previous = index > 0 ? displayUnits[index - 1].record : undefined;
              const gap = previous
                ? new Date(record.createdAt).getTime() - new Date(previous.createdAt).getTime()
                : 0;
              const originalContent = record.content || '';
              // RUN_ERROR 历史：run 内有 agentDock.error 活动时剥离末尾错误文本，由错误卡展示。
              const errorActivity = storedBlocks.find(
                (block) =>
                  block.kind === 'activity' &&
                  block.payload?.activityType === 'agentDock.error',
              );
              const displayContent = stripRunErrorText(
                originalContent,
                typeof errorActivity?.payload?.message === 'string'
                  ? errorActivity.payload.message
                  : undefined,
              );
              const renderedStoredBlocks = record.role === 'user' ? null : renderStoredBlocks(storedBlocks, {
                onApproveHitl: (requestId, payload) =>
                  void respondToHitl({
                    mode: String(payload?.mode || 'toolAuthorization'),
                    decision: 'approve',
                    requestId,
                    ...(payload?.editedArguments !== undefined ? { editedArguments: payload.editedArguments as Record<string, unknown> } : {}),
                    ...(payload?.input !== undefined ? { input: String(payload.input) } : {}),
                    ...(payload?.selectedValues !== undefined ? { selectedValues: payload.selectedValues as string[] } : {}),
                    ...(payload?.formValues !== undefined ? { formValues: payload.formValues as Record<string, unknown> } : {}),
                  }),
                onRejectHitl: (requestId) =>
                  void respondToHitl({ mode: 'toolAuthorization', decision: 'reject', requestId }),
                onSurfaceAction: (surfaceId) =>
                  void sendA2uiAction({
                    actionName: 'open_report',
                    context: { reportId: 'artifact-report' },
                    sourceComponentId: 'open',
                    surfaceId,
                  }),
                onRegenerateError: (runId) => regenerateError(runId),
              }, { deletedKeys, narration, showReasoning });
              const assistantActions = (
                <MessageActions
                  content={originalContent}
                  onCopy={(content) => void navigator.clipboard.writeText(content || '')}
                  onDislike={() =>
                    setFeedbackModal({
                      messageId: record.id,
                      runId: record.runId || '',
                      sessionId,
                      threadId: session?.threadId || '',
                    })
                  }
                  onLike={() =>
                    void messageFeedbackService.submitMessageFeedback({
                      messageId: record.id,
                      runId: record.runId || '',
                      sessionId,
                      threadId: session?.threadId || '',
                      feedback: 'like',
                    })
                  }
                  onRestoreToInput={(content) => setInput(content)}
                />
              );
              return (
                <Fragment key={record.id}>
                  {gap > HISTORY_DIVIDER_MS && <HistoryDivider label={t('chat.history')} />}
                  {record.role === 'user' ? (
                    <ChatItem
                      actions={
                        <MessageActions
                          content={originalContent}
                          placement="user"
                          onCopy={(content) => void navigator.clipboard.writeText(content || '')}
                          onRestoreToInput={(content) => setInput(content)}
                        />
                      }
                      content={displayContent}
                      id={record.id}
                      name={t('chat.you')}
                      role="user"
                      showTitle={false}
                      time={new Date(record.createdAt).getTime()}
                    />
                  ) : record.role === 'assistant' || !record.role ? (
                    <ChatItem
                      actions={assistantActions}
                      avatar="👥"
                      content={record.content}
                      id={record.id}
                      name={session?.title || t('nav.group')}
                      role="assistant"
                      showAvatar
                      showTitle
                      time={new Date(record.createdAt).getTime()}
                    >
                      {renderedStoredBlocks}
                    </ChatItem>
                  ) : (
                    <SpecialMessage
                      actions={assistantActions}
                      agentAvatar="👥"
                      agentName={session?.title || t('nav.group')}
                      content={displayContent}
                      record={record}
                    >
                      {renderedStoredBlocks}
                    </SpecialMessage>
                  )}
                </Fragment>
              );
            })}
            {isActiveRun && (answer || running || run?.status) && (
              <>
                <ChatItem
                  actions={
                    <MessageActions
                      content={currentUserMessage || input}
                      placement="user"
                      onCopy={(content) => void navigator.clipboard.writeText(content || '')}
                      onRestoreToInput={(content) => setInput(content)}
                    />
                  }
                  content={currentUserMessage || input}
                  id="current-group-user"
                  name={t('chat.you')}
                  role="user"
                  time={Date.now()}
                />
                {liveSpecialRecords.map((record) => (
                  <SpecialMessage
                    agentAvatar="👥"
                    agentName={session?.title || t('nav.group')}
                    key={record.id}
                    loading={running}
                    record={record}
                  >
                    {record.id === liveProcessHostId ? blocks : undefined}
                  </SpecialMessage>
                ))}
                {showLiveAssistant && <ChatItem
                  actions={
                    !running && (
                      <MessageActions
                        content={answer || ''}
                        onCopy={(content) => void navigator.clipboard.writeText(content || '')}
                        onDislike={() =>
                          setFeedbackModal({
                            messageId: lastLiveMessageId,
                            runId: run?.runId || '',
                            sessionId,
                            threadId: session?.threadId || '',
                          })
                        }
                        onLike={() =>
                          void messageFeedbackService.submitMessageFeedback({
                            messageId: lastLiveMessageId,
                            runId: run?.runId || '',
                            sessionId,
                            threadId: session?.threadId || '',
                            feedback: 'like',
                          })
                        }
                        onRestoreToInput={(content) => setInput(content)}
                      />
                    )
                  }
                  avatar="👥"
                  content={displayAnswer}
                  enableStream={running}
                  id="current-group-assistant"
                  loading={running}
                  name={session?.title || t('nav.group')}
                  role="assistant"
                  time={Date.now()}
                >
                  {!liveProcessHostId && blocks}
                </ChatItem>}
              </>
            )}
          </Flexbox>
        </Flexbox>
        <Flexbox className={styles.surface} ref={surfaceRef}>
          <Flexbox
            style={{
              marginInline: 'auto',
              maxWidth: 840,
              pointerEvents: 'auto',
              width: '100%',
            }}
          >
            <ChatInput
              activity={opStatusActivity}
              agentName={session?.title || t('nav.group')}
              fab={fab}
              draftKey={`group:${sessionId}`}
              mentions={mentions}
              running={running}
              value={input}
              onChange={setInput}
              onSend={handleSend}
              onStop={() => void stop()}
              runStatus={run?.status}
              startTime={runStartedAt}
              stepCount={opStepCount}
            />
          </Flexbox>
        </Flexbox>
      </Flexbox>

      {settingsOpen && (
      <Flexbox className={styles.panel} gap={16} padding={16}>
        <Tabs
          items={[
            {
              children: (
                <Flexbox gap={14}>
                  <Text weight={500}>{t('workspace.group.mode')}</Text>
                  <Segmented
                    block
                    options={modes.map((item) => ({ label: item.name, value: item.modeId }))}
                    value={mode}
                    onChange={(value) => setMode(String(value))}
                  />
                  <Text fontSize={12} type="secondary">
                    {t('workspace.group.modeHint')}
                  </Text>
                  {running ? (
                    <Button block icon={Clock3} onClick={() => void stop()}>
                      {t('workspace.group.stop')}
                    </Button>
                  ) : (
                    <Button
                      block
                      icon={Play}
                      type="primary"
                      onClick={() => void sendMessage(t('workspace.group.sampleMessage'))}
                    >
                      {t('workspace.group.start')}
                    </Button>
                  )}
                </Flexbox>
              ),
              key: 'mode',
              label: t('workspace.group.mode'),
            },
            {
              children: (
                <Flexbox gap={14}>
                  <Text weight={500}>{t('workspace.group.task')}</Text>
                  <Text style={{ lineHeight: 1.7 }}>{t('workspace.group.taskDesc')}</Text>
                  <Flexbox horizontal gap={8}>
                    <Tag>maxIterations: 6</Tag>
                    <Tag>{t('workspace.group.timeout')}</Tag>
                  </Flexbox>
                </Flexbox>
              ),
              key: 'task',
              label: t('workspace.group.task'),
            },
            {
              children: (
                <Flexbox gap={14}>
                  <Text weight={500}>{t('workspace.group.members', { count: members.length })}</Text>
                  {members.map((member, index) => {
                    const mention = mentionByMember(member);
                    return (
                      <Flexbox
                        horizontal
                        align="center"
                        gap={12}
                        key={`${member.agentId}@${member.fab}`}
                      >
                        <Avatar avatar={mention?.icon ?? '🤖'} shape="square" size={40} />
                        <Flexbox flex={1} style={{ minWidth: 0 }}>
                          <Text ellipsis weight={500}>
                            {mention?.agentFullName ?? member.agentId}
                          </Text>
                          <Text fontSize={12} type="secondary">
                            v{member.version || '—'} · {member.fab}
                          </Text>
                        </Flexbox>
                        {index === 0 && <Tag color="info">Supervisor</Tag>}
                        <ActionIcon
                          aria-label={t('group.chat.removeMember')}
                          icon={X}
                          onClick={() => removeMember(member)}
                          title={t('group.chat.removeMember')}
                        />
                      </Flexbox>
                    );
                  })}
                  <Button icon={Plus}>{t('workspace.group.addMember')}</Button>
                </Flexbox>
              ),
              key: 'members',
              label: t('workspace.group.members', { count: members.length }),
            },
          ]}
          variant="square"
        />
      </Flexbox>
      )}
      <FeedbackModal
        onClose={() => setFeedbackModal(undefined)}
        open={!!feedbackModal}
        target={feedbackModal}
      />
    </Flexbox>
  );
};

export default GroupChatPage;
