import type {
  AgentDetail,
  AgentMarketItem,
  MarketItem,
  McpFabDetail,
  ReferencingAgent,
  SkillFabDetail,
  SkillMcpMarketItem,
  SkillMcpDetail,
} from '@/types';

const version = (fab: string, value: string, callPermission = true) => ({
  callPermission,
  fab,
  version: value,
});

const agentItem = (
  id: string,
  name: string,
  fab: string,
  versionValue: string,
  callPermission: boolean,
  extra: Omit<AgentMarketItem, 'agentFullName' | 'fabPermission' | 'id' | 'version'>,
): AgentMarketItem => ({
  id,
  agentFullName: `${name}-${fab}`,
  fabPermission: { callPermission, fab },
  version: versionValue,
  ...extra,
});

export const marketItemsMockData: {
  agent: AgentMarketItem[];
  mcp: SkillMcpMarketItem[];
  skill: SkillMcpMarketItem[];
} = {
  agent: [
    agentItem('flight-analysis', 'FlightAnalysis_Agent', 'F15B', '2.1.0', true, {
      icon: '🛩️',
      description: '分析飞行试验数据，提取异常指标、趋势和关键结论。',
      ownerId: 'flight-ai',
      ownerName: 'Flight AI Team',
      ownerType: 'Organization',
      category: '数据分析',
      isFeatured: true,
      isValidated: true,
      metric: '864 次使用',
      installCount: 864,
      skillCount: 3,
      mcpCount: 2,
      createTimeAt: '2026-07-04T09:00:00+08:00',
      updatedAt: '2026-08-18T09:30:00+08:00',
    }),
    agentItem('flight-analysis', 'FlightAnalysis_Agent', 'F18B', '2.0.2', true, {
      icon: '🛩️',
      description: '分析飞行试验数据，提取异常指标、趋势和关键结论。',
      ownerId: 'flight-ai',
      ownerName: 'Flight AI Team',
      ownerType: 'Organization',
      category: '数据分析',
      isValidated: true,
      metric: '864 次使用',
      installCount: 864,
      skillCount: 2,
      mcpCount: 1,
      createTimeAt: '2026-07-04T09:00:00+08:00',
      updatedAt: '2026-08-18T09:30:00+08:00',
    }),
    agentItem('code-review', 'CodeReview_Agent', 'F15B', '1.3.0', true, {
      icon: '🧑‍💻',
      description: '审查代码、定位风险，并输出可执行的改进建议。',
      ownerId: 'lami',
      ownerName: 'lami',
      ownerType: 'NT',
      category: '编程',
      isValidated: true,
      metric: '1.2k 次使用',
      installCount: 1200,
      skillCount: 4,
      mcpCount: 3,
      createTimeAt: '2026-06-10T09:00:00+08:00',
      updatedAt: '2026-08-17T12:30:00+08:00',
    }),
    agentItem('code-review', 'CodeReview_Agent', 'F18B', '1.2.0', false, {
      icon: '🧑‍💻',
      description: '审查代码、定位风险，并输出可执行的改进建议。',
      ownerId: 'lami',
      ownerName: 'lami',
      ownerType: 'NT',
      category: '编程',
      isValidated: true,
      metric: '1.2k 次使用',
      installCount: 1200,
      skillCount: 3,
      mcpCount: 2,
      createTimeAt: '2026-06-10T09:00:00+08:00',
      updatedAt: '2026-08-17T12:30:00+08:00',
    }),
    agentItem('report-writer', 'ReportWriter_Agent', 'F15B', '2.1.0', true, {
      icon: '📝',
      description: '读取资料并生成结构清晰、可追溯的专业报告。',
      ownerId: 'knowledge',
      ownerName: 'Knowledge Team',
      ownerType: 'Organization',
      category: '办公',
      isValidated: true,
      metric: '642 次使用',
      installCount: 642,
      skillCount: 1,
      mcpCount: 1,
      createTimeAt: '2026-05-21T09:00:00+08:00',
      updatedAt: '2026-08-16T08:00:00+08:00',
    }),
  ],
  skill: [
    { id: 'document-summary', name: '文档摘要', icon: '📄', description: '提取文档重点并生成结构化摘要。', ownerId: 'knowledge', ownerName: 'Knowledge Team', ownerType: 'Organization', category: '文档', isValidated: true, metric: '326 次安装', installCount: 326, stars: 186, ratingCount: 36, createTimeAt: '2026-07-01T09:00:00+08:00', updatedAt: '2026-08-14T16:00:00+08:00', versions: [version('F15B', '1.0.0')] },
    { id: 'secure-review', name: '安全代码审查', icon: '🛡️', description: '识别代码缺陷、依赖风险和常见安全问题。', ownerId: 'security', ownerName: 'Security Team', ownerType: 'Organization', category: '开发', isValidated: true, metric: '291 次安装', installCount: 291, stars: 98, ratingCount: 12, createTimeAt: '2026-06-08T09:00:00+08:00', updatedAt: '2026-08-12T11:00:00+08:00', versions: [version('F15B', '1.1.0'), version('F18B', '1.0.4')] },
  ],
  mcp: [
    { id: 'company-git', name: 'Company Git MCP', icon: '🔧', description: '读取公司 Git 仓库、提交和 Pull Request。', ownerId: 'dev-platform', ownerName: 'Developer Platform', ownerType: 'Organization', category: '开发工具', isValidated: true, isFeatured: true, metric: '850 次安装', installCount: 850, ratingCount: 42, createTimeAt: '2026-05-10T09:00:00+08:00', updatedAt: '2026-08-16T11:00:00+08:00', versions: [version('F15B', '2.0.0'), version('F18B', '1.8.0', false)] },
    { id: 'flight-data', name: 'Flight Data MCP', icon: '📡', description: '按权限读取飞行试验遥测和指标数据。', ownerId: 'flight-platform', ownerName: 'Flight Platform', ownerType: 'Organization', category: '数据', isValidated: true, metric: '208 次安装', installCount: 208, ratingCount: 18, createTimeAt: '2026-06-11T09:00:00+08:00', updatedAt: '2026-08-11T10:00:00+08:00', versions: [version('F15B', '1.2.0')] },
  ],
};

export const marketFabOptionsMockData: Record<'agent' | 'skill' | 'mcp', string[]> = {
  agent: ['F15B', 'F18B'],
  mcp: ['F15B', 'F18B'],
  skill: ['F15B', 'F18B'],
};

const skillVersion = (item: SkillMcpMarketItem, fab: string, value: string, callPermission: boolean): SkillFabDetail => ({
  fab,
  version: value,
  callPermission,
  summary: `${item.name} ${fab} 版本`,
  content: `# ${item.name}\n\n## 适用场景\n用于 ${fab} 企业资料。\n\n## 工作流程\n1. 校验权限。\n2. 提取事实。\n3. 生成结果。`,
  changelog: ['完善 FAB 模板', '增加完整性检查'],
  permissions: ['document:read'],
  resources: [{ path: 'references/output-format.md', size: '2 KB' }],
});

const mcpVersion = (item: SkillMcpMarketItem, fab: string, value: string, callPermission: boolean): McpFabDetail => ({
  fab,
  version: value,
  callPermission,
  overview: `${item.name} 在 ${fab} 由平台托管。`,
  changelog: ['增加批量检索工具'],
  connectionType: 'HTTP',
  deploymentOptions: [{ label: '公司托管 HTTP', description: '平台自动注入身份与凭据。', recommended: true }],
  tools: [{ name: 'searchRepositories', description: '搜索有权访问的仓库。', schema: '{ keyword: string }' }],
  resources: [{ name: 'repository', description: '仓库元数据', uri: 'company-git://repositories/{id}' }],
  prompts: [],
});

export const buildSkillMcpDetailMockData = (kind: 'mcp' | 'skill', item: SkillMcpMarketItem): SkillMcpDetail => {
  const detail: SkillMcpDetail = {
    ...item,
    summary: `${item.description} 已通过 Agent Registry 校验。`,
    tags: [item.category, '企业内部', '已验证'],
    homepageUrl: `https://intranet.example/${kind}/${item.id}`,
    repositoryUrl: `https://git.company.example/ai/${kind}/${item.id}`,
    related: marketItemsMockData[kind].filter((candidate) => candidate.id !== item.id),
    referencingAgents: marketItemsMockData.agent
      .slice(0, 2)
      .map((agent) => toReferencingAgent(agent)),
  };
  if (kind === 'skill') detail.skillVersions = item.versions.map((v) => skillVersion(item, v.fab, v.version, v.callPermission));
  if (kind === 'mcp') detail.mcpVersions = item.versions.map((v) => mcpVersion(item, v.fab, v.version, v.callPermission));
  return detail;
};

export const buildAgentDetailMockData = (item: AgentMarketItem): AgentDetail => {
  const baseName = item.agentFullName.replace(/-(F\w+)$/, '');
  const fab = item.fabPermission.fab;
  return {
    ...item,
    summary: `${item.description} 已通过 Agent Registry 校验。`,
    homepageUrl: `https://intranet.example/agent/${item.id}`,
    overview: `${baseName} 面向 ${fab} 环境提供可追溯的专业能力。`,
    systemRoleMarkdown: `你是 ${baseName}，服务于 ${fab} 环境。准确理解目标，使用可验证数据与工具，不编造内部信息。`,
    capabilities: ['结构化分析', 'FAB 权限隔离', '工具调用追踪', '报告生成'],
    examples: [
      { title: '分析最新数据', userMessage: '请分析今天的数据并列出异常。' },
      { title: '生成带证据的结论', userMessage: '请给出关键结论并附上数据证据。' },
    ],
    skills: [{ skillId: 'skill-secure-review', name: '安全代码审查', icon: '🛡️', version: '1.1.0', fab }],
    mcpServers: [{ mcpServerId: 'mcp-company-git', name: 'Company Git MCP', icon: '🔧', version: '2.0.0', fab }],
    versionInfo: {
      version: item.version,
      fab,
      callPermission: item.fabPermission.callPermission,
      createAt: item.createTimeAt,
      updateAt: item.updatedAt,
      changeLog: '- 完善 FAB 模板\n- 增加完整性检查',
    },
    relatedAgents: marketItemsMockData.agent
      .filter((other) => other.id !== item.id && other.fabPermission.fab === fab && other.fabPermission.callPermission)
      .map((other) => ({
        agentId: other.id,
        agentFullName: other.agentFullName,
        icon: other.icon,
        description: other.description,
        ownerId: other.ownerId,
        ownerName: other.ownerName,
        ownerType: other.ownerType,
        category: other.category,
        knowledgeCount: 2,
      })),
  };
};

const toReferencingAgent = (agent: AgentMarketItem): ReferencingAgent => ({
  agentId: agent.id,
  agentFullName: agent.agentFullName,
  agentVersion: agent.version,
  callPermission: agent.fabPermission.callPermission,
  category: agent.category,
  description: agent.description,
  fab: agent.fabPermission.fab,
  icon: agent.icon,
  knowledgeCount: 2,
  ownerId: agent.ownerId,
  ownerName: agent.ownerName,
  ownerType: agent.ownerType,
});
