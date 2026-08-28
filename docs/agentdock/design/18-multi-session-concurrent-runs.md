# AgentDock 多 Session 并发 Run：生产实现说明

> 状态：已实现并投入生产验收
>
> 最后更新：2026-08-28
> 适用范围：Browser App、CopilotKit v2 Headless、AG-UI SSE、Dexie IndexedDB

本文描述当前代码的真实行为，是多 Session Run 的维护依据。协议或实现变化时必须同步更新本文。

## 1. 用户侧保证

- Session A 运行时切换到 Session B，不会卸载或停止 A。
- A、B 可以同时运行，各自接收、归约和持久化自己的 AG-UI 事件。
- 后台 Session 收到 `RUN_FINISHED`、`RUN_ERROR` 或取消终态后，会独立退出运行状态。
- 切回后台 Session 时，立即显示该 Session 的最新状态；终态落库后显示完整历史，输入框恢复发送按钮。
- `stop`、HITL 响应和 A2UI Action 只作用于所属 Session。
- 同一个 Session 同时最多有一个 `booting/running/paused` Run；不同 Session 可以并发。

## 2. 当前架构

```text
ChatPage / GroupChatPage（只负责当前 Session 的视图）
        │
        ▼
useAgentDockConversation（薄 facade + 当前 Session selector）
        │
        ▼
sessionOperationService（命令、事件路由、终态与资源清理）
        ├── sessionOperationStore（Zustand 可观察热状态）
        ├── sessionRuntimeRegistry（Worker 命令句柄与有超时的 ready waiter）
        └── sessionHistoryService（Dexie 历史、checkpoint、分页）
                    ▲
                    │ register / unregister
SessionRuntimeHost（CopilotKit Provider 内、BrowserRouter 页面之外）
        ├── SessionRuntimeWorker A：useAgent + subscribe + runAgent
        ├── SessionRuntimeWorker B：useAgent + subscribe + runAgent
        └── SessionRuntimeWorker N：useAgent + subscribe + runAgent
```

实际文件：

- `src/app/providers.tsx`
- `src/features/chat/runtime/SessionRuntimeHost.tsx`
- `src/features/chat/runtime/sessionOperationService.ts`
- `src/features/chat/runtime/sessionRuntimeRegistry.ts`
- `src/features/chat/useAgentDockConversation.ts`
- `src/stores/sessionOperationStore.ts`
- `src/api/runtime/runReducer.ts`
- `src/api/session/sessionHistoryService.ts`

核心边界：页面只选择 Session 状态，不拥有 Agent、订阅或网络流。路由切换可以卸载 ChatPage，但 `SessionRuntimeHost` 仍然存在，因此后台 Worker 继续运行。

## 3. ID 与 AG-UI 契约

| ID | 产生方 | 用途 |
|---|---|---|
| `sessionId` | AgentDock | 页面路由、本地历史、运行隔离 |
| `threadId` | AgentDock | Agent 对话线程 |
| `runId` | AgentDock Browser | 一次执行、幂等、事件归属、续传 |
| `operationId` | AgentDock | `runId` 的内部同值别名 |
| `eventId` | Agent 后端 / Event Hub | 事件去重和 checkpoint 游标 |

固定关系：`operationId === runId`。

真实事件契约：

```ts
interface AgUiEvent {
  type: string;
  eventId?: string; // 顶层字段
  runId?: string;
  threadId?: string;
}
```

`eventId` 位于事件顶层，不读取 `rawEvent.eventId`。每个需要支持精确去重或断点续传的业务事件都应携带稳定、单调可续传的顶层 `eventId`。

CopilotKit subscriber 的 `input.runId/input.threadId` 是客户端 Operation 的权威路由。`bindEventToRun` 会把事件绑定到这两个 ID；即使上游返回不同 ID，也不会把终态写入其他 Session。

普通内容事件不要求携带 `sessionId`。Worker 创建时已经捕获 `const route = { sessionId, threadId }`，所以事件路由不读取当前页面的 Session，也不会因用户切换页面而串流。

## 4. Run 生命周期

### 4.1 创建与发送

1. `send` 在网络请求前生成唯一 `runId`。
2. `startOperation` 创建 `RuntimeRunState`，先投影用户消息。
3. Store 写入 `operationsById[runId]`、`activeRunBySession[sessionId]` 和 `runtimeBySession[sessionId]`。
4. Worker 完成历史水合后向 Registry 注册 handle。
5. `dispatchOperation` 调用该 Session Worker 的 `runAgent`。

同 Session 已有 busy Operation 时拒绝重复发送；其他 Session 不受影响。

### 4.2 独立订阅与事件路由

每个 Worker 创建自己的 `agent.subscribe()`。所有 callback 都经过：

```text
subscriber input 绑定 run/thread
  → resolveOperation(route, event)
  → 校验 session/thread/active run
  → reduceRunEvent
  → 更新 hot snapshot
  → 按 runId 调度 checkpoint
  → 50ms 节流发布 React 投影
```

终态事件立即发布，不等待 50ms 节流，因此输入框不会在后端已经结束后继续显示虚运行。

如果 CopilotKit 的 `runAgent()` 已正常 resolve、但适配层没有转发 `RUN_FINISHED`，`finalizeOperationAfterStreamClosed` 只会给“同一个、仍为 running、未停止”的 Operation 合成成功终态。它不会覆盖 `RUN_ERROR`、取消、paused HITL、已删除 Operation 或同 Session 的新 Run。

### 4.3 HITL 与停止

- HITL 活动把所属 Run 置为 `paused`。
- 响应前先持久化“恢复中”的 running checkpoint，缩小刷新窗口。
- 恢复请求失败会回滚为 `paused`，允许用户重试。
- 用户停止按 `runId` 去重，重复点击只调用一次远端 stop；UI 先立即进入本地取消终态。
- 远端 stop 最长等待 10 秒，超时后释放本地 stop Promise，不会永久阻塞删除与清理。
- 远端 stop 即使失败，本地仍可靠进入 `cancelled`，且不会向 UI 泄漏未处理 Promise rejection。
- `stoppingRuns` 防止流关闭兜底把取消误改为成功。

### 4.4 终态与历史

`RUN_FINISHED/RUN_ERROR/CANCELLED` 到达后：

1. reducer 生成终态 snapshot；
2. UI 立即退出运行态；
3. `completeOperation` 按该 `runId` flush；
4. 文本和过程块写入 `sessionMessages`；
5. 终态 checkpoint 删除，历史消息成为刷新后的权威来源；
6. 热 Operation 延迟释放。

不同 Run 的 checkpoint timer、最大等待 timer 和写链全部按 `runId` 分槽，同一 Run 串行写，不会发生 A 的旧 running 写在新终态之后并复活 checkpoint。

## 5. 刷新与断点恢复

运行中 checkpoint 保存原始 `runId/threadId/sessionId`、snapshot、顶层 `latestEventId`、`processedEventIds` 和恢复所需的压缩 input。

刷新后：

- `paused` checkpoint 恢复 HITL UI，使用 checkpoint 的权威 thread/agent 上下文。
- `running` 且有 `latestEventId` 时，以同一个 `runId` 发送：

```ts
forwardedProps: {
  action: 'resume',
  resume: { lastEventId: checkpoint.latestEventId }
}
```

- `running` 但没有游标时无法安全续传，客户端将其终结为 `cancelled`。
- 后端必须支持 `runId + lastEventId` 的剩余事件回放；前端 IndexedDB 不能替代服务端事件日志。
- `processedEventIds` 对服务端可能重放的重叠事件做幂等去重。

## 6. 有界内存与清理策略

### 6.1 Operation / Worker 上限

- 每个 Session 开始新 Run 时，上一终态 Run 的热快照立即释放；完整内容已由 IndexedDB 历史接管。
- 正常持久化成功：终态 Operation 保留 30 秒，供 live UI 平滑切换到历史。
- 连续三次持久化失败：终态最多保留 5 分钟，之后仍释放，避免存储故障永久占用 Worker。
- 全局最多保留 50 个终态 Operation；超过时按完成时间淘汰最旧项。
- running/paused Operation 不按终态缓存淘汰，因为它们是正在工作的资源，不属于泄漏。
- 删除 Session（包括跨标签页删除）会清理该 Session 的全部 Operation，而不只 active Run。

释放路径会清理：

- Zustand `operationsById/activeRunBySession/runtimeBySession`
- `hotSnapshots`
- render/cleanup timers
- mock `AbortController`
- Registry handle 与 ready waiters
- Worker unmount 后的 CopilotKit subscription

`whenReady` 最长等待 15 秒；reset、停止启动阶段 Run 或删除 Session 会立即拒绝 waiter，不留下永久 Promise。

### 6.2 单 Run 数据上限

| 资源 | 上限 | 说明 |
|---|---:|---|
| `rawEvents` | 100 | 仅保存小型诊断元数据；不复制 payload，不落 checkpoint |
| `processedEventIds` | 5000 | 重放去重窗口 |
| Worker 历史水合 | 最近 200 条用户/助手文本 | 完整历史仍在 IndexedDB |
| `MESSAGES_SNAPSHOT` live 投影 | 最近 200 条可见消息 | 防止全量快照导致每 token 巨量 clone |
| Chat 历史首屏 | 分页加载 | “加载更早消息”按完整 Run 向上追加 |

持久化历史本身不是内存缓存，会随用户数据增长；设置页提供容量检测、导出和级联清理。checkpoint 会裁剪 `rawEvents/state/context/tools`，只保存渲染与恢复必需数据。

### 6.3 React 资源

- Worker subscription 在 unmount 时 `unsubscribe()`。
- Session/Run 变化时清空自动审批 request ID 集合。
- 终态自动贴底的 interval 与 12 秒 timeout 都在 effect cleanup 中释放。
- Mutation/Resize observer、工具耗时 interval 和状态托盘 interval 均有 cleanup。

## 7. UI 状态规则

ChatPage 只使用 `selectSessionRun(sessionId)`。输入框规则：

```text
running / paused  → 停止按钮
success / error / cancelled / 无 live run → 发送按钮
```

历史加载不启用流式动画；只有当前 live Run 使用 `enableStream`。终态落库事件包含 `sessionId/runId/status`，页面只刷新自己的 Session。

`ACTIVITY_SNAPSHOT / ACTIVITY_DELTA` 会按事件顺序进入 `orderedBlocks`。除 A2UI Surface、错误和 HITL 使用专用组件外，所有普通 Activity（不要求 `activityType` 以 `agentDock.` 开头）都显示为助手过程折叠区内的任务卡片；实时态和 IndexedDB 历史态遵循同一规则。

## 8. 明确非目标与运行边界

- 不支持同一 Session 内两个普通 Run 并发。
- 浏览器标签页关闭后，前端 Worker 不会继续执行；能否恢复取决于后端 Run 和事件日志是否仍存在。
- 不支持多个浏览器标签页同时拥有同一个 Run；BroadcastChannel 只同步历史变化和删除通知，不是分布式锁。
- 不支持跨设备无缝接管；需要服务端运行所有权、鉴权和 durable event log。
- 活跃并发 Run 数是容量规划问题，不按终态缓存规则淘汰。生产环境应结合 Agent 后端并发配额、浏览器性能和产品策略限制入口。

## 9. 回归测试矩阵

核心测试位于：

- `src/features/chat/sessionOperationStore.test.ts`
- `src/api/runtime/runReducer.test.ts`
- `src/api/session/sessionHistoryService.test.ts`
- `src/api/session/sessionStorageService.test.ts`

必须覆盖：A/B 独立路由与迟到事件隔离、顶层 `eventId` 终态、stream 关闭兜底、error/cancelled/paused、防重复 stop、HITL/stop 竞态、checkpoint 恢复、删除清理、终态缓存上限、历史水合上限和 snapshot live 投影上限。

提交前最低门槛：

```bash
pnpm test
pnpm build
git diff --check
```

涉及 UI 状态机时，还应在 `http://127.0.0.1:3000/chat/` 验证：单 Session 完成、多 Session 后台完成、切回后完整答案和发送按钮、浏览器控制台无错误。
