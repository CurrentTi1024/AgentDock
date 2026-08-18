// Selective adaptation of LobeHub ConversationArea, ChatItem, reasoning and tool-call UI.
import { ActionIcon, Avatar, Block, Button, Flexbox, Icon, Tag, Text, TextArea } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Brain, Check, ChevronDown, Copy, FileBarChart, Paperclip, Play, Send, Square, ThumbsDown, ThumbsUp, Wrench, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { agentMarketService, type MentionAgent } from '@/services/market/agentMarketService';
import { messageFeedbackService } from '@/services/conversation/messageFeedbackService';
import { runtimeConfig } from '@/services/runtimeConfig';
import { createRunInput } from '@/services/runtime/agentRuntimeService';
import type { RuntimeMessage } from '@/services/runtime/types';
import { sessionHistoryService, type SessionRecord } from '@/services/session/sessionHistoryService';
import { useRunStore } from '@/stores/runStore';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`opacity: 0; transition: opacity 150ms ${cssVar.motionEaseOut};`,
  artifact: css`flex: none; width: 380px; border-inline-start: 1px solid ${cssVar.colorBorderSecondary}; background: ${cssVar.colorBgContainer};`,
  assistant: css`&:hover .message-actions { opacity: 1; }`,
  composer: css`position: relative; border: 1px solid ${cssVar.colorBorder}; border-radius: ${cssVar.borderRadiusLG}px; background: ${cssVar.colorBgContainer}; box-shadow: ${cssVar.boxShadowSecondary};`,
  header: css`flex: none; border-block-end: 1px solid ${cssVar.colorBorderSecondary};`,
  mentionMenu: css`position: absolute; z-index: 10; inset-inline: 0; inset-block-end: calc(100% + 8px); max-height: 270px; overflow-y: auto; padding: 6px; border: 1px solid ${cssVar.colorBorder}; border-radius: 12px; background: ${cssVar.colorBgElevated}; box-shadow: ${cssVar.boxShadowSecondary};`,
  process: css`overflow: hidden; border: 1px solid ${cssVar.colorBorderSecondary}; border-radius: ${cssVar.borderRadiusLG}px; background: ${cssVar.colorFillQuaternary};`,
  scroll: css`overflow-y: auto; flex: 1;`,
  user: css`max-width: 72%; border-radius: ${cssVar.borderRadiusLG}px 4px ${cssVar.borderRadiusLG}px ${cssVar.borderRadiusLG}px; padding: 10px 14px; background: ${cssVar.colorFillSecondary};`,
}));

export default function ChatPage() {
  const { id = 'session-inbox' } = useParams();
  const [searchParams] = useSearchParams();
  const sessionId = id === 'inbox' ? 'session-inbox' : id;
  const [open, setOpen] = useState(true);
  const [input, setInput] = useState('请分析今天的飞行测试数据，并给出关键结论。');
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentions, setMentions] = useState<MentionAgent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<MentionAgent | undefined>();
  const [agent, setAgent] = useState('FlightAnalysis_Agent-F15B');
  const [artifact, setArtifact] = useState(false);
  const [session, setSession] = useState<SessionRecord>();
  const [history, setHistory] = useState<RuntimeMessage[]>([]);
  const { run, execute, restoreSession, stop, respondToHitl, sendA2uiAction } = useRunStore();
  const running = run?.status === 'running'; const approval = run?.status === 'paused';
  const answer = Object.values(run?.messages || {}).filter((message) => message.role === 'assistant').at(-1)?.content || '';
  const currentUserMessage = Object.values(run?.messages || {}).filter((message) => message.role === 'user').at(-1)?.content || input;
  const phase = run?.status === 'success' ? 5 : approval ? 1 : Object.keys(run?.toolCalls || {}).length ? (answer ? 4 : 3) : run ? 2 : 0;
  const hitl = Object.values(run?.activities || {}).find((activity) => typeof activity === 'object' && activity && 'requestId' in activity) as { requestId?: string } | undefined;
  const surface = Object.entries(run?.surfaces || {}).at(-1);

  useEffect(() => { agentMarketService.getMentionAgentsList({ locale: 'zh-CN', limit: 20 }).then(({ items }) => { setMentions(items); setSelectedAgent(items[0]); }); }, []);
  useEffect(() => { const requested = mentions.find((item) => item.agentId === searchParams.get('agent') && item.fab === searchParams.get('fab')); if (requested) { setSelectedAgent(requested); setAgent(requested.name); } }, [mentions, searchParams]);
  useEffect(() => { sessionHistoryService.getSession(sessionId).then((value) => { setSession(value); if (value) setAgent(`${value.agentName || value.title}-${value.fab}`.replace(/\s+/g, '')); }); void sessionHistoryService.getMessages(sessionId).then(setHistory); void restoreSession(sessionId); }, [restoreSession, sessionId]);
  useEffect(() => { if (run && ['success', 'cancelled', 'error'].includes(run.status)) void sessionHistoryService.getMessages(sessionId).then(setHistory); }, [run?.status, sessionId]);
  const stream = () => hitl?.requestId && void respondToHitl({ requestId: hitl.requestId, mode: 'toolAuthorization', decision: 'approve' });
  const send = () => { const fab = selectedAgent?.fab || session?.fab || agent.split('-').at(-1) || 'F15B'; setArtifact(false); setOpen(true); void execute(createRunInput({ agentId: selectedAgent?.agentId || session?.agentId || 'flight-analysis', fab, message: input, sessionId, threadId: session?.threadId || `thread-${sessionId}` })); };
  const selectMention = (mention: MentionAgent) => { setSelectedAgent(mention); setAgent(mention.name); setInput((value) => `@${mention.name} ${value.replace(/^@\S*\s*/, '')}`); setMentionOpen(false); };
  const steps = [
    ['理解任务与制定计划', Brain],
    ['读取飞行测试数据', Check],
    ['flightData.queryMetrics', Wrench],
    ['交叉检查异常时间段', Check],
  ] as const;

  return <Flexbox horizontal height="100%">
    <Flexbox flex={1} height="100%" style={{ minWidth: 0 }}>
      <Flexbox horizontal align="center" className={styles.header} height={64} justify="space-between" paddingInline={20}><Flexbox horizontal align="center" gap={10}><Avatar avatar="🛩️" shape="square" size={36} /><Flexbox><Text weight="bold">{agent}</Text><Text fontSize={11} type="secondary">{runtimeConfig.resolveAgentRuntimeUrl(agent.split('-').at(-1) || 'F15B')}</Text></Flexbox></Flexbox><Button>Agent 信息</Button></Flexbox>
      <Flexbox className={styles.scroll}><Flexbox gap={24} style={{ marginInline: 'auto', maxWidth: 840, padding: '44px 24px 190px', width: '100%' }}>
        {history.filter((message) => !run?.messages[message.id]).map((message) => message.role === 'user' ? <Flexbox align="flex-end" gap={8} key={message.id}><Flexbox horizontal align="center" gap={8} style={{ flexDirection: 'row-reverse' }}><Avatar avatar="LC" size={32} /><Text weight="bold">你</Text></Flexbox><div className={styles.user}>{message.content}</div></Flexbox> : message.role === 'assistant' ? <Flexbox className={styles.assistant} gap={10} key={message.id}><Flexbox horizontal align="center" gap={8}><Avatar avatar="🛩️" shape="square" size={32} /><Text weight="bold">{agent}</Text></Flexbox><div style={{ fontSize: 15, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{message.content}</div></Flexbox> : null)}
        {!history.length && !answer && !running && !approval && <Flexbox align="center" gap={12} paddingBlock={48}><Avatar avatar="🛩️" shape="square" size={64} /><Text as="h1" fontSize={24} weight="bold">你好，我是 {agent}</Text><Text type="secondary">我可以展示规划、推理摘要、工具调用、HITL 确认和 Artifact。</Text><Flexbox horizontal gap={8} wrap="wrap"><Button onClick={() => setInput('分析今日飞行数据')}>分析今日飞行数据</Button><Button onClick={() => setInput('比较两次试飞结果')}>比较两次试飞结果</Button><Button onClick={() => setInput('生成测试摘要')}>生成测试摘要</Button></Flexbox></Flexbox>}
        {(answer || running || approval) && <>
          <Flexbox align="flex-end" gap={8}><Flexbox horizontal align="center" gap={8} style={{ flexDirection: 'row-reverse' }}><Avatar avatar="LC" size={32} /><Text weight="bold">你</Text></Flexbox><div className={styles.user}>{currentUserMessage}</div></Flexbox>
          <Flexbox className={styles.assistant} gap={10}><Flexbox horizontal align="center" gap={8}><Avatar avatar="🛩️" shape="square" size={32} /><Flexbox><Text weight="bold">{agent}</Text><Text fontSize={11} type="secondary">刚刚</Text></Flexbox></Flexbox>
            <div className={styles.process}><Flexbox horizontal align="center" gap={8} padding={11} style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}><Icon icon={Brain} size={15} /><Flexbox flex={1}><Text fontSize={12} weight="bold">{approval ? '计划已生成，等待确认' : running ? '正在分析' : '分析过程'}</Text><Text fontSize={11} type="secondary">{phase ? `步骤 ${Math.min(phase, 4)} / 4` : '准备执行'}</Text></Flexbox><Icon icon={ChevronDown} size={14} /></Flexbox>{open && <Flexbox gap={9} padding={12} style={{ borderTop: `1px solid ${cssVar.colorBorderSecondary}` }}>{steps.map(([label, glyph], index) => <Flexbox horizontal align="center" gap={8} key={label}><Icon color={phase > index ? cssVar.colorSuccess : cssVar.colorTextDescription} icon={glyph} size={14} /><Text fontSize={12} weight={phase === index + 1 ? 'bold' : undefined}>{label}</Text><Text fontSize={11} type="secondary">{phase > index + 1 ? '完成' : phase === index + 1 ? (approval ? '待确认' : '运行中') : '等待'}</Text></Flexbox>)}</Flexbox>}</div>
            {approval && <Block gap={12} padding={16} variant="outlined"><Flexbox horizontal align="center" gap={9}><Icon color={cssVar.colorWarning} icon={Play} /><Text weight="bold">需要你的确认</Text><Tag>HITL</Tag></Flexbox><Text type="secondary">即将读取 {selectedAgent?.fab || 'F15B'} 飞行测试指标。操作只读，不会修改源数据。</Text><Flexbox horizontal gap={8}><Button type="primary" onClick={stream}>允许并继续</Button><Button onClick={() => void respondToHitl({ requestId: hitl?.requestId || '', mode: 'toolAuthorization', decision: 'reject' })}>取消</Button></Flexbox></Block>}
            {answer && <div style={{ fontSize: 15, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{answer}{running && ' ▍'}</div>}
            {!running && answer && <><Flexbox horizontal gap={8}><Button icon={FileBarChart} onClick={() => setArtifact(true)}>打开分析报告</Button><Tag color="success">2 个引用</Tag>{surface && <Tag color="info">A2UI Surface</Tag>}</Flexbox><Flexbox horizontal className={`${styles.actions} message-actions`} gap={2}><ActionIcon aria-label="复制" icon={Copy} size="small" /><ActionIcon aria-label="点赞" icon={ThumbsUp} size="small" onClick={() => void messageFeedbackService.submitMessageFeedback({ feedback: 'like', messageId: Object.keys(run?.messages || {}).at(-1) || '', sessionId, threadId: session?.threadId || `thread-${sessionId}`, runId: run?.runId || '' })} /><ActionIcon aria-label="点踩" icon={ThumbsDown} size="small" onClick={() => void messageFeedbackService.submitMessageFeedback({ feedback: 'dislike', messageId: Object.keys(run?.messages || {}).at(-1) || '', reasonCode: 'incorrect', sessionId, threadId: session?.threadId || `thread-${sessionId}`, runId: run?.runId || '' })} /></Flexbox></>}
          </Flexbox>
        </>}
      </Flexbox></Flexbox>
      <Flexbox style={{ background: `linear-gradient(transparent, ${cssVar.colorBgContainer} 24%)`, bottom: 0, left: 0, padding: '28px 24px 12px', position: 'absolute', right: artifact ? 380 : 0 }}><Flexbox className={styles.composer} gap={4} padding={10} style={{ marginInline: 'auto', maxWidth: 840, width: '100%' }}>
        {mentionOpen && <Flexbox className={styles.mentionMenu} gap={3}><Text fontSize={11} type="secondary" style={{ padding: '6px 10px' }}>可调用的 Agent-FAB</Text>{mentions.map((mention) => <Flexbox horizontal align="center" gap={10} key={`${mention.agentId}-${mention.fab}`} padding="8px 10px" style={{ borderRadius: 8, cursor: 'pointer' }} onClick={() => selectMention(mention)}><Avatar avatar={mention.icon} size={30} /><Flexbox flex={1}><Text weight="bold">{mention.name}</Text><Text fontSize={11} type="secondary">v{mention.version} · {mention.description}</Text></Flexbox></Flexbox>)}</Flexbox>}
        <TextArea autoSize={{ minRows: 2, maxRows: 6 }} placeholder="发送消息，输入 @ 选择 Agent-FAB" value={input} variant="borderless" onChange={(e) => { setInput(e.target.value); setMentionOpen(e.target.value.startsWith('@')); }} />
        <Flexbox horizontal align="center" justify="space-between"><Flexbox horizontal gap={2}><ActionIcon aria-label="添加附件" icon={Paperclip} /><Button size="small" type="text" onClick={() => setMentionOpen((value) => !value)}>@ Agent-FAB</Button></Flexbox>{running ? <ActionIcon aria-label="停止生成" icon={Square} onClick={() => void stop()} /> : <ActionIcon aria-label="发送消息" icon={Send} onClick={send} />}</Flexbox>
      </Flexbox></Flexbox>
    </Flexbox>
    {artifact && <Flexbox className={styles.artifact} height="100%"><Flexbox horizontal align="center" className={styles.header} height={64} justify="space-between" paddingInline={16}><Flexbox horizontal align="center" gap={8}><Icon icon={FileBarChart} /><Text weight="bold">飞行测试分析报告</Text></Flexbox><ActionIcon icon={X} onClick={() => setArtifact(false)} /></Flexbox><Flexbox gap={20} padding={20} style={{ overflowY: 'auto' }}><Text as="h1" fontSize={22} weight="bold">当日试飞指标摘要</Text><Text type="secondary">A2UI Surface · 由 {agent} 生成</Text><Block gap={8} padding={16} variant="outlined"><Text weight="bold">总体状态</Text><Flexbox horizontal align="baseline" gap={8}><Text fontSize={30} weight="bold">稳定</Text><Tag color="success">通过</Tag></Flexbox></Block><Block gap={12} padding={16} variant="outlined"><Text weight="bold">需复核异常</Text><Text>09:42 · 振动峰值 +18%</Text><Text>10:17 · 温度跃升 +6.2°C</Text></Block><Button type="primary" onClick={() => surface && void sendA2uiAction({ surfaceId: surface[0], sourceComponentId: 'open', actionName: 'open_report', context: { reportId: 'artifact-report' } })}>执行 A2UI Action</Button></Flexbox></Flexbox>}
  </Flexbox>;
}
