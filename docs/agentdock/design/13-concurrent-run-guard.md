# 并发 run 防护与客户端流中断恢复（2026-08-20）

> 状态：历史问题记录；当前实现见 `18-multi-session-concurrent-runs.md`
> 关联：`sessionOperationService.ts`、`server/copilot-runtime/fabRoutingAgent.ts`

## 1. 现象

后端日志偶发同一时刻两个 `/ag-ui` POST；浏览器控制台出现 `agent_run_failed: network error`；页面可能停留在“停止生成”状态。

## 2. 根因

1. **客户端重试/重复发送**：CopilotKit `runAgent` 在流中断时可能重发同一 run（相同 runId），形成重复上游执行；UI 的 `running` 门禁存在状态延迟，快速连发可能穿透。
2. **旧版刷新后 resume 重放**：旧 demo 后端没有 Redis 事件日志/eventId 游标，resume 会重放整轮对话并再次触发上游执行。当前后端与前端已改为顶层 `eventId + lastEventId` 增量续传。
3. **流中断后 UI 卡死**：`runAgent` 抛错未被处理，run 状态停在 running。

## 3. 修复

### 3.1 Hook 层防重入（useAgentDockConversation）

官方与 mock 两条 `send()` 路径都在开头检查 `run.status === 'running' | 'paused'`，命中直接忽略新发送，与 ChatInput 按钮门禁形成双保险。

### 3.2 Runtime 幂等守卫（fabRoutingAgent.ts）

```ts
const inFlightRuns = new Map<string, string>(); // `${threadId}:${runId}` -> fab
if (isRunAction && inFlightRuns.has(key)) throw new Error(`FAB_DUPLICATE_RUN: ${runId}`);
if (isRunAction) inFlightRuns.set(key, fab);
return upstream.run(input).pipe(finalize(() => inFlightRuns.delete(key)));
```

契约要求“同一个 runId 的重复 action=run 请求不得重复启动 Core 任务”，重复请求直接拒绝，不启动第二个上游调用。

### 3.3 running checkpoint 的安全 resume

`restore()` 对 status=running 且有 `latestEventId` 的快照，以相同 `runId` 发送 `action=resume + lastEventId`；没有游标时才转为 `cancelled`。HITL(paused) 仍通过所属 Operation 的 `hitlResponse` 续跑。

### 3.4 runAgent 异常兜底

`send()` 的 `runAgent` 包 try/catch，失败写 `RUN_ERROR(NETWORK_ERROR)`，UI 立即退出 running。

## 4. 验证

- 快速连发 3 条：浏览器只发出 1 个 `agent/run`（其余被门禁忽略）；后端仅 1 次 POST。
- 刷新/恢复：有游标时只补缺失事件；无游标时转 cancelled，不整轮重放。
- `pnpm run test` 28/28，`pnpm run build` 通过。

## 5. 坑

> 安全前提不变：后端必须按 `lastEventId` 只回放缺失事件；若某个环境无法保证该契约，应关闭该环境的自动 resume，而不是重放整轮。
