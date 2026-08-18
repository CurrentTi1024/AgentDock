# AgentDock 前端与 Copilot Runtime 架构

> 状态：待评审  
> 文档版本：0.1  
> 日期：2026-08-17

## 1. 架构结论

AgentDock 采用“CopilotKit 做协议和运行时，LobeHub 做 UI/UX”的组合方式：

```text
LobeHub 风格页面与消息组件
              ↓
AgentDock Conversation Projection
              ↓
CopilotKit Headless API / useAgent
              ↓
Copilot Runtime（前端团队维护的服务端 BFF）
              ↓
Orchestration Service /ag-ui
              ↓
Orchestration Core + DeepAgents + CopilotKitMiddleware
```

- 不使用 `CopilotChat`、`CopilotSidebar` 替换 LobeHub 对话页面。
- 使用 CopilotKit Headless API、AG-UI Client、HITL hooks 和 A2UI Renderer。
- Copilot Runtime 不是浏览器依赖；它和前端代码位于同一仓库，并默认由同一个 AgentDock Node 服务、同一个进程和同一个镜像运行。
- Orchestration Service 是唯一面向 Agent Core 和 Redis Message Hub 的服务。

## 2. 建议技术栈

### 2.1 Browser App

- React + TypeScript + Vite。
- React Router。
- `@lobehub/ui`、Ant Design/antd-style、Lobe Icons。
- CopilotKit React Core v2 Headless API。
- `@ag-ui/client`、`@ag-ui/core`。
- `@copilotkit/a2ui-renderer`。
- Zustand：页面状态和精简 Conversation Projection Store。
- Dexie：IndexedDB 会话历史。
- Zod：API、事件扩展字段和本地数据校验。
- i18next：保留可国际化结构，需要支持原Lobehub全部语言。获取默认语言的逻辑复用Lobehub的：优先用户设置--》未设置就是浏览器语言

### 2.2 AgentDock App Server

- Node.js/Bun + TypeScript。
- 同时托管 Vite 构建产物和 Copilot Runtime 路由。
- Copilot Runtime v2。
- single-route 模式。
- 一个远端 Orchestration Agent Adapter，调用 FastAPI `/ag-ui`。
- 不配置模型，不直接运行 Agent。
- 负责 Catalog、A2UI Middleware、AG-UI run/connect/stop 和上游断线恢复适配。
- **不负责 SSO 与普通 API 转发**：SSO 登录态注入与 `/api/*` 到 Agent Registry 的路由由 OAuth2 Proxy 统一完成（见 `design/08` §7）；仓库不自建反向代理。

## 3. 建议仓库结构

```text
agentdock/
├── src/                         # Vite Browser App（bulletproof-react 范式）
│   ├── app/                     # 应用装配层：App.tsx / router.tsx / providers.tsx
│   ├── api/                     # 数据访问层：core/market/runtime/session/… Service
│   ├── components/              # 全局共享 UI：AppShell + shell 布局原语
│   ├── features/                # 业务域：chat / market / skill / workspace
│   ├── i18n/                    # 国际化：locales + dictionaries
│   ├── lib/                     # 可复用基础设施：httpClient / mock 工具
│   ├── mock-data/               # 与 api/ 一一对应的 Mock 数据
│   ├── stores/                  # zustand：runStore / uiStore
│   ├── types/                   # 全局共享领域类型
│   └── main.tsx                 # 薄入口
├── server/                      # 同一服务中的服务端代码
│   └── copilot-runtime/         # 托管 dist + /api/copilotkit 的 FAB 代理
├── docs/
├── package.json                 # 同一个项目和依赖锁文件
└── vite.config.ts
```

首期不建立复杂 Monorepo，也不拆成两个部署服务。`src/` 和 `server/` 只是浏览器代码与服务端代码的源码边界；构建后由同一个 AgentDock 服务运行。

生产拓扑：

```text
Browser
  ├─ GET/静态资源 → AgentDock Container（Vite dist，可选由 OAuth2 Proxy/CDN 前置）
  └─ POST /api/* → OAuth2 Proxy（SSO token 注入）
       ├─ /api/market/* → Agent Registry
       ├─ /api/copilotkit → Copilot Runtime（AgentDock Container / Node Process）
       │                     └─ FabRoutingAgent → {fab}/ag-ui（Orchestration FastAPI）
       └─ 其他 /api/* → Agent Registry
```

## 4. Copilot Runtime 配置原则

### 4.1 只使用 POST

Runtime 使用 single-route：

```tsx
<CopilotKit
  a2ui={{ catalog: agentDockCatalog }}
  runtimeUrl="/api/copilotkit"
  useSingleEndpoint
>
  <AgentDockApp />
</CopilotKit>
```

浏览器只访问：

```text
POST /api/copilotkit
```

### 4.2 只注册一个代理 Agent

市场中的 `agentId` 是业务 Agent ID，不建议为每一个市场 Agent 动态注册一个 Runtime Agent。

Runtime 只注册一个：

```text
runtimeAgentId = orchestration
```

实际选择的 `agentId`、`fab` 和 Agent Group 配置放在 `forwardedProps` 中。

### 4.3 A2UI 注入责任唯一

建议链路：

- Browser：注册 Catalog definitions + React renderers。
- Copilot Runtime：启用 A2UI Middleware，并负责 Catalog definitions 注入。
- Core：`CopilotKitMiddleware` 接收 `generate_a2ui` 能力并执行。
- Orchestration Service：透明转发请求和事件。

不能由 Runtime 和 Core 同时各自手工注册同名 `generate_a2ui` 工具。

## 5. LobeHub Conversation 复用策略

### 5.1 不重写 UI，建立最小投影层

```text
CopilotKit agent.messages / state / events
                    ↓
ConversationProjection
                    ↓
AgentDockConversationStore
                    ↓
迁移后的 LobeHub Messages/AssistantGroup/Tool UI
```

`ConversationProjection` 的责任：

- 把 CopilotKit 已归并的消息转成 LobeHub 风格 ViewModel。
- 把 step、activity、delegation 转为可折叠工作流 block。
- 把 tool call 转为工具卡片 block。
- 把 HITL 转为 Intervention block。
- 把 A2UI activity/surface 转为 `A2UISurfaceBlock`。
- 不负责底层 SSE 解析，不维护第二套 Agent message state machine。

### 5.2 最小兼容消息模型

```ts
type AgentDockMessageRole =
  | 'user'
  | 'assistant'
  | 'assistantGroup'
  | 'supervisor'
  | 'tool'
  | 'task';

interface AgentDockMessage {
  id: string;
  sessionId: string;
  threadId: string;
  runId?: string;
  role: AgentDockMessageRole;
  agentId?: string;
  content?: string;
  children?: AgentDockContentBlock[];
  createdAt: number;
  metadata?: {
    orchestrationMode?: string;
    orchestrationRole?: 'supervisor' | 'worker';
    parentAgentId?: string;
    status?: 'pending' | 'running' | 'interrupted' | 'completed' | 'error';
  };
}
```

```ts
type AgentDockContentBlock =
  | TextBlock
  | ReasoningBlock
  | AgentDelegationBlock
  | WorkflowStepBlock
  | ToolCallBlock
  | HitlBlock
  | TaskBlock
  | A2UISurfaceBlock
  | ArtifactBlock
  | ErrorBlock
  | AttachmentBlock;
```

### 5.3 优先复用的 LobeHub 代码

- `Conversation/ChatItem`：消息外壳、头像、标题、时间和操作区。
- `Conversation/Messages/index.tsx`：消息角色路由结构。
- `AssistantGroup`：主管/成员、children、tool、task completion。
- `ProcessFold`、`WorkflowCollapse`：执行过程折叠。
- `segments.ts`：消息与工具分段。
- `toolRenderRules.ts`、`toolDisplayNames.ts`：工具显示规则和友好名称。
- Tool Inspector：状态、参数、结果、执行时间。
- Intervention：审批、参数编辑、输入和选择 UI。
- Task/GroupTasks、Markdown、Artifact、自动滚动和虚拟列表。

### 5.4 必须替换的依赖

- `useConversationStore` 和 LobeHub 数据库 action。
- LobeHub Agent Store、AgentGroup Store、Tool Store。
- TRPC、server action 和原 service。
- LobeHub Cloud、模型供应商、计费、评论、分享、Electron。
- 原生 Tool Registry 改为 AgentDock Renderer Registry。

### 5.5 Renderer Registry

```ts
interface ToolRendererRegistration {
  toolName: string | RegExp;
  displayName: string;
  render: React.ComponentType<ToolRendererProps>;
}
```

- 未注册工具使用通用 Tool Card。
- 已注册工具可显示业务专用 UI。
- A2UI 使用独立 Catalog，不混入 Tool Renderer Registry。

## 6. 自动折叠规则

- 当前运行步骤：展开。
- 等待用户的 HITL：强制展开。
- 失败步骤：展开错误和可操作按钮。
- 已完成 reasoning：默认折叠。
- 已完成普通工具：折叠为一行摘要，可查看参数、结果和耗时。
- 连续工具调用：按同一 Agent/step 合并到 Workflow Group。
- 最终回答：始终展开。
- A2UI Surface：默认展开，不并入普通工具折叠。
- Supervisor 摘要常驻；成员执行过程结束后默认折叠。
- 用户折叠状态保存到 IndexedDB UI State。

## 7. IndexedDB 边界

建议表：

```text
sessions
messages
checkpoints
```

### 落库时机（单 Agent 与 Agent Group 一致）

- 流式事件期间不逐条写库：`reduceRunEvent` 先把事件投影到内存 `RuntimeRunState`，每次事件后调用 `scheduleRunCheckpoint`（350ms 防抖，只保留最新快照，避免高频事件打满 IndexedDB）。
- 运行终态（`success` / `error` / `cancelled`）显式 `flushRunCheckpoint` 落盘；异常路径直接 `saveRunCheckpoint`。
- 一次落盘写入三处：
  - `checkpoints`：`runId` + 完整快照 + `latestStreamId`（断线恢复游标）；
  - `messages`：`persistRunSnapshot` 把快照中全部可见消息（text / reasoning / tool / activity / surface / step）`bulkPut`；
  - `sessions.updatedAt` 刷新（驱动会话列表排序）。
- 页面刷新恢复：会话列表与当前会话消息从 `getMessages` 读取；mock/direct 从 `getLatestRun` 恢复快照（`runStore.restoreSession`），http+proxy 走 `connectAgent(action=resume, resume.lastStreamId)`。
- 失败策略：新建会话/群聊统一“先跳转、路由携带 `pendingSession`、后台异步落库”，写入失败仅 `console.warn` 不阻断对话；`createSession` 超过 3s 未完成输出阻塞诊断；监听 Dexie `blocked`/`versionchange`，被旧标签页阻塞时提示关闭旧页。
- 列表刷新：`createSession`/`updateSession`/`saveRunCheckpoint` 成功后广播 `agentdock:sessions-changed`，HomeSidebar/GroupSidebar/群聊首页监听后重新拉取会话列表，新会话无需手动刷新即可出现在“最近对话/最近群聊”。
- 测试：`src/api/session/sessionHistoryService.test.ts` 用 `fake-indexeddb` 覆盖“创建会话 / 终态 flush 落库 / 防抖自动落盘 / 刷新后恢复一致”；浏览器验收按 `docs/agentdock/03` 刷新后回看。

### sessions

```ts
interface LocalSession {
  id: string;
  threadId: string;
  title: string;
  agentSnapshot?: unknown;
  createdAt: number;
  updatedAt: number;
}
```

### messages

- 保存已经完成或可恢复展示的 AgentDock ViewModel。
- 保存最终可见文本、工具摘要、HITL 结果、Artifact 和可选 A2UI 最终 Surface 快照。
- 不保存 DeepAgents checkpoint、完整内部推理上下文或 Redis event log。

### sessionUiState

```ts
interface SessionUiState {
  sessionId: string;
  collapsedBlockIds: string[];
  latestRunId?: string;
  latestStreamId?: string;
  scrollAnchorMessageId?: string;
}
```

## 8. Service 模块原则

页面不能直接 `fetch`。

```text
src/api/market/{marketService,agentMarketService,skillMarketService,mcpMarketService}.ts
src/api/runtime/agentRuntimeService.ts
src/api/session/sessionHistoryService.ts
src/api/memory/memoryService.ts
```

每个 Service 导出 interface、HTTP 实现、Mock 实现和按环境选择的实例（`selectService`），共享契约类型在 `src/api/core/types.ts`，传输与 Mock 工具在 `src/lib/`。

页面只依赖 Service interface，后续替换真实接口时不修改页面组件。

Service 模式默认由 `VITE_SERVICE_MODE` 决定（构建期）；设置页「开发预览环境」可在运行时切换 Mock/HTTP，偏好写入 `localStorage`（`agentdock-service-mode`），`selectService` 与 `agentRuntimeService` 按当前模式动态分发，页面无需改动。

## 9. 错误边界

- 单个 Tool Renderer 或 A2UI Surface 错误不能使整个对话白屏。
- 每种消息 block 具备独立 Error Boundary。
- 非法/未知 AG-UI Custom 事件记录日志并忽略，不中断文本流。
- IndexedDB 写入失败不阻断当前对话，但必须提示“历史可能无法保存”。
- Memory 检索失败不阻断 Agent Run。

## 9.1 布局与群聊

- 应用外壳由 `providers.tsx` 的 ThemeProvider 撑满视口（`height: 100%` + `min/max-height: 100dvh`），`AppShell` 左右分栏：左侧 `NavPanelDraggable` 侧边栏，右侧 `DesktopLayoutContainer` 内容容器。
- 侧边栏按路由切换：`/group*` 显示群组侧边栏（最近群聊 + 新建群聊），其余路由显示 HomeSidebar（功能导航 + 最近会话）。
- 对话页参照 LobeHub：消息列最大宽度 840 居中，输入区绝对定位于底部通栏，内部同样 840 居中；历史会话（agent 与 group 两类）统一在侧边栏「最近会话/最近群聊」按类型展示。
- `/group` 为群聊首页（创建 + 最近群聊），`/group/:id` 为群聊会话页（主会话区 + 右侧配置面板：成员/编排模式/启动停止）。

## 10. 本文待确认项

- [ 用Nodejs] Runtime 使用 Node.js 还是 Bun；建议先选团队 CI 已支持的 Node.js。
- [不启用 ] 首期是否启用附件；如果启用，需要确认上传服务和大小限制。
- [ 消息分支可以考虑。评论不用了，但是可以建立每个消息点赞点踩的feedback机制，点踩要有原因填写表单 ] LobeHub 原消息分支、Reaction、评论确认不迁移。
