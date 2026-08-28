# 最终架构决策：CopilotKit × LobeHub × OAuth2 Proxy 融合方案

> 状态：决策稿（2026-08-18 联网 survey 后定稿）  
> 本文回答：AG-UI 事件由谁解析、A2UI 由谁渲染、CopilotKit 与 LobeHub 状态如何不打架、FAB 路由与 SSO 由谁负责。

## 1. 前置事实（联网核实）

### 1.1 OAuth2 Proxy

- 官方支持多 upstream 按路径前缀路由（配置 `upstreams = [...]`，多个时按 path 匹配）。
- 由它统一完成 SSO 登录态注入（Authorization 头/Cookie），因此**前端仓库不需要自建 `/api/*` 反向代理**。
- 生产需要确认 SSE 流式响应不被缓冲（检查 `flush-interval`/代理配置），否则流式 token 会被攒批。

### 1.2 CopilotKit

- 开源 headless API：`useAgent` / `useCopilotKit`（`@copilotkit/react-core` v2）；`useCopilotChatHeadless_c` 是 **Enterprise** 功能，不使用。
- `selfManagedAgents`（前端直连自己托管的 AG-UI Agent）是 **Enterprise** 功能；开源生产路径是 **Copilot Runtime**（Node 服务，`@copilotkit/runtime`）。
- Runtime 代理模式：前端 `runtimeUrl → runtime /info 发现 agent → runtime 侧 HttpAgent → 后端 /ag-ui`。Runtime 提供认证透传、A2UI middleware、HITL bridge、stop/connect。
- `useAgent({ agentId, threadId })` 返回标准 AG-UI `AbstractAgent`，可订阅 AG-UI 事件：`onRunStartedEvent`、`onStepStartedEvent`、`onTextMessage*`、`onToolCall*`、`onState*`、`onMessagesSnapshotEvent`、`onCustomEvent`、`onRawEvent` 等。
- `runAgent` 在客户端生成 `runId`（HITL 续跑时用 `logicalRunId` 保持同一逻辑 run）。

### 1.3 A2UI

- v0.9 协议：`createSurface → updateComponents → updateDataModel`（三种操作必须按序）。
- 官方渲染路径：Provider 传 catalog → Runtime `a2ui: { injectA2UITool: true }` → 动态 schema 由后端 `CopilotKitMiddleware`/`get_a2ui_tools` 注入 `generate_a2ui` → `render_a2ui` 的 TOOL_CALL_ARGS 流式到达 → Runtime middleware 转成 surface 事件 → 前端内置 renderer 渲染。
- 固定 schema：Agent 直接返回 `a2ui_operations`，Runtime 只需 `a2ui: true`，不注入生成工具。
- 自定义 UI：`useRenderActivityMessage()` 取渲染函数；或用 `createA2UIMessageRenderer({ theme, onAction })` 传给 Provider 的 `renderActivityMessages`；action 拦截器可本地处理、修改或放行。
- 不依赖 CopilotKit 的独立渲染器存在（`@a2ui/web_core` + `@a2ui/react`、`@a2ui-renderer/react`），但需要自己消费 AG-UI 流并管理 surface 状态。

### 1.4 后端（DeepAgents + CopilotKitMiddleware）

- FastAPI 侧：`add_langgraph_fastapi_endpoint(app, LangGraphAGUIAgent(...), path="/ag-ui")` + `CopilotKitMiddleware`。
- HITL 有两种 wire 形态：legacy `CustomEvent(on_interrupt)` + `forwardedProps.command.resume`（CopilotKit ≤1.60 默认）；AG-UI 标准 `RunAgentInput.resume[]` + `RunFinishedEvent.outcome.interrupts`（`emit_interrupt_outcome=True` 才开启，且要求客户端已升级）。**必须在联调前与后端冻结一种**。

### 1.5 Copilot Runtime 的职责（为什么必须有这个 Node 服务）

Copilot Runtime（`server/index.ts` 同进程挂载）不是简单的“端口配置”，它承担以下职责，缺一不可：

1. **协议翻译**：前端 CopilotKit transport 使用 single-route JSON envelope（`{method, params, body}`）；Runtime 负责把它还原成 AG-UI 的 `run/connect/stop/info` 调用，并把后端 AG-UI SSE 转回前端可消费的 envelope。没有它，前端只能自研一套协议客户端（方案 B，已否决）。
2. **FAB 路由**：浏览器只知道同源 `/api/copilotkit`；Runtime 根据 `forwardedProps.fab` 选择 `AGENT_ORCHESTRATION_BASE_URLS_JSON[fab]` 并调用 `{baseUrl}/ag-ui`。OAuth2 Proxy 只做固定 path 转发，无法按 FAB 选择上游。
3. **A2UI Middleware**：后端 `render_a2ui` 的 `TOOL_CALL_ARGS` 流到达 Runtime 后，官方 A2UIMiddleware 将其转换为 surface 事件（`createSurface/updateComponents/updateDataModel`），前端 renderer 才能渲染。开源版中该能力只在 Runtime 路径提供。
4. **HITL Bridge**：interrupt 事件需要 Runtime 侧的 bridge 才能用 `resume` 数组续跑（legacy `on_interrupt` 或 AG-UI 标准 outcome）。前端 `useInterrupt` 的 `resolve/cancel` 最终都通过 Runtime 提交。
5. **认证与安全边界**：Runtime 与 Orchestration 之间是服务端到服务端调用，token 由 OAuth2 Proxy 注入到 Runtime 的入站请求后，Runtime 再透传给上游；浏览器不直接接触 orchestration 域名，避免 CORS、密钥和审计缺口。
6. **统一错误与审计**：上游不可达/非 2xx 转成 `FAB_ENDPOINT_*`/`RUN_ERROR`；日志、限流、trace 可在这一层统一处理。

结论：**Copilot Runtime 是与前端同仓库、同进程部署的 Node 服务**，但它承担的是“官方协议闭环”的职责，而不是一个可选代理。前端 `runtimeUrl="/api/copilotkit"` 指向的就是它。

## 2. 候选方案

### 方案 A：官方 CopilotKit + Copilot Runtime（推荐）

```text
Browser（LobeHub 风格 UI，headless hooks 驱动）
  → /api/copilotkit（OAuth2 Proxy 加 token）
  → Copilot Runtime（Node，本仓库 server/）
       ├─ /info、single-route envelope、A2UI middleware、HITL bridge
       └─ FabRoutingAgent：按 forwardedProps.fab → {AGENT_ORCHESTRATION_BASE_URLS_JSON[fab]}/ag-ui
  → Orchestration FastAPI /ag-ui（ag-ui-langgraph + CopilotKitMiddleware）
  → Core DeepAgents
```

普通 REST（市场等）：`/api/*` 由 OAuth2 Proxy 直接路由到 Agent Registry，不经过 Runtime。

### 方案 B：纯自研（不引入 Copilot Runtime/Provider）

```text
Browser（自研 runStore 客户端/@ag-ui/client + runReducer + 独立 A2UI renderer）
  → /api/ag-ui/{fab}（需按 FAB 动态路由到 {fab}/ag-ui）
  → Orchestration FastAPI /ag-ui
```

> **生产可行性已否决**：公司 OAuth2 Proxy 只支持固定 path 前缀转发，不具备按请求参数（`fab`）动态选择 upstream 的能力；仓库也不自建反向代理。因此 `/api/ag-ui/{fab}` 无法在现有网络拓扑里落地。方案 B 仅保留给本地 Mock/单机联调参考，不再作为生产后备。

### 方案 C：混合（CopilotKit 仅作类型参考，协议自定义）

保留当前自研 transport，只加 `@ag-ui/core` 类型与独立 A2UI renderer。本质上接近方案 B，只是协议仍为“RunAgentInput 全文转发”。

## 3. 决策与理由

**选择方案 A**。理由：

1. 公司后端已确定 DeepAgents + CopilotKitMiddleware；官方前端协议与其天然同版本演进（HITL、A2UI、frontend tools）。
2. 用户原架构声明即“前端 copilotkit + copilot runtime”，方案 A 与其一致。
3. A2UI 的完整管线（catalog → 工具注入 → 流式 surface）官方只有 runtime 路径开源可用；方案 B 需要自己重实现 ~3000 行 A2UI 状态机或引入第三方独立 renderer，且 HITL/stop/connect 全部自维护，风险集中在最复杂的部分。
4. 方案 B 无法生产：按 FAB 动态路由依赖 OAuth2 Proxy 不具备的能力，且仓库不自建反向代理；即使“禁止 Node 运行时服务”，也必须另配一层 FAB 路由网关，方案 B 仍不成立。

**关键约束**：

- 不使用 Enterprise API（`useCopilotChatHeadless_c`、`selfManagedAgents`）。
- 不引入 LobeHub 任何 store；LobeHub 组件只作为展示层。
- 只有一个状态机：CopilotKit agent（协议层）+ 投影层（展示/持久化），禁止双解析双 reducer。

## 4. 状态冲突解决方案（重点）

### 4.1 冲突来源

LobeHub 的 UI 与它的 zustand `useConversationStore`（messages/topic/agent 状态）强耦合；如果同时持有 CopilotKit agent 状态和 LobeHub store 状态，会出现“两边都在改消息”的错位。

### 4.2 解法：单源 + 纯函数投影

```text
CopilotKit Agent（唯一状态源：messages / state / events）
        │ 订阅（onMessagesChanged / onStateChanged / onRunStartedEvent…）
        ▼
AgentDockProjection（纯函数，无副作用）
        ├─ RuntimeRunState（LobeHub ViewModel：messages/reasoning/toolCalls/surfaces/steps/activities）
        ├─ 消息 block 渲染（ChatItem + MessageBlocks）
        └─ IndexedDB 持久化（sessionHistoryService）
```

规则：

- 组件只读投影结果，不回写 CopilotKit 状态之外的业务状态。
- 用户输入/点赞/折叠等本地 UI 状态放 `uiStore`；对话内容状态一律来自 agent。
- `runStore` 从“协议状态机”降级为“投影 + 持久化 facade”（或删除，改为 hook 组合）。
- `runReducer` 不再解析 SSE；只在需要落盘时把 agent.messages/state 投影成持久化快照。
- IndexedDB 通过 agent 事件订阅写入，禁止在 reducer 内写库。

### 4.3 LobeHub 组件接入边界

| LobeHub 组件 | 接入方式 |
|---|---|
| ChatItem / MessageBlocks | 纯展示，props 由投影层提供 |
| Reasoning / Tool 卡片 | 用 `useRenderToolCall` 注册到投影的 block 渲染 |
| HITL Intervention | 用官方 HITL hooks（`useLangGraphInterrupt` 或 AG-UI 标准 resume）驱动 UI |
| A2UI | Provider 内置 renderer 嵌入 ChatItem children（见第 6 节） |
| ChatInput / @菜单 | 本地组件，调 `runAgent`，不触碰 LobeHub store |

## 5. AG-UI 事件解析决策

### 5.1 结论

**生产环境由 CopilotKit 官方 transport 解析，前端订阅 `agent` 事件；不保留自研 runStore 解析作为生产路径。**

理由：官方 transport 与 runtime envelope、HITL、A2UI、connect/stop 是一个闭环；自研解析器会在事件裁剪/去重/恢复上与官方行为产生两套实现，是状态冲突的另一来源。

### 5.2 落地

- `agent.subscribe`（或 `useAgent` 自动重渲染）消费事件：
  - `onStepStartedEvent/onStepFinishedEvent` → steps 投影（补上当前缺失的 STEP UI）。
  - `onTextMessageStart/Content/End` → 文本消息。
  - `onToolCall*` → Tool 卡片。
  - `onRunStartedEvent` → 记录 `runId`（官方客户端生成）。
  - `onRunFinishedEvent/onRunErrorEvent` → 终态 + 落盘。
  - `onCustomEvent/onRawEvent` → 诊断日志。
- `runReducer`/`runReducer` 仅保留给 Mock 联调与离线 fixture 测试，并在代码注释与文档中标注“非生产路径”。

### 5.3 runId / eventId

- `runId`：由官方客户端生成，事件回调中读取并写入 IndexedDB；后端必须原样回显。
- `eventId`：公司 Redis 事件游标通过 AG-UI 事件顶层 `eventId` 透传；恢复时使用相同 `runId` 的 resume + `lastEventId`。

## 6. A2UI 渲染决策

### 6.1 结论

**采用官方 A2UI 渲染（Provider catalog + Runtime middleware + 内置/自定义 renderer），把渲染结果嵌入 LobeHub 消息 chrome，而不是自写一套 A2UI 状态机。**

### 6.2 落地

```tsx
// 1) Catalog（BYOC）
const agentDockCatalog = createCatalog({
  catalogId: 'agentdock://catalog',
  includeBasicCatalog: true,
  definitions: [metricCard, actionButton],
  renderers: { metricCard: MetricCard, actionButton: ActionButton },
});

// 2) Provider
<CopilotKit
  runtimeUrl="/api/copilotkit"
  useSingleEndpoint
  a2ui={{ catalog: agentDockCatalog }}   // 动态 schema 时 Runtime 侧还要 injectA2UITool: true
  renderActivityMessages={createA2UIMessageRenderer({ theme, onAction: interceptor })}
>
  <AgentDockApp />
</CopilotKit>

// 3) 自定义消息列表
const renderActivityMessage = useRenderActivityMessage();
// 在 ChatItem children 中：renderActivityMessage({ message }) 或 renderActivityMessages
```

### 6.3 Action 回传

- 拦截器 `(action, forward) => A2UIUserAction | null | void`：
  - 返回 `null`：本地处理（例如打开本地报告面板）。
  - 返回修改后的 action：改后转发。
  - 返回 `undefined`：原样转发给 Agent。
- 转发的 action 由官方客户端走 AG-UI；后端按 `surfaceId/actionName/context` 处理。
- 不再使用当前硬编码 `open_report` 的手写按钮；按钮由 catalog 定义驱动。

### 6.4 后备

若未来出现“禁止 Node Runtime 且必须放弃 CopilotKit 官方运行时”的场景，A2UI 才需要改用独立渲染器（`@a2ui/web_core` + `@a2ui/react`）消费 AG-UI 流中的 A2UI operations，并且必须同时解决按 FAB 路由的网关问题（OAuth2 Proxy 当前不具备）；联调前还需拿到后端 A2UI 事件 fixture 验证协议版本（v0.8/v0.9/v1.0 差异较大）。

## 7. FAB 路由与 SSO 分工

### 7.0 路由能力边界（公司现状）

- OAuth2 Proxy 只做**固定 path 前缀转发**（如 `/api/copilotkit`、`/api/market/*`），并统一注入 SSO token。
- OAuth2 Proxy **不具备按请求体/URL 参数（fab）动态选择 upstream 的能力**，也不会把请求分发到多个 orchestration 域名。
- 因此 **Copilot Runtime（`server/index.ts`）是生产必选组件**：浏览器只有一个同源地址 `/api/copilotkit`，FAB → orchestration baseUrl 的决策必须发生在 Runtime 内部。

### 7.1 分工表

| 能力 | 负责方 |
|---|---|
| SSO 登录、token 注入 | OAuth2 Proxy |
| `/api/*` 普通业务转发 | OAuth2 Proxy 按路径路由到 Agent Registry |
| `/api/copilotkit` 转发 | OAuth2 Proxy → Copilot Runtime 服务 |
| FAB → orchestration baseUrl 选择 | Copilot Runtime 的 FabRoutingAgent（服务端 env） |
| 静态资源 | nginx/CDN（或 Runtime 同进程托管，二选一） |

### 7.2 FabRoutingAgent 建议实现

```ts
class FabRoutingAgent extends AbstractAgent {
  async run(input) {
    const fab = input.forwardedProps?.fab;
    const baseUrl = FAB_ENDPOINTS[fab];          // AGENT_ORCHESTRATION_BASE_URLS_JSON
    if (!baseUrl) throw new Error('FAB_ENDPOINT_NOT_CONFIGURED');
    const upstream = new HttpAgent({ url: `${baseUrl}/ag-ui` });
    return upstream.run(input);                   // 复用 @ag-ui/client 的完整事件处理
  }
}
```

备选（Runtime 内部实现方式，不影响网络拓扑）：按 FAB 注册多个 agent `{ 'F15B-orchestration': HttpAgent(...), ... }`，前端 `useAgent({ agentId: \`${fab}-orchestration\` })`。推荐 FabRoutingAgent（agentId 稳定），两者都可接受；无论哪种，OAuth2 Proxy 都只看到同一个 `/api/copilotkit`。

### 7.3 OAuth2 Proxy 配置示例

```yaml
upstreams:
  - path: /api/market/
    uri: http://agent-registry:8000/api/market/
  - path: /api/copilotkit
    uri: http://agentdock-runtime:3000/api/copilotkit
  - path: /api/
    uri: http://agent-registry:8000/api/
```

> 路径规则以团队实际部署为准；重点：`/api/copilotkit` 必须到 Runtime，市场接口到 Registry，不能全部打到 orchestration。

### 7.4 SSE 流式注意

- 确认 OAuth2 Proxy/网关对 SSE 不缓冲（flush interval）。
- Runtime 响应头：`Cache-Control: no-cache`、`Content-Type: text/event-stream`、`X-Accel-Buffering: no`。

### 7.5 Runtime 与前端是否同服务、OAuth2 Proxy 放在哪一跳

**Copilot Runtime 与前端代码天然是同一个 Node 服务**：`server/index.ts` 一个进程既托管 Vite dist（或只托管 `/api/copilotkit`，静态交给 CDN），又挂载 Runtime handler。前端配置的 `runtimeUrl` 是同源路径 `/api/copilotkit`，**不是独立的 runtime URL/域名**，浏览器不会看到第二个服务地址。

OAuth2 Proxy 有两种可落地的放置方式：

| 放置方式 | 链路 | 可行性 |
|---|---|---|
| A（推荐） | Browser → OAuth2 Proxy → Runtime（同前端服务）→ Orchestration 直连 | ✅ OAuth2 Proxy 在边缘完成 SSO 并注入 token；Runtime 把收到的 header 原样透传给 `{fab}/ag-ui`。FAB 选择发生在 Runtime 内，不依赖 Proxy 动态路由 |
| B | Browser → Runtime（同前端服务）→ OAuth2 Proxy → Orchestration | ⚠️ 有条件可行：Runtime 是 server-to-server 调用，OAuth2 Proxy 无法自己发起登录，必须由 Runtime 把浏览器原始 `Cookie/Authorization` 原样转发过去，Proxy 才能识别会话并注入上游 token；且每个 FAB 需要一条**静态 path 前缀**（如 `/api/f15b/ag-ui → F15B`、`/api/f18b/ag-ui → F18B`），否则 Proxy 不知道把请求发给哪个 orchestration。这等于把 FAB 路由做成了 OAuth2 Proxy 的静态配置，与“不具备动态路由”不冲突，但 FAB 增删要同步改配置 |

结论：

- “Runtime 和前端启在一个服务里”完全成立，本文档一直按这个拓扑设计；
- 推荐放方式 A：OAuth2 Proxy 只负责边缘认证与固定 path 转发，Runtime 内做 FAB 选择；
- 如果你的网络要求“Runtime 出站必须经过 OAuth2 Proxy”，可以走方式 B，但必须为每个 FAB 在 OAuth2 Proxy 配静态 path，且 Runtime 要原样转发浏览器会话头；在 FAB 数量少、配置可静态维护时这是可接受的替代方案。

## 8. HITL 决策

- 联调前与后端冻结：**legacy on_interrupt + forwardedProps.command.resume（CopilotKit ≤1.60 默认）** 或 **AG-UI 标准 RunAgentInput.resume[] + outcome.interrupts**。
- 前端采用官方 hooks 对应实现；废弃当前自定义 `forwardedProps.hitlResponse` 作为最终协议（仅保留为 Orchestration Adapter 后备归一化）。
- HITL UI（approve/reject/edit/input/select/form）继续用 LobeHub Intervention 风格，但数据流由官方 hook 驱动。

## 9. 依赖与版本冻结

```json
{
  "@ag-ui/core": "锁定",
  "@ag-ui/client": "锁定（Runtime 内用）",
  "@copilotkit/react-core": "v2 锁定",
  "@copilotkit/runtime": "v2 锁定",
  "@copilotkit/a2ui-renderer": "锁定"
}
```

后端冻结：`copilotkit`(Python)、`ag-ui-langgraph`、`deepagents` 版本；HITL 形态、A2UI 协议版本（v0.9）、`RunAgentInput` schema 一起在 `docs/agentdock/03` 联调前确认。

## 10. 迁移步骤（P0 已落地）

1. `server/`：新建 Node 服务入口 `server/index.ts` —— 这是 OAuth2 Proxy 转发 `/api/copilotkit` 时真正监听的 HTTP 服务：

   ```ts
   // server/index.ts（已落地，官方 v2 API）
   import { createServer } from 'node:http';
   import { CopilotRuntime, createCopilotRuntimeHandler } from '@copilotkit/runtime/v2';
   import { createCopilotNodeHandler } from '@copilotkit/runtime/v2/node';
   import { FabRoutingAgent } from './copilot-runtime/fabRoutingAgent';

   const runtime = new CopilotRuntime({
     agents: { orchestration: new FabRoutingAgent({ fabToBaseUrl: JSON.parse(process.env.AGENT_ORCHESTRATION_BASE_URLS_JSON!) }) },
     a2ui: {},
   });

   const fetchHandler = createCopilotRuntimeHandler({ runtime, basePath: '/api/copilotkit', mode: 'single-route' });
   const handler = createCopilotNodeHandler(fetchHandler);

   const server = createServer((req, res) => {
     if (req.method === 'GET' && req.url === '/healthz') return ok(res);
     if (req.url?.startsWith('/api/copilotkit')) return handler(req, res);
     return notFound(res);
   });

   server.listen(Number(process.env.PORT ?? 3000));
   ```

   - 必须项：`POST /api/copilotkit`（single-route）+ `GET /healthz` + `FabRoutingAgent` + 读取 `AGENT_ORCHESTRATION_BASE_URLS_JSON`。
   - 可选项：托管 Vite dist 静态资源；若公司用 CDN/nginx 托管 SPA，则不需要静态托管，本服务只暴露 `/api/copilotkit`。
   - 不做：`/api/*` 到 Agent Registry 的反向代理（OAuth2 Proxy 负责）。
   - 同服务说明：前端 `runtimeUrl="/api/copilotkit"` 与这个 handler 同源同进程，不存在独立 runtime URL；Runtime 到 Orchestration 的出站方式见 §7.5（方式 A 直连 / 方式 B 经 OAuth2 Proxy 静态 path）。
2. 前端：Provider + `useAgent`/`useCopilotKit` 替换 `agentRuntimeService.stream`；删除生产路径的 `runReducer`/`runReducer` 调用（保留 Mock 用）。
3. 投影层：`RuntimeRunState` 改由 agent 事件订阅生成；IndexedDB 改由订阅写入。
4. A2UI：catalog + renderer + interceptor；Mock 数据同步升级为 v0.9 operations。
5. HITL：与后端冻结 wire 后接入官方 hooks；补 Intervention 各模式 UI。
6. STEP/Reasoning/Tool 渲染按 `design/05` 矩阵补齐。

## 11. 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| CopilotKit 版本与后端 Python SDK 不同步 | HITL/A2UI wire 不兼容 | 联调前统一冻结 + fixture 双向验证 |
| OAuth2 Proxy 缓冲 SSE | 流式变攒批 | 提前验证 flush；Runtime 设置 no-buffer 头 |
| LobeHub 组件样式与官方 A2UI renderer 容器冲突 | 视觉不一致 | renderer 只渲染组件本体，外壳统一 LobeHub ChatItem |
| 官方客户端 runId 生成时机与后端期望不一致 | 恢复/审计错位 | 从事件读取 runId 并落盘；后端只回显不新建 |
| HITL legacy/标准并存 | 双协议维护 | 联调前二选一，文档冻结 |
