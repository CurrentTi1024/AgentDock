export interface PageItem {
  id: string;
  title: string;
  content: string;
  status: 'draft' | 'published';
  agentId?: string;
  agentName?: string;
  createdAt: string;
  updatedAt: string;
}

export const pageMockData: PageItem[] = [
  {
    id: 'page-home',
    title: 'AgentDock 使用指南',
    content: `# AgentDock 使用指南

## 对话

从首页选择 Agent 后发送消息，支持流式输出、推理摘要、工具调用、HITL 审批与 A2UI 表面。

## 任务

在任务页创建、指派并跟踪 Agent 任务，支持列表/看板两种视图。

## 记忆

记忆页管理自动注入的上下文、经验与偏好。`,
    status: 'published',
    createdAt: '2026-08-05T09:00:00+08:00',
    updatedAt: '2026-08-18T14:00:00+08:00',
    agentName: 'ReportWriter_Agent-F15B',
  },
  {
    id: 'page-doc-contract',
    title: '接口契约速览',
    content: `# 接口契约速览

- FAB 前置：先 \`getFabOptions\` 再查分类/列表/详情。
- Agent 列表返回 \`agentFullName\` 与 \`fabPermission\`。
- 运行时：\`/api/copilotkit\` single-route envelope + AG-UI SSE。`,
    status: 'draft',
    createdAt: '2026-08-12T10:00:00+08:00',
    updatedAt: '2026-08-16T10:00:00+08:00',
    agentName: 'CodeReview_Agent-F18B',
  },
];
