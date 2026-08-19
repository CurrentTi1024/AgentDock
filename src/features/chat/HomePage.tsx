// AgentDock 首页 hub：不绑定默认 Agent、不记住上次——发送前在输入框左下角选择 Agent
// 或输入 @ 快速选择；候选问题悬浮在输入框外部左上角；输入框复用 ChatInput 统一样式。
// Adapted from: src/features/Home + AgentSidebar/Header/Agent/SwitchPanel (LobeHub canary)
import { Avatar, Button, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Sparkles } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import NavHeader from '@/components/shell/NavHeader';
import { agentMarketService, type MentionAgent } from '@/api/market/agentMarketService';
import { sessionHistoryService, type SessionRecord } from '@/api/session/sessionHistoryService';
import ChatInput from '@/features/chat/components/ChatInput';
import { useI18n } from '@/i18n';
import { formatRelativeTime } from '@/lib/relativeTime';

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  row: css`
    cursor: pointer;
    border-radius: ${token.borderRadiusLG}px;
    transition: background 200ms ${token.motionEaseOut};
    &:hover {
      background: ${token.colorFillQuaternary};
    }
  `,
  scroll: css`
    overflow-y: auto;
    flex: 1;
  `,
  section: css`
    padding-block: 20px 8px;
    color: ${token.colorTextDescription};
    font-size: 12px;
    font-weight: 500;
  `,
}));

const SUGGESTIONS = ['chat.suggestion.analyze', 'chat.suggestion.compare', 'chat.suggestion.summary'] as const;

const HomePage = memo(() => {
  const { locale, t } = useI18n();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<MentionAgent[]>([]);
  const [selected, setSelected] = useState<MentionAgent>();
  const [input, setInput] = useState('');
  const [sessions, setSessions] = useState<SessionRecord[]>([]);

  useEffect(() => {
    void agentMarketService.getMentionAgentsList({ locale: 'zh-CN' }).then(({ items }) => {
      setAgents(items);
    });
  }, []);

  useEffect(() => {
    const load = () => {
      void sessionHistoryService.listSessions().then(setSessions);
    };
    load();
    window.addEventListener('agentdock:sessions-changed', load);
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', load);
    return () => {
      window.removeEventListener('agentdock:sessions-changed', load);
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', load);
    };
  }, []);

  const recentSessions = useMemo(() => sessions.slice(0, 8), [sessions]);

  const start = useCallback(async () => {
    // 发送前必须确定 Agent：优先用下拉选择；未选择时尝试从输入里的 @名字 解析（@Agent 快速对话）。
    let target = selected;
    if (!target && input.includes('@')) {
      const token = input.slice(input.lastIndexOf('@') + 1).trim().split(/\s+/)[0];
      if (token) {
        target = agents.find(
          (agent) =>
            agent.agentFullName.toLowerCase().startsWith(token.toLowerCase()) ||
            agent.agentId.toLowerCase().startsWith(token.toLowerCase()),
        );
      }
    }
    if (!target || !input.trim()) return;
    const prompt = input.trim();
    // 选中/解析出的 Agent 从输入里去掉 @ 前缀（保留正文）。
    const cleanPrompt = prompt.replace(/^@\S*\s*/, '').trim() || prompt;
    const id = `session-${crypto.randomUUID()}`;
    const record = {
      agentId: target.agentId,
      agentName: target.agentFullName,
      fab: target.fab,
      id,
      pinned: false,
      threadId: crypto.randomUUID(),
      title: cleanPrompt.slice(0, 32) || target.agentFullName,
      type: 'agent' as const,
      version: target.version,
    };
    navigate(`/chat/${id}?agent=${encodeURIComponent(target.agentId)}&fab=${encodeURIComponent(target.fab)}`, {
      state: { pendingSession: record },
    });
    void sessionHistoryService.createSession(record).catch((reason) => {
      console.warn('[AgentDock] agent session persist failed', reason);
    });
  }, [agents, input, navigate, selected]);

  const selectMention = useCallback(
    (mention: MentionAgent) => {
      setSelected(mention);
      setInput((value) => `@${mention.agentFullName} ${value.replace(/^@\S*\s*/, '')}`);
    },
    [],
  );

  return (
    <Flexbox height="100%" style={{ minWidth: 0 }}>
      <NavHeader left={<Text fontSize={15} weight={500}>{t('nav.chat')}</Text>} />
      <Flexbox className={styles.scroll}>
        <Flexbox
          gap={14}
          style={{ marginInline: 'auto', maxWidth: 840, padding: '40px 24px 120px', width: '100%' }}
        >
          <Flexbox align="center" gap={14} paddingBlock={16}>
            <Avatar avatar="🛩️" shape="square" size={64} />
            <Flexbox align="center" gap={6}>
              <Text as="h1" fontSize={24} weight={600}>
                {t('home.welcome')}
              </Text>
              <Text type="secondary">{t('home.selectAgent')}</Text>
            </Flexbox>
          </Flexbox>

          {/* 候选问题：悬浮在输入框外部左上角（无输入时展示） */}
          {!input.trim() && (
            <Flexbox horizontal gap={8} paddingInline={2}>
              {SUGGESTIONS.map((key) => (
                <Button key={key} size="small" onClick={() => setInput(t(key))}>
                  {t(key)}
                </Button>
              ))}
            </Flexbox>
          )}

          <ChatInput
            agentName={selected?.agentFullName}
            fab={selected?.fab}
            mentions={agents}
            onChange={setInput}
            onMentionTrigger={() => undefined}
            onSelectMention={selectMention}
            onSend={() => void start()}
            onStop={() => undefined}
            onSwitchAgent={(agent) => setSelected(agent)}
            placeholder={t('home.placeholder')}
            running={false}
            sendDisabled={!selected && !input.trim().startsWith('@')}
            switchAgents={agents}
            value={input}
          />

          <div className={styles.section}>
            <Flexbox horizontal align="center" gap={6}>
              <Sparkles size={14} />
              {t('nav.recent')}
            </Flexbox>
          </div>
          {recentSessions.length === 0 ? (
            <Text fontSize={12} type="secondary">
              {t('nav.emptySessions')}
            </Text>
          ) : (
            <Flexbox gap={2}>
              {recentSessions.map((session) => {
                const agent = agents.find(
                  (item) => item.agentId === session.agentId && item.fab === session.fab,
                );
                const group = session.type === 'group';
                return (
                  <Flexbox
                    horizontal
                    align="center"
                    className={styles.row}
                    gap={12}
                    key={session.id}
                    padding={10}
                    onClick={() => navigate(group ? `/group/${session.id}` : `/chat/${session.id}`)}
                  >
                    <Avatar avatar={group ? '👥' : agent?.icon || '🤖'} shape="square" size={28} />
                    <Flexbox flex={1} style={{ minWidth: 0 }}>
                      <Text ellipsis weight={500}>
                        {session.title}
                      </Text>
                      <Text ellipsis fontSize={11} type="secondary">
                        {group ? session.title : agent?.agentFullName || session.agentName} ·{' '}
                        {formatRelativeTime(session.updatedAt, locale)}
                      </Text>
                    </Flexbox>
                  </Flexbox>
                );
              })}
            </Flexbox>
          )}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

HomePage.displayName = 'HomePage';

export default HomePage;
