# AG-UI 协议实现（现状、事件矩阵、与官方差距）

> 状态：方案 A 已落地（官方 single-route envelope）；自研 runStore/reducer 仅保留给 mock。事件协议基线见 `docs/agentdock/02-agui-a2ui-runtime-contract.md`
> 规范来源：<https://docs.ag-ui.com/sdk/js/core/types>、CopilotKit Runtime 文档

## 1. 标准 RunAgentInput

```ts
type RunAgentInput = {
  threadId: string;
  runId: string;
  parentRunId?: string;
  state: any;
  messages: Message[];
  tools: Tool[];
  context: Context[];
  forwardedProps: any;
};
```

当前 `src/api/runtime/types.ts` 与该结构对齐（`forwardedProps` 有 AgentDock 扩展类型）。

角色（AG-UI 标准）：`developer | system | assistant | user | tool | activity | reasoning`。当前 `RuntimeMessage` 只有 `assistant | system | tool | user`，reasoning/activity 由 reducer 用独立 map 存放，不进入 messages —— 这是“自研投影”设计，与官方 headless（messages 包含 reasoning/activity 角色）不同，见 `design/06`。

## 2. 事件解析（当前实现）

对话实时传输只有 proxy（官方 CopilotKit transport 解析 SSE）；`direct` 自研 SSE 解析器
（`sse.ts`）已随 direct 模式移除。`eventId` 由 `rawEvent.eventId` 携带，mock 路径直接透传。

已知问题：

| # | 问题 | 影响 | 优先级 |
|---|---|---|---|
| S1 | 流结束时有残留但无 `\n\n` 结尾的 frame 会被静默丢弃 | 若后端最后一条事件不带空行会丢事件 | P1 |
| S2 | 不解析 `event:` 字段（AG-UI 不需要，但官方 runtime 可能带） | 与官方 runtime 兼容性 | P1 |
| S3 | `JSON.parse` 失败直接抛错中断整个流 | 单个坏事件应跳过并记日志 | P1 |

## 3. 事件矩阵：标准事件 vs 当前 reducer

事件分类与 `src/api/runtime/runReducer.ts` 的处理：

| 事件 | 标准 | 当前处理 | 渲染 | 优先级 |
|---|---|---|---|---|
| `RUN_STARTED` | ✓ | status=running | 运行状态 | 完成 |
| `RUN_FINISHED` | ✓ | status=success | 结束态 | 完成 |
| `RUN_ERROR` | ✓ | status=error/cancelled + error | ErrorBlock | 完成 |
| `STEP_STARTED` | ✓ | steps map + orderedBlocks | WorkflowStepsBlock | ✅ |
| `STEP_FINISHED` | ✓ | steps map + orderedBlocks | WorkflowStepsBlock | ✅ |
| `TEXT_MESSAGE_START/CONTENT/END` | ✓ | messages map 拼接 | ChatItem + Markdown | ✅ |
| `TEXT_MESSAGE_CHUNK` | 兼容 | 追加 delta | 同上 | 完成 |
| `REASONING_MESSAGE_START/CONTENT/END/CHUNK` | ✓ | reasoning map | ReasoningBlock | 完成（样式 P1） |
| `REASONING_START/END` | ✓ | 忽略 | — | P1（生命周期状态） |
| `REASONING_ENCRYPTED_VALUE` | ✓ | 忽略 | — | P2 |
| `TOOL_CALL_START` | ✓ | toolCalls map | ToolCallBlock | 完成 |
| `TOOL_CALL_ARGS` | ✓ | 连续拼接 | 展开可见 | 完成 |
| `TOOL_CALL_END` | ✓ | status=called | 状态标签 | 完成 |
| `TOOL_CALL_RESULT` | ✓ | status=completed + result | 展开可见 | 完成 |
| `STATE_SNAPSHOT` | ✓ | state=snapshot | 无 UI | P1（可诊断面板） |
| `STATE_DELTA` | ✓ | RFC6902 子集 | 无 UI | P1 |
| `MESSAGES_SNAPSHOT` | ✓ | 覆盖 messages | 渲染 | 完成 |
| `ACTIVITY_SNAPSHOT` | ✓ | activities map + orderedBlocks；HITL→paused；a2ui.surface/a2ui-surface→surfaces | HITL/Activity/A2UI | ✅（官方 renderer + stored fallback） |
| `ACTIVITY_DELTA` | ✓ | 浅合并 patch | 无 UI | P1 |
| `CUSTOM` / `RAW` | ✓ | rawEvents | 无 UI | P2 |

## 4. 去重与恢复

- `processedEventIds` 数组 + `latestEventId`；同 eventId 幂等。
- 每次事件后 `sessionHistoryService.saveRunCheckpoint` 写 IndexedDB（messages + checkpoints）。
- 刷新恢复：`restoreSession` → 若 `status === 'running'` 且 `latestEventId` 存在 → `resume`（`action=resume`, `resume.lastEventId`）。

注意：`ACTIVITY_DELTA` 目前是 `{...prev, ...patch}` 浅合并，RFC 6902 的 remove/replace 语义不完整；`STATE_DELTA` 只处理顶层 key。真实后端若使用嵌套 path，需要增强。

## 5. 现状 vs 官方 CopilotKit Runtime

### 5.1 官方 single-route envelope（已核实源码）

```json
{
  "method": "agent/run",
  "params": { "agentId": "orchestration", "threadId": "thread-1" },
  "body": { /* RunAgentInput */ }
}
```

合法 method：`agent/run`、`agent/suggest`、`agent/connect`、`agent/stop`、`info`、`inspector/metadata`、`transcribe`。

官方多路由：

```text
GET  {basePath}/info
POST {basePath}/agent/:agentId/run
POST {basePath}/agent/:agentId/connect
POST {basePath}/agent/:agentId/stop/:threadId
POST {basePath}/transcribe
```

前端通过 `useSingleEndpoint` 或 runtime info 自动探测决定 transport。

### 5.2 当前 AgentDock

- 生产 proxy：官方 `@copilotkit/react-core/v2` transport 发送 envelope，`useAgentDockConversation` 消费 `agent.subscribe` 事件。
- Runtime：`server/index.ts` 挂载 `createCopilotRuntimeHandler`（single-route）+ `FabRoutingAgent`；`/info` 已验证。
- mock：自研 `runReducer + runStore`，body 为全文 `RunAgentInput`。

### 5.3 决策建议

方案 A（已落地）：官方 `@copilotkit/runtime` + headless client；`server/index.ts` single-route + `FabRoutingAgent`；前端 `useAgent`/`useCopilotKit`，`useOfficial` 仅在 http+proxy 生效。

方案 B（仅本地/Mock 过渡）：自研 client/reducer，“直接 RunAgentInput 全文转发”；后端 `/ag-ui` 必须接受相同 body。生产不采用（OAuth2 Proxy 无按 FAB 路由能力，见 `design/08` §7.0）。

**事件语义、runId 回显、eventId 透传不可改变。**

## 6. 缺口与行动项

| # | 缺口 | 优先级 |
|---|---|---|
| A1 | ~~STEP 消费与渲染~~ | ✅ WorkflowStepsBlock |
| A2 | ~~Markdown 渲染~~ | ✅ `Markdown.tsx` |
| A3 | ~~官方 envelope/transport~~ | ✅ single-route + headless |
| A4 | SSE 残留 frame 处理、坏事件跳过、event: 字段（仅影响自研 mock 路径） | P1 |
| A5 | STATE_DELTA / ACTIVITY_DELTA 完整 RFC6902 path 支持 | P1 |
| A6 | reasoning 生命周期（REASONING_START/END）与流式状态 | P1 |
| A7 | Custom/RAW 事件可诊断面板（非白屏） | P2 |
