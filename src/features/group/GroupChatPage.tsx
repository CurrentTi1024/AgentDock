// Group conversation — LobeHub group Conversation + Portal adaptation (slim)
import { ActionIcon, Avatar, Block, Button, Flexbox, Icon, Segmented, Tabs, Tag, Text } from '@lobehub/ui';
import { DropdownMenu } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { message } from 'antd';
import { ChevronLeft, Clock3, Info, Play, Plus, Users, X } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { MessageActions } from '@/features/chat/components/MessageActions';
import NavHeader from '@/components/shell/NavHeader';
import {
  HistoryDivider,
  renderRunBlocks,
  renderStoredBlocks,
  type StoredTextMessage,
} from '@/features/chat/components/MessageBlocks';
import { useAgentDockConversation } from '@/features/chat/useAgentDockConversation';
import { useI18n } from '@/i18n';
import { useUiStore } from '@/stores/uiStore';

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
  const [input, setInput] = useState('');
  const [modes, setModes] = useState<Array<{ modeId: string; name: string }>>([]);
  const [mode, setMode] = useState('supervisor');
  const [members, setMembers] = useState(DEFAULT_GROUP_MEMBERS);
  const [mentions, setMentions] = useState<MentionAgent[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const groupConfig = useMemo<StoredGroupConfig | undefined>(() => {
    const value = session?.group;
    return value && typeof value === 'object'
      ? (value as StoredGroupConfig)
      : undefined;
  }, [session?.group]);
  const configuredMembers = groupConfig?.members?.length ? groupConfig.members : undefined;

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

  const running = run?.status === 'running';
  // 完成/取消/失败的 run 刷新后按历史渲染（可编辑/操作），只有进行中才走 live 渲染。
  const isActiveRun = run?.status === 'running' || run?.status === 'paused';
  const answer = Object.values(run?.messages || {})
    .filter((message) => message.role === 'assistant')
    .at(-1)?.content;
  const currentUserMessage = Object.values(run?.messages || {})
    .filter((message) => message.role === 'user')
    .at(-1)?.content;
  const surface = Object.entries(run?.surfaces || {}).at(-1);

  useEffect(() => {
    if (!sessionId) {
      navigate('/group', { replace: true });
      return;
    }
    void sessionHistoryService.getSession(sessionId).then((value) => {
      if (!value) {
        if (pendingSession?.id === sessionId) {
          setSession(pendingSession);
          return;
        }
        navigate('/group', { replace: true });
        return;
      }
      setSession(value);
    });
    void sessionHistoryService.getMessages(sessionId).then(setHistory);
    void restore();
  }, [navigate, pendingSession?.id, restore, sessionId]);

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

  useEffect(() => {
    if (run && ['success', 'cancelled', 'error'].includes(run.status)) {
      void sessionHistoryService.getMessages(sessionId).then(setHistory);
    }
  }, [run?.status, sessionId]);

  const storedMessages = useMemo<StoredTextMessage[]>(() => {
    const liveTextIds = isActiveRun ? new Set(Object.keys(run?.messages || {})) : new Set<string>();
    const result: StoredTextMessage[] = [];
    for (let index = 0; index < history.length; index += 1) {
      const record = history[index];
      const rawTextId = record.id.replace(/^text:/, '');
      if (record.kind !== 'text' || liveTextIds.has(rawTextId)) continue;
      const blocks: SessionMessageRecord[] = [];
      for (let next = index + 1; next < history.length; next += 1) {
        const candidate = history[next];
        if (candidate.kind === 'text') break;
        blocks.push(candidate);
      }
      result.push({ blocks, record });
    }
    return result;
  }, [history, isActiveRun, run?.messages]);

  const blocks = renderRunBlocks(run, {
    onApproveHitl: (requestId) =>
      void respondToHitl({ mode: 'toolAuthorization', decision: 'approve', requestId }),
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
  }, { showReasoning });

  const hasAnyMessage = storedMessages.length > 0 || (isActiveRun && Boolean(answer || running || run?.status));

  const sendMessage = async (message: string) => {
    if (!session) return;
    await sessionHistoryService.updateSession(session.id, {
      title: session.title === t('nav.newGroup') ? message.slice(0, 32) || session.title : session.title,
    });
    await send(message);
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
                    {t('workspace.group.members')}
                  </Tag>
                  {run && (
                    <Tag color={run.status === 'running' ? 'processing' : run.status === 'error' ? 'error' : 'success'} size="small">
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
                <Tag color={run.status === 'running' ? 'processing' : run.status === 'error' ? 'error' : 'success'} size="small">
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
            placement="bottomLeft"
          >
            <Button icon={Plus} size="small">
              {t('group.chat.addMember')}
            </Button>
          </DropdownMenu>
        </Flexbox>
        <Flexbox className={styles.scroll}>
          <Flexbox
            gap={8}
            style={{ marginInline: 'auto', maxWidth: 840, padding: '24px 24px 150px', width: '100%' }}
          >
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
            {storedMessages.map(({ blocks: storedBlocks, record }, index) => {
              const previous = index > 0 ? storedMessages[index - 1].record : undefined;
              const merged = Boolean(previous && previous.role === record.role);
              const gap = previous
                ? new Date(record.createdAt).getTime() - new Date(previous.createdAt).getTime()
                : 0;
              return (
                <Fragment key={record.id}>
                  {gap > HISTORY_DIVIDER_MS && <HistoryDivider label={t('chat.history')} />}
                  {record.role === 'user' ? (
                    <ChatItem
                      actions={
                        <MessageActions
                          content={record.content || ''}
                          placement="user"
                          onCopy={(content) => void navigator.clipboard.writeText(content || '')}
                          onDelete={() =>
                            void sessionHistoryService.removeMessage(sessionId, record.id).then(() =>
                              sessionHistoryService.getMessages(sessionId).then(setHistory),
                            )
                          }
                        />
                      }
                      content={record.content}
                      id={record.id}
                      name={t('chat.you')}
                      role="user"
                      showAvatar={!merged}
                      showTitle={false}
                      time={new Date(record.createdAt).getTime()}
                    />
                  ) : (
                    <ChatItem
                      actions={
                        <MessageActions
                          content={record.content || ''}
                          onCopy={(content) => void navigator.clipboard.writeText(content || '')}
                          onDelete={() =>
                            void sessionHistoryService.removeMessage(sessionId, record.id).then(() =>
                              sessionHistoryService.getMessages(sessionId).then(setHistory),
                            )
                          }
                        />
                      }
                      content={record.content}
                      id={record.id}
                      name={session?.title || t('nav.group')}
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
                        onSurfaceAction: (surfaceId) =>
                          void sendA2uiAction({
                            actionName: 'open_report',
                            context: { reportId: 'artifact-report' },
                            sourceComponentId: 'open',
                            surfaceId,
                          }),
                      }, { showReasoning })}
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
                      onCopy={(content) => void navigator.clipboard.writeText(content || '')}
                    />
                  }
                  content={currentUserMessage || input}
                  id="current-group-user"
                  name={t('chat.you')}
                  role="user"
                  time={Date.now()}
                />
                <ChatItem
                  actions={
                    !running && (
                      <MessageActions
                        content={answer || ''}
                        onCopy={(content) => void navigator.clipboard.writeText(content || '')}
                      />
                    )
                  }
                  content={answer}
                  id="current-group-assistant"
                  loading={running}
                  name={session?.title || t('nav.group')}
                  role="assistant"
                  time={Date.now()}
                >
                  {blocks}
                </ChatItem>
              </>
            )}
          </Flexbox>
        </Flexbox>
        <Flexbox className={styles.surface}>
          <Flexbox style={{ marginInline: 'auto', maxWidth: 840, width: '100%' }}>
            <ChatInput
              agentName={session?.title || t('nav.group')}
              fab={fab}
              mentions={[]}
              running={running}
              value={input}
              onChange={setInput}
              onMentionTrigger={() => undefined}
              onSelectMention={() => undefined}
              onSend={() => void sendMessage(input)}
              onStop={() => void stop()}
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
                  <Text weight={500}>{t('workspace.group.members')}</Text>
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
              label: t('workspace.group.members'),
            },
          ]}
          variant="square"
        />
      </Flexbox>
      )}
    </Flexbox>
  );
};

export default GroupChatPage;
