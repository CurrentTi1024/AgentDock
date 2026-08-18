# AgentDock 详细设计与实现文档索引

> 状态：评审完成，待按 P0/P1/P2 排期实现  
> 日期：2026-08-18  
> 基线：`/private/tmp/lobehub-canary`（LobeHub canary 源码）

## 1. 本目录的目的

本目录是 AgentDock 的**详细设计 + 实现方案 + Review 结论**合集，回答三个问题：

1. 需求是什么（功能需求、约束、优先级）。
2. 现状是什么（代码已实现到哪一步、与需求的差距）。
3. 怎么改（实现方案、接口契约、调试方法、验收方式）。

权威基线文档（决策与契约）仍以 `docs/agentdock/00 ~ 06` 为准；本目录在基线之上展开实现细节，不重复定义契约，只引用并落地。

## 2. 文档清单与阅读顺序

| 文档 | 主题 | 读者 |
|---|---|---|
| [00-design-index.md](00-design-index.md) | 本索引 | 所有人 |
| [01-end-to-end-runtime-link.md](01-end-to-end-runtime-link.md) | AgentDock ↔ Agent Registry ↔ Copilot Runtime ↔ Orchestration 端到端链路：ID 语义、FAB 路由、run/stop/resume/HITL、CD 部署 | 前端/运行时/后端联调 |
| [02-ag-ui-protocol-implementation.md](02-ag-ui-protocol-implementation.md) | AG-UI 协议实现：RunAgentInput、SSE、reducer 事件矩阵、现状 vs 官方 | 前端/运行时 |
| [03-a2ui-pipeline.md](03-a2ui-pipeline.md) | A2UI 端到端管线：Catalog、renderer、DeepAgents Middleware、Action 回传 | 前端 + 后端 Core |
| [04-agent-registry-integration.md](04-agent-registry-integration.md) | Agent Registry 集成：FAB 前置、getFabOptions、市场 Service、Mock→HTTP 切换 | 前端/后端 Registry |
| [05-lobehub-rendering-matrix.md](05-lobehub-rendering-matrix.md) | LobeHub 各信息粒度组件 ↔ AgentDock 当前组件 ↔ 缺口矩阵（fully copy LobeHub） | 前端 |
| [06-copilotkit-integration-plan.md](06-copilotkit-integration-plan.md) | CopilotKit 官方依赖接入方案：headless hooks、transport 匹配、迁移路径、风险 | 前端架构 |
| [07-end-to-end-debugging-guide.md](07-end-to-end-debugging-guide.md) | 公司内无缝调试 Agent Registry + Orchestration、AG-UI/A2UI 对话与事件消费回显 | 前后端联调工程师 |
| [08-final-architecture-decision.md](08-final-architecture-decision.md) | 最终架构决策：官方 CopilotKit + Copilot Runtime、状态冲突解法、A2UI 渲染、FAB/SSO 分工 | 前端架构 + 联调 |
| [09-agui-lobehub-rendering-adapter.md](09-agui-lobehub-rendering-adapter.md) | AG-UI/A2UI → LobeHub 渲染适配层：投影层方案、ViewModel 定义、组件 props 化迁移 | 前端 |
| [10-end-to-end-code-review.md](10-end-to-end-code-review.md) | 端到端逐行 Code Review：AG-UI/A2UI/流式回显/信息粒度渲染，review 模块、发现与修复、待办清单 | 前端 + 联调 |

## 3. 与权威文档的关系

```text
docs/agentdock/
├── 00-project-baseline.md         产品范围与决策（FAB 前置、ID 语义、接口约定）
├── 01-frontend-and-runtime-architecture.md   技术栈与架构总览
├── 02-agui-a2ui-runtime-contract.md          实时契约（唯一权威）
├── 03-integration-and-acceptance.md          联调验收清单
├── 04-frontend-backend-api.md                普通业务 API（唯一权威）
├── 05-lobehub-source-migration.md            迁移对照表
├── 06-frontend-migration-todo.md             迁移 TODO
└── design/                                   本目录：实现细节与 Review
```

变更规则：

- 接口字段变更只改 `04`，同时同步 `00`、`06` 与相关 Service/Mock。
- 实时协议变更只改 `02`，同时同步 `design/01`、`design/02`、`design/03`。
- 渲染组件变更同步 `design/05`。
- 新增调试方法同步 `design/07`。

## 4. Review 结论摘要（2026-08-18）

### 4.1 已满足的核心需求

- 前端目录已按 bulletproof-react 范式重组（`app/api/components/features/lib/types`），路由薄壳 + feature 业务域 + service 数据访问边界成立。
- Agent/Skill/MCP 市场 FAB 前置：`getFabOptions` → 分类/列表/详情带 `fab`，详情 Version 不分区。
- 对话请求携带 `agentId / fab / sessionId / threadId / runId`；`runId` 由客户端生成（AG-UI 标准：Client 提供 runId）。
- Runtime 按 FAB 路由已实现核心（`server/copilot-runtime/fabProxy.ts`），支持 `AGENT_ORCHESTRATION_BASE_URLS_JSON`。
- AG-UI SSE 解析、事件去重、IndexedDB 检查点、stop/resume/HITL/A2UI Action 骨架已实现。
- i18n 已从 3 种扩展到 LobeHub 全部 18 种语言，全部提供本地化词典并有测试守护。

### 4.2 必须补的关键缺口（P0）

1. ~~Copilot Runtime 尚未挂载~~：已实现 `server/index.ts`（官方 single-route handler + FabRoutingAgent + 可选静态托管）；普通 `/api/*` 由 OAuth2 Proxy 直接路由到 Agent Registry。
2. ~~未接入官方 CopilotKit~~：已接入 `@copilotkit/react-core/v2`（Provider + `useAgent` + `useCopilotKit`），Runtime `/info` 已验证返回 agents + a2uiEnabled。
3. ~~A2UI 是伪实现~~：已实现 `a2ui/catalog.tsx` + Provider `a2ui` + 官方 renderer（`useRenderActivityMessage`）；action 拦截待联调。
4. ~~HITL requestId 未传递~~：已从 activity 读取并回传；http 路径走官方 `pendingInterrupts + resume[]`，legacy wire 保留后备。
5. ~~Markdown 未渲染~~：已实现 `Markdown.tsx`（react-markdown + remark-gfm）。
6. ~~STEP_STARTED / STEP_FINISHED 未消费~~：已实现 `RuntimeRunState.steps` + `WorkflowStepsBlock`。

### 4.3 其他重要缺口（P1/P2）

- 市场列表/详情请求无 AbortController、无 loading/error 状态、FAB 切换存在旧数据覆盖新数据竞态。
- 多处 `locale` 硬编码 `zh-CN` / `en-US`（MarketPage、DetailPage、CreateSkillPage、MarketItem、PublishedTime、WorkspacePage 日期）。
- Skill 创建发布后跳转死链（硬编码 `/market/skill/document-summary`，Mock 无该详情）。
- 复制按钮无 onClick；未知 Custom 事件只入 rawEvents 无 UI；Activity 只渲染 HITL/Surface，Delegation/Task 不渲染。

完整缺口清单见各 design 文档末尾的“缺口与行动项”。

## 5. 优先级定义

- **P0**：阻塞真实联调或与 LobeHub 视觉明显不一致，本月交付必须完成。
- **P1**：不阻塞首条文本链路，但影响体验/正确性，应在真实联调前完成。
- **P2**：后续模块或体验优化，可以延后。
