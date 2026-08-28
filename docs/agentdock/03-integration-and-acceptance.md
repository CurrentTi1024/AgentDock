# AgentDock 首次联调与验收清单

> 状态：待评审  
> 文档版本：0.1  
> 日期：2026-08-17  
> 联调日期：2026-08-19

## 1. 本轮目标

首次联调只要求打通一条可靠的单 Agent 链路：

```text
用户输入
  → AgentDock
  → Copilot Runtime
  → Orchestration Service
  → Orchestration Core
  → 标准 AG-UI SSE
  → AgentDock LobeHub 风格消息区域
```

最低成功标准：用户发送一条问题后，页面显示运行状态和流式回答；刷新页面后已完成回答仍能从 IndexedDB 回看。

## 2. 联调参与方责任

### AgentDock 前端

- 创建 React/Vite 页面和 LobeHub 风格 Conversation Shell。
- 接入 CopilotKit Provider、`useAgent` 和 Runtime single-route。
- 提供 `sessionId/threadId/runId/agentId/fab/current user message`。
- 显示 lifecycle、文本流、reasoning、tool 和错误。
- 将已完成的可见消息写入 IndexedDB。
- 输出 Browser、Runtime、AG-UI event 三层日志。

### AgentDock App Server / Runtime

- 与 Web 前端同一仓库、同一 Node 服务和同一镜像运行。
- 同时托管 Vite 构建产物和 Runtime 接口。
- 暴露 single-route `POST /api/copilotkit`。
- 注册 Orchestration Agent Adapter。
- 代理 FastAPI `/ag-ui`。
- 透传 forwardedProps、Catalog 和 AG-UI events；SSO 登录态由前置 OAuth2 Proxy 注入（仓库不自建 `/api/*` 反向代理，普通 REST 由 OAuth2 Proxy 路由到 Agent Registry）。
- 对上游错误转换为 `RUN_ERROR`，不返回 HTML 错误页。

### Orchestration Service

- 提供可访问的 `/ag-ui` 地址。
- 接收标准 `RunAgentInput`。
- 沿用输入的 `runId`。
- 将当前 user message、`agentId/fab/threadId` 送到 Core。
- 将 Redis 相同 `runId` 的事件按序流式返回。
- 在每个需要续传的 AG-UI event 顶层提供 `eventId` 游标。

### Orchestration Core

- 提供至少一个可运行 Agent。
- DeepAgents 根据 `threadId` 处理自己的上下文。
- 输出标准 AG-UI lifecycle 和文本事件。
- 后续提供 reasoning、tool、HITL、A2UI 样本。

## 3. 后端联调前必须提供

- [ ] Orchestration Service Base URL。
- [ ] `/ag-ui` 的鉴权方式和测试凭据获取方式。
- [ ] 可使用的 `agentId`。
- [ ] Agent 允许调用的 `version + fab`，至少提供一个，例如 `F15B`。
- [ ] 测试 `threadId` 是否由前端 UUID 产生。
- [ ] 标准文本回答的完整 SSE fixture。
- [ ] Reasoning fixture。
- [ ] 至少一个 Tool Call fixture。
- [ ] 一个错误 fixture。
- [ ] 心跳间隔、请求超时和 Redis event TTL。
- [ ] CORS/内网域名配置；Browser 正式环境只访问 AgentDock Runtime。

## 4. 2026-08-18 准备工作

### 4.1 前端

- 搭建 Web 与 Runtime 最小工程。
- 建立 `/chat/:sessionId` 页面。
- 用本地 Mock SSE fixture 验证 Text、Reasoning、Tool 和 Error 渲染。
- IndexedDB 建立 `sessions/messages/sessionUiState`。

### 4.2 Runtime

- single-route POST 可访问。
- 用 Mock AG-UI Server 验证远端 `HttpAgent` 代理。
- 验证 `forwardedProps` 到达上游。
- 验证事件顶层 `eventId` 经过 Runtime 后仍存在。

### 4.3 联合检查

- 用相同 JSON Schema 校验 `RunAgentInput`。
- 比较 Service 原始事件和 Browser 收到事件，确认字段和顺序未变化。
- 冻结 CopilotKit、AG-UI、A2UI 包版本。

## 5. 2026-08-19 联调顺序

必须按以下顺序进行，不同时排查所有功能。

### Case 1：连接与 RUN_STARTED

请求发送后 3 秒内收到：

```json
{
  "type": "RUN_STARTED",
  "threadId": "thread-001",
  "runId": "run-001"
}
```

验收：

- 页面进入 running 状态。
- `runId` 与 Browser 请求一致。
- 顶层 `eventId` 存在。

### Case 2：流式文本

验收：

- 多个 `TEXT_MESSAGE_CONTENT` 按顺序追加。
- 页面不等待完整回答才显示。
- 相同 delta 不重复。
- `TEXT_MESSAGE_END` 后消息状态完成。

### Case 3：RUN_FINISHED

验收：

- 页面退出 running 状态。
- 停止 loading animation。
- 最终消息写入 IndexedDB。
- 刷新页面可以回看。

### Case 4：Reasoning

验收：

- reasoning 和最终 answer 分开。
- streaming 时展开或展示进行状态。
-完成后默认折叠。
- reasoning event 不拼入最终回答文本。

### Case 5：Tool Call

验收：

- 显示工具名称、状态和参数流。
- Args 完整后是合法 JSON。
- 显示结果和执行时间。
- 已完成工具默认折叠。
- 未注册工具使用通用卡片，不白屏。

### Case 6：错误

验收：

- `RUN_ERROR` 显示 LobeHub 风格错误卡片。
- 页面退出 running 状态。
- 已经收到的部分文本保留。
- 错误不包含敏感内部信息。

## 6. 联调成功后继续验证

### Case 7：Stop

- 用户点击停止。
- Runtime 调用上游取消。
- Core 停止产生新 token。
- 页面保留部分回答并标记 interrupted。

### Case 8：断线恢复

- 人工在文本流中断开连接；前端保存 `runId + latestEventId`（IndexedDB checkpoint）。
- 官方 proxy 路径：恢复走 Runtime `agent/connect`，携带 `action=resume` + `resume.lastEventId`；**按 eventId 游标恢复（方向已冻结）**，后端需只返回游标之后的事件。
- 自研 mock 路径：`restoreSession` 用相同 runId + `resume.lastEventId` 恢复。
- 只补发缺失事件；文本不重复、不缺失。

### Case 9：HITL

- 收到一个后端真实 interrupt fixture。
- LobeHub Intervention UI 正确显示。
- 用户响应后 Agent 继续。
- 重复点击不会提交两次。

### Case 10：A2UI

- Agent 能感知 AgentDock Catalog。
- 出现 `render_a2ui` streamed tool call。
- Surface 在 LobeHub 消息区域内渲染。
- 文本消息和 Surface 可以同时存在。
- Action 能返回 Agent，并携带 `surfaceId/actionName/context`。

## 7. 端到端测试数据

建议固定以下测试输入，方便重放：

### 文本

```text
请用三句话介绍你能做什么。
```

### Tool

```text
请调用一个测试工具，并把工具结果总结给我。
```

### Reasoning

```text
请分步骤分析一个简单问题，并给出最终结论。
```

### HITL

```text
请执行一个必须由用户确认的操作。
```

### A2UI

```text
请用卡片形式展示三个测试指标。
```

## 8. 日志要求

所有日志使用同一组关联字段：

```json
{
  "sessionId": "session-001",
  "threadId": "thread-001",
  "runId": "run-001",
  "eventId": "1723870000000-0",
  "messageId": "assistant-001",
  "toolCallId": null,
  "surfaceId": null
}
```

- 不记录完整 SSO Token。
- 生产环境默认不记录完整用户问题和工具敏感结果。
- Debug 模式可以记录事件类型和 ID，不默认记录 reasoning 内容。

## 9. 首轮 Definition of Done

- [ ] Browser 只调用 Copilot Runtime single POST 入口。
- [ ] Runtime 能代理真实 `/ag-ui`。
- [ ] 当前 user message、`agentId/fab/sessionId/threadId/runId` 全部到达 Service。
- [ ] Service 沿用输入 `runId`。
- [ ] RUN_STARTED → Text → RUN_FINISHED 正常显示。
- [ ] 页面刷新后已完成对话仍存在。
- [ ] 未知事件和未知工具不会导致页面崩溃。
- [ ] Service 和 Browser 事件顺序一致。
- [ ] 错误能够显示并结束 loading。
- [ ] 至少保存一份真实 SSE fixture 进入前端自动化测试。

## 10. 不阻塞首次文本联调的事项

以下可以在文本链路成功后继续完成：

- 全部 HITL 模式。
- Agent Group orchestration UI。
- A2UI Action 的完整业务闭环。
- 市场真实 API。
- Memory 正式后端。
- Task、Documents、Artifact 完整页面。

但其接口位置和消息 block 必须在首期架构中保留，禁止以“先写死文本 Chat”的方式实现。

## 11. 联调现场问题记录模板

```md
### 问题标题

- 时间：
- 环境：
- sessionId：
- threadId：
- runId：
- lastEventId：
- 期望事件：
- 实际事件：
- Service 原始 SSE：
- Runtime 接收事件：
- Browser 接收事件：
- 初步归属：Browser / Runtime / Service / Core
- 结论：

## 12. 2026-08-20 联合测试结果

已完成一次真实前后端联合端到端验证（AgentDock ↔ Copilot Runtime ↔ demo 后端 `/ag-ui` ↔ DeepSeek v4 flash），完整报告见 `design/11-e2e-joint-test-report.md`。

### 验收结果对照

| Case | 结论 | 说明 |
|---|---|---|
| Case 1 连接与 RUN_STARTED | ✅ | 浏览器经 Runtime 转发，后端沿用客户端 runId |
| Case 2 流式文本 | ✅ | TEXT_MESSAGE_* 逐段投影，完成态消息保留 |
| Case 3 RUN_FINISHED | ✅ | 退出 running、落库、历史刷新（事件驱动，消除竞态） |
| Case 4 Reasoning | ⚠️ 受限 | DeepSeek reasoning 加密，ag_ui-langgraph 0.0.40 无 REASONING 事件；组件渲染/自动折叠由 mock 流验证 |
| Case 5 Tool Call | ✅ | ls / render_a2ui 工具块（参数/结果/耗时/状态） |
| Case 6 错误 | ✅ 兜底 | `runAgent` 失败写 RUN_ERROR；停止→cancelled |
| Case 7 Stop | ✅ | 停止生成退出 running，保留部分内容 |
| Case 8 断线恢复 | ✅ 服务层 / ⚠️ 端到端 | demo 后端已实现 eventId 注入 + 游标回放（69 事件全带 eventId；resume 第 40 条精确回放 29 条、无重执行；未知 run→STREAM_EXPIRED）；CopilotKit single-route 纯尾回放受其 SSE 校验限制（须 RUN_STARTED 开头），真实接入用 agent/connect 或全量回放+去重（见 02 §10.5） |
| Case 9 HITL | ✅ 展示与请求 / ⚠️ 续跑 | 真实 interrupt（write_file）已触发：页面渲染 HitlBlock、批准携带真实 interruptId + decisions payload 到达后端；纯 deepagents 层 resume 后工具执行成功；ag_ui-langgraph 0.0.40 的 HTTP resume 映射与 langchain interrupt() 返回值约定不兼容，续跑执行需公司服务层实现/升级适配器（见 02 §8.2） |
| Case 10 A2UI | ✅ 单轮 | 指标卡片叶子节点渲染 + render_a2ui 工具块 + a2ui-surface 事件；多轮上下文受 DeepSeek 偏离影响 |

### 遗留项

- 断线恢复（eventId 游标）端到端注入测试。
- 真实 HITL wire 冻结（样本已抓取；续跑执行依赖公司服务层实现 resume 映射或升级 ag_ui-langgraph）。
- A2UI 多轮上下文稳定性（模型 forced tool_choice 偏离）。
- 刷新后 A2UI surface 持久化恢复。
```
