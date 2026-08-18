import { Avatar, Block, Button, Flexbox, Icon, SearchBar, Segmented, Tag, Text } from '@lobehub/ui';
import { Switch } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { Brain, CalendarClock, CheckCircle2, Clock3, FileText, ListTodo, MoreHorizontal, Play, Plus, Settings, Sparkles, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { agentGroupService } from '@/services/agent-group/agentGroupService';
import { documentService } from '@/services/document/documentService';
import { memoryService } from '@/services/memory/memoryService';
import { createRunInput } from '@/services/runtime/agentRuntimeService';
import { scheduledTaskService } from '@/services/task/scheduledTaskService';
import { useRunStore } from '@/stores/runStore';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`cursor: pointer; border: 1px solid ${cssVar.colorBorderSecondary}; border-radius: ${cssVar.borderRadiusLG}px; background: ${cssVar.colorBgContainer}; &:hover { border-color: ${cssVar.colorBorder}; box-shadow: ${cssVar.boxShadowTertiary}; }`,
  header: css`flex: none; border-block-end: 1px solid ${cssVar.colorBorderSecondary};`,
  page: css`overflow-y: auto; height: 100%;`,
  root: css`width: 100%; max-width: 1120px; margin-inline: auto; padding: 32px 32px 80px;`,
  split: css`display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 24px; align-items: start;`,
  tableRow: css`display: grid; grid-template-columns: minmax(240px, 1fr) 160px 140px 48px; align-items: center; gap: 16px; min-height: 62px; padding: 10px 16px; border-block-end: 1px solid ${cssVar.colorBorderSecondary}; &:last-child { border-block-end: 0; }`,
}));

const meta = {
  documents: ['文档', '浏览、搜索并管理 Agent 可访问的工作文档。', FileText],
  group: ['Chat Group', '临时组合多个 Agent，选择编排方式并开始协作。', Users],
  memory: ['记忆', '查看和管理运行时可注入的个人记忆。', Brain],
  settings: ['设置', '调整 AgentDock 通用设置、外观和功能开关。', Settings],
  tasks: ['任务', '创建、安排并跟踪 Agent 任务和定时任务。', ListTodo],
} as const;

function PageTitle({ type }: { type: keyof typeof meta }) {
  const [title, description] = meta[type];
  return <Flexbox gap={5}><Text as="h1" fontSize={28} weight="bold">{title}</Text><Text type="secondary">{description}</Text></Flexbox>;
}

function GroupPage() {
  const agents = [['🛩️', 'FlightAnalysis_Agent-F15B', '规划与主分析'], ['📊', 'DataCheck_Agent-F15B', '数据质量检查'], ['📝', 'ReportWriter_Agent-F15B', '汇总报告']];
  const [modes, setModes] = useState<Array<{ modeId: string; name: string }>>([]); const [mode, setMode] = useState('supervisor'); const { execute, respondToHitl, run, stop } = useRunStore();
  useEffect(() => { agentGroupService.getSupportedAgentGroupOrchestrationModes({ locale: 'zh-CN' }).then((data) => { setModes(data.modes); setMode(data.defaultModeId); }); }, []);
  const hitl = Object.values(run?.activities || {}).find((activity) => typeof activity === 'object' && activity && 'requestId' in activity) as { requestId?: string } | undefined;
  const startGroup = () => void execute(createRunInput({ fab: 'F15B', message: '并行检查今日试飞数据并汇总异常。', sessionId: 'session-group-flight', threadId: 'thread-group-flight', group: { members: [{ agentId: 'flight-analysis', fab: 'F15B', version: '2.1.0' }, { agentId: 'data-check', fab: 'F15B' }, { agentId: 'report-writer', fab: 'F15B' }], orchestrationMode: mode, config: { maxIterations: 6 } } }));
  return <><PageTitle type="group" /><div className={styles.split}><Flexbox gap={16}><Block gap={16} padding={18} variant="outlined"><Flexbox horizontal align="center" justify="space-between"><Flexbox><Text weight="bold">飞行评审小组</Text><Text type="secondary">临时 Group · 不保存到市场</Text></Flexbox><Tag color="success">3 个 Agent</Tag></Flexbox>{agents.map(([icon, name, role], index) => <Flexbox horizontal align="center" gap={12} key={name}><Avatar avatar={icon} shape="square" size={40} /><Flexbox flex={1}><Text weight="bold">{name}</Text><Text fontSize={12} type="secondary">{role}</Text></Flexbox>{index === 0 && <Tag color="info">Supervisor</Tag>}<Button icon={MoreHorizontal} type="text" /></Flexbox>)}<Button icon={Plus}>添加 Agent-FAB</Button></Block><Block gap={14} padding={18} variant="outlined"><Text weight="bold">本次任务</Text><Text style={{ lineHeight: 1.7 }}>并行检查今日试飞数据，由主管 Agent 汇总异常、证据和行动项。</Text><Flexbox horizontal gap={8}><Tag>maxIterations: 6</Tag><Tag>超时: 10 min</Tag>{run && <Tag color="info">{run.status}</Tag>}</Flexbox>{run?.status === 'paused' && hitl?.requestId && <Block gap={10} padding={12} variant="filled"><Text weight="bold">主管 Agent 请求读取成员所需数据</Text><Text fontSize={12} type="secondary">确认后继续使用相同 runId 执行并汇总。</Text><Flexbox horizontal gap={8}><Button size="small" type="primary" onClick={() => void respondToHitl({ requestId: hitl.requestId!, mode: 'toolAuthorization', decision: 'approve' })}>允许并继续</Button><Button size="small" onClick={() => void respondToHitl({ requestId: hitl.requestId!, mode: 'toolAuthorization', decision: 'reject' })}>拒绝</Button></Flexbox></Block>}</Block></Flexbox><Flexbox gap={16}><Block gap={14} padding={18} variant="outlined"><Text weight="bold">编排模式</Text><Segmented block options={modes.map((item) => ({ label: item.name, value: item.modeId }))} value={mode} onChange={(value) => setMode(String(value))} /><Text fontSize={12} type="secondary">模式来自 agentGroupService，页面不硬编码。</Text></Block>{run?.status === 'running' ? <Button block icon={Clock3} size="large" onClick={() => void stop()}>停止 Group Chat</Button> : <Button block icon={Play} size="large" type="primary" onClick={startGroup}>开始 Group Chat</Button>}</Flexbox></div></>;
}

function TasksPage() {
  const [tasks, setTasks] = useState<Awaited<ReturnType<typeof scheduledTaskService.getScheduledTasks>>>([]);
  useEffect(() => { void scheduledTaskService.getScheduledTasks().then(setTasks); }, []);
  const statusLabel: Record<string, string> = { completed: '已完成', running: '运行中', scheduled: '已计划' };
  return <><PageTitle type="tasks" /><Flexbox horizontal justify="space-between"><Segmented options={['全部', '运行中', '定时任务', '已完成']} defaultValue="全部" /><Button icon={Plus} type="primary">新建任务</Button></Flexbox><Block variant="outlined" style={{ overflow: 'hidden' }}>{tasks.map((task) => <div className={styles.tableRow} key={task.id}><Flexbox horizontal align="center" gap={12}><Avatar avatar={<Icon icon={task.status === 'running' ? Play : task.status === 'scheduled' ? CalendarClock : CheckCircle2} />} size={38} /><Flexbox><Text weight="bold">{task.title}</Text><Text fontSize={12} type="secondary">{task.agentName}</Text></Flexbox></Flexbox><Tag color={task.status === 'running' ? 'info' : task.status === 'completed' ? 'success' : undefined}>{statusLabel[task.status]}</Tag><Text type="secondary">{task.schedule}</Text><Button icon={MoreHorizontal} type="text" /></div>)}</Block></>;
}

function DocumentsPage() {
  const [documents, setDocuments] = useState<Awaited<ReturnType<typeof documentService.getDocumentsListByKW>>>([]);
  useEffect(() => { void documentService.getDocumentsListByKW().then(setDocuments); }, []);
  const formatSize = (size: number) => size > 1_000_000 ? `${(size / 1_000_000).toFixed(1)} MB` : `${Math.round(size / 1000)} KB`;
  return <><PageTitle type="documents" /><Flexbox horizontal justify="space-between"><Segmented options={['最近', '我的文档', '共享给我']} defaultValue="最近" /><Button icon={Plus} type="primary">添加文档</Button></Flexbox><Block variant="outlined" style={{ overflow: 'hidden' }}>{documents.map((document) => <div className={styles.tableRow} key={document.id}><Flexbox horizontal align="center" gap={12}><Avatar avatar={<Icon icon={FileText} />} size={38} /><Flexbox><Text weight="bold">{document.title}</Text><Text fontSize={12} type="secondary">{document.mediaType.split('/').at(-1)} · {formatSize(document.size)}</Text></Flexbox></Flexbox><Text type="secondary">{document.owner}</Text><Text type="secondary">{new Date(document.updatedAt).toLocaleDateString('zh-CN')}</Text><Button icon={MoreHorizontal} type="text" /></div>)}</Block></>;
}

function MemoryPage() {
  const [memories, setMemories] = useState<Awaited<ReturnType<typeof memoryService.getMemoryItems>>>([]);
  const [autoInject, setAutoInject] = useState(true);
  useEffect(() => { void Promise.all([memoryService.getMemoryItems(), memoryService.getMemorySettings()]).then(([items, settings]) => { setMemories(items); setAutoInject(settings.autoInject); }); }, []);
  return <><PageTitle type="memory" /><Block horizontal align="center" gap={14} padding={18} variant="outlined"><Icon color={cssVar.colorWarning} icon={Sparkles} size={22} /><Flexbox flex={1}><Text weight="bold">运行时自动注入</Text><Text type="secondary">记忆由后端按权限注入 Agent context，不会拼接进用户消息。</Text></Flexbox><Switch checked={autoInject} onChange={setAutoInject} /></Block><Flexbox gap={10}>{memories.map((memory) => <Block horizontal align="center" gap={14} key={memory.id} padding={16} variant="outlined"><Avatar avatar={<Icon icon={Brain} />} size={38} /><Flexbox flex={1}><Flexbox horizontal gap={8}><Text weight="bold">{memory.title}</Text><Tag>{memory.category}</Tag></Flexbox><Text type="secondary">{memory.content}</Text></Flexbox><Text fontSize={12} type="secondary">{new Date(memory.updatedAt).toLocaleDateString('zh-CN')}</Text><Button icon={MoreHorizontal} type="text" /></Block>)}</Flexbox></>;
}

function SettingsPage() {
  const rows = [['界面语言', '简体中文', false], ['深色模式', '跟随系统', true], ['显示推理摘要', '仅显示安全摘要，不展示隐藏思维链', true], ['Mock 流式响应', '开发预览环境', true]] as const;
  return <><PageTitle type="settings" /><Block gap={0} variant="outlined">{rows.map(([label, description, toggle]) => <Flexbox horizontal align="center" gap={16} key={label} padding={17} style={{ borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}` }}><Flexbox flex={1}><Text weight="bold">{label}</Text><Text type="secondary">{description}</Text></Flexbox>{toggle ? <Switch defaultChecked /> : <Button>修改</Button>}</Flexbox>)}</Block><Block horizontal align="center" gap={12} padding={18} variant="outlined"><Icon icon={Clock3} /><Flexbox><Text weight="bold">Session History</Text><Text type="secondary">保存在当前浏览器 IndexedDB；不上传后端。</Text></Flexbox></Block></>;
}

export default function WorkspacePage({ type }: { type: keyof typeof meta }) {
  return <Flexbox className={styles.page}><Flexbox horizontal align="center" className={styles.header} height={64} justify="space-between" paddingInline={24}><SearchBar placeholder={`搜索${meta[type][0]}`} style={{ maxWidth: 480, width: '48%' }} />{!['settings', 'group'].includes(type) && <Button icon={Plus} type="primary">新建</Button>}</Flexbox><Flexbox className={styles.root} gap={24}>{type === 'group' && <GroupPage />}{type === 'tasks' && <TasksPage />}{type === 'documents' && <DocumentsPage />}{type === 'memory' && <MemoryPage />}{type === 'settings' && <SettingsPage />}</Flexbox></Flexbox>;
}
