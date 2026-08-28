# AgentDock ↔ Registry ↔ Runtime ↔ Orchestration 端到端链路设计

> 状态：设计定稿（待实现 P0 缺口）  
> 关联：`docs/agentdock/02-agui-a2ui-runtime-contract.md`（实时契约唯一权威）、`docs/agentdock/04-frontend-backend-api.md`（业务 API 唯一权威）、`design/08`（最终架构决策）、`design/09`（渲染投影层）

## 1. 目标

保证从“市场选择 Agent → 开始对话 → 发送消息 → 流式回显 → HITL/A2UI → 刷新恢复”全链路无缝联通，且只迁移前端，后端沿用公司 Orchestration Service + Core（DeepAgents + CopilotKitMiddleware）。

## 2. 生产拓扑

```text
┌───────────────────────── Browser（AgentDock SPA） ─────────────────────────┐
│ 普通 REST：POST /api/*              实时：POST /api/copilotkit（固定同源）   │
└───────────────┬──────────────────────────────┬────────────────────────────┘
                │ OAuth2 Proxy（SSO：加登录 token）│ OAuth2 Proxy（SSO：加登录 token）
                ▼                              ▼
        Agent Registry（AGENT_REGISTRY_BASE_URL）   Copilot Runtime（Node 服务）
        （按 path 前缀直接路由，不按 FAB 切地址）        └─ FAB 路由（AGENT_ORCHESTRATION_BASE_URLS_JSON）
                                                  ▼
                               {FAB base}/ag-ui（Orchestration Service）
                                                  │
                                                  ▼
                               Core：DeepAgents + CopilotKitMiddleware
                                                  │
                                                  ▼
                                        Redis Message Hub（eventId 有序事件）
```

原则：

- 浏览器只访问同源地址，避免 CORS、认证泄露和 FAB 地址进入前端产物。
- 普通 REST 与实时链路的认证都由 OAuth2 Proxy 统一注入，仓库不自建 `/api/*` 反向代理。
- 普通 REST 不按 FAB 切换 Base URL；只有实时 Agent 通信按 FAB 路由。
- Runtime 是唯一 FAB 路由决策点；`forwardedProps.fab` 是路由 key。
- 生产拓扑与详细分工见 `design/08-final-architecture-decision.md`。

## 3. ID 模型（回答 LobeHub 是否有 threadId）

### 3.1 LobeHub 原版模型

LobeHub 对话上下文为 `ConversationContext`：

```ts
type ConversationContext = {
  agentId: string;
  topicId: string | null;   // 会话内的“话题”/消息线程
  threadId: string | null;  // 可空，生成消息时透传给 agent runtime
};
```

结论：**LobeHub 有 `threadId`**，在 `src/features/Conversation/store/initialState.ts` 中为 `null`，并在 generation action 中以 `threadId: context.threadId ?? undefined` 透传给运行时；它的主标识是 `sessionId + topicId`，`threadId` 属于可选上下文。AgentDock 不需要照搬 LobeHub 的 `topicId` 概念，但要保证 `threadId` 与后端约定一致。

**持久化范围（P0 需求）**：IndexedDB 保存全部会话消息（单 Agent 与 Agent Group 的可见消息，含 reasoning/tool/activity/HITL/A2UI surface/step），每次打开从 IndexedDB 恢复；清空浏览器存储后为空。`sessionHistoryService` 是唯一读写入口，不模拟成后端接口。

### 3.2 AgentDock ID 语义（冻结）

| ID | 产生方 | 生成方式（当前实现） | 语义 | 管理位置 |
|---|---|---|---|---|
| `sessionId` | AgentDock | 路由 `/chat/:id`；会话主键 = 路由 id（默认入口固定 `session-inbox`，真实会话 `crypto.randomUUID()`），`createSession({ id: sessionId })` 保证会话行、消息、checkpoint 同键 | 用户可见的一段本地会话；IndexedDB sessions 主键 | Dexie `sessions.id`；ChatPage `session` state（路由切换时仅同 id 复用内存 state） |
| `threadId` | AgentDock | 创建会话时 `crypto.randomUUID()` 固化进 `SessionRecord.threadId`；hook 兜底 `thread-${sessionId}` | DeepAgents 上下文线程；同一会话内所有 run 共用 | Dexie `sessions.threadId`；后端保存上下文 |
| `runId` | AG-UI Client | 每次发送 `crypto.randomUUID()`（mock 在 `createRunInput`，官方在 `send()`） | 一次用户提问/Agent 执行；Orchestration 必须沿用，不得新建 | Dexie `checkpoints.runId`（主键）+ `snapshot.runId`；后端执行记录 |
| `parentRunId` | AG-UI Client | A2UI Action 新 run 时指向产生 Surface 的 runId（mock 已设；官方 transport 暂不传，见 4.4） | 子执行（A2UI Action 新 run）的父 run | 按需 |
| `eventId` | Orchestration/Redis | 后端 AG-UI 事件顶层字段，前端 `runReducer` 提取 | 一个 run 内事件游标；按 eventId 游标恢复（已实现） | 每个 `RuntimeRunState` 独立维护 `latestEventId + processedEventIds`；Dexie `checkpoints.latestEventId` |
| `messageId` | 事件产生方 | 后端事件自带 | 一段文本/reasoning/activity 消息 | IndexedDB 可见历史（`messages.id`） |
| `toolCallId` | Agent/Core | 后端事件自带 | 一次工具调用 | 可见消息块 |
| `surfaceId` | A2UI 工具 | 后端/中间件生成 | 一个 A2UI Surface | 可见消息块/快照 |

### 3.3 runId 由谁生成（用户疑问）

AG-UI 规范中 `RunAgentInput.runId` 由 **调用方（Client/Application）提供**；官方 CopilotKit 的 headless `runAgent()` 默认在客户端自动生成，Runtime 层在输入缺失时也可自动生成（TanStack AG-UI 兼容实现同样如此），但 **`RUN_STARTED / RUN_FINISHED` 必须原样回显该 runId**。

当前 AgentDock 实现：`createRunInput()` 在浏览器用 `crypto.randomUUID()` 生成 runId。这与规范一致。如果公司要求“runId 由 runtime 生成”，需要后端在请求无 runId 时生成并在响应事件中回传；**二选一，禁止两端各生成一个**。本文按官方标准冻结为：客户端生成，Orchestration 沿用。

### 3.4 threadId 生成规则（当前实现）

- 新会话：`ChatPage.ensureSession()` 在 `createSession` 时用 `crypto.randomUUID()` 生成并固化 `threadId`，避免可预测值。
- 已存在的会话：从 IndexedDB `SessionRecord.threadId` 读取；hook 内 `thread-${sessionId}` 仅作防御性兜底。
- 同一 threadId 内多次 run 共享 DeepAgents 上下文；切换 agent/fab 是否复用 threadId 需与后端确认（建议：同一本地会话复用，切换 agent 时新建）。

### 3.5 eventId 的维护与多会话独立性

**维护位置**：每个 run 的 `RuntimeRunState` 独立持有：

- `latestEventId`：最近一次 AG-UI 事件顶层 `eventId` 游标。
- `processedEventIds[]`：已处理游标集合，用于幂等去重（上限 5000，超出后滚动淘汰）。

落盘：`saveRunCheckpoint` 把 `latestEventId` 写入 `checkpoints`（以 `runId` 为主键、`sessionId` 为索引），消息记录也携带该 run 的 eventId。

**多会话独立性**：

- 持久化层天然隔离：`messages` 按 `sessionId` 查询，`checkpoints` 按 `runId` 主键 + `sessionId` 索引，多个会话/run 的记录互不覆盖。
- 多标签页：每个标签页是独立 JS 上下文与内存 store，IndexedDB 同源共享但按上述键隔离，互不干扰。
- 单标签页内可以有多个后台 Session 同时运行：`SessionRuntimeHost` 为每个活跃 Session 保持独立 Worker/订阅，`sessionOperationStore` 按 `runId` 保存热状态，页面仅选择当前 `sessionId`。
- mock 与 http 路径都通过同一个 `sessionOperationService` 路由；切换可见 Session 不替换其他 Session 的 Operation。
- `scheduleRunCheckpoint` 的防抖、最大等待和串行写链均按 `runId` 分槽，不同 Session 的 checkpoint 不互相覆盖。

### 3.6 会话行、落库 id 与会话列表刷新

- `createSession({ id: sessionId })`：会话行主键与路由一致；默认入口固定 `session-inbox`，真实会话为 UUID。`ensureSession` 只在内存 `session.id === sessionId` 时复用，路由切换必须按新 id 重新加载。
- 消息落库 id 带 kind 前缀（`text:` / `reasoning:` / `tool:` / `step:` / `activity:` / `surface:`）；渲染过滤时先去掉前缀再与 `run.messages`（原始 id）比对，避免刷新后历史与实时 run 重复渲染。
- 文本消息记录自己的 `eventId`（该消息最后一次更新的游标，`TEXT_MESSAGE_*` 事件逐条更新，含 END）；其余消息类型记录 run 当前 `latestEventId`。
- 列表刷新：`createSession / updateSession / saveRunCheckpoint` 后派发 `agentdock:sessions-changed`；侧边栏对路由 `pendingSession` 乐观插入，并监听 focus / visibilitychange 兜底刷新。
- 标题更新：发送首条消息后用消息前 32 字符更新会话标题（默认文案“新对话 / New chat”）。

## 4. 一次 run 的完整请求/响应

### 4.1 客户端构造（当前 `createRunInput`）

```json
{
  "threadId": "thread-session-001",
  "runId": "9f338642-e569-42e1-8f91-a3e5fe22fc54",
  "state": {},
  "messages": [
    { "id": "2c0f...", "role": "user", "content": "请分析今天的飞行测试数据" }
  ],
  "tools": [],
  "context": [],
  "forwardedProps": {
    "action": "run",
    "sessionId": "session-001",
    "agentId": "flight-analysis",
    "fab": "F15B"
  }
}
```

### 4.2 浏览器传输层

对话实时传输只有 `proxy` 一种方式：Browser 固定走 `/api/copilotkit`，FAB 路由由 Runtime 完成。
`direct`（自研 SSE 直连上游 `/ag-ui`）已移除；`agentRuntimeService` 仅用于 mock（离线 UI 测试）。

### 4.3 Runtime（Copilot Runtime Node 服务）转发

`server/index.ts`（官方 single-route handler）+ `server/copilot-runtime/fabRoutingAgent.ts`：

1. 前端 POST `/api/copilotkit`，body 为官方 envelope `{ method, params, body }`（`agent/run` / `agent/connect` / `agent/stop` / `info`）。
2. `FabRoutingAgent.run(input)` 读取 `forwardedProps.fab`，从 `AGENT_ORCHESTRATION_BASE_URLS_JSON` 选择 base URL（协议由公司内网规范决定，不强制校验），委托 `HttpAgent` 请求 `${base}/ag-ui`。
3. `CopilotRuntime({ a2ui: {} })` 提供 A2UI Middleware 与认证透传；事件流原样回传。
4. 上游不可达/非 2xx 由 Runtime 错误处理转为 `FAB_ENDPOINT_UNAVAILABLE` 等错误；取消返回 `CANCELLED`。

### 4.4 动作矩阵

| 逻辑动作 | `forwardedProps.action` | 关键字段 | 当前状态 |
|---|---|---|---|
| 发起执行 | `run` | `sessionId`、`agentId` 或 `group`、`fab`、当前 message | ✅ 官方 `agent/run`（proxy）/ 自研 runStore（mock） |
| 断线恢复 | `resume` | `fab`、相同 `runId`、`resume.lastEventId` | ✅ mock `resume(lastEventId)`；http+proxy `connectAgent` 携带 `lastEventId`（方向已冻结：按 eventId 游标恢复） |
| 停止 | `stop` | `fab`、相同 `threadId/runId` | ✅ 官方 `agent/stop`（proxy）/ 本地 abort（mock） |
| HITL 响应 | `hitlResponse` | `fab`、`requestId`、mode、decision/input 等 | ✅ 标准 `resume[]` + legacy 后备；wire 待冻结 |
| A2UI Action | `a2uiAction` | `fab`、`surfaceId`、`actionName`、`context`、`sourceComponentId` | ✅ 官方 `a2uiAction.userAction`（renderer bridge）/ 自研后备 |

## 5. FAB 路由与部署配置

### 5.1 前端（构建期）

```env
VITE_SERVICE_MODE=mock|http
VITE_API_BASE_URL=/api
# 对话实时传输只有 proxy（/api/copilotkit）；direct 已移除
```

### 5.2 服务端 / CD（`deployment.yml` 示例）

```yaml
env:
  - name: AGENT_REGISTRY_BASE_URL
    value: "https://agent-registry.company.example"
  - name: AGENT_ORCHESTRATION_BASE_URLS_JSON
    value: '{"F15B":"https://agent-f15b.company.example","F18B":"https://agent-f18b.company.example"}'
  - name: NODE_ENV
    value: "production"
```

上线时只需修改 CD 环境变量，不需要重新构建前端。`VITE_*` 中不得出现生产 FAB 地址。

### 5.3 路由规则与错误码

- `fab = F15B` 只允许转发 F15B Base URL；映射缺失返回 `FAB_ENDPOINT_NOT_CONFIGURED`（422）。
- 上游不可达/非 2xx 返回 `FAB_ENDPOINT_UNAVAILABLE`（502）。
- 上游在流中错误：原样透传 SSE，前端按 `RUN_ERROR` 展示。

## 6. Agent Registry 集成点

- 市场（分类/列表/详情/引用）全部通过 `AGENT_REGISTRY_BASE_URL` 的普通 REST（`POST /api/*`），**不按 FAB 切地址**，`fab` 只是请求参数。
- `getFabOptions(type, mode)` 决定可用 FAB 与默认 FAB。
- `getMentionAgentsList` 返回全部有权限的 `Agent + FAB` 组合，供 `@Agent` 菜单。
- 详情页“开始对话”携带 `agentId + fab` 跳转 `/chat/session-inbox?agent=...&fab=...`。

## 7. 当前实现缺口与行动项

| # | 缺口 | 优先级 | 行动项 |
|---|---|---|---|
| R1 | ~~无 Copilot Runtime HTTP 挂载~~ | ✅ | `server/index.ts` + `FabRoutingAgent`；`pnpm run server` 启动；OAuth2 Proxy 配置见 `design/08` §7.3 |
| R2 | ~~自研 transport 与官方 envelope 不一致~~ | ✅ | 官方 single-route envelope 已接入；自研 runStore/reducer 仅 mock |
| R3 | ~~HITL requestId 硬编码~~ | ✅ | activity/interrupt 中读取并回传 |
| R4 | ~~新会话 threadId 退化~~ | ✅ | `createSession` 固化 `crypto.randomUUID()` |
| R5 | ~~direct mock 回退死链~~ | ✅ | `useOfficial` 仅 proxy；mock 统一走 `agentRuntimeService`（mock stream / 自研 runStore） |
| R6 | `stop` 终态确认 | P1(联调) | 官方 `agent/stop` 已接入；上游终止事件形态待后端确认 |
| R7 | ~~无 /info 发现端点~~ | ✅ | 官方 Runtime `/info` 已验证（agents + a2uiEnabled） |

> 渲染侧：AG-UI/A2UI 事件 → LobeHub 组件不做事件 Adapter，统一走投影层（`design/09-agui-lobehub-rendering-adapter.md`）。
