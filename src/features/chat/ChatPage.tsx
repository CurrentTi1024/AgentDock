// AgentDock conversation page — LobeHub ConversationArea + ChatItem + ChatInput adaptation.
import { ActionIcon, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
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
import Welcome from '@/features/chat/components/Welcome';
import {
  HistoryDivider,
  renderStoredBlocks,
  renderRunBlocks,
  type StoredTextMessage,
} from '@/features/chat/components/MessageBlocks';
import { messageFeedbackService } from '@/api/conversation/messageFeedbackService';
import { getChatServiceMode } from '@/api/core/serviceMode';
import { agentMarketService, type MentionAgent } from '@/api/market/agentMarketService';
import type { RuntimeStep } from '@/api/runtime/types';
import {
  sessionHistoryService,
  type SessionMessageRecord,
  type SessionRecord,
} from '@/api/session/sessionHistoryService';
import { useAgentDockConversation } from '@/features/chat/useAgentDockConversation';
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
  const [artifactOpen, setArtifactOpen] = useState(false);

  const fab = selectedAgent?.fab || session?.fab || agent.split('-').at(-1) || 'F15B';
  const agentId = resolveChatAgentId(selectedAgent?.agentId, session?.agentId);
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
  const running = run?.status === 'running';
  // 只有进行中的 run（running/paused）才走 live 渲染；完成的 run 刷新后按历史消息渲染，
  // 保证最后一条消息也有编辑/重新生成等操作（LobeHub 无“live 消息”概念）。
  const isActiveRun = run?.status === 'running' || run?.status === 'paused';
  const answer = Object.values(run?.messages || {})
    .filter((message) => message.role === 'assistant')
    .at(-1)?.content;
  const currentUserMessage = Object.values(run?.messages || {})
    .filter((message) => message.role === 'user')
    .at(-1)?.content;
  const surface = Object.entries(run?.surfaces || {}).at(-1);

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
    void sessionHistoryService.getMessages(sessionId).then(setHistory);
    void restore();
  }, [ensureSession, restore, sessionId]);

  useEffect(() => {
    if (run && ['success', 'cancelled', 'error'].includes(run.status)) {
      // 运行终态时 flushRunCheckpoint 异步落库；延迟到落库完成后刷新历史，
      // 避免读到缺少助手回复的中间快照（竞态会导致完成后消息消失）。
      const timer = setTimeout(() => {
        void sessionHistoryService.getMessages(sessionId).then(setHistory);
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [run?.status, sessionId]);

  // 落库完成事件：确定性刷新历史（大 run 落库可能超过 600ms，时间兜底不可靠）。
  useEffect(() => {
    const refresh = () => {
      void sessionHistoryService.getMessages(sessionId).then(setHistory);
    };
    window.addEventListener('agentdock:run-persisted', refresh);
    return () => window.removeEventListener('agentdock:run-persisted', refresh);
  }, [sessionId]);

  const sendMessageWith = async (prompt: string) => {
    if (!prompt || running) return;
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
      if (record.kind !== 'text' || liveTextIds.has(rawTextId)) continue;
      const blocks = record.role === 'assistant' && record.runId
        ? (blocksByRun.get(record.runId) ?? [])
        : [];
      result.push({ blocks, record });
    }
    return result;
  }, [history, isActiveRun, run?.messages]);

  const blocks = renderRunBlocks(run, {
    onApproveHitl: (requestId) =>
      void respondToHitl({ mode: 'toolAuthorization', decision: 'approve', requestId }),
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
  }, { showReasoning, showSurfaces: true });

  const lastLiveMessageId = Object.keys(run?.messages || {}).at(-1) || '';
  const feedbackTarget = {
    messageId: lastLiveMessageId,
    runId: run?.runId || '',
    sessionId,
    threadId: session?.threadId || '',
  };
  const hasAnyMessage = storedMessages.length > 0 || (isActiveRun && Boolean(answer || running || run?.status));
  const lastUserPrompt = useMemo(() => {
    const fromRun = Object.values(run?.messages || {})
      .filter((message) => message.role === 'user')
      .at(-1)?.content;
    if (fromRun) return fromRun;
    return [...history].reverse().find((record) => record.role === 'user')?.content || '';
  }, [history, run?.messages]);

  const deleteMessage = useCallback(
    (messageId: string) => {
      void sessionHistoryService.removeMessage(sessionId, messageId).then(() =>
        sessionHistoryService.getMessages(sessionId).then(setHistory),
      );
    },
    [sessionId],
  );

  // branch 替换：删除以该用户消息开头的一整轮（用户消息 + 助手回复过程块 + checkpoint），
  // 再以新 prompt 重跑——编辑与「重新生成」统一走这条路径（LobeHub regenerate 语义）。
  const replaceTurn = async (userMessageId: string, prompt: string) => {
    if (!prompt || running) return;
    await sessionHistoryService.removeTurn(sessionId, userMessageId);
    const refreshed = await sessionHistoryService.getMessages(sessionId);
    setHistory(refreshed);
    await sendMessageWith(prompt);
  };

  const regenerateAssistant = (assistantRecordId: string) => {
    const index = history.findIndex((record) => record.id === `text:${assistantRecordId}`);
    if (index < 0) return;
    let userRecord: SessionMessageRecord | undefined;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (history[cursor].kind === 'text') {
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
        <Flexbox className={styles.scroll}>
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
            {storedMessages.map(({ blocks: storedBlocks, record }, index) => {
              const previous = index > 0 ? storedMessages[index - 1].record : undefined;
              // 仅合并同一轮 run 内的连续同角色消息（如一轮内多条助手文本）；
              // 不同 run 的独立回复必须各自显示头像/标题，避免出现“只有气泡没有头像”。
              const merged = Boolean(
                previous &&
                  previous.role === record.role &&
                  previous.runId &&
                  previous.runId === record.runId,
              );
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
                      showAvatar={!merged}
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
                      showAvatar={!merged}
                      showTitle={!merged}
                      time={new Date(record.createdAt).getTime()}
                    >
                      {renderStoredBlocks(storedBlocks, {
                        onApproveHitl: (requestId) =>
                          void respondToHitl({ mode: 'toolAuthorization', decision: 'approve', requestId }),
                        onRejectHitl: (requestId) =>
                          void respondToHitl({ mode: 'toolAuthorization', decision: 'reject', requestId }),
                        onSurfaceAction: (actionName, surfaceId) =>
                          void sendA2uiAction({
                            actionName: actionName || 'open_report',
                            context: { reportId: 'artifact-report' },
                            sourceComponentId: 'action-button',
                            surfaceId,
                          }),
                      }, { showReasoning, showSurfaces: true })}
                    </ChatItem>
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
          <Flexbox style={{ marginInline: 'auto', maxWidth: 840, width: '100%' }}>
            <ChatInput
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
            <Text as="h1" fontSize={22} weight={600}>
              {t('chat.artifact.title')}
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
