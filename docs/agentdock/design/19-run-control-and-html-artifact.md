# Agent Run 控制与 HTML Artifact 方案

> 状态：架构决策与联调实施方案  
> 日期：2026-09-09  
> 优先级：P0 = 真正停止后端执行；P1 = HTML Artifact 完整体验  
> 权威契约：实时 wire 以 `../02-agui-a2ui-runtime-contract.md` 为准，Browser API 汇总以 `../04-frontend-backend-api.md` 为准

## 1. 结论

### 1.1 Stop

- **Stop 不是一条 Chat Message**，不得发送 `message = "Agent stop"`，也不得让模型解释控制命令。
- CopilotKit 原生 `agent/stop` 只有 Runtime `agentId + threadId`，缺少本项目真实取消必需的业务 `runId + fab`，因此**不能作为权威远端取消接口**。
- Browser 新增 AgentDock 自有控制接口 `POST /api/agent-runtime/runs/{runId}/cancel`，显式提交 `threadId + sessionId + agentId + fab`。
- AgentDock App Server 只做无状态 FAB 白名单路由，不保存 `threadId → runId/FAB` 映射；它把请求转发到对应厂区的
  `POST /ag-ui/runs/{runId}/cancel`。
- Browser 绝不拼接或接触真实 Orchestration Base URL；`fab → baseUrl` 仍只有服务端一份配置。
- `copilotkit.stopAgent({agent})` 保留为浏览器流、frontend tools 与 CopilotKit 本地生命周期清理，与权威取消并行执行；两条 Stop 路径必须幂等。
- 关闭 SSE/Abort HTTP 只能停止接收，不足以证明后端任务停止；真正的取消需要后端任务注册表、取消令牌和终态确认。
- P0 采用协作式取消：停止 LLM 流、阻止下一轮 loop、在工具边界检查取消；对可控子进程再做强制终止和超时兜底。

### 1.2 HTML Artifact

- Agent 输出应分为“正文摘要”和“Artifact 结构化事件”，不把整段 HTML 塞进普通助手正文。
- HTML 不属于 A2UI。A2UI 用于受 Catalog 约束的原生交互组件；完整 HTML 页面使用 `agentDock.artifact` Activity。
- 聊天正文展示文件卡片（标题、类型、大小、状态）；点击后打开右侧工作面板，默认“预览”，可切换“源码”、复制和下载。
- 首期无 MinIO 时允许 inline HTML；必须设置大小上限、持久化到 IndexedDB，并在 sandbox iframe 中执行严格 CSP。
- 当前代码已经具备 live Activity 自动打开右栏和 `iframe.srcDoc` 渲染骨架，但尚缺稳定契约、历史恢复、源码切换、Artifact Service 归档和足够安全的 sandbox/CSP。

## 2. 本项目需要开发哪些 API

只新增下列接口；其他场景全部复用现有链路或留在 Core 内部。

| 优先级 | 场景 | Browser API | 内部 Orchestration API | 是否新开发 | 原因与边界 |
|---|---|---|---|---|---|
| P0 | 真正停止当前 Run | `POST /api/agent-runtime/runs/{runId}/cancel` | `POST /ag-ui/runs/{runId}/cancel` | **是** | 原生 CopilotKit Stop 缺 `runId/fab`，只能作为本地清理；取消必须精确路由到厂区和 task |
| P0 | 异步取消后的状态确认 | `POST /api/agent-runtime/runs/{runId}/status` | `POST /ag-ui/runs/{runId}/status` | **是** | cancel 可能返回 `cancel_requested`；浏览器关闭 SSE 后仍需确认后端真正成为终态 |
| 已有 | 发送消息/新 Run | `/api/copilotkit` `agent/run` | `POST /ag-ui` | 否 | 当前链路已传 `runId/threadId/agentId/fab` 并消费 AG-UI SSE |
| 已有 | 断线重连 | `/api/copilotkit` `agent/connect` | `POST /ag-ui` resume/connect 语义 | 否 | 当前 checkpoint + `lastEventId` 方案已实现；只有真实联调证明 connect 丢参数时才另立 `/events`，本次不预建 |
| 已有 | HITL 回应 | `/api/copilotkit` `agent/run` + `resume[]` | `POST /ag-ui` | 否 | 请求 body 能携带 FAB、interruptId 和 payload；缺口在公司 adapter 的 resume 映射，不是缺 API |
| 已有 | A2UI Action | `/api/copilotkit` `agent/run` + `a2uiAction` | `POST /ag-ui` | 否 | 属于继续执行 Agent，现有 RunAgentInput 足够 |
| 内部 | Agent loop/工具取消 | 无 Browser API | cancellation token | 否（但要改 Core） | loop 是同一 Run 内部行为；每个 node/tool 边界检查 token，不能由前端逐步控制 |
| 本地已有 | Session History | IndexedDB Service | 无 | 否 | 当前产品明确本地存储，不新增公司后端 CRUD |
| 后续 P1 | HTML Artifact | AG-UI `agentDock.artifact` + 既有 Artifact Service 规划 | 既有 `/ag-ui` 事件 | 本次只冻结协议 | 与 Stop 无关，不阻塞 P0；不新增另一条“HTML API” |

明确不开发：单独 `continue`、`retry`、`loop`、`a2uiAction`、`hitlResponse` API；它们都应继续创建/恢复 CopilotKit Run。也不开发 Runtime 的 `threadId → runId/FAB` 映射。

## 3. 最终架构：无状态 AgentDock Control Gateway

```text
Browser
  ├─ Run/Connect/HITL/A2UI ── POST /api/copilotkit ── Copilot Runtime ── {FAB}/ag-ui
  │
  ├─ Cancel ──────────────── POST /api/agent-runtime/runs/{runId}/cancel ─┐
  └─ Status ──────────────── POST /api/agent-runtime/runs/{runId}/status ─┤
                                                                          ▼
AgentDock App Server（无状态 Control Gateway）
  ├─ 校验 runId/threadId/agentId/fab
  ├─ 只允许 AGENT_ORCHESTRATION_BASE_URLS_JSON 中的 FAB
  ├─ 透传 SSO principal / request-id / traceparent
  └─ 根据 fab 转发，不保存 thread/run 映射
                                                                          ▼
FAB Orchestration
  ├─ runId → task/cancellation token（权威）
  ├─ 校验 threadId/agentId/principal 与启动记录一致
  ├─ cancel_requested → cancelled
  └─ Core 停止 LLM、loop、未开始的 tool/step
```

这个 Gateway 可以与 `server/index.ts` 的 Copilot Runtime 部署在同一个进程，但使用独立路径和 handler；它不是 CopilotKit AgentRunner 的一部分。OAuth2 Proxy 必须按最长路径优先路由：

```text
/api/agent-runtime/* -> AgentDock App Server
/api/copilotkit*     -> AgentDock App Server
/api/*               -> Agent Registry
```

### 3.1 为什么不在 Browser Axios 拼真实 URL

- 前端 bundle 不应包含每个厂区的内部拓扑。
- 浏览器直连会把 CORS、Cookie/SSO、CSRF、TLS 和厂区网络可达性扩散到每套 Orchestration。
- FAB 映射会出现前端/服务端两份配置并发生漂移。
- 服务端无法统一做白名单、防 SSRF、权限、审计、限流和 trace。
- Browser 只提交 `fab="F15B"`，绝不能提交 `orchestrationBaseUrl`；Base URL 必须来自服务端白名单。

### 3.2 ID 责任

- `runId`：Browser 创建并贯穿现有 Run；取消主键，放在 URL。
- `threadId`：用于 Orchestration 校验 Run 归属，不能替代 runId。
- `sessionId`：AgentDock UI/审计关联，不作为 Core 取消主键。
- `agentId`：业务 Agent ID，用于权限和启动记录一致性校验。
- `fab`：无状态 Gateway 的路由键；请求值只用于选候选服务，Orchestration 必须再用 Run 启动记录校验。
- `principal`：由 SSO/可信 Header 注入，Browser body 不得提交 userId。

## 4. API 契约

### 4.1 Browser → AgentDock：取消 Run（P0）

**HTTP**：`POST /api/agent-runtime/runs/{runId}/cancel`
**认证**：同源 SSO Cookie
**Content-Type**：`application/json`
**幂等性**：同一个 `runId` 重复调用返回相同或更后的状态，不得返回 500
**超时**：Browser 3 秒；Orchestration 应在 2 秒内返回已接受，真实退出由 status API 确认

```json
{
  "sessionId": "session-001",
  "threadId": "thread-001",
  "agentId": "flight-analysis-agent",
  "fab": "F15B",
  "reason": "user_requested",
  "mode": "interrupt"
}
```

`mode` 首期只接受 `interrupt`：停止后保留已产生的文本、工具结果和 Artifact。不要在首期实现 rollback。

真实任务已经退出时返回 HTTP 200：

```json
{
  "code": 0,
  "message": "",
  "data": {
    "runId": "run-001",
    "threadId": "thread-001",
    "fab": "F15B",
    "accepted": true,
    "status": "cancelled",
    "terminal": true
  }
}
```

取消已接受但工具仍在退出时返回 HTTP 202，响应 envelope 相同，但 `status="cancel_requested"`、`terminal=false`；Browser 随后调用 status API。

### 4.2 Browser → AgentDock：查询 Run 状态（P0）

使用 POST 是为了与本项目普通 API 约定一致，并让 FAB/身份信息不进入 URL query/log。

```http
POST /api/agent-runtime/runs/{runId}/status
Content-Type: application/json
```

```json
{
  "threadId": "thread-001",
  "agentId": "flight-analysis-agent",
  "fab": "F15B"
}
```

```json
{
  "code": 0,
  "message": "",
  "data": {
    "runId": "run-001",
    "threadId": "thread-001",
    "fab": "F15B",
    "status": "cancelled",
    "terminal": true,
    "startedAt": "2026-09-09T10:00:00+08:00",
    "cancelRequestedAt": "2026-09-09T10:00:08+08:00",
    "completedAt": "2026-09-09T10:00:08.420+08:00"
  }
}
```

允许状态：`pending | running | paused | cancel_requested | cancelled | success | error`。Browser 最多轮询 10 秒，间隔建议 `250ms → 500ms → 1s`，页面进入后台或 Operation 已被替换时立即停止轮询。

### 4.3 AgentDock → Orchestration 内部接口

路径分别为：

```text
POST {fabBaseUrl}/ag-ui/runs/{runId}/cancel
POST {fabBaseUrl}/ag-ui/runs/{runId}/status
```

Gateway 移除普通业务 envelope 后转发必要字段，并追加可信身份/追踪 Header。Orchestration 返回相同 `data` 对象，Gateway 再包装 AgentDock envelope。

Orchestration 必须校验：

```text
URL runId == 启动记录 runId
body.threadId == 启动记录 threadId
body.agentId == 启动记录 agentId
认证 principal == 启动记录 owner/authorized principal
请求路由 FAB == 当前 Orchestration 部署 FAB
```

错误：

| HTTP | code | Browser 行为 |
|---|---|---|
| 400 | `INVALID_REQUEST` | 不重试，记录协议错误 |
| 403 | `RUN_PERMISSION_DENIED` | 不重试，显示无权限 |
| 404 | `RUN_NOT_FOUND` | 查询一次 status；仍 404 则显示“运行不存在或已过期” |
| 409 | `RUN_ROUTE_MISMATCH` | 不重试，记录 FAB/thread/agent 不一致 |
| 409 | `RUN_NOT_CANCELLABLE` | 若返回现有终态则按终态显示 |
| 502 | `FAB_ENDPOINT_UNAVAILABLE` | 允许人工重试 |
| 503 | `CANCEL_UNAVAILABLE` | 退避重试，不能宣称已停止 |

### 4.4 权威终态事件

Orchestration 完成取消后持久化 `cancelled`，并在仍存在的原 SSE/connect 流输出：

```json
{
  "type": "RUN_ERROR",
  "threadId": "thread-001",
  "runId": "run-001",
  "code": "CANCELLED",
  "message": "Run cancelled by user.",
  "eventId": "1788920000000-000042"
}
```

随后关闭流。终态之后不得再写 `TEXT_MESSAGE_CONTENT`，不得启动新 step/tool/loop。status API 与 AG-UI 终态冲突时，以 Orchestration 持久化的终态为准，并记录协议告警。

## 5. Agent Stop 关键实现

### 5.1 前端 Service（建议新增 `src/api/runtime/runControlService.ts`）

```ts
export type AgentRunStatus =
  | 'pending' | 'running' | 'paused' | 'cancel_requested'
  | 'cancelled' | 'success' | 'error';

export interface RunControlContext {
  runId: string;
  sessionId: string;
  threadId: string;
  agentId: string;
  fab: string;
}

export interface RunControlResult {
  runId: string;
  threadId: string;
  fab: string;
  status: AgentRunStatus;
  terminal: boolean;
}

export const cancelAgentRun = async (
  input: RunControlContext,
  signal?: AbortSignal,
): Promise<RunControlResult> => {
  const { runId, ...body } = input;
  return postApi(`agent-runtime/runs/${encodeURIComponent(runId)}/cancel`, {
    ...body,
    mode: 'interrupt',
    reason: 'user_requested',
  }, { signal });
};

export const getAgentRunStatus = async (
  input: Omit<RunControlContext, 'sessionId'>,
  signal?: AbortSignal,
): Promise<RunControlResult> => {
  const { runId, ...body } = input;
  return postApi(`agent-runtime/runs/${encodeURIComponent(runId)}/status`, body, { signal });
};
```

实际 `postApi` 签名应按 `src/lib/httpClient.ts` 适配；关键点是组件不直接 Axios/fetch、URL 只含同源路径、`runId` 必须编码、支持 AbortSignal。

### 5.2 前端 Stop 编排

```ts
async function stopRun(operation: SessionOperation, runtime: SessionRuntimeHandle) {
  if (operation.status === 'cancel_requested' || operation.status === 'cancelled') return;
  markCancelRequested(operation.runId);

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 3_000);
  try {
    // 权威远端取消先启动；不能等待 CopilotKit 原生 stop 帮忙补 FAB。
    const cancelPromise = runControlService.cancel(operation, controller.signal);

    // 仅清理浏览器流、frontend tools 和 CopilotKit 本地生命周期。
    // 它会额外发出原生 agent/stop；服务端应让重复 Stop 幂等。
    const localStopPromise = runtime.stop().catch((error) => {
      console.warn('CopilotKit local stop failed', error);
    });

    const result = await cancelPromise;
    await localStopPromise;
    if (result.terminal) {
      markCancelled(operation.runId);
      return;
    }
    await pollUntilTerminal(operation, 10_000);
  } catch (error) {
    if (!isCurrentOperation(operation)) return;
    markCancelFailed(operation.runId, error);
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
```

生产实现不能沿用当前“先本地写 cancelled、远端错误只 console”的逻辑。请求失败时保留部分内容，但 UI 必须显示“停止未确认，可重试”。

### 5.3 AgentDock App Server 无状态 Handler

```ts
const RUN_CONTROL_PATH =
  /^\/api\/agent-runtime\/runs\/([^/]+)\/(cancel|status)$/;

async function handleRunControl(request: Request): Promise<Response> {
  const match = new URL(request.url).pathname.match(RUN_CONTROL_PATH);
  if (!match || request.method !== 'POST') return jsonError(404, 'NOT_FOUND');

  const runId = decodeURIComponent(match[1]);
  const action = match[2];
  const body = await readAndValidateRunControlBody(request, action);
  const baseUrl = fabEndpoints[body.fab];
  if (!baseUrl) return jsonError(422, 'FAB_ENDPOINT_NOT_CONFIGURED');

  // baseUrl 只能来自服务端白名单，严禁从 body 读取 URL。
  const upstream = `${baseUrl.replace(/\/+$/, '')}/ag-ui/runs/` +
    `${encodeURIComponent(runId)}/${action}`;
  const response = await fetch(upstream, {
    method: 'POST',
    headers: buildTrustedHeaders(request),
    body: JSON.stringify({
      threadId: body.threadId,
      agentId: body.agentId,
      ...(action === 'cancel'
        ? { mode: 'interrupt', reason: body.reason ?? 'user_requested' }
        : {}),
    }),
    signal: AbortSignal.timeout(2_500),
  });
  return wrapRunControlResponse(response);
}
```

代码审查必须确认：JSON body 有字节上限；只允许 UUID/项目规定格式的 ID；FAB 用 own-property 查表防原型键；上游非 JSON/超时统一转结构化 502；不回传内部 URL、堆栈和凭据。

### 5.4 Orchestration/Core 取消伪代码

```python
@app.post('/ag-ui/runs/{run_id}/cancel')
async def cancel_run(run_id: str, body: CancelRunInput, principal=Depends(auth)):
    run = await run_repository.get_for_update(run_id)
    verify_run_scope(run, body.thread_id, body.agent_id, principal)

    if run.status in {'cancelled', 'success', 'error'}:
        return to_result(run)  # 幂等：返回已有终态

    await run_repository.compare_and_set_status(
        run_id, expected={'pending', 'running', 'paused'}, new='cancel_requested'
    )
    await cancellation_bus.publish(run.worker_id, run_id)

    # 不等待 worker 真正退出；Browser 用 status API 确认终态。
    current = await run_repository.get(run_id)
    return JSONResponse(to_result(current), status_code=200 if current.terminal else 202)
```

Core 的每个可取消边界都必须检查同一个 token：

```python
cancel_token.raise_if_cancelled()       # 调模型前
async for chunk in model_stream:
    cancel_token.raise_if_cancelled()   # token 流中
    await publish(chunk)
cancel_token.raise_if_cancelled()       # 启动 tool/下一 loop 前
```

Orchestration 的 `runId → worker/task/cancellation token` 是执行服务自身的权威状态，不能省略；被删除的是不可靠的 Copilot Runtime `threadId → runId/FAB` 映射。

### 5.5 并发与无 Bug 约束

- Stop 使用捕获到的 `operation`，异步过程中禁止重新读取当前页面 session/FAB，避免切换会话后取消错 Run。
- Run 完成与 Cancel 并发时，数据库只允许第一个合法终态成功；`success/error/cancelled` 互不覆盖。
- 迟到的 Stop 必须携带旧 `runId`，因此不会误杀同 thread 的新 Run。
- 重复 Stop、CopilotKit 原生 Stop 与自有 Cancel 并发必须幂等。
- `cancel_requested` 时禁止发送新消息；确认终态或明确 cancel_failed 后再允许用户处理。
- status 轮询绑定 `runId`，路由切换、组件卸载、新 Run 开始时 Abort。
- 如果不可取消工具已产生外部副作用，状态不能假装 rollback；首期 `interrupt` 只保证停止后续执行。
- Orchestration 只有在 task/worker 确认退出后才写 `cancelled`，收到请求不能直接写终态。

## 6. HTML Artifact API 文档

### 6.1 AG-UI 事件

后端在正文摘要之后发送一个完整 `ACTIVITY_SNAPSHOT`。HTML 不使用 `ACTIVITY_DELTA` 逐字符传输：不完整 DOM 会造成预览闪烁，也会放大持久化与安全检查成本；更新文档时重新发送同一 `artifactId`、更高 `revision` 的 Snapshot：

```json
{
  "type": "ACTIVITY_SNAPSHOT",
  "messageId": "artifact-event-001",
  "activityType": "agentDock.artifact",
  "content": {
    "artifactId": "artifact-001",
    "revision": 1,
    "title": "飞行测试分析报告",
    "mimeType": "text/html",
    "encoding": "utf-8",
    "storage": "inline",
    "body": "<!doctype html><html><body>...</body></html>",
    "sizeBytes": 18432,
    "sha256": "sha256-hex",
    "presentation": {
      "display": "side-panel",
      "autoOpen": true,
      "defaultTab": "preview"
    },
    "capabilities": {
      "preview": true,
      "source": true,
      "download": true
    }
  }
}
```

字段规则：

- `artifactId + revision` 唯一标识内容版本；更新同一 Artifact 时 revision 递增。
- `mimeType` 首期只开放 `text/html`，后续可扩展 `text/markdown`、`image/svg+xml`、Mermaid 等。
- `storage=inline` 时 `body` 必填；首期建议 UTF-8 内容上限 512 KiB，超限返回 `ARTIFACT_TOO_LARGE`。
- `sha256` 用于完整性、去重和缓存校验。
- `presentation` 只是显示建议，Browser 可因用户设置或安全策略不自动打开。
- 不使用 `TEXT_MESSAGE_CONTENT` 承载 HTML，不使用 Markdown 裸标签猜测 Artifact。
- `presentation.autoOpen=true` 只对当前 live run 的该 `artifactId + revision` 生效一次；用户手动关闭后不得因 React 重渲染重复抢焦点。历史恢复只显示文件卡，不自动打开。

兼容公司 Agent 暂时只能输出普通文本的场景：允许在 `TEXT_MESSAGE_*` 中返回 fenced code block（` ```html` 或 ` ```htm`）。前端继续把它作为正文代码块展示并保留复制能力，只在该代码块工具栏增加“预览”按钮；用户点击后才打开同一个安全侧栏。不得用“正文含 `<div>`”之类的模糊规则识别，避免把讲解文字、XML、模板片段误执行为页面。该兼容路径不自动打开、不生成持久 Artifact ID；后端具备结构化事件能力后仍应迁移到 `agentDock.artifact`。

兼容期可读取当前 `{ title, html }`，但新后端只应生成上面的规范结构；前端归一化后再渲染。

### 6.2 为什么用 Activity，不用 A2UI

| 输出 | 协议 | 原因 |
|---|---|---|
| 指标卡、按钮、表单、审批组件 | A2UI Surface | 组件来自受信 Catalog，行为可验证、可回传 action |
| 完整单页 HTML/CSS 结果 | `agentDock.artifact` Activity | 内容是文档资产，需要预览/源码/下载/版本管理 |
| 简短解释、结论 | Assistant text | 便于阅读、搜索和无障碍 |

如果 HTML 里的按钮需要影响 Agent，不允许它直接调用父页面。应把关键交互建模为 A2UI Action，或由 iframe `postMessage` 发出经过白名单校验的 Artifact action，再由宿主转换为 `a2uiAction`/业务 action。

### 6.3 推荐交互

1. 正文先显示 Agent 的自然语言摘要。
2. 紧接一个 Artifact 文件卡：`飞行测试分析报告 · HTML · 18 KB`，提供“打开”按钮。
3. `autoOpen=true` 时首次生成自动打开右侧工作面板；用户手动关闭后，同一 Artifact 更新不应反复抢焦点。
4. 右栏顶部显示标题、版本和关闭/全屏/下载；主体有“预览 / 源码”两页签。
5. 源码页使用语法高亮和复制，不在正文重复输出整段 code。
6. 刷新、切换会话、加载历史时，可从 IndexedDB 中的 Activity 恢复文件卡和侧栏内容。

这比“正文输出大段 HTML code，再让用户找按钮切换”更友好，也保留了源码可见性。

### 6.4 无对象存储时的持久化

- 当前会话内把规范 Activity 原样保存到 IndexedDB；Artifact 列表可从 session message/activity 投影，或同步写入 `artifactService` 的本地实现。
- 不要把大 HTML 复制到多份 message/checkpoint；建议以 `artifactId/revision` 单独建 IndexedDB object store，消息只存引用。
- 设定单 Artifact 512 KiB、单 Session 10 MiB 的软上限；达到上限提示下载/清理。
- 后续接 MinIO/S3 时把 `storage` 扩展为 `object`，内容字段替换为短时签名 URL/asset key，事件结构和 UI 不变。

### 6.5 安全基线

HTML 来自模型，必须按不受信代码处理：

- 使用 `<iframe sandbox>`，不要设置 `allow-same-origin`；首期也不要设置 `allow-scripts`、`allow-forms`、`allow-popups`。
- 向 `srcDoc` 注入 CSP：`default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; script-src 'none'; connect-src 'none'; media-src data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'`。
- 对 HTML 做 sanitize/size/encoding 校验；源码视图必须转义，不能用 `dangerouslySetInnerHTML`。
- 禁止外网图片、脚本、字体和 fetch，避免数据外泄；需要资源时使用 data/blob 内联且计入大小限制。
- 下载文件名清理路径字符，并固定 `.html` MIME；不要让 Artifact 获得 SSO Cookie 或父页面 DOM 权限。

当前实现的 `sandbox="allow-same-origin"` 应改为更严格的空 sandbox。MDN 明确警告：`srcdoc` 是注入点，而 `allow-same-origin` 会削弱隔离。

## 7. 当前 HTML 功能审计

### 已迁入

- ChatPage 能从 live `agentDock.artifact` Activity 读取 `{html,title}`。
- 收到 live HTML 后自动打开 380px 右侧栏。
- 使用 iframe `srcDoc` 预览。
- Activity 会进入 runtime snapshot，并能落入 IndexedDB activity record。
- 独立 `/artifact` 页面和 `artifactService` 已有本地 Mock 列表/详情骨架。

### 尚未完成

- 正文没有真实、可点击的 Artifact 文件卡；目前只隐藏 Activity，结束后显示通用报告图标。
- 无“预览 / 源码”切换、复制、全屏和规范 HTML 下载。
- ChatPage 只从 live run 查找 Artifact，没有从历史 activity 建立侧栏模型。
- live Activity 与 `/artifact` 的 `artifactService` 没有统一数据源。
- wire 仍是临时 `{title, html}`，没有 artifactId/revision/MIME/大小/hash。
- iframe 使用 `allow-same-origin`，且未注入严格 CSP/内容上限。
- ArtifactPage 把非 code 内容按 Markdown 显示，尚未按 `text/html` 使用安全 renderer。

## 8. 实施顺序与验收

### P0：真正 Stop

1. Orchestration 增加 run registry 与 `POST /ag-ui/runs/{runId}/cancel`。
2. Orchestration 增加 `POST /ag-ui/runs/{runId}/status`；Core 贯通 cancellation token、loop/tool 边界和唯一终态。
3. AgentDock App Server 增加无状态 `/api/agent-runtime/runs/{runId}/cancel|status` handler，复用现有 FAB 白名单配置。
4. 前端增加 `runControlService`、`cancel_requested`、终态轮询和失败重试；远端未确认前不得宣称完成。
5. 保留 `copilotkit.stopAgent` 只做本地生命周期清理；不建设 Runtime active-run registry。
6. E2E：启动 30 秒 loop，点击 Stop 后 2 秒内收到 accepted，10 秒内 task 不再运行；Redis/日志无后续 token/tool/loop。

### P1：HTML Artifact（本次实现）

1. 冻结规范 payload 和兼容 `{title, html}` 归一化器。
2. 实现正文 ArtifactCard 与共用 Portal 的“预览 / 源码”、复制和下载。
3. 实现无权限 sandbox、CSP、危险节点/属性清理和 512 KiB 大小限制。
4. 当前会话沿用既有 Activity IndexedDB 落库实现历史恢复；后续 Artifact 列表跨会话检索时再拆独立 object store，避免本次双写。
5. E2E：生成、自动打开一次、源码切换、复制/下载、关闭后不抢焦点、刷新后从文件卡打开、恶意脚本/外连被阻断。

### Stop 验收证据

- Browser Network 出现 `/api/agent-runtime/runs/{runId}/cancel`，body 含 `threadId/agentId/fab`；原生 `agent/stop` 仅作为可选本地清理证据。
- AgentDock Control Gateway 日志包含 request-id、runId、FAB 和 upstream cancel status，且不泄漏内部 URL。
- Orchestration run 状态最终为 `cancelled`。
- Core worker/task 退出，取消后无新普通事件。
- SSE/connect 可观察到唯一 `RUN_ERROR code=CANCELLED`。
- 重复 Stop 不产生 500，不取消同 thread 的下一次新 run。
