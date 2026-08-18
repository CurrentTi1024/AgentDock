// AgentDock conversation page — LobeHub ConversationArea + ChatItem + ChatInput adaptation.
import { ActionIcon, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { useRenderActivityMessage } from '@copilotkit/react-core/v2';
import { createStaticStyles, cssVar } from 'antd-style';
import { Copy, FileBarChart, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';

import { resolveChatAgentId } from '@/features/chat/agentDetail';
import ChatHeader from '@/features/chat/components/ChatHeader';
import ChatInput from '@/features/chat/components/ChatInput';
import ChatItem from '@/features/chat/components/ChatItem';
import Welcome from '@/features/chat/components/Welcome';
import {
  ActivityBlock,
  A2uiSurfaceBlock,
  HitlBlock,
  ReasoningBlock,
  renderStoredBlocks,
  renderRunBlocks,
  ToolCallBlock,
  WorkflowStepsBlock,
  type StoredTextMessage,
} from '@/features/chat/components/MessageBlocks';
import { messageFeedbackService } from '@/api/conversation/messageFeedbackService';
import { getServiceMode } from '@/api/core/serviceMode';
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
  const [searchParams] = useSearchParams();
  const sessionId = id === 'inbox' ? 'session-inbox' : id;
  const pendingSession = (location.state as { pendingSession?: SessionRecord } | null)?.pendingSession;

  const [input, setInput] = useState('');
  const [mentions, setMentions] = useState<MentionAgent[]>([]);
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
  const answer = Object.values(run?.messages || {})
    .filter((message) => message.role === 'assistant')
    .at(-1)?.content;
  const currentUserMessage = Object.values(run?.messages || {})
    .filter((message) => message.role === 'user')
    .at(-1)?.content;
  const surface = Object.entries(run?.surfaces || {}).at(-1);

  useEffect(() => {
    void agentMarketService
      .getMentionAgentsList({ locale: 'zh-CN' })
      .then(({ items }) => {
        setMentions(items);
        setSelectedAgent(items[0]);
      });
  }, []);

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
    const existing = session ?? (await sessionHistoryService.getSession(sessionId));
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
    void ensureSession().then((value) =>
      setAgent(`${value.agentName || value.title}-${value.fab}`.replace(/\s+/g, '')),
    );
    void sessionHistoryService.getMessages(sessionId).then(setHistory);
    void restore();
  }, [ensureSession, restore, sessionId]);

  useEffect(() => {
    if (run && ['success', 'cancelled', 'error'].includes(run.status)) {
      void sessionHistoryService.getMessages(sessionId).then(setHistory);
    }
  }, [run?.status, sessionId]);

  const sendMessage = async () => {
    setArtifactOpen(false);
    const active = session ?? (await ensureSession());
    if (!active) return;
    await sessionHistoryService.updateSession(active.id, {
      agentId: selectedAgent?.agentId || active.agentId,
      agentName: selectedAgent?.agentFullName || active.agentName,
      fab,
      title: active.title === t('nav.newSessionTitle') ? input.slice(0, 32) || active.title : active.title,
      version: selectedAgent?.version || active.version,
    });
    await send(input);
    setInput('');
  };

  const selectMention = (mention: MentionAgent) => {
    setSelectedAgent(mention);
    setAgent(mention.agentFullName);
    setInput((value) => `@${mention.agentFullName} ${value.replace(/^@\S*\s*/, '')}`);
  };
  const showReasoning = useUiStore((s) => s.showReasoning);

  const storedMessages = useMemo<StoredTextMessage[]>(() => {
    const liveTextIds = new Set(Object.keys(run?.messages || {}));
    const result: StoredTextMessage[] = [];
    for (let index = 0; index < history.length; index += 1) {
      const record = history[index];
      if (record.kind !== 'text' || liveTextIds.has(record.id)) continue;
      const blocks: SessionMessageRecord[] = [];
      for (let next = index + 1; next < history.length; next += 1) {
        const candidate = history[next];
        if (candidate.kind === 'text') break;
        blocks.push(candidate);
      }
      result.push({ blocks, record });
    }
    return result;
  }, [history, run?.messages]);

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
  }, { showReasoning, showSurfaces: getServiceMode() !== 'http' });

  const lastLiveMessageId = Object.keys(run?.messages || {}).at(-1) || '';
  const feedbackTarget = {
    messageId: lastLiveMessageId,
    runId: run?.runId || '',
    sessionId,
    threadId: session?.threadId || '',
  };
  const hasAnyMessage = storedMessages.length > 0 || Boolean(answer || running || run?.status);

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
          <Flexbox gap={24} style={{ marginInline: 'auto', maxWidth: 840, padding: '24px 24px 150px', width: '100%' }}>
            {!hasAnyMessage && (
              <Welcome agentName={agent} onSuggestion={(suggestion) => setInput(t(suggestion))} />
            )}
            {storedMessages.map(({ blocks: storedBlocks, record }) =>
              record.role === 'user' ? (
                <ChatItem
                  avatar="LC"
                  content={record.content}
                  id={record.id}
                  key={record.id}
                  name={t('chat.you')}
                  role="user"
                />
              ) : (
                <ChatItem
                  avatar="🛩️"
                  content={record.content}
                  id={record.id}
                  key={record.id}
                  name={agent}
                  role="assistant"
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
                  }, { showReasoning, showSurfaces: getServiceMode() !== 'http' })}
                </ChatItem>
              ),
            )}
            {(answer || running || run?.status) && (
              <>
                <ChatItem
                  avatar="LC"
                  content={currentUserMessage || input}
                  id="current-user"
                  name={t('chat.you')}
                  role="user"
                />
                <ChatItem
                  actions={
                    !running && answer ? (
                      <>
                        <ActionIcon
                          aria-label={t('chat.copy')}
                          icon={Copy}
                          onClick={() => void navigator.clipboard.writeText(answer || '')}
                          size="small"
                        />
                        <ActionIcon
                          aria-label={t('chat.like')}
                          icon={ThumbsUp}
                          size="small"
                          onClick={() =>
                            void messageFeedbackService.submitMessageFeedback({
                              ...feedbackTarget,
                              feedback: 'like',
                            })
                          }
                        />
                        <ActionIcon
                          aria-label={t('chat.dislike')}
                          icon={ThumbsDown}
                          size="small"
                          onClick={() =>
                            void messageFeedbackService.submitMessageFeedback({
                              ...feedbackTarget,
                              feedback: 'dislike',
                              reasonCode: 'incorrect',
                            })
                          }
                        />
                      </>
                    ) : undefined
                  }
                  avatar="🛩️"
                  content={answer}
                  id="current-assistant"
                  loading={running}
                  name={agent}
                  role="assistant"
                  time={t('chat.justNow')}
                >
                  {blocks}
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
        <Flexbox className={styles.surface}>
          <Flexbox style={{ marginInline: 'auto', maxWidth: 840, width: '100%' }}>
            <ChatInput
              mentions={mentions}
              running={running}
              value={input}
              onChange={setInput}
              onSelectMention={selectMention}
              onSend={() => void sendMessage()}
              onStop={() => void stop()}
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
    </Flexbox>
  );
}
