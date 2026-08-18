import { Avatar, Block, Button, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  BookOpenIcon,
  BotIcon,
  CheckCircle2Icon,
  CheckIcon,
  CodeIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileCode2Icon,
  GitBranchIcon,
  HistoryIcon,
  InfoIcon,
  LayersIcon,
  ListIcon,
  MessageSquareTextIcon,
  PackageCheckIcon,
  PlayIcon,
  ShieldCheckIcon,
  SparklesIcon,
  SquareUserIcon,
  StarIcon,
  UsersIcon,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import MarketItem from '@/components/lobehub/MarketItem';
import { agentMarketService } from '@/services/market/agentMarketService';
import { mcpMarketService } from '@/services/market/mcpMarketService';
import { skillMarketService } from '@/services/market/skillMarketService';
import type { AgentFabDetail, MarketDetail, MarketKind, McpFabDetail, SkillFabDetail } from '@/types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 48px;
    align-items: start;
    @media (max-width: 900px) { grid-template-columns: minmax(0, 1fr); gap: 24px; }
  `,
  capabilityGrid: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    @media (max-width: 680px) { grid-template-columns: minmax(0, 1fr); }
  `,
  code: css`
    overflow: auto;
    margin: 0;
    padding: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;
    color: ${cssVar.colorTextSecondary};
    background: ${cssVar.colorFillQuaternary};
    font: 12px/1.65 ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre-wrap;
  `,
  fabButton: css`
    cursor: pointer;
    height: 34px;
    padding-inline: 14px;
    border: 0;
    border-radius: 7px;
    color: ${cssVar.colorTextSecondary};
    background: transparent;
    &:hover { color: ${cssVar.colorText}; background: ${cssVar.colorFillTertiary}; }
  `,
  fabButtonActive: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorBgContainer};
    box-shadow: 0 1px 3px rgb(0 0 0 / 8%);
  `,
  header: css`
    padding-block: 32px 24px;
  `,
  infoRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding-block: 10px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    &:last-child { border-block-end: 0; }
  `,
  markdown: css`
    color: ${cssVar.colorTextSecondary};
    font-size: 14px;
    line-height: 1.8;
    white-space: pre-wrap;
  `,
  nav: css`
    overflow-x: auto;
    display: flex;
    min-height: 48px;
    border-block-end: 1px solid ${cssVar.colorBorder};
    scrollbar-width: none;
    &::-webkit-scrollbar { display: none; }
  `,
  navButton: css`
    cursor: pointer;
    position: relative;
    display: flex;
    align-items: center;
    gap: 7px;
    flex: none;
    min-height: 47px;
    padding-inline: 13px;
    border: 0;
    color: ${cssVar.colorTextSecondary};
    background: transparent;
    &:hover { color: ${cssVar.colorText}; background: ${cssVar.colorFillQuaternary}; }
    &::after {
      content: '';
      position: absolute;
      inset-inline: 13px;
      inset-block-end: -1px;
      height: 2px;
      border-radius: 2px;
      background: transparent;
    }
  `,
  navButtonActive: css`
    font-weight: 600;
    color: ${cssVar.colorText};
    &::after { background: ${cssVar.colorPrimary}; }
  `,
  page: css`
    overflow-y: auto;
    height: 100%;
  `,
  root: css`
    width: 100%;
    max-width: 1180px;
    margin-inline: auto;
    padding: 0 32px 64px;
    @media (max-width: 680px) { padding: 0 16px 48px; }
  `,
  sidebar: css`
    position: sticky;
    top: 16px;
    @media (max-width: 900px) { position: static; }
  `,
  stat: css`
    min-width: 84px;
    padding: 10px 14px;
    border-inline-start: 1px solid ${cssVar.colorBorderSecondary};
    text-align: center;
  `,
  title: css`overflow-wrap: anywhere; @media (max-width: 680px) { font-size: 22px !important; }`,
  versionStrip: css`
    display: flex;
    gap: 4px;
    width: fit-content;
    padding: 4px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 10px;
    background: ${cssVar.colorFillQuaternary};
  `,
}));

type TabItem = { count?: number; icon: typeof BookOpenIcon; key: string; label: string };

const tabs: Record<MarketKind, TabItem[]> = {
  agent: [
    { icon: BookOpenIcon, key: 'overview', label: '概览' },
    { icon: SquareUserIcon, key: 'system-role', label: '系统角色' },
    { icon: LayersIcon, key: 'capabilities', label: '能力' },
    { icon: HistoryIcon, key: 'version', label: '版本' },
    { icon: ListIcon, key: 'related', label: '相关 Agent' },
  ],
  skill: [
    { icon: BookOpenIcon, key: 'overview', label: '概览' },
    { icon: DownloadIcon, key: 'install', label: '安装' },
    { icon: MessageSquareTextIcon, key: 'reviews', label: '评价' },
    { icon: InfoIcon, key: 'info', label: '信息' },
    { icon: BotIcon, key: 'agents', label: 'Agent' },
    { icon: HistoryIcon, key: 'version', label: '版本' },
  ],
  mcp: [
    { icon: BookOpenIcon, key: 'overview', label: '概览' },
    { icon: DownloadIcon, key: 'deployment', label: '部署' },
    { icon: CodeIcon, key: 'schema', label: 'Schema' },
    { icon: ListIcon, key: 'related', label: '相关 MCP' },
    { icon: PackageCheckIcon, key: 'security', label: '安全' },
    { icon: BotIcon, key: 'agents', label: 'Agent' },
    { icon: HistoryIcon, key: 'version', label: '版本' },
  ],
};

function SectionTitle({ children, count }: { children: ReactNode; count?: number }) {
  return <Flexbox horizontal align="center" gap={8}><Text as="h2" fontSize={18} weight="bold">{children}</Text>{typeof count === 'number' && <Tag>{count}</Tag>}</Flexbox>;
}

function EmptyHint({ children }: { children: ReactNode }) {
  return <Block padding={24} variant="outlined"><Text type="secondary">{children}</Text></Block>;
}

function ResourceCards({ items }: { items: Array<{ description?: string; icon?: string; name: string; version?: string }> }) {
  return <Flexbox gap={10}>{items.map((item) => <Block horizontal align="center" gap={12} key={`${item.name}-${item.version || ''}`} padding={14} variant="outlined"><Avatar avatar={item.icon || '🧩'} background="transparent" shape="square" size={36} /><Flexbox flex={1} gap={2}><Text weight="bold">{item.name}</Text>{item.description && <Text fontSize={12} type="secondary">{item.description}</Text>}</Flexbox>{item.version && <Tag>v{item.version}</Tag>}</Block>)}</Flexbox>;
}

function ChatExamples({ data, agent }: { agent: MarketDetail; data: AgentFabDetail }) {
  return <Block gap={0} variant="outlined" style={{ overflow: 'hidden' }}>{data.examples.map((message, index) => <Flexbox horizontal align="flex-start" gap={12} key={index} padding={16} style={{ background: message.role === 'assistant' ? cssVar.colorFillQuaternary : undefined, borderBlockEnd: index < data.examples.length - 1 ? `1px solid ${cssVar.colorBorderSecondary}` : undefined }}><Avatar avatar={message.role === 'assistant' ? agent.icon : '👤'} background="transparent" size={32} /><Flexbox gap={4}><Text fontSize={12} type="secondary">{message.role === 'assistant' ? agent.name : '你'}</Text><Text style={{ lineHeight: 1.7 }}>{message.content}</Text></Flexbox></Flexbox>)}</Block>;
}

function FabSelector({ data, fab, onChange }: { data: Array<{ callPermission: boolean; fab: string; version: string }>; fab: string; onChange: (fab: string) => void }) {
  return <div className={styles.versionStrip}>{data.map((item) => <button className={`${styles.fabButton} ${fab === item.fab ? styles.fabButtonActive : ''}`} key={item.fab} onClick={() => onChange(item.fab)}>{item.fab}{!item.callPermission && ' · 无权限'}</button>)}</div>;
}

function VersionHeader({ item }: { item: { callPermission: boolean; fab: string; version: string } }) {
  return <Block horizontal align="center" justify="space-between" padding={16} variant="outlined" wrap="wrap"><Flexbox horizontal align="center" gap={10} wrap="wrap"><code style={{ fontSize: 16, whiteSpace: 'nowrap' }}>v{item.version}</code><Tag color="info">当前激活版本</Tag>{item.callPermission ? <Tag color="success">可调用</Tag> : <Tag>仅可查看</Tag>}</Flexbox><Text fontSize={12} type="secondary">FAB {item.fab}</Text></Block>;
}

function AgentContent({ detail, tab }: { detail: MarketDetail; tab: string }) {
  const versions = detail.agentVersions || [];
  const [fab, setFab] = useState(versions[0]?.fab || '');
  const active = versions.find((item) => item.fab === fab) || versions[0];
  if (!active) return <EmptyHint>暂无版本信息</EmptyHint>;

  if (tab === 'overview') return <Flexbox gap={20}><Block gap={8} padding={16} variant="outlined"><Text weight="bold">摘要</Text><Text className={styles.markdown}>{detail.summary}</Text></Block><SectionTitle>对话示例</SectionTitle><ChatExamples agent={detail} data={active} /></Flexbox>;
  if (tab === 'system-role') return <Flexbox gap={20}><SectionTitle>系统角色</SectionTitle><Block padding={16} variant="outlined"><div className={styles.markdown}>{active.systemRole}</div><Flexbox horizontal gap={6} paddingBlock={14} wrap="wrap">{detail.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</Flexbox></Block><SectionTitle>开场白</SectionTitle><Block horizontal align="flex-start" gap={12} padding={16} variant="outlined"><Icon color={cssVar.colorError} icon={SparklesIcon} size={20} /><Text style={{ lineHeight: 1.7 }}>{active.openingMessage}</Text></Block><SectionTitle count={active.openingQuestions.length}>建议问题</SectionTitle><Flexbox gap={8}>{active.openingQuestions.map((question) => <Block horizontal align="center" gap={12} key={question} padding={14} variant="outlined"><Icon color={cssVar.colorWarning} icon={MessageSquareTextIcon} size={18} /><Text>{question}</Text></Block>)}</Flexbox></Flexbox>;
  if (tab === 'capabilities') return <Flexbox gap={42}><Flexbox gap={16}><SectionTitle count={active.capabilities.length}>核心能力</SectionTitle><div className={styles.capabilityGrid}>{active.capabilities.map((capability) => <Block horizontal align="center" gap={10} key={capability} padding={15} variant="outlined"><Icon color={cssVar.colorSuccess} icon={CheckCircle2Icon} size={18} /><Text>{capability}</Text></Block>)}</div></Flexbox><Flexbox gap={16}><SectionTitle count={active.mcpServers.length}>工具与 MCP</SectionTitle><ResourceCards items={active.mcpServers} /></Flexbox><Flexbox gap={16}><SectionTitle count={active.skills.length}>知识与 Skill</SectionTitle><ResourceCards items={active.skills} /></Flexbox></Flexbox>;
  if (tab === 'version') return <Flexbox gap={18}><Flexbox gap={8}><SectionTitle>版本</SectionTitle><Text type="secondary">FAB 是版本页面的第二层导航；每个 FAB 只展示一个当前激活版本。</Text></Flexbox><FabSelector data={versions} fab={fab} onChange={setFab} /><VersionHeader item={active} /><Block gap={16} padding={16} variant="outlined"><Text weight="bold">{active.fab} 版本说明</Text><Text className={styles.markdown}>{active.overview}</Text><Flexbox horizontal gap={8} wrap="wrap"><Tag>{active.skills.length} Skills</Tag><Tag>{active.mcpServers.length} MCP Servers</Tag><Tag>{active.capabilities.length} Capabilities</Tag></Flexbox></Block></Flexbox>;
  return <Flexbox gap={16}><SectionTitle count={detail.related.length}>相关 Agent</SectionTitle><div className={styles.capabilityGrid}>{detail.related.map((item) => <MarketItem item={item} key={item.id} kind="agent" />)}</div></Flexbox>;
}

function SkillContent({ detail, tab }: { detail: MarketDetail; tab: string }) {
  const versions = detail.skillVersions || [];
  const [fab, setFab] = useState(versions[0]?.fab || '');
  const active = versions.find((item) => item.fab === fab) || versions[0];
  if (!active) return <EmptyHint>暂无版本信息</EmptyHint>;

  if (tab === 'overview') return <Flexbox gap={18}><Block padding={16} variant="outlined"><div className={styles.markdown}>{active.content}</div></Block><SectionTitle count={detail.related.length}>相关 Skill</SectionTitle><div className={styles.capabilityGrid}>{detail.related.map((item) => <MarketItem item={item} key={item.id} kind="skill" />)}</div></Flexbox>;
  if (tab === 'install') return <Flexbox gap={18}><SectionTitle>安装到 AgentDock</SectionTitle><Block gap={16} padding={20} variant="outlined"><Flexbox horizontal align="center" gap={14}><Avatar avatar={detail.icon} background="transparent" shape="square" size={44} /><Flexbox flex={1}><Text weight="bold">从 Agent Registry 安装</Text><Text type="secondary">安装后可在有权限的 Agent 中启用，FAB 兼容性由平台校验。</Text></Flexbox><Button icon={DownloadIcon} type="primary">安装</Button></Flexbox><pre className={styles.code}>agentdock skill install {detail.id} --fab {active.fab}</pre></Block><SectionTitle>支持的平台</SectionTitle><ResourceCards items={[{ icon: '🌐', name: 'AgentDock Web', description: '由平台自动安装和更新' }, { icon: '⌨️', name: 'VS Code', description: '复制命令到集成终端' }]} /></Flexbox>;
  if (tab === 'reviews') return <Flexbox gap={16}><SectionTitle>用户评价</SectionTitle><Block horizontal align="center" gap={24} padding={20} variant="outlined"><Flexbox align="center"><Text fontSize={30} weight="bold">4.8</Text><Text fontSize={12} type="secondary">12 条评价</Text></Flexbox><Flexbox horizontal gap={3}>{[1, 2, 3, 4, 5].map((n) => <Icon color={cssVar.colorWarning} icon={StarIcon} key={n} size={18} />)}</Flexbox></Block>{['输出结构清楚，引用路径可以直接核验。', 'FAB 适配信息明确，安装过程很顺。'].map((review, index) => <Block gap={8} key={review} padding={16} variant="outlined"><Flexbox horizontal align="center" gap={8}><Avatar avatar={index ? '🧑‍💻' : '👩‍🚀'} size={28} /><Text weight="bold">{index ? 'Developer A' : 'Flight User'}</Text><Tag>已验证用户</Tag></Flexbox><Text>{review}</Text></Block>)}</Flexbox>;
  if (tab === 'info') return <Flexbox gap={16}><SectionTitle>资源信息</SectionTitle><Block paddingInline={16} variant="outlined"><InfoRows detail={detail} /><div className={styles.infoRow}><Text type="secondary">仓库</Text><Text>{detail.repositoryUrl}</Text></div><div className={styles.infoRow}><Text type="secondary">权限</Text><Flexbox horizontal gap={6}>{active.permissions.map((permission) => <Tag key={permission}>{permission}</Tag>)}</Flexbox></div></Block><SectionTitle count={active.resources.length}>包含资源</SectionTitle><ResourceCards items={active.resources.map((resource) => ({ icon: '📄', name: resource.path, description: resource.size }))} /></Flexbox>;
  if (tab === 'agents') return <ReferencingAgents detail={detail} />;
  return <Flexbox gap={18}><Flexbox gap={8}><SectionTitle>版本</SectionTitle><Text type="secondary">保留 Skill 原页面导航，并在新增的版本页内按 FAB 细分。</Text></Flexbox><FabSelector data={versions} fab={fab} onChange={setFab} /><VersionHeader item={active} /><Block gap={12} padding={16} variant="outlined"><Text weight="bold">变更记录</Text>{active.changelog.map((change) => <Flexbox horizontal align="center" gap={8} key={change}><Icon color={cssVar.colorSuccess} icon={CheckIcon} size={16} /><Text>{change}</Text></Flexbox>)}</Block></Flexbox>;
}

function McpContent({ detail, tab }: { detail: MarketDetail; tab: string }) {
  const versions = detail.mcpVersions || [];
  const [fab, setFab] = useState(versions[0]?.fab || '');
  const active = versions.find((item) => item.fab === fab) || versions[0];
  if (!active) return <EmptyHint>暂无版本信息</EmptyHint>;

  if (tab === 'overview') return <Flexbox gap={18}><Block gap={12} padding={18} variant="outlined"><Text className={styles.markdown}>{active.overview}</Text><Flexbox horizontal gap={8}><Tag>{active.connectionType}</Tag><Tag color="success">平台托管</Tag><Tag>{active.tools.length} Tools</Tag></Flexbox></Block><SectionTitle>功能</SectionTitle><ResourceCards items={active.tools.map((tool) => ({ icon: '🧰', name: tool.name, description: tool.description }))} /></Flexbox>;
  if (tab === 'deployment') return <Flexbox gap={16}><SectionTitle count={active.deploymentOptions.length}>部署方式</SectionTitle>{active.deploymentOptions.map((option) => <Block horizontal align="center" gap={14} key={option.label} padding={17} variant="outlined"><Icon color={option.recommended ? cssVar.colorSuccess : cssVar.colorTextSecondary} icon={GitBranchIcon} size={21} /><Flexbox flex={1}><Flexbox horizontal align="center" gap={8}><Text weight="bold">{option.label}</Text>{option.recommended && <Tag color="success">推荐</Tag>}</Flexbox><Text type="secondary">{option.description}</Text></Flexbox><Button>查看说明</Button></Block>)}</Flexbox>;
  if (tab === 'schema') return <Flexbox gap={32}><Flexbox gap={14}><SectionTitle count={active.tools.length}>Tools</SectionTitle>{active.tools.map((tool) => <Block gap={12} key={tool.name} padding={16} variant="outlined"><Flexbox horizontal align="center" gap={8}><Icon icon={FileCode2Icon} size={18} /><Text weight="bold">{tool.name}</Text></Flexbox><Text type="secondary">{tool.description}</Text><pre className={styles.code}>{tool.schema}</pre></Block>)}</Flexbox><Flexbox gap={14}><SectionTitle count={active.resources.length}>Resources</SectionTitle><ResourceCards items={active.resources.map((resource) => ({ icon: '🔗', name: resource.name, description: `${resource.description} · ${resource.uri}` }))} /></Flexbox><Flexbox gap={14}><SectionTitle count={active.prompts.length}>Prompts</SectionTitle><ResourceCards items={active.prompts.map((prompt) => ({ icon: '💬', name: prompt.name, description: prompt.description }))} /></Flexbox></Flexbox>;
  if (tab === 'related') return <Flexbox gap={16}><SectionTitle count={detail.related.length}>相关 MCP</SectionTitle><div className={styles.capabilityGrid}>{detail.related.map((item) => <MarketItem item={item} key={item.id} kind="mcp" />)}</div></Flexbox>;
  if (tab === 'security') return <Flexbox gap={16}><SectionTitle>安全与质量</SectionTitle><Block gap={16} padding={18} variant="outlined">{[['Registry 校验', '已通过'], ['凭据处理', '仅服务端注入'], ['数据权限', '继承当前用户'], ['最近扫描', '2026-08-17']].map(([label, value]) => <Flexbox horizontal align="center" justify="space-between" key={label}><Flexbox horizontal align="center" gap={9}><Icon color={cssVar.colorSuccess} icon={ShieldCheckIcon} size={18} /><Text>{label}</Text></Flexbox><Tag color="success">{value}</Tag></Flexbox>)}</Block></Flexbox>;
  if (tab === 'agents') return <ReferencingAgents detail={detail} />;
  return <Flexbox gap={18}><Flexbox gap={8}><SectionTitle>版本</SectionTitle><Text type="secondary">FAB 作为原 LobeHub Version 页中的二级页签，不改变 MCP 一级导航。</Text></Flexbox><FabSelector data={versions} fab={fab} onChange={setFab} /><VersionHeader item={active} /><Block gap={12} padding={16} variant="outlined"><Text weight="bold">变更记录</Text>{active.changelog.map((change) => <Flexbox horizontal align="center" gap={8} key={change}><Icon color={cssVar.colorSuccess} icon={CheckIcon} size={16} /><Text>{change}</Text></Flexbox>)}</Block></Flexbox>;
}

function ReferencingAgents({ detail }: { detail: MarketDetail }) {
  const agents = detail.referencingAgents || [];
  return <Flexbox gap={16}><SectionTitle count={agents.length}>使用此资源的 Agent</SectionTitle><Text type="secondary">仅展示当前用户可见的 Agent 当前激活版本。</Text><ResourceCards items={agents.map((agent) => ({ icon: agent.icon, name: `${agent.name}-${agent.fab}`, description: `Agent v${agent.agentVersion}` }))} /></Flexbox>;
}

function InfoRows({ detail }: { detail: MarketDetail }) {
  return <>{[['所有者', detail.ownerName], ['分类', detail.category], ['创建时间', new Date(detail.createTimeAt).toLocaleDateString('zh-CN')], ['更新时间', new Date(detail.updatedAt).toLocaleDateString('zh-CN')]].map(([label, value]) => <div className={styles.infoRow} key={label}><Text type="secondary">{label}</Text><Text>{value}</Text></div>)}</>;
}

function Sidebar({ detail, kind, navigate }: { detail: MarketDetail; kind: MarketKind; navigate: ReturnType<typeof useNavigate> }) {
  const available = detail.versions.find((version) => version.callPermission);
  return <Flexbox className={styles.sidebar} gap={20}>
    {kind === 'agent' && <Button block disabled={!available} icon={PlayIcon} size="large" type="primary" onClick={() => navigate(`/chat/session-inbox?agent=${detail.id}&fab=${available?.fab}`)}>开始对话</Button>}
    {kind !== 'agent' && <Button block icon={DownloadIcon} size="large" type="primary">{kind === 'skill' ? '安装 Skill' : '添加到 Agent'}</Button>}
    <Block gap={12} padding={16} variant="outlined"><Text weight="bold">摘要</Text><Text type="secondary" style={{ lineHeight: 1.7 }}>{detail.summary}</Text></Block>
    <Block gap={2} paddingInline={16} variant="outlined"><InfoRows detail={detail} /></Block>
    <Flexbox horizontal gap={8} wrap="wrap">{detail.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</Flexbox>
    {(detail.homepageUrl || detail.repositoryUrl) && <Flexbox gap={8}>{detail.homepageUrl && <Button icon={ExternalLinkIcon}>主页</Button>}{detail.repositoryUrl && <Button icon={GitBranchIcon}>源代码</Button>}</Flexbox>}
  </Flexbox>;
}

export default function DetailPage({ kind }: { kind: MarketKind }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<MarketDetail | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  useEffect(() => {
    setActiveTab('overview');
    const request = kind === 'agent' ? agentMarketService.getAgentDetailById({ agentId: id, locale: 'zh-CN' }) : kind === 'skill' ? skillMarketService.getSkillDetailById({ skillId: id, locale: 'zh-CN' }) : mcpMarketService.getMcpServerDetailById({ mcpServerId: id, locale: 'zh-CN' });
    request.then(setDetail);
  }, [id, kind]);
  const navItems = useMemo(() => tabs[kind].map((item) => ({ ...item, count: item.key === 'version' ? detail?.versions.length : item.key === 'related' ? detail?.related.length : item.key === 'agents' ? detail?.referencingAgents?.length : undefined })), [detail, kind]);
  if (!detail) return <Flexbox align="center" justify="center" height="100%"><Text type="secondary">正在加载详情…</Text></Flexbox>;

  return <div className={styles.page}><div className={styles.root}>
    <Flexbox className={styles.header} gap={20}>
      <Button onClick={() => navigate(`/market/${kind}`)}>返回市场</Button>
      <Flexbox horizontal align="center" gap={18} wrap="wrap">
        <Avatar avatar={detail.icon} background="transparent" shape="square" size={68} />
        <Flexbox flex={1} gap={7}>
          <Flexbox horizontal align="center" gap={8} wrap="wrap"><Text as="h1" className={styles.title} fontSize={26} weight="bold">{detail.name}</Text>{detail.isValidated && <Tag color="success" icon={<Icon icon={CheckCircle2Icon} size={13} />}>已验证</Tag>}</Flexbox>
          <Text type="secondary">{detail.description}</Text>
          <Flexbox horizontal align="center" gap={8} wrap="wrap"><Text fontSize={12} type="secondary">{detail.ownerName}</Text><span>·</span><Tag>{detail.category}</Tag><Text fontSize={12} type="secondary">更新于 {new Date(detail.updatedAt).toLocaleDateString('zh-CN')}</Text></Flexbox>
        </Flexbox>
        <Flexbox horizontal>
          <Flexbox className={styles.stat}><Text weight="bold">{detail.metric.split(' ')[0]}</Text><Text fontSize={11} type="secondary">使用</Text></Flexbox>
          <Flexbox className={styles.stat}><Text weight="bold">{detail.versions.length}</Text><Text fontSize={11} type="secondary">FAB</Text></Flexbox>
        </Flexbox>
      </Flexbox>
    </Flexbox>

    <nav className={styles.nav}>{navItems.map((item) => <button className={`${styles.navButton} ${activeTab === item.key ? styles.navButtonActive : ''}`} key={item.key} onClick={() => setActiveTab(item.key)}><Icon icon={item.icon} size={16} /><span>{item.label}</span>{typeof item.count === 'number' && item.count > 0 && <Tag size="small">{item.count}</Tag>}</button>)}</nav>

    <div className={styles.body} style={{ paddingTop: 24 }}>
      <Flexbox style={{ minWidth: 0 }}>
        {kind === 'agent' && <AgentContent detail={detail} tab={activeTab} />}
        {kind === 'skill' && <SkillContent detail={detail} tab={activeTab} />}
        {kind === 'mcp' && <McpContent detail={detail} tab={activeTab} />}
      </Flexbox>
      <Sidebar detail={detail} kind={kind} navigate={navigate} />
    </div>
  </div></div>;
}
