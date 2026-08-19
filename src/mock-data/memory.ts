export type MemoryKind = 'context' | 'experience' | 'preference' | 'identity' | 'activity';

export interface MemoryItem {
  id: string;
  kind: MemoryKind;
  title: string;
  category: string;
  content: string;
  summary?: string;
  source?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  highlight?: string;
}

export interface MemoryPersona {
  name: string;
  role: string;
  summary: string;
  traits: string[];
  updatedAt: string;
}

export interface MemoryAnalysisResult {
  summary: string;
  tags: string[];
  suggestions: string[];
  range?: { from: string; to: string };
}

export const memoryMockData: MemoryItem[] = [
  {
    id: 'memory-fab',
    kind: 'preference',
    title: '默认使用 F15B',
    category: '偏好',
    content: '对话中选择 Agent 时优先展示 F15B',
    summary: 'Agent 选择偏好',
    tags: ['FAB', '选择'],
    createdAt: '2026-08-01T09:30:00+08:00',
    updatedAt: '2026-08-18T09:30:00+08:00',
    pinned: true,
  },
  {
    id: 'memory-language',
    kind: 'preference',
    title: '报告使用中文',
    category: '沟通',
    content: '输出报告和行动项时默认使用中文',
    tags: ['语言', '报告'],
    createdAt: '2026-08-02T09:20:00+08:00',
    updatedAt: '2026-08-18T09:20:00+08:00',
  },
  {
    id: 'memory-format',
    kind: 'preference',
    title: '偏好结构化结论',
    category: '格式',
    content: '先结论，再证据，最后行动项',
    tags: ['格式', '结论'],
    createdAt: '2026-08-03T09:10:00+08:00',
    updatedAt: '2026-08-18T09:10:00+08:00',
  },
  {
    id: 'memory-context-fab',
    kind: 'context',
    title: '当前 FAB 环境',
    category: '上下文',
    content: '本周默认测试环境为 F15B，联调环境为 F18B。',
    source: 'workspace',
    tags: ['FAB', '环境'],
    createdAt: '2026-08-17T10:00:00+08:00',
    updatedAt: '2026-08-18T10:30:00+08:00',
  },
  {
    id: 'memory-context-session',
    kind: 'context',
    title: '评审会话上下文',
    category: '上下文',
    content: '代码评审 Agent 使用 F18B，输出中文评审意见并附带文件行号。',
    source: 'chat:session-review',
    tags: ['评审', 'F18B'],
    createdAt: '2026-08-16T14:00:00+08:00',
    updatedAt: '2026-08-16T14:00:00+08:00',
  },
  {
    id: 'memory-exp-review',
    kind: 'experience',
    title: '评审报告结构经验',
    category: '经验',
    content: '按“结论 → 证据 → 行动项”结构评审，阻塞项必须带文件行号。',
    summary: '评审输出经验',
    tags: ['评审', '结构'],
    createdAt: '2026-08-15T11:00:00+08:00',
    updatedAt: '2026-08-15T11:00:00+08:00',
  },
  {
    id: 'memory-exp-market',
    kind: 'experience',
    title: '市场迁移经验',
    category: '经验',
    content: 'FAB 前置后，列表/详情必须携带 fab；切换 FAB 时用 AbortController 取消旧请求。',
    tags: ['市场', 'FAB'],
    createdAt: '2026-08-14T16:00:00+08:00',
    updatedAt: '2026-08-14T16:00:00+08:00',
  },
  {
    id: 'memory-identity',
    kind: 'identity',
    title: '平台 AI 助手身份',
    category: '身份',
    content: '我是 AgentDock 平台助手，负责串联飞行数据分析、代码评审与报告生成 Agent。',
    tags: ['身份'],
    createdAt: '2026-08-01T08:00:00+08:00',
    updatedAt: '2026-08-10T08:00:00+08:00',
  },
  {
    id: 'memory-activity-1',
    kind: 'activity',
    title: '完成了市场排序迁移',
    category: '活动',
    content: 'CodeReview_Agent 完成市场排序/升降序迁移并通过 CDP 验证。',
    source: 'TASK-1002',
    tags: ['市场', '完成'],
    createdAt: '2026-08-13T18:00:00+08:00',
    updatedAt: '2026-08-13T18:00:00+08:00',
  },
  {
    id: 'memory-activity-2',
    kind: 'activity',
    title: '飞行异常复核触发',
    category: '活动',
    content: 'FT-0819-07 振动峰值 +18%，触发人工复核。',
    source: 'TASK-1024',
    tags: ['飞行', '告警'],
    createdAt: '2026-08-19T16:05:00+08:00',
    updatedAt: '2026-08-19T16:05:00+08:00',
  },
];

export const memoryPersonaMock: MemoryPersona = {
  name: '平台 AI 助手',
  role: 'AgentDock 编排助手',
  summary:
    '负责串联飞行数据分析、代码评审与报告生成 Agent；偏好先结论后证据；报告默认中文；Agent 选择优先 F15B。',
  traits: ['结构化输出', '中文优先', '数据驱动'],
  updatedAt: '2026-08-18T09:30:00+08:00',
};
