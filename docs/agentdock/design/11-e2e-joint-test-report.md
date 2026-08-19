# 端到端前后端联合测试报告（AG-UI / A2UI / 消息组件渲染）

> 日期：2026-08-20
> 范围：AgentDock（前端 + Copilot Runtime）↔ demo 后端（FastAPI `/ag-ui`）↔ DeepSeek v4 flash（Responses API）
> 方法：无头 Chrome（Playwright + 系统 Chrome）驱动真实页面，逐场景断言 DOM/状态/控制台

## 1. 环境拓扑

```text
Browser (Chrome, http://127.0.0.1:3000)
  └─ POST /api/copilotkit（single-route envelope: {method, params, body}）
       └─ Copilot Runtime（agent-dock server/index.ts, @copilotkit/runtime 1.68.1）
            ├─ A2UI Middleware（@ag-ui/a2ui-middleware 0.0.10, injectA2UITool=true）
            ├─ FabRoutingAgent（@ag-ui/client HttpAgent）→ AGENT_ORCHESTRATION_BASE_URLS_JSON[fab]
            └─ demo 后端 FastAPI http://127.0.0.1:8123/ag-ui（ag-ui-langgraph 0.0.40 + copilotkit 0.1.94）
                 └─ DeepAgents 0.7.5 + CopilotKitMiddleware → LangChain ChatOpenAI
                      └─ https://api.deepseek.com/ （Responses API, deepseek-v4-flash）
```

运行配置：

| 项 | 值 |
|---|---|
| 前端构建 | `VITE_CHAT_MODE=http`、`VITE_SERVICE_MODE=mock`、`VITE_AGENT_RUNTIME_TRANSPORT=proxy`（写入 agent-dock/.env） |
| Runtime 服务端 | `AGENT_ORCHESTRATION_BASE_URLS_JSON={"F15B":"http://127.0.0.1:8123"}` |
| 后端模型 | `OPENAI_MODEL=deepseek-v4-flash`、`OPENAI_BASE_URL=https://api.deepseek.com/`、`OPENAI_USE_RESPONSES_API=true`、`OPENAI_REASONING_EFFORT=none`（A2UI 需要；thinking 模式不接受 forced tool_choice） |

## 2. 完整请求链路（一次对话 run）

1. 用户在 ChatPage 输入消息 → `useAgentDockConversation.send()` 生成 `runId` + `threadId`，`agent.addMessage` 后调用 `copilotkit.runAgent({agent, forwardedProps:{action:'run', agentId, fab:'F15B', sessionId}, runId})`。
2. CopilotKit v2 客户端以 single-route envelope POST `/api/copilotkit`（body 为标准 AG-UI `RunAgentInput`）。
3. Runtime `createCopilotRuntimeHandler` 解析 envelope → `FabRoutingAgent.run(input)` → `new HttpAgent({url})` → POST `http://127.0.0.1:8123/ag-ui`，透传 `forwardedProps` 与 catalog。
4. 后端 `LangGraphAGUIAgent`（ag_ui_langgraph）把 `RunAgentInput` 转成 LangGraph state（`messages/ag-ui/copilotkit`），`CopilotKitMiddleware` 依据 `inject_a2ui_tool` 动态构造 `generate_a2ui` 工具。
5. DeepAgents 主模型（DeepSeek Responses API）产生 `TEXT_MESSAGE_*` / `TOOL_CALL_*` / `STEP_*` / `MESSAGES_SNAPSHOT` 事件，ag_ui_langgraph 组装成 AG-UI SSE。
6. Runtime A2UI Middleware 把 `render_a2ui` 工具调用流式转换为 `ACTIVITY_SNAPSHOT(activityType="a2ui-surface", content={a2ui_operations})`。
7. 前端 `agent.subscribe` 各事件回调 → `reduceRunEvent` 投影为 `RuntimeRunState` → LobeHub 风格组件渲染；IndexedDB 防抖落库（350ms），终态 `flushRunCheckpoint` 后广播 `agentdock:run-persisted`，ChatPage 据此刷新历史。

## 3. 关键代码链路

| 环节 | 文件 | 说明 |
|---|---|---|
| 前端 Provider | `src/app/providers.tsx` | `<CopilotKit a2ui={{catalog}} runtimeUrl="/api/copilotkit" useSingleEndpoint>`，仅 chat=http 挂载 |
| 对话 hook | `src/features/chat/useAgentDockConversation.ts` | 官方路径：`useAgent(runtimeAgentId='orchestration')` + `runAgent`；事件投影；`runAgent` 失败兜底 `RUN_ERROR` |
| 事件投影 | `src/api/runtime/runReducer.ts` | `MESSAGES_SNAPSHOT` 只保留 user/assistant；`lc_run--` 占位 id 用快照规范 UUID 替换；system 上下文（App Context）不渲染 |
| 历史落库 | `src/api/session/sessionHistoryService.ts` | 终态 flush 后广播 `agentdock:run-persisted`，避免历史刷新竞态 |
| 渲染 | `src/features/chat/components/MessageBlocks.tsx` | Text / ReasoningBlock（完成自动折叠）/ ToolCallBlock / WorkflowStepsBlock / ActivityBlock / HitlBlock / A2uiSurfaceBlock / ErrorBlock |
| Runtime | `server/index.ts` + `server/copilot-runtime/fabRoutingAgent.ts` | single-route、A2UI 注入、按 fab 路由到 `/ag-ui` |
| 后端接入 | demo `backend/main.py` / `backend/agent.py` | `add_langgraph_fastapi_endpoint('/ag-ui')`；`create_deep_agent` + `CopilotKitMiddleware`；`use_responses_api` + reasoning effort 配置 |

## 4. 测试矩阵与结果（真实后端 + 无头 Chrome）

| # | 场景 | 提示词/操作 | 结果 |
|---|---|---|---|
| 1 | 文本消息 | `hi` | ✅ 用户消息即时显示；完成态后助手回复保留；无 App Context 泄漏；工作流步骤块渲染 |
| 2 | 历史顺序/去重 | 同会话 `hi` → `hi again` | ✅ 两轮 user→assistant 交替；同一回复无重复（`lc_run--` 占位替换）；历史刷新由落库事件驱动 |
| 3 | 工具调用 | `请使用 ls 工具列出当前目录的文件，不要生成 UI` | ✅ ToolCallBlock（ls + 已完成 + 耗时） |
| 4 | A2UI（新会话单轮） | `请用卡片形式展示三个测试指标：CPU 45%、内存 62%、磁盘 78%` | ✅ 消息区渲染指标叶子节点（CPU/内存/磁盘）；`render_a2ui` 工具块（8s 已调用）；完成态 success；无控制台错误 |
| 5 | 停止生成 | 长文提示后点「停止生成」 | ✅ 退出 running，状态 cancelled，按钮恢复发送 |
| 6 | Thinking 渲染与自动折叠 | mock 流（真实 DeepSeek reasoning 为加密内容，见 §6） | ✅ ReasoningBlock 出现；流式结束后内容区自动收起（头部可见、内容不渲染）；点击可展开 |
| 7 | HITL | mock 流 HITL 块「允许并继续」 | ✅ HitlBlock 渲染，批准后继续执行 |
| 8 | 工具/文本/Surface（mock 全链路） | mock 流批准 HITL 后 | ✅ `flightData.queryMetrics` 工具块、活动块、文本回复、metricCard surface（异常数量） |
| 9 | 单元测试 | `pnpm run test` | ✅ 28/28 |
| 10 | 构建 | `pnpm run build`（tsc + vite） | ✅ 通过 |
| 11 | 断线重连（streamId） | 首轮 run 后按 lastStreamId resume | ✅ 服务层：69 事件全带 streamId；resume 第 40 条精确回放 29 条、无模型调用；未知 runId→STREAM_EXPIRED。⚠️ runtime single-route 纯尾回放受 SSE 校验限制（须 RUN_STARTED 开头），真实接入用 agent/connect 或全量回放+去重 |
| 12 | 真实 HITL（非 mock） | write_file 触发 interrupt → 页面确认 → 批准 resume | ✅ interrupt 真实触发、HitlBlock 渲染、批准携带真实 interruptId + decisions payload 到达后端；纯 deepagents resume 后工具执行成功。⚠️ ag_ui-langgraph 0.0.40 HTTP resume 映射与 langchain interrupt() 约定不兼容，续跑执行需公司服务层实现/升级适配器 |

## 5. 本轮修复清单（前端）

- `runReducer.ts`：`MESSAGES_SNAPSHOT` 过滤 system/developer 上下文；流式 `lc_run--<runid>` 占位消息在快照到达时用规范 UUID 替换（同角色同内容），消除历史重复。
- `sessionHistoryService.ts`：终态落库完成后广播 `agentdock:run-persisted`，ChatPage 监听刷新历史，消除“完成态助手回复消失”竞态（原 600ms 时间兜底保留为备用）。
- `useAgentDockConversation.ts`：`runAgent` 抛错（网络/流中断）时写入 `RUN_ERROR`，避免页面卡死 running。
- `MessageBlocks.tsx`：ReasoningBlock 流式结束自动折叠（原 `useState(streaming)` 只在首帧生效）。
- `server/index.ts`：显式开启 `a2ui: { injectA2UITool: true }`（A2UI 注入由 Runtime 负责，后端 CopilotKitMiddleware 动态生成 `generate_a2ui`，不做后端静态注入）。
- `agent-dock/.env`：锁定 `VITE_CHAT_MODE=http` + `VITE_SERVICE_MODE=mock`，避免任何一次 `pnpm build` 把对话静默切回 mock。
- 构建修复：SettingsPage `Switch` 改从 `@lobehub/ui/base-ui` 导入；TaskItem `ContextMenu` 改为 antd Dropdown；WorkspacePage 使用 `assigneeAgentName/schedulePattern/name/identifier` 真实字段；de/fr/nl 缺失 i18n 补译至阈值以下（28/28 测试通过）。

## 6. 已知问题与限制

- **真实 Thinking 不可见**：DeepSeek v4 flash 的 reasoning 以加密内容流式返回，ag_ui-langgraph 0.0.40 不产生 `REASONING_MESSAGE_*` 协议事件，ReasoningBlock 只能通过 mock/合成事件验证（已验证渲染与自动折叠）。
- **A2UI 多轮上下文脆弱**：同一 thread 内已有大量工具调用历史时，DeepSeek secondary 模型可能偏离 forced `render_a2ui`（转而调用 ls 等），A2UI toolkit 重试 3 次后可能以 `RUN_ERROR` 结束。新会话单轮验证稳定通过。
- **thinking 与 A2UI 互斥**：`reasoning=high` 时 DeepSeek 拒绝 forced `tool_choice`（400），当前以 `OPENAI_REASONING_EFFORT=none` 换取 A2UI 可用；主模型推理与 A2UI 并存需要主/副模型分离配置。
- **并发发送偶发 network error**：连续快速发送曾出现 `agent_run_failed: network error`（客户端 SSE 中断），已加失败兜底不卡 UI；逐条发送可避免。
- **刷新后 A2UI surface 不持久化**：http 实时路径由官方 renderer 渲染 activity 消息，刷新后仅保留文本/工具/步骤（surface 快照恢复为后续项）。
- **HITL 真实 wire 未冻结**：demo 后端当前不触发真实 interrupt；HITL 块由 mock 流验证。

## 7. 复现命令

```bash
# demo 后端（Python 3.11 venv）
cd agent-demo-copilotkit-deepagents-langchian-python
OPENAI_REASONING_EFFORT=none .venv/bin/python -m backend.main   # 8123

# agent-dock runtime（Node 25 + pnpm 10）
cd agent-dock
AGENT_ORCHESTRATION_BASE_URLS_JSON='{"F15B":"http://127.0.0.1:8123"}' pnpm run server  # 3000

# 构建（.env 已锁定 chat=http / market=mock）
pnpm run build
```
