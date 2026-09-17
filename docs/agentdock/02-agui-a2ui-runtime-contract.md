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
- 使用统一 `runId`，支持基于 `eventId` 的断线恢复。
- 为 Agent Group delegation、Task 和 Artifact 保留标准扩展方式。

## 2. 服务链路与责任

```text
Browser / Headless Client
  production(proxy): POST /api/copilotkit（single-route envelope）→ Copilot Runtime 按 FAB → {orchestrationBaseUrl}/ag-ui
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

- 产生或提交 `runId`；生产只访问同源 App Server：Run 在 `forwardedProps.fab` 中声明 FAB，权威 Stop 在自有控制 API body 中声明 FAB。
- 提交当前 user message 和业务运行参数。
- 消费 CopilotKit 已归并的消息、state 和 activity。
- 渲染 LobeHub 风格消息、HITL 和 A2UI。
- 保存本地可见历史和恢复检查点。

### Copilot Runtime

- 生产 proxy 模式使用 single-route POST，并根据 FAB 路由（唯一真实传输；direct 直连联调已移除）。
- Browser 与 Runtime 之间使用官方 envelope：`{ method: "agent/run" | "agent/connect" | "agent/stop" | "info", params: { agentId, threadId }, body: RunAgentInput }`；只有 `body` 是标准 `RunAgentInput`。
- 负责 Catalog definitions、A2UI Middleware、Agent proxy 和 Browser-facing run/connect；原生 stop 只清理 CopilotKit 生命周期。
- 将 SSO 凭据安全传递到 Orchestration Service。
- 不修改标准 AG-UI 事件语义和关联 ID。
- Runtime Adapter 负责 run/connect；App Server 的无状态 Control Gateway 负责 cancel/status，并复用同一 FAB 白名单。

### Orchestration Service

- 校验请求和权限。
- 必须读取并沿用 `RunAgentInput.runId`，不得创建第二个 Run ID。
- 把任务发送给 Core。
- 监听 Redis 中相同 `runId` 的消息。
- 按 `eventId` 顺序输出 SSE。
- 支持从 `lastEventId` 后恢复。
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
    lastEventId: string;
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

> 该 JSON 是 `RunAgentInput`。生产 proxy 模式把它作为 `{ method: "agent/run", params: { agentId: "orchestration", threadId }, body: <本 JSON> }` 的 body 发送。

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

### 4.2 eventId

- 由 Orchestration Service/Redis Message Hub 产生。
- 在同一个 `runId` 内严格递增或严格有序。
- **必须字符串可排序**：resume 续传按 `eventId > lastEventId` 字符串比较过滤，序号必须定宽补零
  （建议 `{epoch_ms}-{seq:06d}`，如 `1723870000000-000042`）；未补零时 run 超过 9 个事件会漏事件。
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
    "eventId": "1723870000000-000000"
  }
}
```

### 4.3 messageId/toolCallId/surfaceId

- start/content/end 三段事件必须使用相同 `messageId`。
- tool start/args/end/result 必须使用相同 `toolCallId`。
- A2UI 同一 Surface 更新必须使用相同 `surfaceId`。
- ID 在对应 thread 内不可复用。

### 4.4 独立订阅的多 Session 事件路由

AgentDock 首期使用“一个活跃 Session 一个独立 Agent/SSE 订阅”，不要求普通内容事件重复携带 `sessionId`、`threadId` 或 `runId`：

- Browser 在发送前生成 `runId`，并把 `sessionId/threadId/runId` 固定到本地 Operation。
- `RUN_STARTED` 必须回显请求中的 `threadId + runId`，用于校验订阅与 Operation 未错配。
- 后续普通事件通过创建订阅时捕获的 `sessionId` 写入对应 Operation；禁止按当前页面 active Session 路由。
- 同一 Session 首期至多一个普通 active Run，因此无 `runId` 的内容事件可以安全归属该 Session 当前 Run。
- 如果后续改为多个 Run 共用一条连接，则每个 event envelope 必须增加 `runId/operationId`，本条独立订阅规则不再适用。
- 每个需要精确去重或断点续传的业务事件必须提供顶层 `eventId`；客户端不读取 `rawEvent.eventId`。

未来续传请求至少携带：

```json
{
  "threadId": "thread-001",
  "runId": "run-001",
  "afterEventId": "1723870000000-000042"
}
```

`afterEventId` 为 exclusive cursor。续传只能订阅并补发缺失事件，不得重新启动相同 `runId` 的 Agent。

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

心跳不进入 AG-UI event stream，不分配业务 `eventId`。

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

### 6.7 Browser 展示顺序与过程分段

- Browser 必须按业务事件首次到达的顺序维护单轮时间线，禁止在渲染层把 reasoning、tool、activity、step 和正文重新按类型分组。
- 相邻的 reasoning、tool call、普通 activity、workflow step 与 HITL 组成一个“过程段”；助手文本和 A2UI Surface 是正文段，也是过程段边界。
- 正文可以在一轮 run 中出现多次。页面必须保持 `过程 1 → 正文 1 → 过程 2 → 正文 2` 的真实顺序，刷新后从本地历史恢复时顺序不变。
- 流式期间只自动展开时间线上最后一个、且尚未被后续正文截断的过程段。正文开始后，前一个过程段立即自动折叠；后续过程段开始时只展开新过程段。
- Error Alert 与 A2UI Surface 属于用户可见输出，不收入过程折叠；`generate_a2ui` / `render_a2ui` 等仅服务于 Surface 的内部工具仍隐藏。
- 当前正式链路由 Agent 输出 `render_a2ui` 的 `TOOL_CALL_ARGS`，CopilotRuntime 的 A2UI Middleware 自动投影为
  `ACTIVITY_SNAPSHOT(activityType="a2ui-surface")`。Browser 同时兼容 Snapshot，以及其他 AG-UI adapter 通过 Delta 首次补齐
  `a2ui_operations/components` 以及未经过转换的完整 `render_a2ui` 参数；三者最终都只生成一个正文级 Surface。
- 同一事件实体的增量（例如 `TOOL_CALL_ARGS`、`ACTIVITY_DELTA`）更新该实体，不因每个 token/delta 重复创建卡片；顺序锚点取该可见实体首次出现的位置。

### 6.8 扩展

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

- 使用 AG-UI 标准 `RUN_FINISHED(outcome.type="interrupt")` 表示执行已暂停；不以 CustomEvent
  作为新链路的 HITL 主协议。
- 当前 SSE 在 interrupt 后正常关闭。用户回答通过下一次 `RunAgentInput.resume[]` 提交，该 POST
  返回新的 SSE，并继续原 `sessionId/threadId/runId` 与原 assistant row。
- 同一次 Event 的 `interrupts[]` 是一个原子 batch（1–8 项），每项必须拥有稳定
`interruptId`；存在顺序依赖的问题不得放进同一 batch。
- 同一张业务表单使用一个 `kind="form"` interrupt；数组主要承载并行 graph branch、子 Agent
  或其他真正独立的暂停点。
- UI 只支持 `confirm | text | choice | form` 四种紧凑 kind；组件、布局和按钮样式由前端确定。
- 用户取消、超时和 skip 必须形成明确状态，不能静默结束。
- 完整字段、校验和 fallback 规则见
  `design/20-hitl-v2-interaction-protocol.md`；本节是实时协议权威摘要。

### 8.2 标准 Event 与 Resume

```json
{
  "type": "RUN_FINISHED",
  "threadId": "thread-1",
  "runId": "run-100",
  "outcome": {
    "type": "interrupt",
    "interrupts": [{
      "id": "int-01JXYZ",
      "reason": "human_input_required",
      "message": "请选择需要重点分析的维度。",
      "metadata": {
        "hitl": {
          "kind": "choice",
          "multiple": true,
          "options": [
            { "value": "cost", "label": "成本" },
            { "value": "quality", "label": "质量" }
          ]
        }
      }
    }]
  }
}
```

`responseSchema` 在 AG-UI 0.0.57 中是 optional，本项目不逐 Event 发送。前后端使用同一个
固定判别联合校验 `metadata.hitl`，并在 resume 时结合数据库中的 pending spec 校验回答。

```json
{
  "resume": [{
    "interruptId": "int-01JXYZ",
    "status": "resolved",
    "payload": {
      "action": "submit",
      "answer": { "selected": ["quality"] }
    }
  }]
}
```

按钮无需后端逐次声明：confirm 固定为 continue，可选 revise/skip；其他 kind 固定为 submit，
可选 skip；所有 kind 均可 cancel。cancel 使用 `status="cancelled"` 且不带 payload。

若 `interrupts[]` 有多项，前端必须等待用户完成全部交互，再用一次请求提交 `resume[]`。
`resume[]` 按原顺序覆盖全部 pending ID，每个 ID 恰好一次；后端对整个 batch 原子校验、原子
恢复，禁止部分成功。正常提交全部为 resolved；取消整个 batch 全部为 cancelled，P0 不支持
两种 status 混合。遗漏、重复或未知 ID 返回 `HITL_INCOMPLETE_BATCH`，checkpoint 保持 paused。

### 8.3 Legacy 真实样本与迁移边界（2026-08-20 已抓取）

DeepAgents 0.7.5 `interrupt_on={"write_file": True}` + ag_ui-langgraph 0.0.40 + CopilotKit 0.1.94 的真实 wire（demo 后端实测）：

旧 DeepAgents 适配链路曾把 interrupt 以 Custom 事件暴露，而不是标准
`RUN_FINISHED(outcome=interrupt)`：

```json
{
  "type": "CUSTOM",
  "name": "on_interrupt",
  "value": {
    "action_requests": [{
      "name": "write_file",
      "args": { "file_path": "/tmp/x.txt", "content": "abc" },
      "description": "Tool execution requires approval\n\nTool: write_file\nArgs: {...}"
    }],
    "review_configs": [{ "action_name": "write_file", "allowed_decisions": ["approve","edit","reject","respond"] }],
    "id": "<真实 langgraph interrupt id，由 demo 从 checkpointer tasks[].interrupts 注入>",
    "message": "Tool execution requires approval..."
  }
}
```

旧 response 同样沿用 threadId/runId，通过 `RunAgentInput.resume` 恢复：

```json
{
  "resume": [{
    "interruptId": "<真实 id>",
    "status": "resolved",
    "payload": { "decisions": [{ "type": "approve" }] }
  }]
}
```

该结构只作为迁移期输入兼容，不允许成为新后端的输出格式。纯 deepagents 层 resume 后工具执行
成功；但 ag_ui-langgraph 0.0.40 曾把 ResumeEntry 列表原样传给 `Command(resume=...)`，导致再次
interrupt。公司 Orchestration Service 必须把标准 ResumeEntry 解包成底层图所需的 resume value，
或升级到已正确适配的版本。

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

官方路径：前端通过 `agent.connectAgent` 恢复，携带 `forwardedProps.action=resume` + `forwardedProps.resume.lastEventId`，并沿用相同 `runId/threadId`；`@ag-ui/client` transport 走 Runtime `agent/connect`。**已与后端冻结方向：按 eventId 游标恢复**。

自研路径（mock）Browser 保存：

```ts
{
  runId: string;
  latestEventId: string;
}
```

恢复时（自研路径）调用 Runtime connect，并在 forwarded props 中携带：

```json
{
  "action": "resume",
  "resume": {
    "lastEventId": "1723870000000-0"
  }
}
```

### 10.2 Runtime → Orchestration Service

Runtime Adapter 使用相同 `runId` 请求 `/ag-ui`（官方 `agent/connect`），透传 `lastEventId`；**Service 必须只返回游标之后的事件**（按 eventId 游标恢复，已冻结）。Redis event TTL 到期后的错误行为见 10.4。

### 10.3 去重

- Service 按 `eventId` 排序和恢复。
- Browser 对同一 `eventId` 去重。
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

### 10.5 实测补充（demo 后端，2026-08-20）

- demo 后端（`backend/streaming.py`）已实现：逐事件注入顶层 `eventId`（`{epoch_ms}-{seq}` 严格递增）、按 runId 内存缓冲（FIFO 上限 100 run）、`action=resume + lastEventId` 只回放游标后事件（不重新执行 Core）、未知 run 返回 `RUN_ERROR(STREAM_EXPIRED)`。
- 实测：首轮 69 事件全部带 eventId；resume（第 40 条游标）精确回放 29 条且无模型调用；未知 runId 返回 STREAM_EXPIRED。
- ⚠️ 经 CopilotKit single-route `agent/run` envelope 走纯尾回放时，runtime SSE 校验要求首事件为 `RUN_STARTED` 且以终态结束，纯尾回放会判 `INCOMPLETE_STREAM`。真实接入二选一：① 使用官方 `agent/connect`（lastSeenEventId）语义；② 全量回放（相同 eventId）+ Browser 按 eventId 去重（前端 reducer 已支持）。
- 前端当前策略：running checkpoint 有顶层 `latestEventId` 时，以相同 `runId` 发送 `action=resume + lastEventId`；没有游标时才安全终结为 cancelled。HITL(paused) 通过同一 Operation 的 `hitlResponse` 续跑。

## 11. Stop/Cancel

- Stop 是 Run 控制操作，不是 Chat Message；禁止发送 `message="Agent stop"` 或让模型解释停止意图。
- CopilotKit 原生 `agent/stop` 只有 `agentId + threadId`，缺少本项目权威取消需要的 `runId + fab`，因此只用于清理 Browser 流、frontend tools 与 CopilotKit 本地生命周期。
- Browser 必须另行调用 AgentDock 自有 `POST /api/agent-runtime/runs/{runId}/cancel`，body 显式携带 `sessionId/threadId/agentId/fab`；取消未立即完成时调用同一 Run 的 `/status`。
- AgentDock App Server 根据 body 的 `fab` 查询服务端白名单，转发至同一 FAB Orchestration 的 `POST /ag-ui/runs/{runId}/cancel|status`；不得保存或依赖 Runtime `threadId → runId/FAB` 映射。
- 关闭 Browser SSE/fetch 只属于即时 UX，不能作为后端停止的证据。Orchestration 必须登记真实 task handle/cancellation token，
  并通知 Core 停止 LLM stream、后续 loop、新 tool/step；长工具应实现 cancel hook 和超时。
- Orchestration cancel 接口必须幂等：`pending/running → cancel_requested → cancelled`；重复请求返回当前状态，不得误取消同 thread 的下一次 run。
- 权威终态统一为 `RUN_ERROR(code=CANCELLED)`，随后关闭流。已经产生的部分文本和 Artifact 保留并标记 interrupted；终态后不得继续写普通 content delta。
- Browser 应显示 `cancel_requested` 中间态；只有收到 cancel API 确认/终态后才宣称远端已停止。远端失败允许重试，不得只吞掉异常后伪造成功。
- 完整请求/响应、错误码、状态机、当前代码缺口和验收证据见 `design/19-run-control-and-html-artifact.md`。

### 11.1 Orchestration Cancel 请求

Browser-facing 契约、status 接口、错误码和关键实现见 `04-frontend-backend-api.md` §9.3 与 `design/19-run-control-and-html-artifact.md`。以下是 Gateway 转发到 Orchestration 的内部请求：

```http
POST {orchestrationBaseUrl}/ag-ui/runs/{runId}/cancel
Content-Type: application/json
```

```json
{
  "threadId": "thread-001",
  "agentId": "flight-analysis-agent",
  "reason": "user_requested",
  "mode": "interrupt",
  "requestedAt": "2026-09-09T10:00:00+08:00"
}
```

首次接受建议返回 HTTP 202：

```json
{
  "runId": "run-001",
  "threadId": "thread-001",
  "status": "cancel_requested",
  "accepted": true
}
```

接口必须校验 `runId + threadId + principal`。FAB 与上游地址从 run 启动记录读取，不能相信取消请求重新提交的 FAB。

### 11.2 代码预览（HTML / SVG / Mermaid / Markdown）

- 不定义 Artifact AG-UI 事件，也不要求 Agent、Orchestration 或 CopilotKit Runtime 转换前端展示协议。
- Agent 通过标准 `TEXT_MESSAGE_*` 返回 Markdown；显式 fenced `html/htm/svg/mermaid/markdown/md` 代码块在正文显示源码，工具栏提供“预览”。
- 完整代码块到达且右侧栏为空时自动打开；右侧栏已有内容时不切换、不覆盖。用户点击“预览”属于显式切换。
- 禁止根据普通正文里的零散标签模糊识别；单段预览 UTF-8 上限为 512 KiB，未闭合 fence 不触发预览。
- HTML 视为不受信代码：使用不带 `allow-same-origin/allow-scripts` 的 iframe sandbox，注入严格 CSP，并执行 sanitize。
- SVG 在主文档挂载前用 DOMPurify 清除脚本、事件、外链、内联 CSS 和 `foreignObject`；Mermaid/Markdown 复用 LobeHub renderer。
- A2UI 仍只承载 Catalog 约束的原生交互组件，与代码预览无关。

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
- [x]（2026-08-20 已抓取，见 §8.2）真实 HITL event fixture：CUSTOM(on_interrupt) + resume[] 约定；⚠️ ag_ui-langgraph 0.0.40 的 HTTP resume 映射与 langchain interrupt() 返回值约定不兼容，续跑执行需公司服务层实现/升级适配器。
- [ ] A2UI 由 Runtime Middleware 形成 Activity，还是 Core 已输出最终 Surface Activity；必须避免重复转换。
- [x]（demo 已实现 eventId 游标回放，见 §10.5）Copilot Runtime Adapter 的 connect 是否能取得 Browser 的 `lastEventId`——demo 侧已通；公司 connect 语义仍需验证。
- [ ] Stop 的最终事件采用 `RUN_ERROR/CANCELLED` 还是后端已有终止表达。
- [ ] Redis event log TTL 和最大单 Run 事件数（demo 为内存缓冲 FIFO 100 run，TTL 语义待公司服务确认）。
- [ ] Agent delegation 是已有 Tool Call、Activity，还是两者都有。
