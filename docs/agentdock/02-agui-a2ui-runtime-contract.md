# AgentDock ↔ Orchestration AG-UI/A2UI 运行时契约

> 状态：联调前必须评审  
> 文档版本：0.1  
> 日期：2026-08-17  
> 首次联调目标日期：2026-08-19

## 1. 契约目标

本文是 Browser、Copilot Runtime、Orchestration Service 和 Orchestration Core 之间的唯一实时通信契约。

目标：

- 单 Agent 文本流能够显示到 AgentDock 页面。
- reasoning、tool call、error 和 lifecycle 不丢失。
- Catalog 能到达 Core，A2UI 能形成并渲染 Surface。
- HITL 能暂停、展示用户操作并继续执行。
- 使用统一 `runId`，支持基于 `streamId` 的断线恢复。
- 为 Agent Group delegation、Task 和 Artifact 保留标准扩展方式。

## 2. 服务链路与责任

```text
Browser / Headless Client
  production(proxy): POST /api/copilotkit（single-route envelope）→ Copilot Runtime 按 FAB → {orchestrationBaseUrl}/ag-ui
  direct dev: 按 FAB POST {orchestrationBaseUrl}/ag-ui（自研 SSE client，body 为全文 RunAgentInput）
    ↓
Orchestration Service → text/event-stream
    ↓
Orchestration Core / DeepAgents / CopilotKitMiddleware
    ↓
Redis Message Hub
    ↓
Orchestration Service → Runtime → Browser
```

### Browser

- 产生或提交 `runId`；生产只访问同源 Runtime，并在 `forwardedProps.fab` 中声明 FAB。
- 提交当前 user message 和业务运行参数。
- 消费 CopilotKit 已归并的消息、state 和 activity。
- 渲染 LobeHub 风格消息、HITL 和 A2UI。
- 保存本地可见历史和恢复检查点。

### Copilot Runtime

- 生产 proxy 模式使用 single-route POST，并根据 FAB 路由；direct 联调模式不经过 Runtime。
- Browser 与 Runtime 之间使用官方 envelope：`{ method: "agent/run" | "agent/connect" | "agent/stop" | "info", params: { agentId, threadId }, body: RunAgentInput }`；只有 `body` 是标准 `RunAgentInput`。
- 负责 Catalog definitions、A2UI Middleware、Agent proxy 和 Browser-facing run/connect/stop。
- 将 SSO 凭据安全传递到 Orchestration Service。
- 不修改标准 AG-UI 事件语义和关联 ID。
- Runtime Adapter 负责把 connect/stop 映射到 Orchestration Service。

### Orchestration Service

- 校验请求和权限。
- 必须读取并沿用 `RunAgentInput.runId`，不得创建第二个 Run ID。
- 把任务发送给 Core。
- 监听 Redis 中相同 `runId` 的消息。
- 按 `streamId` 顺序输出 SSE。
- 支持从 `lastStreamId` 后恢复。
- 不丢弃、不合并、不重排未知事件或 `TOOL_CALL_ARGS`。

### Orchestration Core

- 根据 `agentId`、`fab`、`threadId` 和临时 Group 配置执行 Agent。
- DeepAgents 自己加载和保存上下文。
- 使用 CopilotKitMiddleware 获取 frontend tools、context 和 A2UI Catalog 能力。
- 输出标准 AG-UI BaseEvent。

## 3. 标准 RunAgentInput

Orchestration Service `/ag-ui` 接受标准 AG-UI `RunAgentInput`：

```ts
interface RunAgentInput {
  threadId: string;
  runId: string;
  parentRunId?: string;
  state: unknown;
  messages: Message[];
  tools: Tool[];
  context: Context[];
  forwardedProps: AgentDockForwardedProps;
}
```

### 3.1 AgentDockForwardedProps

```ts
interface AgentDockForwardedProps {
  sessionId: string;
  agentId?: string;
  fab: string;

  action: 'run' | 'resume' | 'stop' | 'hitlResponse' | 'a2uiAction';

  group?: {
    members: Array<{
      agentId: string;
      version?: string;
      fab: string;
    }>;
    orchestrationMode: string;
    config?: Record<string, unknown>;
  };

  resume?: {
    lastStreamId: string;
  };

  hitlResponse?: {
    requestId: string;
    mode: HitlMode;
    decision?: 'approve' | 'reject';
    editedArguments?: Record<string, unknown>;
    input?: string;
    selectedValues?: string[];
    formValues?: Record<string, unknown>;
  };

  a2uiAction?: {
    actionName: string;
    context?: Record<string, unknown>;
    sourceComponentId?: string;
    surfaceId: string;
  };
}
```

```ts
type HitlMode =
  | 'approveReject'
  | 'editArguments'
  | 'textInput'
  | 'singleSelect'
  | 'multiSelect'
  | 'form'
  | 'toolAuthorization'
  | 'custom';
```

### 3.2 单 Agent 请求示例

> 该 JSON 是 `RunAgentInput`。生产 proxy 模式把它作为 `{ method: "agent/run", params: { agentId: "orchestration", threadId }, body: <本 JSON> }` 的 body 发送；direct 联调模式直接 POST 到 `{fab}/ag-ui`。

```json
{
  "threadId": "thread-001",
  "runId": "9f338642-e569-42e1-8f91-a3e5fe22fc54",
  "state": {},
  "messages": [
    {
      "id": "message-user-001",
      "role": "user",
      "content": "请分析今天的飞行测试数据"
    }
  ],
  "tools": [],
  "context": [],
  "forwardedProps": {
    "action": "run",
    "sessionId": "session-001",
    "agentId": "flight-analysis-agent",
    "fab": "F15B"
  }
}
```

约束：

- `messages` 至少包含本次当前用户消息。
- 即使 Browser 发送了可见历史，Core 也不得把它当成唯一上下文来源；DeepAgents 使用 `threadId` 加载自己的上下文。
- `fab` 必填，必须是后端已授权的字符串。
- 单 Agent 时 `agentId` 必填，`group` 不传。
- Group 时 `group` 必填，可不传顶层 `agentId`。

## 4. 标识和幂等性

### 4.1 runId

- 由 AG-UI Client 产生或由调用者显式提交。
- 表示一次 Agent Run。
- Orchestration Service 和 Core 必须原样沿用。
- 同一个 `runId` 的重复 `action=run` 请求不得重复启动 Core 任务。
- `RUN_STARTED`、`RUN_FINISHED` 必须返回同一个 `runId`。

### 4.2 streamId

- 由 Orchestration Service/Redis Message Hub 产生。
- 在同一个 `runId` 内严格递增或严格有序。
- SSE 必须输出：

```text
id: 1723870000000-0
data: {"type":"TEXT_MESSAGE_CONTENT", ...}

```

- 为避免 Copilot Runtime/HttpAgent 忽略原始 SSE `id`，每个事件还必须在 `rawEvent` 中复制检查点：

```json
{
  "type": "TEXT_MESSAGE_CONTENT",
  "messageId": "message-assistant-001",
  "delta": "分析结果",
  "rawEvent": {
    "runId": "9f338642-e569-42e1-8f91-a3e5fe22fc54",
    "streamId": "1723870000000-0"
  }
}
```

### 4.3 messageId/toolCallId/surfaceId

- start/content/end 三段事件必须使用相同 `messageId`。
- tool start/args/end/result 必须使用相同 `toolCallId`。
- A2UI 同一 Surface 更新必须使用相同 `surfaceId`。
- ID 在对应 thread 内不可复用。

## 5. SSE 与事件格式

响应：

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

每一个 SSE frame 的 `data:` 必须是一个完整 JSON BaseEvent。禁止把一个 JSON 拆到多个 SSE frame。

可以周期性发送 SSE 注释作为心跳：

```text
: heartbeat

```

心跳不进入 AG-UI event stream，不分配业务 `streamId`。

## 6. 首期必须支持的标准事件

### 6.1 Run 生命周期

- `RUN_STARTED`
- `RUN_FINISHED`
- `RUN_ERROR`
- `STEP_STARTED`
- `STEP_FINISHED`

最小合法文本流：

```jsonl
{"type":"RUN_STARTED","threadId":"thread-001","runId":"run-001"}
{"type":"TEXT_MESSAGE_START","messageId":"assistant-001","role":"assistant"}
{"type":"TEXT_MESSAGE_CONTENT","messageId":"assistant-001","delta":"你好"}
{"type":"TEXT_MESSAGE_END","messageId":"assistant-001"}
{"type":"RUN_FINISHED","threadId":"thread-001","runId":"run-001"}
```

### 6.2 文本消息

- `TEXT_MESSAGE_START`
- `TEXT_MESSAGE_CONTENT`
- `TEXT_MESSAGE_END`
- 可选 `TEXT_MESSAGE_CHUNK`；Runtime/Client 必须能展开成标准三段事件。

### 6.3 Reasoning

- `REASONING_START`
- `REASONING_MESSAGE_START`
- `REASONING_MESSAGE_CONTENT`
- `REASONING_MESSAGE_END`
- `REASONING_MESSAGE_CHUNK`
- `REASONING_END`
- `REASONING_ENCRYPTED_VALUE`

不得再设计新的 Thinking 事件；旧 Thinking 事件只在兼容适配器中处理。

### 6.4 Tool Call

- `TOOL_CALL_START`
- `TOOL_CALL_ARGS`
- `TOOL_CALL_END`
- `TOOL_CALL_RESULT`
- 可选 `TOOL_CALL_CHUNK`。

工具参数必须是连续 JSON 字符串增量，Runtime 在完整累积后解析。

### 6.5 State 和消息快照

- `STATE_SNAPSHOT`
- `STATE_DELTA`
- `MESSAGES_SNAPSHOT`

State Delta 使用 RFC 6902 JSON Patch。

### 6.6 Activity

- `ACTIVITY_SNAPSHOT`
- `ACTIVITY_DELTA`

用于长生命周期、可增量更新的 Agent delegation、Task、Plan 和 A2UI Surface，不用文本消息模拟结构化状态。

### 6.7 扩展

- `CUSTOM`
- `RAW`

未知 Custom 事件必须透传；Browser 可以忽略但不能使 Run 失败。

## 7. Agent delegation 契约

优先使用 Activity 表达可持续更新的委派状态：

```json
{
  "type": "ACTIVITY_SNAPSHOT",
  "messageId": "activity-delegation-001",
  "activityType": "agentDock.agentDelegation",
  "content": {
    "parentAgentId": "supervisor-agent",
    "targetAgentId": "research-agent",
    "targetAgentName": "Research Agent",
    "orchestrationMode": "supervisor",
    "task": "检索飞行测试资料",
    "status": "running",
    "startedAt": "2026-08-19T09:00:00+08:00"
  }
}
```

更新：

```json
{
  "type": "ACTIVITY_DELTA",
  "messageId": "activity-delegation-001",
  "activityType": "agentDock.agentDelegation",
  "patch": [
    { "op": "replace", "path": "/status", "value": "completed" }
  ]
}
```

如果 delegation 本身就是 Agent 的真实 Tool Call，仍输出标准 Tool Call；Activity 用于 LobeHub 风格持续工作流展示，两者通过 `toolCallId` 或 content metadata 关联。

## 8. HITL 契约

### 8.1 原则

- 优先使用 CopilotKit/DeepAgents 集成原生 interrupt/tool lifecycle。
- AgentDock UI 归一化支持全部 `HitlMode`。
- HITL request 必须拥有稳定 `requestId`，重复响应必须幂等。
- HITL UI 未完成前不得发出 `RUN_FINISHED`。
- 用户取消、超时和拒绝必须形成可显示结果，不能静默结束。

### 8.2 联调前必须抓取真实事件

DeepAgents + CopilotKitMiddleware 的具体 interrupt wire shape 与版本相关。后端必须提供一次真实事件样本，前后端据此确认：

- interrupt 是 Tool Call、Activity 还是 Custom 事件。
- response 是同一 Run 恢复还是新 Run + `parentRunId`。
- approve/reject、编辑参数、输入、单选、多选和表单的字段位置。

在真实事件确定前，禁止再创建一套与 CopilotKit 平行的最终 HITL 网络协议。本节 `hitlResponse` 仅作为 Orchestration Adapter 的归一化后备结构。

## 9. A2UI 契约

### 9.1 Catalog

- Browser 注册 Catalog ID、definitions 和 React renderers。
- 只有可序列化 definitions/description 发送到 Core。
- React renderer 不离开 Browser。
- Core 只能生成 Catalog 中允许的组件。

### 9.2 Dynamic A2UI 事件

Core/中间件必须形成：

```jsonl
{"type":"TOOL_CALL_START","toolCallId":"a2ui-tool-001","toolCallName":"render_a2ui"}
{"type":"TOOL_CALL_ARGS","toolCallId":"a2ui-tool-001","delta":"{\"surfaceId\":\"surface-001\",\"catalogId\":\"agentdock://catalog\","}
{"type":"TOOL_CALL_ARGS","toolCallId":"a2ui-tool-001","delta":"\"components\":[...],\"data\":{...}}"}
{"type":"TOOL_CALL_END","toolCallId":"a2ui-tool-001"}
```

约束：

- 工具名使用当前锁定版本约定的 `render_a2ui`。
- Middleware 从 `TOOL_CALL_ARGS` 累积参数并建立 Surface。
- 不能只把 A2UI JSON 放在普通文本或最终 `TOOL_CALL_RESULT` 中。
- Orchestration Service 不解析 A2UI，不合并 args delta。
- 官方 `CopilotRuntime({ a2ui: {} })` 的 A2UI Middleware 会把 `render_a2ui` 流式参数转换为 `ACTIVITY_SNAPSHOT(activityType="a2ui-surface", content={ a2ui_operations })`，前端 Provider `a2ui={{ catalog }}` 自动渲染。

### 9.3 A2UI Action

用户点击 A2UI 组件时必须携带：

```json
{
  "surfaceId": "surface-001",
  "sourceComponentId": "approve-button",
  "actionName": "approve_plan",
  "context": {
    "planId": "plan-001"
  }
}
```

如果 Action 触发新的 Agent 执行：

- 使用同一 `threadId`。
- 产生新的 `runId`。
- `parentRunId` 指向产生该 Surface 的 Run。

> 官方 wire：中间件读取 `forwardedProps.a2uiAction.userAction`（`{ surfaceId, sourceComponentId, actionName, context, ... }`），前端由 A2UI renderer 的 action bridge 自动发送；自研后备路径才使用本节的平铺 `forwardedProps.a2uiAction`。

## 10. 断线恢复

### 10.1 Browser → Runtime

官方路径：前端通过 Runtime 的 `agent/connect` 恢复（`@ag-ui/client` transport 自动处理）；`lastStreamId` 仅作为后端可选检查点语义保留，是否支持由 Orchestration 决定。

自研路径（mock/direct）Browser 保存：

```ts
{
  runId: string;
  latestStreamId: string;
}
```

恢复时（自研路径）调用 Runtime connect，并在 forwarded props 中携带：

```json
{
  "action": "resume",
  "resume": {
    "lastStreamId": "1723870000000-0"
  }
}
```

### 10.2 Runtime → Orchestration Service

Runtime Adapter 使用相同 `runId` 请求 `/ag-ui`（官方 `agent/connect`）；若双方约定支持 `lastStreamId`，Service 只返回游标之后的事件。联调前必须确认 Orchestration 的 connect 语义（整场重放 vs 游标恢复）。

### 10.3 去重

- Service 按 `streamId` 排序和恢复。
- Browser 对同一 `streamId` 去重。
- Message reducer 对同一 `messageId/toolCallId` 幂等。
- 重放 `TEXT_MESSAGE_CONTENT` 时不能重复拼接已经持久化的 delta。

### 10.4 事件保留

后端必须明确 Redis event log TTL。TTL 到期后恢复请求返回结构化错误：

```json
{
  "type": "RUN_ERROR",
  "message": "The event stream has expired and cannot be resumed.",
  "code": "STREAM_EXPIRED"
}
```

## 11. Stop/Cancel

- Browser stop 调用 Copilot Runtime stop。
- Runtime Adapter 通知 Orchestration Service。
- Service 通知 Core 取消对应 `runId`。
- 取消后返回 `RUN_ERROR(code=CANCELLED)` 或双方最终确认的标准终止事件。
- 取消必须停止继续写入普通 content delta。
- 是否保留已经产生的部分文本：保留并标记 interrupted。

## 12. 错误码建议

| code | 含义 |
|---|---|
| `INVALID_REQUEST` | 请求字段不合法 |
| `UNAUTHORIZED` | SSO 未通过 |
| `AGENT_NOT_FOUND` | Agent 不存在 |
| `AGENT_PERMISSION_DENIED` | Agent/version/FAB 无权限 |
| `RUN_ALREADY_EXISTS` | 同一 runId 冲突且不能幂等恢复 |
| `RUN_NOT_FOUND` | 恢复或取消时找不到 Run |
| `STREAM_EXPIRED` | Redis 事件已过期 |
| `CANCELLED` | 用户取消 |
| `HITL_TIMEOUT` | HITL 超时 |
| `A2UI_INVALID_PAYLOAD` | A2UI Schema/Catalog 不合法 |
| `INTERNAL_ERROR` | 未分类服务错误 |

错误不得包含模型密钥、内部 Prompt、Redis 地址或堆栈敏感信息。

## 13. 事件完整性规则

- 每个 Run 恰好一个 `RUN_STARTED`。
- 成功 Run 恰好一个 `RUN_FINISHED`。
- 失败 Run 至少一个 `RUN_ERROR`，随后关闭流。
- 每个 Message Start 必须有匹配 End，除非 Run Error/Cancel。
- 每个 Tool Start 必须有匹配 End；有执行结果时再发 Result。
- A2UI `TOOL_CALL_ARGS` 必须能按顺序拼成合法 JSON。
- Event JSON 中的 `runId/threadId/messageId/toolCallId` 不得在中间层改写。
- Service 未识别事件时原样透传。

## 14. 联调前待冻结项

以下不是创建前端项目的阻塞项，但必须在对应功能联调前确认：

- [ ] DeepAgents + CopilotKitMiddleware 真实 HITL event fixture。
- [ ] A2UI 由 Runtime Middleware 形成 Activity，还是 Core 已输出最终 Surface Activity；必须避免重复转换。
- [ ] Copilot Runtime Adapter 的 connect 是否能取得 Browser 的 `lastStreamId`。
- [ ] Stop 的最终事件采用 `RUN_ERROR/CANCELLED` 还是后端已有终止表达。
- [ ] Redis event log TTL 和最大单 Run 事件数。
- [ ] Agent delegation 是已有 Tool Call、Activity，还是两者都有。
