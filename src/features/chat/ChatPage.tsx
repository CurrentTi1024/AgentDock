// AgentDock conversation page — LobeHub ConversationArea + ChatItem + ChatInput adaptation.
import { ActionIcon, Button, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { FileBarChart, X } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { resolveChatAgentId } from '@/features/chat/agentDetail';
import {
  resolveAgentIcon,
  resolveChatRouteQuery,
  resolveSessionAgent,
} from '@/features/chat/agentIdentity';
import ChatHeader from '@/features/chat/components/ChatHeader';
import ChatInput from '@/features/chat/components/ChatInput';
import ChatItem from '@/features/chat/components/ChatItem';
import FeedbackModal, { type FeedbackTarget } from '@/features/chat/components/FeedbackModal';
import { MessageActions } from '@/features/chat/components/MessageActions';
import {
  buildSessionTitle,
  parseMentionedAgents,
} from '@/features/chat/mentions';
import type { OpStatusActivity } from '@/features/chat/components/OpStatusTray';
import Welcome from '@/features/chat/components/Welcome';
import {
  buildDisplayUnits,
  HistoryDivider,
  renderStoredBlocks,
  renderRunBlocks,
  stripRunErrorText,
  type StoredTextMessage,
} from '@/features/chat/components/MessageBlocks';
import { messageFeedbackService } from '@/api/conversation/messageFeedbackService';
import { getChatServiceMode } from '@/api/core/serviceMode';
import { agentMarketService, type MentionAgent } from '@/api/market/agentMarketService';
import {
  sessionHistoryService,
  type SessionMessageRecord,
  type SessionRecord,
} from '@/api/session/sessionHistoryService';
import { useAgentDockConversation } from '@/features/chat/useAgentDockConversation';
import { useChatScroll } from '@/features/chat/hooks/useChatScroll';
import { getHistoryWindowLimit } from '@/features/chat/historyWindow';
import {
  findLiveProcessHostId,
  findStoredProcessHosts,
} from '@/features/chat/messageBlockOwnership';
import ContentLoading from '@/features/chat/components/lobehub/ContentLoading';
import {
  runtimeMessageToSessionRecord,
  SpecialMessage,
} from '@/features/chat/components/lobehub/SpecialMessages';
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

export default function ChatPage() {
  const { t } = useI18n();
  const { id = 'session-inbox' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = id === 'inbox' ? 'session-inbox' : id;
  const pendingSession = (location.state as { pendingSession?: SessionRecord } | null)?.pendingSession;

  const [input, setInput] = useState('');
  const [composerHeight, setComposerHeight] = useState(0);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [feedbackModal, setFeedbackModal] = useState<FeedbackTarget>();
  const [mentions, setMentions] = useState<MentionAgent[]>([]);
  const [mentionsLoading, setMentionsLoading] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<MentionAgent>();
  // 头部/输入框显示的 Agent 名。用「selectedAgent（URL/会话解析）→ session.agentName → 兜底」
  // 的响应式派生，避免多个 effect 异步写 agent 状态互相覆盖（ensureSession 的 .then 竞态
  // 曾把回填后的显示名打回「新对话-F15B」）。
  const [agentFallback, setAgentFallback] = useState('FlightAnalysis_Agent-F15B');
  const [session, setSession] = useState<SessionRecord>();
  const agent = selectedAgent?.agentFullName || session?.agentName || agentFallback;
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
  // React Router 会复用同一个 ChatPage 实例。所有异步读取都必须校验目标 session，
  // 防止 A 的慢请求在已经切到 B 后回写 B 页面（历史串会话/身份闪回）。
  const currentSessionIdRef = useRef(sessionId);
  currentSessionIdRef.current = sessionId;

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
    // 新会话初始计数为 0，终态也必须重取至少一整轮，否则 live→history
    // 切换时消息会瞬间消失。getMessagesPage 会按 run 整组返回，不会截断过程块。
    const target = getHistoryWindowLimit(loadedTextCountRef.current);
    const page = await sessionHistoryService.getMessagesPage(sessionId, { limit: target });
    setHistory(page.records);
    setHasMoreOlder(page.hasMore);
    nextCursorRef.current = page.nextBeforeSequence;
    loadedTextCountRef.current = page.records.filter((record) => record.kind === 'text').length;
  }, [sessionId]);

  const fab = selectedAgent?.fab || session?.fab || agent.split('-').at(-1) || 'F15B';
  const agentId = resolveChatAgentId(selectedAgent?.agentId, session?.agentId);
  const agentIcon = resolveAgentIcon(mentions, agentId, fab);
  const {
    agent: runtimeAgent,
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
  // RUN_ERROR：错误文本被 reducer 追加到助手消息末尾用于持久化；展示时剥离，
  // 由 blocks 里的 agentDock.error 活动渲染 LobeHub 错误卡（Alert + 重新生成）。
  const displayAnswer = stripRunErrorText(answer || '', run?.error?.message);
  const surface = Object.entries(run?.surfaces || {}).at(-1);
  // 错误重试：重新发送该轮最后一条用户消息（live 用当前消息，历史按 runId 回溯）。
  const regenerateError = useCallback(
    (runId?: string) => {
      const prompt = runId
        ? history.find((record) => record.runId === runId && record.role === 'user')?.content
        : currentUserMessage;
      if (prompt) void send(prompt);
    },
    [currentUserMessage, history, send],
  );

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
  // 挂载即预取：输入框左下角「切换 Agent」下拉需要候选列表才能默认选中当前 Agent，
  // 且会话绑定（selectedAgent）也要在 mentions 就绪后才能解析。
  const mentionsLoadedRef = useRef(false);
  const mentionsInFlightRef = useRef(false);
  const mentionsRef = useRef<MentionAgent[]>([]);
  const ensureMentions = useCallback(async () => {
    if (mentionsLoadedRef.current || mentionsInFlightRef.current) return;
    mentionsInFlightRef.current = true;
    setMentionsLoading(true);
    try {
      const { items } = await agentMarketService.getMentionAgentsList({ locale: 'zh-CN' });
      mentionsRef.current = items;
      setMentions(items);
      mentionsLoadedRef.current = true;
    } finally {
      mentionsInFlightRef.current = false;
      setMentionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void ensureMentions();
  }, [ensureMentions]);

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
      setAgentFallback(requested.agentFullName);
      // URL 显式指定与会话记录不一致（创建时 selectedAgent 未就绪会兜底 flight-analysis）
      // 时同步记录，侧边栏按会话解析才能拿到同一 Agent，话题列表过滤也一致。
      if (
        session?.id === sessionId &&
        (session.agentId !== requested.agentId ||
          session.fab !== requested.fab ||
          !session.agentName)
      ) {
        void sessionHistoryService.updateSession(session.id, {
          agentId: requested.agentId,
          agentName: requested.agentFullName,
          fab: requested.fab,
          version: requested.version,
        });
      }
    }
  }, [mentions, searchParams, session, sessionId]);

  // 路由守卫 + URL 归一化：进入会话 URL 始终携带 agentId+fab（侧边栏/话题过滤/
  // 输入框默认选中三者一致）；URL 参数不在当前用户可用（mentionAgents）列表时移除，
  // 防止手改 URL 访问无权限 Agent，随后回退到会话记录/默认 Agent 解析。
  useEffect(() => {
    if (!mentions.length) return;
    const action = resolveChatRouteQuery(
      mentions,
      { agent: searchParams.get('agent'), fab: searchParams.get('fab') },
      session?.id === sessionId ? session : undefined,
    );
    if (action.type === 'keep') return;
    const params = new URLSearchParams(searchParams);
    if (action.type === 'strip') {
      params.delete('agent');
      params.delete('fab');
    } else {
      params.set('agent', action.agent);
      params.set('fab', action.fab);
    }
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ''}`, { replace: true });
  }, [location.pathname, mentions, navigate, searchParams, session, sessionId]);

  // 输入框左下角默认选中当前 Agent：URL 未显式指定时按会话记录解析
  // （精确匹配 agentId+fab，绝不误绑列表第一项）；新会话无 agentName 时回填会话与头部显示。
  useEffect(() => {
    if (!mentions.length || !session || session.id !== sessionId) return;
    if (searchParams.get('agent') && searchParams.get('fab')) return;
    const resolved = resolveSessionAgent(mentions, session);
    if (!resolved) return;
    setSelectedAgent((current) => current ?? resolved);
    if (!session.agentName || session.agentId !== resolved.agentId || session.fab !== resolved.fab) {
      void sessionHistoryService.updateSession(session.id, {
        agentId: resolved.agentId,
        agentName: resolved.agentFullName,
        fab: resolved.fab,
        version: resolved.version,
      });
    }
  }, [mentions, searchParams, session]);

  const ensureSession = useCallback(async (): Promise<SessionRecord> => {
    // 路由切换会复用同一组件实例，不能信任内存里旧会话的 session state。
    if (session?.id === sessionId) return session;
    const existing = await sessionHistoryService.getSession(sessionId);
    if (existing) {
      if (currentSessionIdRef.current === sessionId) setSession(existing);
      return existing;
    }
    if (pendingSession?.id === sessionId) {
      if (currentSessionIdRef.current === sessionId) setSession(pendingSession);
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
    if (currentSessionIdRef.current === sessionId) setSession(created);
    return created;
  }, [fab, pendingSession, selectedAgent?.agentFullName, selectedAgent?.agentId, selectedAgent?.version, session, sessionId]);

  useEffect(() => {
    // 不让新 Session 的首帧沿用旧 Session 的历史和身份；真实数据异步返回后再填充。
    setHistory([]);
    setSession(pendingSession?.id === sessionId ? pendingSession : undefined);
    setSelectedAgent(undefined);
    setRunStartedAt(undefined);
    setArtifact(undefined);
    setArtifactOpen(false);
    // pendingSession 只属于导航到该 session 的瞬时 state；同一 id 内 state 变化不应重置页面。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    const targetSessionId = sessionId;
    void ensureSession().then((value) => {
      if (currentSessionIdRef.current !== targetSessionId) return;
      // agentName 通常是 agentFullName（已含 FAB），不要再拼一次 -fab，避免双后缀。
      setAgentFallback(value.agentName || `${value.title}-${value.fab}`.replace(/\s+/g, ''));
    });
    void loadInitialHistory();
    void restore();
  }, [ensureSession, loadInitialHistory, restore, sessionId]);

  const sendMessageWith = async (prompt: string) => {
    if (!prompt || running) return false;
    // 解析 @Agent 提及：先确保候选列表已加载（直接手输 @ 也可能没触发过联想菜单）。
    if (prompt.includes('@') || prompt.includes('<mention')) await ensureMentions();
    const mentionAgents = parseMentionedAgents(prompt, mentionsRef.current).filter(
      (mention) =>
        !(mention.agentId === (selectedAgent?.agentId || session?.agentId) && mention.fab === fab),
    );
    stickToBottom();
    setRunStartedAt(Date.now());
    setArtifactOpen(false);
    const active = session ?? (await ensureSession());
    if (!active) return false;
    // 标题默认 = 首条消息前 20 字符：会话还没有可见文本消息时才更新，
    // 覆盖侧边栏新建（初始 title=agentFullName）与默认 inbox 两种无消息场景。
    const hasAnyMessage = await sessionHistoryService.hasMessages(active.id);
    await sessionHistoryService.updateSession(active.id, {
      agentId: selectedAgent?.agentId || active.agentId,
      agentName: selectedAgent?.agentFullName || active.agentName,
      fab,
      title: hasAnyMessage ? active.title : buildSessionTitle(prompt, active.title),
      version: selectedAgent?.version || active.version,
    });
    void send(prompt, { mentionAgents }).catch((reason) => {
      console.error('[AgentDock] run start failed', reason);
    });
    return true;
  };

  // 首页 hub 发送：路由 state 携带 pendingPrompt，挂载且会话就绪后自动发送一次；
  // 发送后 replace 清空 state，避免刷新/回退重发。
  const pendingPromptSentRef = useRef(false);
  const pendingPromptSessionRef = useRef(sessionId);
  if (pendingPromptSessionRef.current !== sessionId) {
    pendingPromptSessionRef.current = sessionId;
    pendingPromptSentRef.current = false;
  }
  useEffect(() => {
    if (pendingPromptSentRef.current) return;
    const prompt = (location.state as { pendingPrompt?: string } | null)?.pendingPrompt;
    if (!prompt || !session) return;
    pendingPromptSentRef.current = true;
    void sendMessageWith(prompt);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.pathname, location.search, location.state, navigate, session, sendMessageWith]);

  const handleSend = async (content: string) => {
    const prompt = content.trim();
    if (!prompt || running) return false;
    return sendMessageWith(prompt);
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

  // 同一轮 run 的连续助手文本合并为单个气泡（单聊/群聊共用 buildDisplayUnits）。
  const displayUnits = useMemo(() => buildDisplayUnits(storedMessages), [storedMessages]);

  const { isStickToBottom, isTerminalRun, scrollRef, scrollToBottom, stickToBottom } = useChatScroll({
    answer,
    composerHeight,
    contentVersion: displayUnits,
    historyLength: history.length,
    runStatus: run?.status,
  });

  // 落库完成事件：只在终态落库完成后刷新历史（live→历史切换）。
  // 注意：流式中每次防抖 flush（350ms）也会广播 run-persisted，若照单全收会不断
  // 全量重读历史 + setHistory 重渲染——http 大工具参数/大 A2UI ops 时 IO 与渲染
  // 积压会占满主线程，页面冻结后直接跳到终态（用户感知为“thinking 突然消失”）。
  // 用 ref 跟踪最新 run 状态：running/paused 的广播直接跳过，终态广播才刷新一次。
  const runStatusRef = useRef(run?.status);
  runStatusRef.current = run?.status;
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (detail?.sessionId && detail.sessionId !== sessionId) return;
      if (runStatusRef.current === 'running' || runStatusRef.current === 'paused') return;
      void reloadHistoryWindow().then(() => {
        if (isStickToBottom()) stickToBottom();
      });
    };
    window.addEventListener('agentdock:run-persisted', refresh);
    return () => window.removeEventListener('agentdock:run-persisted', refresh);
  }, [isStickToBottom, isTerminalRun, reloadHistoryWindow, scrollRef, scrollToBottom, sessionId, stickToBottom]);

  // 终态后内容可能延迟数秒增高（A2UI 官方渲染器渐进挂载、图片、折叠块，且渲染期
  // 占用主线程会推迟定时器）：run 状态一变终态即强制贴底，250ms 间隔直接赋值
  // scrollTop=scrollHeight，直到高度连续 1s 稳定（或 12s 上限）才停，保证最终停在最底部。
  useEffect(() => {
    if (!run || !['success', 'cancelled', 'error'].includes(run.status)) return;
    stickToBottom();
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
  }, [run?.status, scrollRef, stickToBottom]);

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
    onRegenerateError: () => regenerateError(),
  }, { deletedKeys, showReasoning, showSurfaces: true });
  const hasLiveAssistant = liveMessages.some((message) => message.role === 'assistant');
  const liveProcessHostId = findLiveProcessHostId(liveSpecialRecords, hasLiveAssistant);
  const hasLiveBlocks = Array.isArray(blocks) && blocks.length > 0;
  const showLiveAssistant = Boolean(answer) || (
    !liveProcessHostId && (hasLiveBlocks || liveSpecialRecords.length === 0)
  );

  const lastLiveMessageId = Object.keys(run?.messages || {}).at(-1) || '';
  const feedbackTarget = {
    messageId: lastLiveMessageId,
    runId: run?.runId || '',
    sessionId,
    threadId: session?.threadId || '',
  };
  const hasAnyMessage = storedMessages.length > 0 || (isActiveRun && Boolean(answer || running || run?.status));
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
          icon={agentIcon}
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
              <Welcome
                agentIcon={agentIcon}
                agentName={agent}
                onSuggestion={(suggestion) => setInput(t(suggestion))}
              />
            )}
            {displayUnits.map(({ blocks: storedBlocks, narration, record }, index) => {
              const previous = index > 0 ? displayUnits[index - 1].record : undefined;
              const gap = previous
                ? new Date(record.createdAt).getTime() - new Date(previous.createdAt).getTime()
                : 0;
              const originalContent = record.content || '';
              // RUN_ERROR 历史：run 内有 agentDock.error 活动时，剥离消息末尾的错误文本，
              // 由 renderStoredBlocks 渲染错误卡，避免 Alert 与正文重复。
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
                onSurfaceAction: (actionName, surfaceId) =>
                  void sendA2uiAction({
                    actionName: actionName || 'open_report',
                    context: { reportId: 'artifact-report' },
                    sourceComponentId: 'action-button',
                    surfaceId,
                  }),
                onRegenerateError: (runId) => regenerateError(runId),
              }, { deletedKeys, narration, showReasoning, showSurfaces: true });
              const assistantActions = (
                <MessageActions
                  content={originalContent}
                  onCopy={copyMessage}
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
                          onCopy={copyMessage}
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
                      avatar={agentIcon}
                      content={record.content}
                      id={record.id}
                      name={agent}
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
                      agentAvatar={agentIcon}
                      agentName={agent}
                      content={displayContent}
                      record={record}
                    >
                      {renderedStoredBlocks}
                    </SpecialMessage>
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
                {liveSpecialRecords.map((record) => (
                  <SpecialMessage
                    agentAvatar={agentIcon}
                    agentName={agent}
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
                      />
                    )
                  }
                  avatar={agentIcon}
                  content={displayAnswer}
                  enableStream={running}
                  id="current-assistant"
                  loading={running}
                  name={agent}
                  role="assistant"
                  time={Date.now()}
                >
                  {!liveProcessHostId && blocks}
                  {running && !answer && !hasLiveBlocks && <ContentLoading startTime={runStartedAt} />}
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
              agentId={agentId}
              agentName={agent}
              approvalMode={approvalMode}
              fab={fab}
              draftKey={`chat:${sessionId}`}
              mentions={mentions}
              running={running}
              value={input}
              onChange={handleInputChange}
              onApprovalModeChange={setApprovalMode}
              onSend={handleSend}
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
