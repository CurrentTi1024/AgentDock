export type TaskStatus =
  | 'backlog'
  | 'canceled'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'running'
  | 'scheduled';

export type TaskVisibility = 'private' | 'public';

export type TaskAutomationMode = 'manual' | 'scheduled' | 'heartbeat';

export interface ScheduledTask {
  identifier: string;
  instruction: string;
  name?: string;
  description?: string;
  status: TaskStatus;
  /** 0 none, 1 urgent, 2 high, 3 normal, 4 low */
  priority: number;
  visibility: TaskVisibility;
  assigneeAgentId?: string;
  assigneeAgentName?: string;
  createdByAgentId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  automationMode?: TaskAutomationMode | null;
  schedulePattern?: string | null;
  scheduleTimezone?: string | null;
  parentTaskId?: string | null;
  totalSubtasks?: number;
  completedSubtaskCount?: number;
  subtasks?: ScheduledTask[];
}

export interface TaskGroupItem {
  key: string;
  statuses: TaskStatus[];
  total: number;
  tasks: ScheduledTask[];
}

export const scheduledTaskMockData: ScheduledTask[] = [
  {
    identifier: 'TASK-1024',
    name: '检查昨日飞行异常',
    instruction: '拉取昨日全部飞行测试记录，标记振动峰值超过阈值的样本并输出异常清单。',
    status: 'running',
    priority: 2,
    visibility: 'public',
    assigneeAgentId: 'flight-analysis',
    assigneeAgentName: 'FlightAnalysis_Agent-F15B',
    createdByAgentId: 'platform',
    createdAt: '2026-08-19T14:20:00+08:00',
    updatedAt: '2026-08-20T09:12:00+08:00',
    automationMode: 'heartbeat',
    scheduleTimezone: 'Asia/Shanghai',
    totalSubtasks: 3,
    completedSubtaskCount: 1,
  },
  {
    identifier: 'TASK-1021',
    name: '生成本周工作报告',
    instruction: '汇总本周各 Agent 的完成项、阻塞项与下周计划，生成中文周报。',
    status: 'scheduled',
    priority: 3,
    visibility: 'public',
    assigneeAgentId: 'report-writer',
    assigneeAgentName: 'ReportWriter_Agent-F15B',
    createdByAgentId: 'platform',
    createdAt: '2026-08-18T10:00:00+08:00',
    updatedAt: '2026-08-19T17:00:00+08:00',
    automationMode: 'scheduled',
    schedulePattern: '0 17 * * 5',
    scheduleTimezone: 'Asia/Shanghai',
  },
  {
    identifier: 'TASK-1018',
    name: '同步代码审查结果',
    instruction: '将 CodeReview_Agent 的审查意见同步到任务列表并标记阻塞项。',
    status: 'completed',
    priority: 1,
    visibility: 'public',
    assigneeAgentId: 'code-review',
    assigneeAgentName: 'CodeReview_Agent-F18B',
    createdByAgentId: 'platform',
    createdAt: '2026-08-17T09:00:00+08:00',
    updatedAt: '2026-08-19T09:12:00+08:00',
    completedAt: '2026-08-19T09:12:00+08:00',
    automationMode: 'manual',
    totalSubtasks: 2,
    completedSubtaskCount: 2,
  },
  {
    identifier: 'TASK-1015',
    name: '评审 A2UI 渲染适配层',
    instruction: '对照 LobeHub 渲染矩阵评审 A2UI catalog 的卡片与按钮实现。',
    status: 'paused',
    priority: 4,
    visibility: 'private',
    assigneeAgentId: 'code-review',
    assigneeAgentName: 'CodeReview_Agent-F18B',
    createdByAgentId: 'user',
    createdAt: '2026-08-16T15:30:00+08:00',
    updatedAt: '2026-08-18T11:00:00+08:00',
    automationMode: 'manual',
  },
  {
    identifier: 'TASK-1009',
    name: '整理群聊编排模式说明',
    instruction: '整理 supervisor / parallel / debate 三种群聊编排模式的适用场景与配置。',
    status: 'backlog',
    priority: 3,
    visibility: 'public',
    assigneeAgentId: 'report-writer',
    assigneeAgentName: 'ReportWriter_Agent-F15B',
    createdByAgentId: 'user',
    createdAt: '2026-08-15T10:00:00+08:00',
    updatedAt: '2026-08-15T10:00:00+08:00',
    automationMode: 'manual',
    totalSubtasks: 2,
    completedSubtaskCount: 0,
  },
  {
    identifier: 'TASK-1002',
    name: '迁移市场排序逻辑',
    instruction: '把 LobeHub 市场排序/升降序逻辑迁移到 AgentDock，并保持 FAB 选择器不变。',
    status: 'completed',
    priority: 2,
    visibility: 'public',
    assigneeAgentId: 'code-review',
    assigneeAgentName: 'CodeReview_Agent-F18B',
    createdByAgentId: 'platform',
    createdAt: '2026-08-12T09:30:00+08:00',
    updatedAt: '2026-08-13T18:00:00+08:00',
    completedAt: '2026-08-13T18:00:00+08:00',
    automationMode: 'manual',
  },
  {
    identifier: 'TASK-0998',
    name: '过期渠道清理',
    instruction: '清理 30 天未连接的渠道凭证，保留审计日志。',
    status: 'canceled',
    priority: 0,
    visibility: 'private',
    assigneeAgentId: 'flight-analysis',
    assigneeAgentName: 'FlightAnalysis_Agent-F15B',
    createdByAgentId: 'user',
    createdAt: '2026-08-10T14:00:00+08:00',
    updatedAt: '2026-08-11T10:00:00+08:00',
    completedAt: '2026-08-11T10:00:00+08:00',
    automationMode: 'manual',
  },
];
