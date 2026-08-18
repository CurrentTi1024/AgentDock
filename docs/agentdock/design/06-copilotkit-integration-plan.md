# CopilotKit 官方依赖接入方案

> 状态：方案定稿，待排期实现  
> 结论：推荐接入官方 CopilotKit v2 Headless + AG-UI/A2UI 基础包；保留 LobeHub 自绘 UI。
> 最终决策（含 OAuth2 Proxy 分工）见 `08-final-architecture-decision.md`；LobeHub 组件如何消费 AG-UI 状态（投影层）见 `09-agui-lobehub-rendering-adapter.md`。

## 1. 为什么需要官方依赖

当前 AgentDock 是**自研 lightweight HTTP SSE client + reducer**（`src/api/runtime/*`），虽然能消费标准 AG-UI 事件，但缺少：

- Runtime 发现（`/info`）与 transport 自动匹配。
- HITL hooks（`useHITL` / frontend tool interrupt 模式）。
- A2UI renderer / catalog / `useA2UIActionHandler`。
- `connect` 断线续传、stop 的服务端编排。
- 官方 DeepAgents 集成（Python `CopilotKitMiddleware`）对应的前端协议版本锁定。

接入官方包后，前端只负责“把官方 hooks 的产出投影为 LobeHub 风格消息”，不再自维护第二套协议状态机。

## 2. 依赖清单（建议版本锁定）

```json
{
  "@ag-ui/client": "^0.x",
  "@ag-ui/core": "^0.x",
  "@copilotkit/react-core": "^2.x",
  "@copilotkit/runtime": "^2.x",
  "@copilotkit/a2ui-renderer": "^2.x",
  "@copilotkit/sdk-js": "^2.x"
}
```

> 具体版本在联调前与后端 `ag-ui-langgraph` / `@copilotkit/sdk-js` / `copilotkit`(Python) 版本一起冻结（`docs/agentdock/03` 第 4.3 节要求）。

## 3. 迁移路径

### 阶段 1：Provider + headless 基础（P0）

```tsx
// providers.tsx
import { CopilotKit } from '@copilotkit/react-core';

<CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint credentials="include">
  <AgentDockApp />
</CopilotKit>
```

替换点：

| 现状 | 目标 |
|---|---|
| `agentRuntimeService.stream` | `useAgent({ agentId: 'orchestration' })` + `useCopilotKit().runAgent(...)` |
| `createRunInput` | 官方 `RunAgentInput`（forwardedProps 保留 AgentDock 字段） |
| `parseSseStream` | 官方 transport（single-route envelope） |
| `runReducer` | 官方 messages/state 模型 + 自定义投影层 |
| `runStore.execute/resume/stop` | 官方 run/connect/stop + 本地 IndexedDB 投影保存 |

### 阶段 2：信息粒度 hooks（P0/P1）

按 headless 文档：

- `useRenderedMessages(messages, isRunning)`：扁平消息 + `renderedContent`。
- `useRenderToolCall()`：注册 LobeHub Tool 卡片（`useRenderTool` / `useDefaultRenderTool`）。
- `useRenderActivityMessage()`：A2UI + Delegation/Task activity。
- `useRenderCustomMessages()`：before/after slots。
- `<CopilotChatReasoningMessage>` 等价物：Reasoning 折叠卡。
- `useFrontendTool` / `useComponent`：客户端工具与组件注册。

### 阶段 3：A2UI（P0）

见 `design/03`：catalog + renderer + action handler + provider `a2ui` 配置。

### 阶段 4：Runtime 服务端（P0）

```ts
// server/index.ts（新增，替代手写 fabProxy 直通）
import { createCopilotRuntime } from '@copilotkit/runtime';
import { createCopilotNodeHandler } from '@copilotkit/runtime/v2/node';

const runtime = createCopilotRuntime({
  agents: [new FabAwareHttpAgent({ fabToBaseUrl, path: '/ag-ui' })],
});

const handler = createCopilotNodeHandler({ runtime, basePath: '/api/copilotkit', mode: 'single-route' });
```

自定义 `FabAwareHttpAgent` 从 `forwardedProps.fab` 选择上游；或保留 `fabProxy` 作为 HttpAgent 的 fetch 实现。生产 CD 只注入 `AGENT_ORCHESTRATION_BASE_URLS_JSON` 与 `AGENT_REGISTRY_BASE_URL`。

## 4. Transport 匹配（必须一致）

| 前端配置 | Runtime 模式 | 说明 |
|---|---|---|
| `useSingleEndpoint`（或自动探测） | single-route：`POST {basePath}`，envelope `{method, params, body}` | 推荐生产 |
| 多路由默认 | `GET /info` + `POST /agent/:id/run` 等 | 需要 `$splat`/catch-all 路由支持 |

前后端 mode 不一致是联调最常见故障之一；`runtimeConfig.resolveAgentRuntimeUrl` 只保留同源 `/api/copilotkit`，direct 模式仅本地。

## 5. 保留自研 reducer 的边界

接入官方后，`runReducer` 可以退化为“投影器”：

- 输入：官方 `agent.messages` / `agent.state` / events。
- 输出：AgentDock `RuntimeRunState`（IndexedDB 可见历史 + 检查点）。
- 不再直接解析 SSE；去重/恢复由官方 transport + 后端 streamId 约定共同保证。

若暂不接官方（方案 B，仅本地/Mock 过渡），必须把自研协议（全文 RunAgentInput + SSE 原样透传）写进 `docs/agentdock/02` 并冻结，且补齐 `/info`。生产不可用：OAuth2 Proxy 无法按 FAB 动态路由到多个 orchestration（见 `design/08` §7.0）。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| 官方包版本与后端 `ag-ui-langgraph` 不兼容 | 联调前统一冻结版本；用同一份 SSE fixture 双向验证 |
| headless hooks 的 messages 语义（reasoning/activity 角色）与现有 reducer 不同 | 投影层做显式映射，禁止两套状态并存 |
| A2UI renderer 与 LobeHub 消息区域样式冲突 | renderer 只渲染组件本体，外壳用 LobeHub ChatItem |
| single-route envelope 与现有 fabProxy 直通协议冲突 | 阶段 4 一次性切换，期间保留旧端点仅用于回滚 |
| 引入官方包导致包体/构建复杂度上升 | 独立 chunk；首期只引 react-core/runtime/a2ui-renderer |

## 7. 验收清单

- [ ] `GET /api/copilotkit/info` 返回 runtime 信息（或 single-route 等价发现）。
- [ ] run/stop/resume/HITL/a2uiAction 五种动作全走同一条 single-route。
- [ ] runId 由浏览器产生且全程不变；恢复时相同 runId + lastStreamId。
- [ ] reasoning、tool、step、activity、A2UI 全部有渲染组件（`design/05` 矩阵）。
- [ ] 与 DeepAgents 后端联调 Case 1-10 通过（`docs/agentdock/03`）。
