# 公司内无缝调试指南：Agent Registry + Orchestration + AG-UI/A2UI

> 面向对象：前后端联调工程师  
> 目标：不改业务代码的前提下，快速定位“消息没出来 / 事件没消费 / 回显不对”发生在哪一跳。
> 前置说明：生产认证与路由由 OAuth2 Proxy 统一处理（SSO token 注入 + 按 path 转发），仓库不自建反向代理；本指南的所有“入口”均指 OAuth2 Proxy 暴露的地址。架构决策见 `design/08`，渲染投影见 `design/09`。

## 1. 环境矩阵

| 场景 | `VITE_SERVICE_MODE` | `VITE_AGENT_RUNTIME_TRANSPORT` | 数据来源 |
|---|---|---|---|
| 纯前端开发 | `mock` | `proxy` | Mock Service + Mock SSE |
| 接真实 Registry | `http` | `proxy` | 真实 `/api/*`（经 OAuth2 Proxy 路由到 Registry） |
| 接真实 Orchestration | `http` | `direct` | 浏览器直连 `{fab}/ag-ui`（本地联调，需 CORS/认证） |
| 生产形态 | `http` | `proxy` | 浏览器 → `/api/copilotkit` → Runtime 按 FAB 路由 |

推荐联调顺序：**Mock 全通 → Registry HTTP → Orchestration direct → 生产 proxy**。

## 2. 配置

前端 `.env`：

```env
VITE_SERVICE_MODE=http
VITE_API_BASE_URL=/api
VITE_AGENT_RUNTIME_TRANSPORT=direct
VITE_AGENT_ORCHESTRATION_ENDPOINTS_JSON={"F15B":"http://127.0.0.1:8123"}
```

App Server / 本地进程 env：

```env
AGENT_REGISTRY_BASE_URL=http://127.0.0.1:8000
AGENT_ORCHESTRATION_BASE_URLS_JSON={"F15B":"http://127.0.0.1:8123"}
```

OAuth2 Proxy（或本地临时 nginx 等价物）upstream 示例：

```yaml
upstreams:
  - path: /api/market/
    uri: http://127.0.0.1:8000/api/market/
  - path: /api/copilotkit
    uri: http://127.0.0.1:3000/api/copilotkit
  - path: /api/
    uri: http://127.0.0.1:8000/api/
```

> `direct` 模式下浏览器直接访问 `http://127.0.0.1:8123/ag-ui`，需要后端允许跨域并携带凭据。

> SSE 检查：若走 OAuth2 Proxy/网关，先验证它不缓冲 SSE（`flush-interval`/`X-Accel-Buffering`），否则流式 token 会被攒批（见 `design/08` §7.4）。

## 3. 快速验证每一跳

### 3.1 普通 REST（Agent Registry）

```bash
curl -sS http://127.0.0.1:8000/api/getFabOptions \
  -H 'Content-Type: application/json' \
  -d '{"type":"agent","mode":"all","locale":"zh-CN"}'
```

前端验证：浏览器 Network → `/api/getFabOptions` → 200 + `code:0`。

生产形态应改为从 OAuth2 Proxy 入口验证（带 SSO 会话）：

```bash
curl -sS https://agentdock.company.example/api/getFabOptions \
  -H 'Content-Type: application/json' \
  -d '{"type":"agent","mode":"all","locale":"zh-CN"}'
```

### 3.2 Orchestration `/ag-ui`（后端直验）

```bash
curl -sSN http://127.0.0.1:8123/ag-ui \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d '{
    "threadId":"thread-debug-001",
    "runId":"debug-run-001",
    "state":{},
    "messages":[{"id":"m1","role":"user","content":"你好"}],
    "tools":[],"context":[],
    "forwardedProps":{"action":"run","sessionId":"session-debug-001","agentId":"flight-analysis","fab":"F15B"}
  }'
```

必须看到：`RUN_STARTED`（runId=debug-run-001）→ 文本事件 → `RUN_FINISHED`。

### 3.3 Copilot Runtime（生产形态）

```bash
curl -sSN https://agentdock.company.example/api/copilotkit \
  -H 'Content-Type: application/json' \
  -d '{"threadId":"thread-debug-001","runId":"debug-run-002",...}'
```

若 422 → 检查 `AGENT_ORCHESTRATION_BASE_URLS_JSON` 是否有该 FAB；若 502 → 上游 `{fab}/ag-ui` 不可达。

## 4. 事件消费回显调试（前端）

### 4.1 三层日志

1. **Browser Network**：查看 `/api/copilotkit`（或 direct URL）的响应体，确认 SSE `id:` 与 `data:` 完整。
2. **parseSseStream**（`src/api/runtime/sse.ts`）：断点确认每个 `streamId` 是否解析成功。
3. **reduceRunEvent**（`src/api/runtime/runReducer.ts`）：断点确认事件进入对应分支（messages/reasoning/toolCalls/surfaces/activities/status）。

### 4.2 关键断点位置

| 文件 | 断点 | 排查内容 |
|---|---|---|
| `src/api/runtime/agentRuntimeService.ts` | `stream()` | 请求 URL、body、响应状态 |
| `src/api/runtime/sse.ts` | `yield` 前 | SSE 解析结果、streamId |
| `src/api/runtime/runReducer.ts` | `switch` 各 case | 事件映射正确性 |
| `src/stores/runStore.ts` | `execute()` | checkpoint 是否写入、resume 是否正确 |
| `server/copilot-runtime/fabProxy.ts` | `handleCopilotRuntimeRequest` | FAB 路由、header 透传、上游状态 |
| `src/features/chat/components/MessageBlocks.tsx` | `renderRunBlocks` | 各 block 是否生成 |

### 4.3 IndexedDB 检查

浏览器 DevTools → Application → IndexedDB → `agentdock-session-v2`：

- `sessions`：sessionId/threadId/agent/fab。
- `messages`：已落盘消息（messageId/runId/streamId）。
- `checkpoints`：每次 run 的 input + snapshot + latestStreamId。

刷新后恢复逻辑：`restoreSession` → 取最新 checkpoint → `status==='running'` 时 `resume(lastStreamId)`。

## 5. A2UI 调试

1. 确认 Runtime 开启 A2UI（provider catalog 或 runtime `a2ui` 配置）。
2. Network 中搜 `render_a2ui` 的 `TOOL_CALL_ARGS`，检查 JSON 是否合法（surfaceId/catalogId/components）。
3. reducer 中确认 `run.surfaces[surfaceId]` 存在。
4. `A2uiSurfaceBlock` / renderer 断点确认组件 props。
5. 点击按钮 → Network 中出现新 run，`forwardedProps.a2uiAction` 携带 `surfaceId/actionName/context`，且 `parentRunId` 正确。

常见失败：

| 现象 | 原因 |
|---|---|
| surface 不出现 | A2UI 未启用 / catalog 未传 / 事件类型不是 a2ui.surface |
| 组件渲染成 raw JSON | renderer 未注册该组件定义 |
| 按钮无响应 | `useA2UIActionHandler` 未注册或 action 字段不匹配 |
| action 新 run 无上下文 | 后端没有按 parentRunId 关联，或 threadId 换了 |

## 6. 常见故障排查表

| 现象 | 检查点 | 归属 |
|---|---|---|
| 页面一直 loading | Registry 接口是否通；VITE_SERVICE_MODE 是否 http | 前端/Registry |
| FAB 无选项 | `/api/market/getFabOptions` 返回；permissioned 为空 | Registry |
| 422 FAB_ENDPOINT_NOT_CONFIGURED | `AGENT_ORCHESTRATION_BASE_URLS_JSON` 缺 FAB | App Server |
| 502 FAB_ENDPOINT_UNAVAILABLE | `{fab}/ag-ui` 可达性/认证/路径 | App Server/Orchestration |
| 收到事件但页面无流式 | parseSseStream/runReducer 断点；事件类型是否被 switch 覆盖 | 前端 |
| runId 与请求不一致 | Orchestration 是否沿用输入 runId（禁止二次生成） | 后端 |
| 刷新后对话消失 | IndexedDB checkpoint 是否写入；restoreSession 是否被调用 | 前端 |
| 刷新后重复拼接文本 | resume 未带 lastStreamId 或后端未按 streamId 过滤 | 前端/后端 |
| HITL 按钮无响应 | requestId 是否为空；hitlResponse 是否到达后端 | 前端/后端 |
| 中文/英文混排 | locale 是否传了用户设置；请求 locale 是否硬编码 | 前端 |

## 7. 回显（事件消费）自检命令

开发态可在浏览器 Console 注入：

```js
// 检查最近一次 run 的事件类型序列
const s = window.__AGENTDOCK__?.runStore?.getState?.().run;
console.table(s?.rawEvents?.map(e => [e.type, e.messageId || e.toolCallId || '', e.streamId]));
```

期望序列示例：`RUN_STARTED → STEP_STARTED → REASONING_* → TOOL_CALL_* → ACTIVITY_SNAPSHOT(a2ui.surface) → TEXT_MESSAGE_* → RUN_FINISHED`。

## 8. 上线 Checklist

- [ ] `VITE_AGENT_RUNTIME_TRANSPORT=proxy`，`VITE_AGENT_ORCHESTRATION_ENDPOINTS_JSON={}`。
- [ ] CD `deployment.yml` 注入 `AGENT_ORCHESTRATION_BASE_URLS_JSON` + `AGENT_REGISTRY_BASE_URL`。
- [ ] OAuth2 Proxy 将 `/api/*` 路由到 Registry、`/api/copilotkit` 路由到 Runtime（不自行实现反向代理）。
- [ ] `/api/copilotkit` 挂载 Runtime handler（single-route）。
- [ ] FAB URL 协议按公司内网规范（代码不强制 http/https）。
- [ ] 日志脱敏：不记录 SSO Token、完整用户问题与工具敏感结果。
