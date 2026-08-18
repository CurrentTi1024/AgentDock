# 端到端 Code Review：AG-UI 通信 / A2UI Pipeline / 流式回显 / 信息粒度渲染

> 状态：2026-08-19 完成第一轮逐行 review，P0 已修复，P1/P2 见文末清单
> 关联：`design/08`（架构决策）、`design/09`（投影层）、`01`（链路）、`02`（协议）

## 1. Review 模块划分（TodoList）

| 模块 | 文件 | 状态 |
|---|---|---|
| R1 协议入口 | `server/index.ts`、`server/copilot-runtime/fabRoutingAgent.ts`、`fabProxy.ts`(legacy) | ✅ 已 review，P0 已修 |
| R2 前端传输 | `src/api/runtime/sse.ts`、`agentRuntimeService.ts`、`runtimeConfig.ts` | ✅ 已 review（自研仅 mock/direct） |
| R3 状态机 | `src/api/runtime/types.ts`、`runReducer.ts`、`src/stores/runStore.ts` | ✅ 已 review，P0 已修（orderedBlocks/CHUNK） |
| R4 官方 headless | `src/features/chat/useAgentDockConversation.ts` | ✅ 已 review，P0 已修（HITL/restore/A2UI shape/direct 回退） |
| R5 页面装配 | `src/features/chat/ChatPage.tsx`、`providers.tsx` | ✅ 已 review，P0 已修（发送清空/去重 surface） |
| R6 信息粒度渲染 | `MessageBlocks.tsx`、`Markdown.tsx`、`ChatItem.tsx`、`a2ui/catalog.tsx` | ✅ 已 review，P0 已修（顺序渲染/占位符） |
| R7 持久化 | `src/api/session/sessionHistoryService.ts` | ✅ 已 review，P1 项保留 |
| R8 A2UI Pipeline | Runtime `a2ui` middleware ↔ Provider `a2ui` ↔ renderer | ✅ 官方源码核实，联调项保留 |
| R9 HITL wire | 标准 `resume[]` / legacy `on_interrupt` | ⚠️ 前端已实现双路径，后端冻结待联调 |

## 2. 官方串接事实（从打包源码核实，非文档推测）

### 2.1 single-route envelope（`@copilotkit/runtime@1.68.1`）

`createCopilotRuntimeHandler({ runtime, basePath, mode: 'single-route' })` 只接受 `POST {basePath}`，body：

```json
{ "method": "agent/run", "params": { "agentId": "orchestration", "threadId": "..." }, "body": { "runId": "...", "messages": [...], "forwardedProps": {...} } }
```

支持的方法（`single-route-helpers.mjs`）：

| method | 用途 |
|---|---|
| `info` | 发现 agents / a2uiEnabled（前端 `useSingleEndpoint` 启动时发送 `{ method: "info" }`） |
| `agent/run` | 发起 run，`body` 为 RunAgentInput |
| `agent/connect` | 断线续跑 |
| `agent/stop` | 停止 |
| `agent/suggest` / `inspector/metadata` / `transcribe` | 预留能力 |

### 2.2 A2UI Middleware（`@ag-ui/a2ui-middleware@0.0.10`）

- `CopilotRuntime({ a2ui: {} })` 自动应用 `A2UIMiddleware`。
- 流式 `render_a2ui` 的 `TOOL_CALL_ARGS` 在**中间件内完成 partial JSON 解析**，按序发出：
  `createSurface → updateComponents → updateDataModel` 包装成 `ACTIVITY_SNAPSHOT`，`activityType = "a2ui-surface"`，`content = { a2ui_operations: [...] }`，`replace: true`。
- 固定 schema（`a2ui_operations` 出现在工具结果）走 `createA2UIActivityEvents` 同样转成 activity。
- 用户 action：中间件读取 `forwardedProps.a2uiAction.userAction`（**注意是嵌套 userAction**），拼成 `log_a2ui_event` 工具调用注入消息流。
- 前端：Provider `a2ui={{ catalog }}` 开启；Runtime `/info` 返回 `a2uiEnabled: true` 时客户端自动挂载 `createA2UIMessageRenderer`；自定义聊天用 `useRenderActivityMessage()` 手动渲染 activity 消息。

### 2.3 流式回显路径

```text
Browser（CopilotKit transport）
  → POST /api/copilotkit（single-route envelope）
  → Copilot Runtime（createCopilotRuntimeHandler）
      └─ FabRoutingAgent.run(input) → HttpAgent → POST {fab}/ag-ui
          → Orchestration（ag-ui-langgraph + CopilotKitMiddleware + DeepAgents）
              → AG-UI SSE 事件流原样返回
  → Runtime 编码回 SSE → 前端 transport 解析
  → agent.subscribe 回调 → AgentDockProjection（reduceRunEvent）
  → 组件按 orderedBlocks 顺序渲染
```

## 3. 事件 → 组件映射矩阵（fully copy LobeHub）

| AG-UI 事件 | 投影 | 组件 | 状态 |
|---|---|---|---|
| `RUN_STARTED / RUN_FINISHED / RUN_ERROR` | `run.status` / `run.error` | ChatHeader Tag / ErrorBlock | ✅ |
| `STEP_STARTED / STEP_FINISHED` | `run.steps[]` + orderedBlocks | WorkflowStepsBlock | ✅ |
| `REASONING_MESSAGE_START/CONTENT/CHUNK/END` | `run.reasoning` | ReasoningBlock（LobeHub Thinking 折叠） | ✅ |
| `TEXT_MESSAGE_START/CONTENT/CHUNK/END` | `run.messages[assistant]` | ChatItem + Markdown | ✅ |
| `TOOL_CALL_START/ARGS/END/RESULT` | `run.toolCalls` | ToolCallBlock（参数/结果/状态折叠） | ✅ |
| `ACTIVITY_SNAPSHOT (a2ui-surface)` | 官方 renderer 直接消费 | A2UI Catalog 组件（metricCard/actionButton） | ✅ http；mock 走 A2uiSurfaceBlock raw JSON |
| `ACTIVITY_SNAPSHOT (agentDock.hitl)` / `RUN_FINISHED(outcome=interrupt)` / `on_interrupt` | `run.activities[requestId]` + status=paused | HitlBlock（approve/reject + requestId） | ✅ 双 wire |
| `ACTIVITY_SNAPSHOT (agentDock.task/agentDelegation)` | `run.activities` | ActivityBlock | ✅ |
| `STATE_SNAPSHOT / STATE_DELTA` | `run.state` | 诊断预留（P2） | ⏳ |
| `MESSAGES_SNAPSHOT` | 全量重建 `run.messages` | 恢复渲染 | ✅ |
| 未知事件 | `rawEvents` | 不阻塞渲染 | ✅ |

## 4. 逐文件 review 发现与修复

### 4.1 `server/index.ts` / `fabRoutingAgent.ts`（R1）

| 发现 | 级别 | 处理 |
|---|---|---|
| 静态托管目录穿越：`startsWith(normalize(distDir))` 会把 `/dist2` 误判为合法 | P1(安全) | ✅ 改为 `distDir + sep` 边界判断 |
| `/api/copilotkit-other` 也被路由到 Runtime | P2 | ✅ 精确匹配 `/api/copilotkit` 与 `/api/copilotkit/` |
| `fabProxy.ts`（旧自研转发）仍留在仓库 | P2 | 保留作 legacy 参考，标注 deprecated，不再被生产引用 |
| 生产未强制 HTTPS（旧 fabProxy 有校验，新 FabRoutingAgent 没有） | P1 | ⏳ 联调前补 `AGENT_ORCHESTRATION_BASE_URLS_JSON` HTTPS 校验（见清单） |

### 4.2 `sse.ts` / `agentRuntimeService.ts`（R2）

| 发现 | 级别 | 处理 |
|---|---|---|
| 自研 SSE 解析器只保留给 mock / direct；http+proxy 已走官方 transport | - | ✅ 已标注，`CopilotHeadlessHttpService` 为 legacy 入口 |
| `parseSseStream` 不支持 `data:` 多行合并后的事件字段超长截断（无上限） | P2 | 保留，真实后端联调观察 |
| mock `createAgentRuntimeMockEvents` 的 HITL 先于 tool/text，便于演示 | - | 保留 |

### 4.3 `types.ts` / `runReducer.ts` / `runStore.ts`（R3）

| 发现 | 级别 | 处理 |
|---|---|---|
| 渲染按 map 分组（先全部 reasoning 再全部 tool），与真实事件顺序不一致 | P1（LobeHub 视觉） | ✅ 新增 `orderedBlocks`，按事件顺序渲染；旧检查点兼容 fallback |
| 缺少 `REASONING_MESSAGE_CHUNK` | P1 | ✅ 已补 |
| `a2ui.surface` / `a2ui-surface` 两种 activityType 不统一 | P1 | ✅ reducer 同时识别，http 下官方 renderer 负责、raw JSON fallback 关闭 |
| `saveRunCheckpoint` 每个事件都全量写 IndexedDB | P2(性能) | 保留，联调后评估 debounce |
| mock stop 后无上游确认直接置 cancelled | P2 | 保留（mock 语义） |

### 4.4 `useAgentDockConversation.ts`（R4）

| 发现 | 级别 | 处理 |
|---|---|---|
| http+direct 模式误走官方 provider（官方直连需 Enterprise） | P0 | ✅ `useOfficial` 仅 proxy；direct 回退 runStore 自研 SSE |
| 标准 HITL（`RUN_FINISHED outcome=interrupt`）未投影为暂停 UI | P0 | ✅ 已投影 `agentDock.hitl` activity + status=paused |
| legacy `on_interrupt` 未订阅 | P0 | ✅ 已加 `onCustomEvent` 处理 |
| 刷新恢复后 agent.messages 为空，下一轮丢上下文 | P0 | ✅ `restore` 用 checkpoint 回填 `agent.setMessages` |
| A2UI action 未按官方 `a2uiAction.userAction` 嵌套 | P1 | ✅ 已改为嵌套 shape |
| stop 后可能长期停留在 running | P1 | ✅ 已补 CANCELLED 终态 |
| `applyEvent` 每事件 await IndexedDB（无 debounce） | P2 | 保留 |

### 4.5 `ChatPage.tsx` / `providers.tsx`（R5）

| 发现 | 级别 | 处理 |
|---|---|---|
| 发送后输入框不清空 | P1(体验) | ✅ 已 `setInput('')` |
| http 下 raw JSON surface 与官方 renderer 双渲染 | P1 | ✅ `showSurfaces: getServiceMode() !== 'http'` |
| mock 下 Provider 仍会尝试 `/info` | P2 | onError 静默；联调后可改为按模式懒挂载 |
| `selectedAgent` 默认选中 `items[0]` | P2 | 保留（需求 P2） |

### 4.6 `MessageBlocks.tsx` / `Markdown.tsx` / `ChatItem.tsx`（R6）

| 发现 | 级别 | 处理 |
|---|---|---|
| `chat.steps` 文案硬编码全角括号、无占位符 | P1(i18n) | ✅ 改为 `{completed}/{total}` 占位符并同步 18 语言 |
| steps 按事件顺序分组渲染 | P1 | ✅ orderedBlocks 顺序 + 连续 step 合并 |
| 助手消息无 Markdown | P0（此前） | ✅ Markdown.tsx |
| 复制按钮无 onClick | P2 | 保留 |

### 4.7 `sessionHistoryService.ts`（R7）

| 发现 | 级别 | 处理 |
|---|---|---|
| 全量消息类型持久化、恢复、清空即空 | ✅ 已实现 | - |
| sequence 用 `Date.now()+index`，同毫秒跨 run 可能乱序 | P2 | 联调后改单调计数器 |
| 恢复后的 A2UI surface 只渲染 raw JSON | P1 | 联调后按 catalog 渲染器重建（见清单） |

## 5. 待办清单

### P0（已全部完成）

- [x] 官方 CopilotKit v2 接入（Provider/useAgent/useCopilotKit/Runtime handler）
- [x] server/index.ts 可启动，/healthz 与 single-route /info 验证
- [x] HITL requestId 回传 + 标准/legacy 双 wire 投影
- [x] Markdown、STEP、Activity、A2UI catalog
- [x] IndexedDB 全量历史（打开恢复、清空即空）
- [x] direct 模式回退自研 SSE，避免误用官方直连

### P1（联调前建议完成）

- [ ] `FabRoutingAgent` 补 HTTPS 校验（与旧 fabProxy 行为一致）
- [ ] HITL wire 与后端冻结（标准 `resume[]` vs legacy `on_interrupt`）
- [ ] A2UI：后端 fixture 验证 `render_a2ui` 流式解析与 surface 事件；恢复历史 surface 用 catalog 重建（替代 raw JSON）
- [ ] 市场/详情请求竞态、locale 硬编码、Skill 跳转
- [ ] 构建产物体积优化（CopilotKit 依赖引入 katex/mermaid/shiki，当前主 chunk ~1.9MB）
- [ ] runStore / applyEvent 的 IndexedDB 写入 debounce

### P2

- [ ] 复制按钮、mention 空态、静态样例、Settings 开关
- [ ] `sequence` 单调计数器
- [ ] mock 模式 Provider 懒挂载

## 6. 联调验证入口（代码侧自检）

```bash
pnpm run server  # AGENT_ORCHESTRATION_BASE_URLS_JSON={"F15B":"http://127.0.0.1:8123"}
curl -sS http://127.0.0.1:3000/healthz
curl -sS -X POST http://127.0.0.1:3000/api/copilotkit \
  -H 'content-type: application/json' \
  -d '{"method":"info","params":{},"body":{}}'
```

浏览器侧：`VITE_SERVICE_MODE=http` + `VITE_AGENT_RUNTIME_TRANSPORT=proxy`，Network 检查 `POST /api/copilotkit` 的 SSE 事件序列：`RUN_STARTED → STEP_STARTED → REASONING_* → TOOL_CALL_* → ACTIVITY_SNAPSHOT(a2ui-surface) → TEXT_MESSAGE_* → RUN_FINISHED`。
