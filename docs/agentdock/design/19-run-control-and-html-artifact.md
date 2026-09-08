# Agent Run 控制与 HTML Artifact 方案

> 状态：架构决策与联调实施方案  
> 日期：2026-09-09  
> 优先级：P0 = 真正停止后端执行；P1 = HTML Artifact 完整体验  
> 权威契约：实时 wire 以 `../02-agui-a2ui-runtime-contract.md` 为准，Browser API 汇总以 `../04-frontend-backend-api.md` 为准

## 1. 结论

### 1.1 Stop

- **Stop 不是一条 Chat Message**，不得发送 `message = "Agent stop"`，也不得让模型解释控制命令。
- Browser 继续使用 CopilotKit single-route 的同一个物理地址 `POST /api/copilotkit`，但发送独立逻辑方法 `agent/stop`。
- Copilot Runtime 必须把 `agent/stop` 映射为 Orchestration 的独立取消接口，并以 `runId` 精确取消 Core task。
- 关闭 SSE/Abort HTTP 只能停止接收，不足以证明后端任务停止；真正的取消需要后端任务注册表、取消令牌和终态确认。
- P0 采用协作式取消：停止 LLM 流、阻止下一轮 loop、在工具边界检查取消；对可控子进程再做强制终止和超时兜底。

### 1.2 HTML Artifact

- Agent 输出应分为“正文摘要”和“Artifact 结构化事件”，不把整段 HTML 塞进普通助手正文。
- HTML 不属于 A2UI。A2UI 用于受 Catalog 约束的原生交互组件；完整 HTML 页面使用 `agentDock.artifact` Activity。
- 聊天正文展示文件卡片（标题、类型、大小、状态）；点击后打开右侧工作面板，默认“预览”，可切换“源码”、复制和下载。
- 首期无 MinIO 时允许 inline HTML；必须设置大小上限、持久化到 IndexedDB，并在 sandbox iframe 中执行严格 CSP。
- 当前代码已经具备 live Activity 自动打开右栏和 `iframe.srcDoc` 渲染骨架，但尚缺稳定契约、历史恢复、源码切换、Artifact Service 归档和足够安全的 sandbox/CSP。

## 2. 为什么不使用消息模拟控制命令

| 方案 | 优点 | 问题 | 结论 |
|---|---|---|---|
| 普通消息 `"Agent stop"` | 表面上复用发送接口 | 会进入上下文、依赖模型理解、无法精确定位 run、运行通道拥塞时可能无法处理 | 禁止 |
| `RunAgentInput.forwardedProps.action=stop` 再 POST `/ag-ui` | 可复用 schema 和 FAB 路由 | 把控制面混入执行面；可能启动第二个 run；同一 worker 忙时无法及时取消 | 仅可作旧后端兼容，不作为正式方案 |
| 仅 Abort SSE/fetch | 前端响应快 | 只证明连接断开，后台 loop、工具或队列任务可能继续运行 | 只能作为本地 UX |
| 独立 run cancel API | 精确、幂等、可鉴权、可观测、可确认终态 | 后端需维护 task/run registry | **推荐** |
| WebSocket 双向控制帧 | 延迟低、适合大量实时命令 | 基础设施和重连状态机复杂，首期没有必要 | 后续可选 |

这里的“独立”指**逻辑资源和语义独立**，不要求 Browser 增加第二个公网 URL。CopilotKit single-route 可以在同一个 `/api/copilotkit` 上通过不同 `method` 承载 run/connect/stop。

## 3. 推荐架构

```text
Browser
  ├─ agent/run  ───────────────┐
  ├─ agent/connect ────────────┤ POST /api/copilotkit (single-route)
  └─ agent/stop ───────────────┘
                 │
                 ▼
Copilot Runtime
  ├─ FAB route + auth/audit
  ├─ ActiveRunRegistry: threadId -> runId/fab/upstream/status
  ├─ run/connect -> POST {fabBaseUrl}/ag-ui
  └─ stop        -> POST {fabBaseUrl}/ag-ui/runs/{runId}/cancel
                 │
                 ▼
Orchestration Service
  ├─ persistent/distributed Run Registry
  ├─ cancel_requested flag + task handle
  ├─ publish terminal AG-UI event
  └─ Core cancellation token
                 │
                 ▼
DeepAgents / Core / Tool workers
  ├─ LLM stream abort
  ├─ loop/step boundary checks
  ├─ tool timeout/cancel hook
  └─ no new content after terminal cancellation
```

### 3.1 ID 责任

- `sessionId`：AgentDock UI/本地历史标识，不用于后端精确取消。
- `threadId`：会话上下文标识。CopilotKit 标准 stop 路由以它定位当前运行。
- `runId`：一次执行的唯一标识，是 Orchestration/Core 取消的最终主键。
- `agentId`：Runtime 注册的代理为 `orchestration`；业务 Agent 保留在 forwarded props。
- `fab`：决定 Orchestration Base URL；取消必须路由到启动该 run 的同一 FAB，不能相信 Stop 时由用户重新提交的 FAB。

Runtime 应在 run 开始时记录 `threadId -> { runId, fab, upstreamBaseUrl, principal }`。多副本部署不能只依赖进程内 Map，应使用 Redis/共享 registry，或者至少保证同一 thread 的 run/stop 粘滞到同一 Runtime 实例。

## 4. Stop API 文档

### 4.1 Browser → Copilot Runtime

**HTTP**：`POST /api/copilotkit`  
**Content-Type**：`application/json`  
**认证**：同源 SSO Cookie  
**幂等性**：同一 active thread 重复调用安全

请求：

```json
{
  "method": "agent/stop",
  "params": {
    "agentId": "orchestration",
    "threadId": "thread-001"
  }
}
```

说明：这是 CopilotKit single-route 的标准逻辑方法。当前 `copilotkit.stopAgent({ agent })` 会发出该请求；不需要构造聊天消息，也不需要 `RunAgentInput` body。

成功响应：

```json
{
  "stopped": true,
  "runId": "run-001",
  "status": "cancel_requested"
}
```

已终止或不存在 active run 时也返回 HTTP 200，以支持重试：

```json
{
  "stopped": false,
  "status": "not_running"
}
```

Runtime 不得在未向 Orchestration 发出取消请求时返回 `stopped: true`。

### 4.2 Copilot Runtime → Orchestration

**HTTP**：`POST {orchestrationBaseUrl}/ag-ui/runs/{runId}/cancel`  
**用途**：真实取消一个 pending/running run  
**认证**：Runtime 透传受信身份与 trace headers  
**推荐超时**：请求确认 2 秒；后台完成取消最长 10 秒

请求：

```json
{
  "threadId": "thread-001",
  "reason": "user_requested",
  "mode": "interrupt",
  "requestedAt": "2026-09-09T10:00:00+08:00"
}
```

响应（首次接受）：

```http
HTTP/1.1 202 Accepted
Content-Type: application/json
```

```json
{
  "runId": "run-001",
  "threadId": "thread-001",
  "status": "cancel_requested",
  "accepted": true
}
```

响应（已完成/幂等重试）：

```json
{
  "runId": "run-001",
  "threadId": "thread-001",
  "status": "cancelled",
  "accepted": true
}
```

错误：

| HTTP | code | 含义 |
|---|---|---|
| 400 | `INVALID_REQUEST` | ID 或 mode 非法 |
| 403 | `RUN_PERMISSION_DENIED` | 当前身份不能取消该 run |
| 404 | `RUN_NOT_FOUND` | run 不存在或已过期 |
| 409 | `RUN_NOT_CANCELLABLE` | run 已成功/失败终止，不可转换为 cancelled |
| 503 | `CANCEL_UNAVAILABLE` | registry/worker 暂不可用，调用方可重试 |

取消接口必须校验 `runId + threadId + principal`；FAB 和上游地址取启动记录，不取客户端自由输入。

### 4.3 终态事件

Orchestration 接受取消后，原 SSE 或 connect 重连流最终输出：

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

随后关闭流。已经产生的文本和 Artifact 保留；终态后不得再写 `TEXT_MESSAGE_CONTENT`、启动新 step、启动新 tool 或开始下一次 loop。

> CopilotKit Runtime 当前内置 stop 响应使用过 `STOPPED`，AgentDock 投影使用 `CANCELLED`。联调时应在 Runtime/Orchestration 边界统一成 `CANCELLED`，不要让 UI 同时解释两套业务终态。

### 4.4 状态机和前端 UX

```text
running -> cancel_requested -> cancelled
                       \----> cancel_failed (仍允许重试)
running --------------------> success/error (与取消并发时，以后端首个持久化终态为准)
```

- 点击停止后按钮立即进入“正在停止”，禁用重复点击，但不要立刻伪造“后端已停止”。
- 收到 cancel API 确认后可显示“停止请求已发送”；收到 `RUN_ERROR/CANCELLED` 后显示“已停止”。
- 2 秒未确认时提示“停止请求仍在处理”；10 秒仍无终态时允许重试并通过 run status/connect 查证。
- 前端 Abort 流用于即时 UX；取消 API 是资源释放的权威路径，两者都要执行。

### 4.5 Core 实现要求

1. Run 创建时登记 task handle、owner、thread、FAB、status 和 cancellation token。
2. Cancel 使用 compare-and-set：只有 `pending/running` 可转 `cancel_requested`。
3. LLM SDK 使用 AbortSignal/cancel scope；生成器收到取消后停止读取 token。
4. 每个 loop、node、tool 前后检查 cancellation token，禁止再启动下一步。
5. 长工具必须支持超时和取消 hook；无法取消的外部副作用要记录为 `cancellation_pending_external`，不能谎报已完全停止。
6. 持久化唯一终态并发布 `RUN_ERROR/CANCELLED`；重复 cancel 返回当前状态。
7. 指标至少包含 cancel latency、cancel success/failure、late event count、仍在运行的孤儿 task 数。

## 5. 当前 Stop 实现审计

| 层 | 当前状态 | 缺口 |
|---|---|---|
| ChatInput | 已有 Stop 按钮 | 无 `cancel_requested` 中间态 |
| `sessionOperationService.stop` | 调用 Runtime stop，并本地投影 cancelled | 在远端确认前先本地终态；失败被吞掉，只写 console |
| CopilotKit Browser Agent | 会发送 single-route `agent/stop` | 标准 stop 只带 threadId，Runtime 需解析 active run |
| Copilot Runtime runner | 内置 runner 能按 thread 找到运行 | 当前 FAB Agent 的真正上游取消需验证/扩展 |
| `FabRoutingAgent` | 只实现 `run()` | 未持有上游 task/cancel API，不能证明 Core 停止 |
| Orchestration/Core | 仓库中无实现 | 需要 run registry、cancel endpoint、token 和终态事件 |

因此，当前 UI “已停止”只能说明本地状态和 Runtime 调用发生，不是后端任务已停止的验收证据。

## 6. HTML Artifact API 文档

### 6.1 AG-UI 事件

后端在正文摘要之后（也可流式过程中）发送 `ACTIVITY_SNAPSHOT`：

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
2. Core 贯通 cancellation token、loop/tool 边界和唯一终态。
3. Runtime 增加 active-run registry，并让 runner `stop(threadId)` 等待上游 cancel 接受。
4. 前端增加 `cancel_requested`/失败重试，不再远端未确认即宣称完成。
5. E2E：启动 30 秒 loop，点击 Stop 后 2 秒内收到 accepted，10 秒内 task 不再运行；Redis/日志无后续 token/tool/loop。

### P1：HTML Artifact

1. 冻结规范 payload 和兼容归一化器。
2. 实现正文 ArtifactCard 与 Portal tabs。
3. 实现严格 sandbox/CSP/sanitize/大小限制。
4. 统一 IndexedDB artifact store、历史恢复和 `/artifact` 页面。
5. E2E：生成、自动打开、源码切换、关闭后不抢焦点、刷新恢复、恶意脚本/外连被阻断。

### Stop 验收证据

- Browser Network 出现 `method=agent/stop`。
- Runtime 日志包含 threadId/runId/FAB 和 upstream cancel status。
- Orchestration run 状态最终为 `cancelled`。
- Core worker/task 退出，取消后无新普通事件。
- SSE/connect 可观察到唯一 `RUN_ERROR code=CANCELLED`。
- 重复 Stop 不产生 500，不取消同 thread 的下一次新 run。

