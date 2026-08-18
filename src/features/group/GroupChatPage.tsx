// Group conversation — LobeHub group Conversation + Portal adaptation (slim)
import { Avatar, Block, Button, Flexbox, Icon, Segmented, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Clock3, MoreHorizontal, Play, Plus, Users } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { agentGroupService } from '@/api/agent-group/agentGroupService';
import { runtimeConfig } from '@/api/runtimeConfig';
import {
  sessionHistoryService,
  type SessionMessageRecord,
  type SessionRecord,
} from '@/api/session/sessionHistoryService';
import ChatInput from '@/features/chat/components/ChatInput';
import ChatItem from '@/features/chat/components/ChatItem';
import NavHeader from '@/components/shell/NavHeader';
import { renderRunBlocks, renderStoredBlocks, type StoredTextMessage } from '@/features/chat/components/MessageBlocks';
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

const GROUP_MEMBERS: Array<[string, string, string]> = [
  ['🛩️', 'FlightAnalysis_Agent-F15B', 'workspace.group.role.supervisor'],
  ['📊', 'DataCheck_Agent-F15B', 'workspace.group.role.dataCheck'],
  ['📝', 'ReportWriter_Agent-F15B', 'workspace.group.role.report'],
];

const DEFAULT_GROUP_MEMBERS = [
  { agentId: 'flight-analysis', fab: 'F15B', version: '2.1.0' },
  { agentId: 'data-check', fab: 'F15B' },
  { agentId: 'report-writer', fab: 'F15B' },
];

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

  const groupConfig = useMemo<StoredGroupConfig | undefined>(() => {
    const value = session?.group;
    return value && typeof value === 'object'
      ? (value as StoredGroupConfig)
      : undefined;
  }, [session?.group]);
  const configuredMembers = groupConfig?.members?.length ? groupConfig.members : undefined;

  const fab = session?.fab || 'F15B';
  const { respondToHitl, restore, run, send, sendA2uiAction, stop } = useAgentDockConversation({
    agentId: 'group',
    fab,
    group: {
      members: configuredMembers ?? DEFAULT_GROUP_MEMBERS,
      orchestrationMode: mode,
      config: groupConfig?.config ?? { maxIterations: 6 },
    },
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
    onSurfaceAction: () =>
      surface &&
      void sendA2uiAction({
        actionName: 'open_report',
        context: { reportId: 'artifact-report' },
        sourceComponentId: 'open',
        surfaceId: surface[0],
      }),
  }, { showReasoning });

  const hasAnyMessage = storedMessages.length > 0 || Boolean(answer || running || run?.status);

  const sendMessage = async (message: string) => {
    if (!session) return;
    await sessionHistoryService.updateSession(session.id, {
      title: session.title === t('nav.newGroup') ? message.slice(0, 32) || session.title : session.title,
    });
    await send(message);
  };

  return (
    <Flexbox horizontal height="100%">
      <Flexbox flex={1} height="100%" style={{ minWidth: 0, position: 'relative' }}>
        <NavHeader
          left={
            <Flexbox horizontal align="center" gap={10} style={{ minWidth: 0 }}>
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
                <Text ellipsis fontSize={11} type="secondary">
                  {runtimeConfig.resolveAgentRuntimeUrl(fab)}
                </Text>
              </Flexbox>
            </Flexbox>
          }
        />
        <Flexbox className={styles.scroll}>
          <Flexbox
            gap={24}
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
                  avatar="👥"
                  content={record.content}
                  id={record.id}
                  key={record.id}
                  name={session?.title || t('nav.group')}
                  role="assistant"
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
              ),
            )}
            {(answer || running || run?.status) && (
              <>
                <ChatItem
                  avatar="LC"
                  content={currentUserMessage || input}
                  id="current-group-user"
                  name={t('chat.you')}
                  role="user"
                />
                <ChatItem
                  avatar="👥"
                  content={answer}
                  id="current-group-assistant"
                  loading={running}
                  name={session?.title || t('nav.group')}
                  role="assistant"
                  time={t('chat.justNow')}
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
              mentions={[]}
              running={running}
              value={input}
              onChange={setInput}
              onSelectMention={() => undefined}
              onSend={() => void sendMessage(input)}
              onStop={() => void stop()}
            />
          </Flexbox>
        </Flexbox>
      </Flexbox>

      <Flexbox className={styles.panel} gap={16} padding={16}>
        <Block gap={14} padding={18} variant="outlined">
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
            <Button block icon={Clock3} size="large" onClick={() => void stop()}>
              {t('workspace.group.stop')}
            </Button>
          ) : (
            <Button
              block
              icon={Play}
              size="large"
              type="primary"
              onClick={() => void sendMessage(t('workspace.group.sampleMessage'))}
            >
              {t('workspace.group.start')}
            </Button>
          )}
        </Block>
        <Block gap={14} padding={18} variant="outlined">
          <Text weight={500}>{t('workspace.group.task')}</Text>
          <Text style={{ lineHeight: 1.7 }}>{t('workspace.group.taskDesc')}</Text>
          <Flexbox horizontal gap={8}>
            <Tag>maxIterations: 6</Tag>
            <Tag>{t('workspace.group.timeout')}</Tag>
          </Flexbox>
        </Block>
        <Block gap={14} padding={18} variant="outlined">
          <Flexbox horizontal align="center" justify="space-between">
            <Text weight={500}>{t('workspace.group.members')}</Text>
            <Tag color="success">{t('workspace.group.members')}</Tag>
          </Flexbox>
          {configuredMembers ? (
            configuredMembers.map((member, index) => (
              <Flexbox horizontal align="center" gap={12} key={`${member.agentId}@${member.fab}`}>
                <Avatar avatar="🤖" shape="square" size={40} />
                <Flexbox flex={1} style={{ minWidth: 0 }}>
                  <Text ellipsis weight={500}>
                    {member.agentId}
                  </Text>
                  <Text fontSize={12} type="secondary">
                    v{member.version || '—'} · {member.fab}
                  </Text>
                </Flexbox>
                {index === 0 && <Tag color="info">Supervisor</Tag>}
                <Button icon={MoreHorizontal} type="text" />
              </Flexbox>
            ))
          ) : (
            GROUP_MEMBERS.map(([icon, name, role], index) => (
              <Flexbox horizontal align="center" gap={12} key={name}>
                <Avatar avatar={icon} shape="square" size={40} />
                <Flexbox flex={1} style={{ minWidth: 0 }}>
                  <Text ellipsis weight={500}>
                    {name}
                  </Text>
                  <Text fontSize={12} type="secondary">
                    {t(role)}
                  </Text>
                </Flexbox>
                {index === 0 && <Tag color="info">Supervisor</Tag>}
                <Button icon={MoreHorizontal} type="text" />
              </Flexbox>
            ))
          )}
          <Button icon={Plus}>{t('workspace.group.addMember')}</Button>
        </Block>
      </Flexbox>
    </Flexbox>
  );
};

export default GroupChatPage;
