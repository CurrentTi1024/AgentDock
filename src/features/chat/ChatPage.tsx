// AgentDock conversation page — LobeHub ConversationArea + ChatItem + ChatInput adaptation.
import { ActionIcon, Button, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { useRenderActivityMessage } from '@copilotkit/react-core/v2';
import { LoadingDots } from '@lobehub/ui/chat';
import { createStaticStyles, cssVar } from 'antd-style';
import { FileBarChart, X } from 'lucide-react';
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { resolveChatAgentId } from '@/features/chat/agentDetail';
import ChatHeader from '@/features/chat/components/ChatHeader';
import ChatInput from '@/features/chat/components/ChatInput';
import ChatItem from '@/features/chat/components/ChatItem';
import FeedbackModal, { type FeedbackTarget } from '@/features/chat/components/FeedbackModal';
import { MessageActions } from '@/features/chat/components/MessageActions';
import type { OpStatusActivity } from '@/features/chat/components/OpStatusTray';
import Welcome from '@/features/chat/components/Welcome';
import {
  buildDisplayUnits,
  HistoryDivider,
  renderStoredBlocks,
  renderRunBlocks,
  type StoredTextMessage,
} from '@/features/chat/components/MessageBlocks';
import { messageFeedbackService } from '@/api/conversation/messageFeedbackService';
import { getChatServiceMode } from '@/api/core/serviceMode';
import { agentMarketService, type MentionAgent } from '@/api/market/agentMarketService';
import type { RunStatus, RuntimeStep } from '@/api/runtime/types';
import {
  sessionHistoryService,
  type SessionMessageRecord,
  type SessionRecord,
} from '@/api/session/sessionHistoryService';
import { useAgentDockConversation } from '@/features/chat/useAgentDockConversation';
import { useChatScroll } from '@/features/chat/hooks/useChatScroll';
import { useUiStore } from '@/stores/uiStore';
import { useI18n } from '@/i18n';

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  artifact: css`
    flex: none;
    width: 380px;
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
    /* 透明渐变区不拦截点击：最后一条消息的悬浮操作栏（重新生成/删除/更多）可被真实鼠标点击；
       输入区内部的 ChatInput 容器单独恢复 pointer-events。 */
    pointer-events: none;
  `,
}));

// 连续同角色消息的时间间隔超过该值才插入「历史消息」分割线（LobeHub History divider）。
const HISTORY_DIVIDER_MS = 30 * 60 * 1000;

// 官方 runtime 的活动消息渲染依赖 CopilotKit Provider，仅在 http 模式下挂载。
interface OfficialActivityMessage {
  role: 'activity';
  content: Record<string, unknown>;
  id: string;
  activityType: string;
}

const OfficialActivityMessages = memo<{ agent: { messages?: unknown[] } }>(({ agent }) => {
  const { renderActivityMessage } = useRenderActivityMessage();
  const activityMessages = (agent.messages || []).filter(
    (message): message is OfficialActivityMessage =>
      (message as { role?: string }).role === 'activity',
  );
  if (activityMessages.length === 0) return null;
  return <>{activityMessages.map((message) => renderActivityMessage(message))}</>;
});

OfficialActivityMessages.displayName = 'OfficialActivityMessages';

export default function ChatPage() {
  const { t } = useI18n();
  const { id = 'session-inbox' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = id === 'inbox' ? 'session-inbox' : id;
  const pendingSession = (location.state as { pendingSession?: SessionRecord } | null)?.pendingSession;

  const [input, setInput] = useState('');
  const [editingId, setEditingId] = useState<string>();
  const [editDraft, setEditDraft] = useState('');
  const [composerHeight, setComposerHeight] = useState(0);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [feedbackModal, setFeedbackModal] = useState<FeedbackTarget>();
  const [mentions, setMentions] = useState<MentionAgent[]>([]);
  const [mentionsLoading, setMentionsLoading] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<MentionAgent>();
  const [agent, setAgent] = useState('FlightAnalysis_Agent-F15B');
  const [session, setSession] = useState<SessionRecord>();
  const [history, setHistory] = useState<SessionMessageRecord[]>([]);
  // 会话内消息懒加载：首屏最近一页，加载更早按文本所属 run 整轮追加。
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const nextCursorRef = useRef<number | undefined>(undefined);
  const loadedTextCountRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [artifact, setArtifact] = useState<{ html?: string; title?: string }>();
  const [runStartedAt, setRunStartedAt] = useState<number>();

  const loadInitialHistory = useCallback(async () => {
    const page = await sessionHistoryService.getMessagesPage(sessionId);
    setHistory(page.records);
    setHasMoreOlder(page.hasMore);
    nextCursorRef.current = page.nextBeforeSequence;
    loadedTextCountRef.current = page.records.filter((record) => record.kind === 'text').length;
  }, [sessionId]);

  const loadOlderHistory = useCallback(async () => {
    if (loadingOlderRef.current || nextCursorRef.current === undefined) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const page = await sessionHistoryService.getMessagesPage(sessionId, {
        beforeSequence: nextCursorRef.current,
      });
      setHistory((current) => [...page.records, ...current]);
      setHasMoreOlder(page.hasMore);
      nextCursorRef.current = page.nextBeforeSequence;
      loadedTextCountRef.current += page.records.filter((record) => record.kind === 'text').length;
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [sessionId]);

  /** 变更/终态后刷新：按当前已加载文本数重取“最新 N 条文本窗口”，保留已加载的更早内容。 */
  const reloadHistoryWindow = useCallback(async () => {
    // 首屏尚未建立窗口时跳过：避免 run-persisted 先于 loadInitialHistory 触发，
    // 用 1 条文本的小窗口覆盖 50 条首屏。
    if (loadedTextCountRef.current === 0) return;
    const target = Math.max(loadedTextCountRef.current, 1);
    const page = await sessionHistoryService.getMessagesPage(sessionId, { limit: target });
    setHistory(page.records);
    setHasMoreOlder(page.hasMore);
    nextCursorRef.current = page.nextBeforeSequence;
    loadedTextCountRef.current = page.records.filter((record) => record.kind === 'text').length;
  }, [sessionId]);

  const fab = selectedAgent?.fab || session?.fab || agent.split('-').at(-1) || 'F15B';
  const agentId = resolveChatAgentId(selectedAgent?.agentId, session?.agentId);
  const {
    agent: runtimeAgent,
    refreshAgentContext,
    respondToHitl,
    restore,
    run,
    send,
    sendA2uiAction,
    stop,
  } = useAgentDockConversation({
    agentId,
    fab,
    sessionId,
    threadId: session?.threadId,
  });
  // 运行中与 HITL 暂停都视为忙态：发送按钮切换为停止、Enter 不发送、草稿保留，
  // 避免暂停期间 send 被内部守卫静默拦截（输入框已清空但消息丢失）。
  const running = run?.status === 'running' || run?.status === 'paused';
  // 只有进行中的 run（running/paused）才走 live 渲染；完成的 run 刷新后按历史消息渲染，
  // 保证最后一条消息也有编辑/重新生成等操作（LobeHub 无“live 消息”概念）。
  const isActiveRun = run?.status === 'running' || run?.status === 'paused';
  // 已删消息墓碑：删除并重新生成时后端线程仍会带回被删轮次，展示与落库都需跳过。
  const deletedKeys = useMemo(() => new Set(session?.deletedMessageIds ?? []), [session?.deletedMessageIds]);
  const liveMessages = Object.values(run?.messages || {}).filter(
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
  const surface = Object.entries(run?.surfaces || {}).at(-1);

  // LobeHub OpStatusTray 的 activity 等价物：有工具在跑→调用工具中；有流式推理→思考中；否则生成中。
  const opStatusActivity: OpStatusActivity = useMemo(() => {
    if (!run) return 'generating';
    // 只认真实工具调用（排除 A2UI 内部工具）；中间件 step 不是工具调用。
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

  // @ 触发时经 Service 拉取可提及 Agent（mock 模式返回 mock 数据），只拉一次并缓存。
  const mentionsLoadedRef = useRef(false);
  const mentionsInFlightRef = useRef(false);
  const ensureMentions = useCallback(async () => {
    if (mentionsLoadedRef.current || mentionsInFlightRef.current) return;
    mentionsInFlightRef.current = true;
    setMentionsLoading(true);
    try {
      const { items } = await agentMarketService.getMentionAgentsList({ locale: 'zh-CN' });
      setMentions(items);
      mentionsLoadedRef.current = true;
      setSelectedAgent((current) => current ?? items[0]);
    } finally {
      mentionsInFlightRef.current = false;
      setMentionsLoading(false);
    }
  }, []);

  const handleInputChange = useCallback(
    (next: string) => {
      setInput(next);
      if (next.startsWith('@')) void ensureMentions();
    },
    [ensureMentions],
  );

  const { approvalMode, setApprovalMode } = useUiStore();
  // 自动审批模式：出现新的 HITL 请求时自动批准，避免打断流式。
  const autoApprovedRef = useRef(new Set<string>());
  useEffect(() => {
    if (approvalMode !== 'auto' || !run) return;
    for (const activity of Object.values(run.activities || {})) {
      const value = activity as { activityType?: string; requestId?: string };
      if (value.activityType !== 'agentDock.hitl' || !value.requestId) continue;
      if (autoApprovedRef.current.has(value.requestId)) continue;
      autoApprovedRef.current.add(value.requestId);
      void respondToHitl({ mode: 'toolAuthorization', decision: 'approve', requestId: value.requestId });
    }
  }, [approvalMode, respondToHitl, run]);

  useEffect(() => {
    const requested = mentions.find(
      (item) => item.agentId === searchParams.get('agent') && item.fab === searchParams.get('fab'),
    );
    if (requested) {
      setSelectedAgent(requested);
      setAgent(requested.agentFullName);
    }
  }, [mentions, searchParams]);

  const ensureSession = useCallback(async (): Promise<SessionRecord> => {
    // 路由切换会复用同一组件实例，不能信任内存里旧会话的 session state。
    if (session?.id === sessionId) return session;
    const existing = await sessionHistoryService.getSession(sessionId);
    if (existing) {
      setSession(existing);
      return existing;
    }
    if (pendingSession?.id === sessionId) {
      setSession(pendingSession);
      return pendingSession;
    }
    const created = await sessionHistoryService.createSession({
      agentId: selectedAgent?.agentId || 'flight-analysis',
      agentName: selectedAgent?.agentFullName,
      fab,
      // 以路由 id 作为会话主键：默认入口固定为 session-inbox，真实会话为 UUID，
      // 保证会话行、消息、checkpoint 使用同一个 sessionId。
      id: sessionId,
      pinned: false,
      threadId: crypto.randomUUID(),
      title: t('nav.newSessionTitle'),
      type: 'agent',
      version: selectedAgent?.version,
    });
    setSession(created);
    return created;
  }, [fab, pendingSession, selectedAgent?.agentFullName, selectedAgent?.agentId, selectedAgent?.version, session, sessionId]);

  useEffect(() => {
    void ensureSession().then((value) => {
      // agentName 通常是 agentFullName（已含 FAB），不要再拼一次 -fab，避免双后缀。
      setAgent(value.agentName || `${value.title}-${value.fab}`.replace(/\s+/g, ''));
    });
    void loadInitialHistory();
    void restore();
  }, [ensureSession, loadInitialHistory, restore, sessionId]);

  useEffect(() => {
    if (run && ['success', 'cancelled', 'error'].includes(run.status)) {
      // 运行终态时 flushRunCheckpoint 异步落库；延迟到落库完成后刷新历史，
      // 避免读到缺少助手回复的中间快照（竞态会导致完成后消息消失）。
      const timer = setTimeout(() => {
        void loadInitialHistory();
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [loadInitialHistory, run?.status, sessionId]);

  const sendMessageWith = async (prompt: string) => {
    if (!prompt || running) return;
    stickToBottom();
    setRunStartedAt(Date.now());
    setArtifactOpen(false);
    const active = session ?? (await ensureSession());
    if (!active) return;
    await sessionHistoryService.updateSession(active.id, {
      agentId: selectedAgent?.agentId || active.agentId,
      agentName: selectedAgent?.agentFullName || active.agentName,
      fab,
      title: active.title === t('nav.newSessionTitle') ? prompt.slice(0, 32) || active.title : active.title,
      version: selectedAgent?.version || active.version,
    });
    await send(prompt);
  };

  // 首页 hub 发送：路由 state 携带 pendingPrompt，挂载且会话就绪后自动发送一次；
  // 发送后 replace 清空 state，避免刷新/回退重发。
  const pendingPromptSentRef = useRef(false);
  useEffect(() => {
    if (pendingPromptSentRef.current) return;
    const prompt = (location.state as { pendingPrompt?: string } | null)?.pendingPrompt;
    if (!prompt || !session) return;
    pendingPromptSentRef.current = true;
    void sendMessageWith(prompt);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.pathname, location.search, location.state, navigate, session, sendMessageWith]);

  const sendMessage = async () => {
    const prompt = input;
    if (!prompt || running) return;
    setInput('');
    await sendMessageWith(prompt);
  };

  const selectMention = (mention: MentionAgent) => {
    setSelectedAgent(mention);
    setAgent(mention.agentFullName);
    setInput((value) => `@${mention.agentFullName} ${value.replace(/^@\S*\s*/, '')}`);
  };

  const switchAgent = useCallback(
    (agent: MentionAgent) => {
      const newId = `session-${crypto.randomUUID()}`;
      const record = {
        agentId: agent.agentId,
        agentName: agent.agentFullName,
        fab: agent.fab,
        id: newId,
        pinned: false,
        threadId: crypto.randomUUID(),
        title: agent.agentFullName,
        type: 'agent' as const,
        version: agent.version,
      };
      navigate(`/chat/${newId}?agent=${encodeURIComponent(agent.agentId)}&fab=${encodeURIComponent(agent.fab)}`, {
        state: { pendingSession: record },
      });
      void sessionHistoryService.createSession(record).catch((reason) => {
        console.warn('[AgentDock] agent session persist failed', reason);
      });
    },
    [navigate],
  );
  const showReasoning = useUiStore((s) => s.showReasoning);

  const storedMessages = useMemo<StoredTextMessage[]>(() => {
    const liveTextIds = isActiveRun ? new Set(Object.keys(run?.messages || {})) : new Set<string>();
    // 块按 runId 归属（LobeHub 以 messageId 归属块的等价物）：助手文本拿到该 run 的全部
    // reasoning/tool/step/activity/surface。不能用“相邻文本即止”切分——paused 中间落库会把
    // 前段块排在助手文本之前，导致块挂错消息或刷新丢失。
    const blocksByRun = new Map<string, SessionMessageRecord[]>();
    for (const record of history) {
      if (record.kind === 'text' || !record.runId) continue;
      const bucket = blocksByRun.get(record.runId) ?? [];
      bucket.push(record);
      blocksByRun.set(record.runId, bucket);
    }
    const result: StoredTextMessage[] = [];
    for (const record of history) {
      if (record.id.startsWith('lc_run--')) continue;
      const rawTextId = record.id.replace(/^text:/, '');
      if (record.kind !== 'text' || liveTextIds.has(rawTextId) || deletedKeys.has(record.id)) continue;
      const blocks = record.role === 'assistant' && record.runId
        ? (blocksByRun.get(record.runId) ?? [])
        : [];
      result.push({ blocks, record });
    }
    return result;
  }, [deletedKeys, history, isActiveRun, run?.messages]);

  // 同一轮 run 的连续助手文本合并为单个气泡（单聊/群聊共用 buildDisplayUnits）。
  const displayUnits = useMemo(() => buildDisplayUnits(storedMessages), [storedMessages]);

  const { isTerminalRun, scrollRef, stickToBottom } = useChatScroll({
    answer,
    composerHeight,
    contentVersion: displayUnits,
    historyLength: history.length,
    runStatus: run?.status,
  });

  // 落库完成事件：确定性刷新历史（大 run 落库可能超过 600ms，时间兜底不可靠）；
  // 终态落库完成后 DOM 会重建（live→历史），此时再滚一次确保停在最新一条。
  useEffect(() => {
    const refresh = () => {
      void reloadHistoryWindow().then(() => {
        if (isTerminalRun()) stickToBottom();
      });
    };
    window.addEventListener('agentdock:run-persisted', refresh);
    return () => window.removeEventListener('agentdock:run-persisted', refresh);
  }, [isTerminalRun, reloadHistoryWindow, sessionId, stickToBottom]);

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
    onSurfaceAction: (actionName = 'open_report') =>
      surface &&
      void sendA2uiAction({
        actionName: actionName || 'open_report',
        context: { reportId: 'artifact-report' },
        sourceComponentId: 'action-button',
        surfaceId: surface[0],
      }),
  }, { deletedKeys, showReasoning, showSurfaces: true });

  const lastLiveMessageId = Object.keys(run?.messages || {}).at(-1) || '';
  const feedbackTarget = {
    messageId: lastLiveMessageId,
    runId: run?.runId || '',
    sessionId,
    threadId: session?.threadId || '',
  };
  const hasAnyMessage = storedMessages.length > 0 || (isActiveRun && Boolean(answer || running || run?.status));
  const lastUserPrompt = useMemo(() => {
    const fromRun = liveMessages.filter((message) => message.role === 'user').at(-1)?.content;
    if (fromRun) return fromRun;
    return (
      [...history]
        .reverse()
        .find((record) => record.role === 'user' && !deletedKeys.has(record.id))?.content || ''
    );
  }, [deletedKeys, history, liveMessages]);

  const deleteMessage = useCallback(
    (messageId: string) => {
      void sessionHistoryService.removeMessage(sessionId, messageId).then(() => reloadHistoryWindow());
    },
    [reloadHistoryWindow, sessionId],
  );

  // branch 替换：删除以该用户消息开头的一整轮（用户消息 + 助手回复过程块 + checkpoint），
  // 再以新 prompt 重跑——编辑与「重新生成」统一走这条路径（LobeHub regenerate 语义）。
  const replaceTurn = async (userMessageId: string, prompt: string) => {
    if (!prompt || running) return;
    // record.id 可能带 text: 前缀，removeTurn 按无前缀 id 查找。
    await sessionHistoryService.removeTurn(sessionId, userMessageId.replace(/^text:/, ''));
    await reloadHistoryWindow();
    // 删除轮次后重建 agent 上下文：否则后端线程仍携带已删消息，
    // 新 run 的 MESSAGES_SNAPSHOT 会把它们复活（user 消息重复、旧回复混入）。
    await refreshAgentContext();
    await sendMessageWith(prompt);
  };

  const regenerateAssistant = (assistantRecordId: string) => {
    // storedMessages 的 record.id 带 text: 前缀，这里兼容两种形态，避免拼成 text:text:xxx 查不到。
    const index = history.findIndex(
      (record) => record.id === assistantRecordId || record.id === `text:${assistantRecordId}`,
    );
    if (index < 0) return;
    let userRecord: SessionMessageRecord | undefined;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      // 必须回找到真正的用户消息：同 run 里可能有一条空的助手文本（kind 也是 text），
      // 只判 kind 会误把它当用户记录，导致 prompt 为空、替换静默失败。
      if (history[cursor].kind === 'text' && history[cursor].role === 'user') {
        userRecord = history[cursor];
        break;
      }
    }
    if (!userRecord) return;
    void replaceTurn(userRecord.id.replace(/^text:/, ''), userRecord.content || '');
  };

  const commitEdit = (userMessageId: string, originalContent: string) => {
    if (editDraft && editDraft !== originalContent) {
      void replaceTurn(userMessageId, editDraft);
    }
    setEditingId(undefined);
    setEditDraft('');
  };

  const regenerate = (prompt: string) => {
    if (!prompt || running) return;
    void sendMessageWith(prompt);
  };

  const copyMessage = useCallback((content: string) => {
    void navigator.clipboard.writeText(content || '');
  }, []);

  // LobeHub Portal：输出含 artifact（agentDock.artifact 活动）时自动打开右侧面板。
  useEffect(() => {
    if (!run) return;
    for (const value of Object.values(run.activities || {})) {
      const activity = value as { activityType?: string; html?: string; title?: string };
      if (activity.activityType === 'agentDock.artifact' && typeof activity.html === 'string') {
        setArtifact({ html: activity.html, title: activity.title });
        setArtifactOpen(true);
        return;
      }
    }
  }, [run]);

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

  return (
    <Flexbox horizontal height="100%">
      <Flexbox flex={1} height="100%" style={{ minWidth: 0, position: 'relative' }}>
        <ChatHeader
          agentId={agentId}
          agentName={agent}
          artifactOpen={artifactOpen}
          fab={fab}
          status={run?.status}
          onToggleArtifact={() => setArtifactOpen((open) => !open)}
        />
        <Flexbox className={styles.scroll} data-testid="chat-scroll" ref={scrollRef}>
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
            {!hasAnyMessage && (
              <Welcome agentName={agent} onSuggestion={(suggestion) => setInput(t(suggestion))} />
            )}
            {displayUnits.map(({ blocks: storedBlocks, narration, record }, index) => {
              const previous = index > 0 ? displayUnits[index - 1].record : undefined;
              const gap = previous
                ? new Date(record.createdAt).getTime() - new Date(previous.createdAt).getTime()
                : 0;
              const editing = editingId === record.id;
              const originalContent = record.content || '';
              return (
                <Fragment key={record.id}>
                  {gap > HISTORY_DIVIDER_MS && <HistoryDivider label={t('chat.history')} />}
                  {record.role === 'user' ? (
                    <ChatItem
                      actions={
                        <MessageActions
                          content={originalContent}
                          placement="user"
                          onCopy={copyMessage}
                          onDelete={() => deleteMessage(record.id)}
                          onEdit={() => {
                            setEditingId(record.id);
                            setEditDraft(originalContent);
                          }}
                          onRegenerate={() => regenerate(originalContent)}
                          onRestoreToInput={(content) => setInput(content)}
                        />
                      }
                      content={record.content}
                      editing={editing}
                      id={record.id}
                      name={t('chat.you')}
                      onChange={setEditDraft}
                      onDoubleClick={() => {
                        setEditingId(record.id);
                        setEditDraft(originalContent);
                      }}
                      onEditingChange={(next) => {
                        if (!next) commitEdit(record.id, originalContent);
                      }}
                      role="user"
                      showAvatar
                      showTitle={false}
                      time={new Date(record.createdAt).getTime()}
                    />
                  ) : (
                    <ChatItem
                      actions={
                        <MessageActions
                          content={originalContent}
                          onCopy={copyMessage}
                          onDelete={() => deleteMessage(record.id)}
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
                              ...feedbackTarget,
                              feedback: 'like',
                            })
                          }
                          onDeleteAndRegenerate={() => regenerateAssistant(record.id)}
                          onRegenerate={() => regenerateAssistant(record.id)}
                        />
                      }
                      content={record.content}
                      id={record.id}
                      name={agent}
                      role="assistant"
                      showAvatar
                      showTitle
                      time={new Date(record.createdAt).getTime()}
                    >
                      {renderStoredBlocks(storedBlocks, {
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
                        onSurfaceAction: (actionName, surfaceId) =>
                          void sendA2uiAction({
                            actionName: actionName || 'open_report',
                            context: { reportId: 'artifact-report' },
                            sourceComponentId: 'action-button',
                            surfaceId,
                          }),
                      }, { deletedKeys, narration, showReasoning, showSurfaces: true })}
                    </ChatItem>
                  )}
                </Fragment>
              );
            })}
            {hasMoreOlder && (
              <Flexbox align="center" paddingBlock={10}>
                <Button loading={loadingOlder} size="small" onClick={() => void loadOlderHistory()}>
                  {t('chat.loadEarlier')}
                </Button>
              </Flexbox>
            )}
            {isActiveRun && (answer || running || run?.status) && (
              <>
                <ChatItem
                  actions={
                    <MessageActions
                      content={currentUserMessage || input}
                      placement="user"
                      onCopy={copyMessage}
                      onRestoreToInput={(content) => setInput(content)}
                    />
                  }
                  content={currentUserMessage || input}
                  id="current-user"
                  name={t('chat.you')}
                  role="user"
                  time={Date.now()}
                />
                <ChatItem
                  actions={
                    !running && (
                      <MessageActions
                        content={answer || ''}
                        onCopy={copyMessage}
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
                            ...feedbackTarget,
                            feedback: 'like',
                          })
                        }
                        onRegenerate={() => regenerate(lastUserPrompt)}
                      />
                    )
                  }
                  content={answer}
                  id="current-assistant"
                  loading={running}
                  name={agent}
                  role="assistant"
                  time={Date.now()}
                >
                  {blocks}
                  {running && !answer && !blocks && <LoadingDots />}
                  {runtimeAgent ? (
                    <OfficialActivityMessages agent={runtimeAgent as { messages?: unknown[] }} />
                  ) : null}
                  {!running && answer && (
                    <Flexbox horizontal gap={8}>
                      <ActionIcon
                        aria-label={t('chat.openReport')}
                        icon={FileBarChart}
                        title={t('chat.openReport')}
                        onClick={() => setArtifactOpen(true)}
                      />
                      {surface && <Tag color="info">{t('chat.a2uiSurface')}</Tag>}
                    </Flexbox>
                  )}
                </ChatItem>
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
              agentName={agent}
              approvalMode={approvalMode}
              fab={fab}
              mentions={mentions}
              mentionsLoading={mentionsLoading}
              running={running}
              value={input}
              onChange={handleInputChange}
              onApprovalModeChange={setApprovalMode}
              onMentionTrigger={() => void ensureMentions()}
              onSelectMention={selectMention}
              onSend={() => void sendMessage()}
              onStop={() => void stop()}
              onSwitchAgent={(agent) => switchAgent(agent)}
              runStatus={run?.status}
              startTime={runStartedAt}
              stepCount={opStepCount}
              switchAgents={mentions}
            />
          </Flexbox>
        </Flexbox>
      </Flexbox>

      {artifactOpen && (
        <Flexbox className={styles.artifact} height="100%">
          <Flexbox
            horizontal
            align="center"
            height={44}
            justify="space-between"
            paddingInline={16}
            style={{ borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}` }}
          >
            <Flexbox horizontal align="center" gap={8}>
              <Icon icon={FileBarChart} />
              <Text weight={500}>{t('chat.artifact.title')}</Text>
            </Flexbox>
            <ActionIcon aria-label={t('common.close')} icon={X} onClick={() => setArtifactOpen(false)} />
          </Flexbox>
          <Flexbox gap={20} padding={20} style={{ overflowY: 'auto' }}>
            {artifact?.html ? (
              <iframe
                sandbox="allow-same-origin"
                srcDoc={artifact.html}
                style={{
                  border: 'none',
                  borderRadius: 12,
                  background: '#fff',
                  flex: 1,
                  minHeight: 420,
                  width: '100%',
                }}
                title={artifact.title || t('chat.artifact.title')}
              />
            ) : (
              <>
                <Text as="h1" fontSize={22} weight={600}>
                  {artifact?.title || t('chat.artifact.title')}
                </Text>
                <Text type="secondary">{t('chat.artifact.subtitle', { name: agent })}</Text>
                <Flexbox gap={8} padding={16} style={{ border: `1px solid ${cssVar.colorBorderSecondary}`, borderRadius: 12 }}>
                  <Text weight={500}>{t('chat.artifact.status')}</Text>
                  <Text fontSize={30} weight={600}>
                    {t('chat.artifact.stable')}
                  </Text>
                  <Tag color="success">{t('chat.artifact.passed')}</Tag>
                </Flexbox>
                <Flexbox gap={8} padding={16} style={{ border: `1px solid ${cssVar.colorBorderSecondary}`, borderRadius: 12 }}>
                  <Text weight={500}>{t('chat.artifact.anomalies')}</Text>
                  <Text>{t('chat.artifact.anomaly1')}</Text>
                  <Text>{t('chat.artifact.anomaly2')}</Text>
                </Flexbox>
              </>
            )}
          </Flexbox>
        </Flexbox>
      )}
      <FeedbackModal
        onClose={() => setFeedbackModal(undefined)}
        open={!!feedbackModal}
        target={feedbackModal}
      />
    </Flexbox>
  );
}
