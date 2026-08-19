export interface DocumentItem {
  id: string;
  title: string;
  mediaType: string;
  size: number;
  owner: string;
  ownerId: string;
  category: 'report' | 'spec' | 'notes' | 'data' | 'minutes';
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  shared?: boolean;
  starred?: boolean;
  agentName?: string;
  pages?: number;
  content?: string;
}

export const documentMockData: DocumentItem[] = [
  {
    id: 'doc-flight-standard',
    title: '飞行测试数据规范',
    mediaType: 'application/pdf',
    size: 8_400_000,
    owner: 'Flight Platform',
    ownerId: 'flight-platform',
    category: 'spec',
    createdAt: '2026-08-10T09:00:00+08:00',
    updatedAt: '2026-08-18T09:00:00+08:00',
    pinned: true,
    shared: true,
    pages: 42,
    agentName: 'FlightAnalysis_Agent-F15B',
    content: `# 飞行测试数据规范

## 1. 采样要求

- 采样频率：**10 Hz** 起步，异常段提升到 **50 Hz**。
- 每架次至少记录：时间戳、经纬度、高度、空速、俯仰/滚转/偏航角、振动三轴。

## 2. 数据质量

| 检查项 | 阈值 | 动作 |
| --- | --- | --- |
| 缺失率 | < 2% | 补齐或剔除并标记 |
| 振动峰值 | ±0.8 g | 触发人工复核 |
| 温度尖峰 | +6°C / 10s | 触发告警 |

## 3. 交付物

每次评审交付：清洗后的 CSV、异常清单（Markdown）、可视化 PDF。
`,
  },
  {
    id: 'doc-agentdock-api',
    title: 'AgentDock API 契约',
    mediaType: 'text/markdown',
    size: 84_000,
    owner: 'Platform AI',
    ownerId: 'platform-ai',
    category: 'spec',
    createdAt: '2026-08-01T18:00:00+08:00',
    updatedAt: '2026-08-17T18:00:00+08:00',
    shared: true,
    starred: true,
    agentName: 'CodeReview_Agent-F18B',
    content: `# AgentDock API 契约

唯一权威接口文档位于 \`docs/agentdock/04-frontend-backend-api.md\`。

## 市场接口

- \`POST /api/market/getFabOptions\`：先取 FAB 再查分类/列表/详情。
- Agent 列表返回 \`agentFullName\`（\`{AgentName}-{fab}\`）与 \`fabPermission\`。

## 运行时

- \`/api/copilotkit\` single-route envelope：\`agent/run / connect / stop / info\`。
- AG-UI SSE 按 \`fab\` 转发到 Orchestration \`/ag-ui\`。
`,
  },
  {
    id: 'doc-review',
    title: '本周评审记录',
    mediaType: 'application/document',
    size: 218_000,
    owner: 'Flight AI Team',
    ownerId: 'flight-ai-team',
    category: 'minutes',
    createdAt: '2026-08-12T16:00:00+08:00',
    updatedAt: '2026-08-17T16:00:00+08:00',
    agentName: 'CodeReview_Agent-F18B',
    content: `# 本周评审记录（2026-08-17）

## 结论

1. 市场排序/升降序已合入并 CDP 验证。
2. 详情页 Reviews / Security 仍为静态样例，等待真实数据源。
3. R4 各页面迁移进入验收。

## 行动项

- [x] FAB 前置接口冻结
- [ ] 构建体积拆包（CopilotKit chunk）
- [ ] 真实后端联调（VITE_SERVICE_MODE=http）
`,
  },
  {
    id: 'doc-flight-20260819',
    title: '2026-08-19 飞行数据摘要',
    mediaType: 'text/markdown',
    size: 12_000,
    owner: 'FlightAnalysis_Agent-F15B',
    ownerId: 'flight-analysis',
    category: 'report',
    createdAt: '2026-08-19T16:00:00+08:00',
    updatedAt: '2026-08-19T16:00:00+08:00',
    shared: true,
    agentName: 'FlightAnalysis_Agent-F15B',
    content: `# 2026-08-19 飞行数据摘要

共 **12 架次**，其中 **1 架次** 触发振动峰值复核（+18%）。

| 架次 | 结果 | 备注 |
| --- | --- | --- |
| FT-0819-01 | 通过 | 平稳 |
| FT-0819-07 | 复核 | 振动峰值 +18%，温度尖峰 +6.2°C |
`,
  },
  {
    id: 'doc-meeting-notes',
    title: 'AgentDock 迭代会议纪要',
    mediaType: 'application/document',
    size: 32_000,
    owner: 'Platform AI',
    ownerId: 'platform-ai',
    category: 'minutes',
    createdAt: '2026-08-14T10:00:00+08:00',
    updatedAt: '2026-08-14T10:00:00+08:00',
    agentName: 'ReportWriter_Agent-F15B',
    content: `# AgentDock 迭代会议纪要

## 议题

1. 本月模式开关的菜单范围。
2. R4 页面迁移优先级：Tasks → Memory → Documents → Channel。
3. 联调依赖：HITL wire 冻结、A2UI fixture。
`,
  },
  {
    id: 'doc-test-log',
    title: '机务测试日志（CSV）',
    mediaType: 'text/csv',
    size: 1_260_000,
    owner: 'Flight Platform',
    ownerId: 'flight-platform',
    category: 'data',
    createdAt: '2026-08-13T08:00:00+08:00',
    updatedAt: '2026-08-15T08:00:00+08:00',
    agentName: 'FlightAnalysis_Agent-F15B',
    content: `timestamp,flight,axis,value_g\n2026-08-13T08:00:00Z,FT-0813-01,x,0.12\n2026-08-13T08:00:00Z,FT-0813-01,y,0.09\n2026-08-13T08:00:00Z,FT-0813-01,z,0.21\n2026-08-13T08:01:00Z,FT-0813-01,x,0.94\n`,
  },
];
