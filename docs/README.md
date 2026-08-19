# AgentDock 文档索引

仓库级文档：

| 文档 | 内容 |
|---|---|
| [../README.md](../README.md) | 项目介绍、启动方式、配置、路由 |
| [../AGENTS.md](../AGENTS.md) | AI Coding Agent 开发规范 |
| [../DESIGN.md](../DESIGN.md) / [../DESIGN.dark.md](../DESIGN.dark.md) | LobeHub 设计价值参考（Natural / Meaningful / Certainty / Growth） |
| [../task.md](../task.md) | 当前进度与验证记录 |

## AgentDock 决策与架构文档

| 文档 | 内容 | 权威性 |
|---|---|---|
| [00-project-baseline.md](agentdock/00-project-baseline.md) | 产品范围、角色权限、P0 范围、已冻结标识语义与市场规则 | 产品范围唯一基线 |
| [01-frontend-and-runtime-architecture.md](agentdock/01-frontend-and-runtime-architecture.md) | 技术栈、仓库结构、App Server / Runtime 拓扑、Service 边界 | 架构总览 |
| [02-agui-a2ui-runtime-contract.md](agentdock/02-agui-a2ui-runtime-contract.md) | Browser ↔ Runtime ↔ Orchestration 的 AG-UI/A2UI 实时契约 | 实时通信唯一权威 |
| [03-integration-and-acceptance.md](agentdock/03-integration-and-acceptance.md) | 首次联调目标、参与方责任、验收清单、问题记录模板 | 联调验收清单 |
| [04-frontend-backend-api.md](agentdock/04-frontend-backend-api.md) | 全部普通业务接口（请求/响应/入参 fab/Mock 目录） | 接口契约唯一权威 |
| [05-lobehub-source-migration.md](agentdock/05-lobehub-source-migration.md) | LobeHub 页面 ↔ AgentDock 页面源码映射、明确移除项 | 迁移对照表 |
| [06-frontend-migration-todo.md](agentdock/06-frontend-migration-todo.md) | 目录结构规范、M0-M7 模块清单、执行状态与剩余跟进项 | 迁移 TODO |

## AgentDock 详细设计与实现（Review 输出）

| 文档 | 内容 |
|---|---|
| [design/00-design-index.md](agentdock/design/00-design-index.md) | 设计目录索引、Review 摘要、优先级定义 |
| [design/01-end-to-end-runtime-link.md](agentdock/design/01-end-to-end-runtime-link.md) | AgentDock↔Registry↔Runtime↔Orchestration 端到端链路、ID 语义、FAB 路由、CD 配置 |
| [design/02-ag-ui-protocol-implementation.md](agentdock/design/02-ag-ui-protocol-implementation.md) | AG-UI 协议实现、SSE、reducer 事件矩阵、与官方差距 |
| [design/03-a2ui-pipeline.md](agentdock/design/03-a2ui-pipeline.md) | A2UI 端到端管线：catalog/renderer/DeepAgents middleware/action |
| [design/04-agent-registry-integration.md](agentdock/design/04-agent-registry-integration.md) | Agent Registry 集成、FAB 前置、Mock→HTTP、竞态与 locale 问题 |
| [design/05-lobehub-rendering-matrix.md](agentdock/design/05-lobehub-rendering-matrix.md) | LobeHub 信息粒度组件 ↔ AgentDock 当前实现缺口矩阵 |
| [design/06-copilotkit-integration-plan.md](agentdock/design/06-copilotkit-integration-plan.md) | CopilotKit 官方依赖接入方案、headless 迁移路径、transport 匹配 |
| [design/07-end-to-end-debugging-guide.md](agentdock/design/07-end-to-end-debugging-guide.md) | 公司内联调指南：Registry + Orchestration + AG-UI/A2UI 事件消费回显 |
| [design/08-final-architecture-decision.md](agentdock/design/08-final-architecture-decision.md) | 最终架构决策：官方 CopilotKit + Copilot Runtime、OAuth2 Proxy 分工、状态冲突解法 |
| [design/09-agui-lobehub-rendering-adapter.md](agentdock/design/09-agui-lobehub-rendering-adapter.md) | AG-UI/A2UI → LobeHub 渲染适配层：投影层方案（不做事件 Adapter） |
| [design/10-end-to-end-code-review.md](agentdock/design/10-end-to-end-code-review.md) | 端到端逐行 Code Review：AG-UI/A2UI/流式回显/信息粒度渲染与待办清单 |
| [design/11-e2e-joint-test-report.md](agentdock/design/11-e2e-joint-test-report.md) | 前后端联合端到端测试报告：完整请求链路、关键代码链路、组件渲染矩阵与已知限制 |
| [design/12-message-history-rendering-fixes.md](agentdock/design/12-message-history-rendering-fixes.md) | 消息历史与渲染修复：落库竞态、lc_run-- 去重、chat=mock 根因、构建修复、thinking 自动折叠 |

## 阅读顺序

1. `README.md`（启动与上手）
2. `00-project-baseline.md`（做什么、不做什么）
3. `01-frontend-and-runtime-architecture.md`（怎么组织）
4. `02-agui-a2ui-runtime-contract.md` + `04-frontend-backend-api.md`（两端契约）
5. `05-lobehub-source-migration.md` + `06-frontend-migration-todo.md`（迁移现状）
6. `03-integration-and-acceptance.md`（联调前对照）
7. `agentdock/design/*`（实现细节、Review 结论与调试指南；联调前必读 01/02/03/07/08/09/10）

## 文档变更规则

- 接口变更：只改 `04-frontend-backend-api.md`，并同步 `00`（范围）、`06`（TODO）、Mock 与 Service。
- 架构变更：改 `01`，涉及实时协议时同步 `02`。
- 目录/命令变更：同步 `README.md`、`AGENTS.md`、`06` 的目录结构章节。
