# 公司内无缝调试指南：Agent Registry + Orchestration + AG-UI/A2UI

> 面向对象：前后端联调工程师  
> 目标：不改业务代码的前提下，快速定位“消息没出来 / 事件没消费 / 回显不对”发生在哪一跳。  
> 前置说明：生产认证与路由由 OAuth2 Proxy 统一处理（SSO token 注入 + 固定 path 转发），仓库不自建反向代理。生产实时链路使用官方 single-route envelope（`{ method, params, body }`）；direct 联调使用自研 SSE（body 为全文 `RunAgentInput`）。架构决策见 `design/08`，渲染投影见 `design/09`，端到端 review 见 `design/10`。

## 1. 环境矩阵

| 场景 | `VITE_SERVICE_MODE` | `VITE_AGENT_RUNTIME_TRANSPORT` | 实时数据来源 |
|---|---|---|---|
| 纯前端开发 | `mock` | `proxy` | Mock Service + Mock SSE（自研 reducer） |
| 接真实 Registry | `http` | `proxy` | 真实 `/api/*`（经 OAuth2 Proxy 路由到 Registry）；对话仍走 Mock SSE |
| 接真实 Orchestration（direct） | `http` | `direct` | 浏览器直连 `{fab}/ag-ui`（自研 SSE client，body 为全文 `RunAgentInput`，需 CORS/认证且后端接受全文转发） |
| 生产形态 | `http` | `proxy` | 浏览器 → `/api/copilotkit`（官方 envelope）→ Runtime → `{fab}/ag-ui` |

推荐联调顺序：**Mock 全通 → Registry HTTP → Orchestration direct → 生产 proxy**。

> 注意：`useAgentDockConversation` 的官方 CopilotKit 路径只在 `http + proxy` 生效；`http + direct` 自动回退自研 SSE（避免误用需 Enterprise 的官方直连）。

## 2. 配置与启动

### 2.1 前端 `.env`

```env
VITE_SERVICE_MODE=http
VITE_API_BASE_URL=/api
# direct 联调时：
VITE_AGENT_RUNTIME_TRANSPORT=direct
VITE_AGENT_ORCHESTRATION_ENDPOINTS_JSON={"F15B":"http://127.0.0.1:8123"}
# 生产时：
VITE_AGENT_RUNTIME_TRANSPORT=proxy
VITE_AGENT_ORCHESTRATION_ENDPOINTS_JSON={}
```

### 2.2 Copilot Runtime（本地进程）

```bash
pnpm run server
```

```env
PORT=3000
HOST=127.0.0.1
AGENT_REGISTRY_BASE_URL=http://127.0.0.1:8000
AGENT_ORCHESTRATION_BASE_URLS_JSON={"F15B":"http://127.0.0.1:8123"}
# 可选：AGENTDOCK_DIST_DIR=dist（托管 SPA）；COPILOTKIT_TELEMETRY_DISABLED=true
```

### 2.3 OAuth2 Proxy（或本地临时 nginx 等价物）upstream 示例

```yaml
upstreams:
  - path: /api/market/
    uri: http://127.0.0.1:8000/api/market/
  - path: /api/copilotkit
    uri: http://127.0.0.1:3000/api/copilotkit
  - path: /api/
    uri: http://127.0.0.1:8000/api/
```

> SSE 检查：若走 OAuth2 Proxy/网关，先验证它不缓冲 SSE（`flush-interval`/`X-Accel-Buffering`），否则流式 token 会被攒批。

## 3. 快速验证每一跳

### 3.1 普通 REST（Agent Registry）

```bash
curl -sS http://127.0.0.1:8000/api/market/getFabOptions \
  -H 'Content-Type: application/json' \
  -d '{"type":"agent","mode":"all","locale":"zh-CN"}'
```

前端验证：浏览器 Network → `/api/market/getFabOptions` → 200 + `code:0`。

生产形态从 OAuth2 Proxy 入口验证（带 SSO 会话）：

```bash
curl -sS https://agentdock.company.example/api/market/getFabOptions \
  -H 'Content-Type: application/json' \
  -d '{"type":"agent","mode":"all","locale":"zh-CN"}'
```

其他 Registry 端点（前端实际路径）：`getAgentCategories`、`getAgentsListByCategoryAndKW`、`getAgentDetailById`、`getMentionAgentsList`、`getSkillCategories`、`getSkillsListByCategoryAndKW`、`getSkillDetailById`、`createAndPublishSkill`、`getMcpServerCategories`、`getMcpServersListByCategoryAndKW`、`getMcpServerDetailById`。

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

### 3.3 Copilot Runtime（生产形态，官方 single-route）

先验证发现端点（single-route 用 `info` envelope）：

```bash
curl -sS -X POST http://127.0.0.1:3000/api/copilotkit \
  -H 'Content-Type: application/json' \
  -d '{"method":"info","params":{},"body":{}}'
# 期望：version=1.68.1、agents.orchestration、a2uiEnabled=true
```

再验证真实 run：

```bash
curl -sSN -X POST http://127.0.0.1:3000/api/copilotkit \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d '{
    "method":"agent/run",
    "params":{"agentId":"orchestration","threadId":"thread-debug-001"},
    "body":{
      "threadId":"thread-debug-001",
      "runId":"debug-run-002",
      "state":{},
      "messages":[{"id":"m1","role":"user","content":"你好"}],
      "tools":[],"context":[],
      "forwardedProps":{"action":"run","sessionId":"session-debug-001","agentId":"flight-analysis","fab":"F15B"}
    }
  }'
```

错误定位：

- `FAB_ENDPOINT_NOT_CONFIGURED`（422）→ `AGENT_ORCHESTRATION_BASE_URLS_JSON` 缺该 FAB。
- `FAB_ENDPOINT_UNAVAILABLE`（502）→ 上游 `{fab}/ag-ui` 不可达/鉴权失败/路径错误。
- `415/400 invalid JSON` → envelope 格式错误（method 必须是 `agent/run` 等合法值）。

## 4. 事件消费回显调试（前端）

### 4.1 三层日志

1. **Browser Network**：查看 `POST /api/copilotkit`（生产）或 direct URL（本地）的响应体，确认 SSE `id:` 与 `data:` 完整。
2. **`useAgentDockConversation.applyEvent`**（http+proxy）或 **`runStore.execute`**（mock/direct）：断点确认每个事件进入投影。
3. **`reduceRunEvent`**（`src/api/runtime/runReducer.ts`）：断点确认事件进入对应分支（messages/reasoning/toolCalls/steps/surfaces/activities/status）。

### 4.2 关键断点位置

| 文件 | 断点 | 排查内容 |
|---|---|---|
| `src/features/chat/useAgentDockConversation.ts` | `applyEvent()` | 官方事件是否被订阅/投影、checkpoint 是否调度 |
| `src/api/runtime/runReducer.ts` | `switch` 各 case | 事件映射正确性、orderedBlocks 顺序 |
| `src/stores/runStore.ts` | `execute()` | mock/direct 路径的 SSE 消费、checkpoint、resume |
| `server/copilot-runtime/fabRoutingAgent.ts` | `run()` | FAB 路由、上游 URL、HttpAgent 转发 |
| `server/index.ts` | `nodeHandler` | envelope 是否命中 single-route、`/info` 是否返回 agents |
| `src/features/chat/components/MessageBlocks.tsx` | `renderRunBlocks` / `renderStoredBlocks` | 各 block 是否生成、顺序是否正确 |
| `src/features/chat/a2ui/catalog.tsx` | renderer | A2UI 组件是否渲染、dispatch 是否触发 |

### 4.3 IndexedDB 检查

浏览器 DevTools → Application → IndexedDB → `agentdock-session-v3`：

- `sessions`：sessionId/threadId/agent/fab。
- `messages`：全部消息类型（text/reasoning/tool/activity/step/surface）按 `sequence` 排序。
- `checkpoints`：每次 run 的 input + snapshot + latestEventId + status。

刷新恢复逻辑：

- http+proxy：`restore()` 读取最新 checkpoint → 回填 `agent.setMessages` → 若 `running/paused` 且有 `latestEventId`，自动 `agent.connectAgent` 携带 `action=resume + resume.lastEventId`（按 eventId 游标恢复，方向已冻结；后端需按游标过滤）。
- mock/direct：`runStore.restoreSession` → 若 `status === 'running'` 且 `latestEventId` 存在 → `resume(lastEventId)`。

## 5. A2UI 调试

1. 确认 Runtime 开启 A2UI：`CopilotRuntime({ agents, a2ui: {} })`；`/info` 返回 `a2uiEnabled: true`。
2. Network 中搜 `render_a2ui` 的 `TOOL_CALL_ARGS`，检查 JSON 是否合法（surfaceId/components/data）。
3. Runtime middleware 会把它转成 `ACTIVITY_SNAPSHOT(activityType="a2ui-surface", content={ a2ui_operations })`；前端 `useRenderActivityMessage` 消费。
4. 点击按钮 → 官方 renderer 的 action bridge 发送新 run，`forwardedProps.a2uiAction.userAction` 携带 `surfaceId/actionName/context/sourceComponentId`。
5. 恢复历史/Mock 的 surface 走 `A2uiStoredSurface`（按 payload 组件重建），未知组件回退 raw JSON。

常见失败：

| 现象 | 原因 |
|---|---|
| surface 不出现 | Runtime `a2ui` 未启用 / Provider 未传 `a2ui={{ catalog }}` / activityType 不是 `a2ui-surface` |
| 组件渲染成 raw JSON | 组件名不在 catalog（`metricCard/actionButton`）或 payload 结构不符 |
| 按钮无响应 | 官方 renderer 未挂载；自研后备未传 `surfaceId/actionName` |
| action 新 run 无上下文 | 后端未按 `threadId` 关联；`userAction` 未嵌套 |

## 6. 常见故障排查表

| 现象 | 检查点 | 归属 |
|---|---|---|
| 页面一直 loading | Registry 接口是否通；`VITE_SERVICE_MODE` 是否 http | 前端/Registry |
| FAB 无选项 | `/api/market/getFabOptions` 返回；permissioned 为空 | Registry |
| `/api/copilotkit` 400/415 | envelope 格式（method/params/body） | 前端/Runtime |
| 422 FAB_ENDPOINT_NOT_CONFIGURED | `AGENT_ORCHESTRATION_BASE_URLS_JSON` 缺 FAB | Runtime |
| 502 FAB_ENDPOINT_UNAVAILABLE | `{fab}/ag-ui` 可达性/认证/路径 | Runtime/Orchestration |
| 收到事件但页面无流式 | applyEvent/runReducer 断点；事件类型是否被 switch 覆盖 | 前端 |
| runId 与请求不一致 | Orchestration 是否沿用输入 runId（禁止二次生成） | 后端 |
| 刷新后对话消失 | IndexedDB v3 checkpoint 是否写入；restore 是否被调用 | 前端 |
| 刷新后重复拼接文本 | 官方路径：agent.messages 回填是否重复；mock：resume lastEventId | 前端/后端 |
| HITL 按钮无响应 | requestId 是否为空；标准 interrupt 还是 legacy on_interrupt（wire 需先冻结） | 前端/后端 |
| A2UI 按钮无响应 | `userAction` 嵌套；catalog 是否匹配 | 前端/Runtime |
| 中文/英文混排 | locale 是否传了用户设置；请求 locale 是否硬编码 | 前端 |

## 7. 回显（事件消费）自检

浏览器 Console 注入（mock/direct 有 runStore；http+proxy 直接看 Network + applyEvent 断点）：

```js
const s = window.__AGENTDOCK__?.runStore?.getState?.().run;
console.table(s?.rawEvents?.map(e => [e.type, e.messageId || e.toolCallId || '', e.eventId]));
```

期望序列示例：`RUN_STARTED → STEP_STARTED → REASONING_* → TOOL_CALL_* → ACTIVITY_SNAPSHOT(a2ui-surface) → TEXT_MESSAGE_* → RUN_FINISHED`。

## 8. 上线 Checklist

- [ ] `VITE_SERVICE_MODE=http`、`VITE_AGENT_RUNTIME_TRANSPORT=proxy`、`VITE_AGENT_ORCHESTRATION_ENDPOINTS_JSON={}`。
- [ ] CD `deployment.yml` 注入 `AGENT_ORCHESTRATION_BASE_URLS_JSON` + `AGENT_REGISTRY_BASE_URL`。
- [ ] OAuth2 Proxy：`/api/*` → Registry、`/api/copilotkit` → Runtime（不自行实现反向代理）。
- [ ] `pnpm run server` 启动的 Runtime 暴露 single-route `/api/copilotkit` + `/healthz`。
- [ ] `/api/copilotkit` `/info` 返回 `agents.orchestration` + `a2uiEnabled: true`。
- [ ] 前端 `runtimeUrl=/api/copilotkit` + `useSingleEndpoint` + `a2ui={{ catalog }}`。
- [ ] FAB URL 协议按公司内网规范（代码不强制 http/https）。
- [ ] 日志脱敏：不记录 SSO Token、完整用户问题与工具敏感结果。

## 9. 联调前与后端确认清单

- [ ] HITL wire：标准 `RUN_FINISHED(outcome=interrupt) + RunAgentInput.resume[]`，还是 legacy `on_interrupt`（前端双路径已实现，需冻结一种）。
- [x] 断线恢复方向：**按 `lastEventId` 游标恢复**（已冻结）；后端需只返回游标之后的事件。
- [ ] Redis event log TTL 与游标过期后的错误行为（`STREAM_EXPIRED`）。
- [ ] A2UI：动态 schema（`injectA2UITool`）还是固定 schema（`a2ui_operations`）；提供一条真实 `render_a2ui` fixture。
- [ ] `AGENT_ORCHESTRATION_BASE_URLS_JSON` 的 FAB → 域名映射与 SSO 透传方式（Cookie vs Authorization）。

## 10. UI 自动化测试稳定选择器

`@lobehub/ui` 的 ActionIcon 渲染为 `div[role="button"]`，**不是 `<button>` 标签**；aria-label 随界面语言变化（如中文为“发送消息”）。UI 测试应使用固定 testid，不要按标签或硬编码英文文案定位：

| 控件 | 选择器 |
|---|---|
| 消息输入框 | `[data-testid="chat-input"]` |
| 发送 | `[data-testid="chat-send"]`（role=button） |
| 停止 | `[data-testid="chat-stop"]`（role=button） |

示例（Playwright）：

```ts
await page.fill('[data-testid="chat-input"]', '你好');
await page.click('[data-testid="chat-send"]');
```
