# RUN_ERROR 错误兜底：UI 测试场景指南

> 目的：验证“后端/上游报错 → RUN_ERROR → assistant 错误回复 → 持久化到历史”整条链路。
> 机制说明见 `docs/design/chat-indexeddb-storage.md` §8.6。

---

## 1. Mock 模式（推荐，零依赖）

设置页 → 通用 → 对话运行时切到 **Mock**。在任一 Agent 会话输入框输入以下关键词发送，即可触发对应错误路径：

| 输入关键词 | 模拟场景 | 期望行为 |
|---|---|---|
| `!error`（或“后端报错”） | 上游 Orchestration 直接返回结构化 RUN_ERROR（无部分回复） | assistant 气泡显示【Mock 后端错误】文案；刷新后该回复仍在历史 |
| `!partial-error`（或“部分回复后报错”） | 先流式输出部分回复，随后后端报错 | 部分回复 + 换行 + 错误文案，合并为**同一条** assistant 消息的最后一个 chunk；刷新后完整保留 |
| `!runtime-error`（或“runtime中断”） | 流中途抛错（模拟 runtime 捕获的上游网络中断） | 触发 runStore 兜底 → assistant 回复显示 NETWORK_ERROR 文案；刷新后仍在历史 |
| 正常发送 + 点击停止 | 用户主动取消 | **不生成**错误回复（CANCELLED 不伪造消息） |

**验证点（三个场景通用）**

1. 发送后界面出现 assistant 错误回复（不是红条/空白/卡 loading）。
2. 错误回复作为历史消息存在：刷新页面 / 重新进入会话后仍能看到。
3. 删除该轮（消息操作 → 删除并重新生成 或 删除）后错误回复随之消失。
4. 运行期间“停止生成”按钮可正常结束；不再出现“卡死/一直转圈”。

---

## 2. HTTP / 代理模式（真实后端）

前置：启动 agent-dock server（`pnpm server`）与 demo 后端，并配置
`AGENT_ORCHESTRATION_BASE_URLS_JSON={"F15B":"http://127.0.0.1:8000"}`；设置页对话运行时切到 **HTTP**。

| 场景 | 操作 | 期望行为 |
|---|---|---|
| 上游返回 RUN_ERROR | 让 demo 后端在 run 中返回错误（如请求未知 runId 触发 `STREAM_EXPIRED`） | 结构化 RUN_ERROR → assistant 错误回复并持久化 |
| 上游 5xx | 停止 demo 后端进程后发送 | Runtime `catchError` → `RUN_ERROR(FAB_UPSTREAM_ERROR)` → assistant 错误回复；前端**不会**收到断流/network error |
| FAB 未配置 | 发送到 `AGENT_ORCHESTRATION_BASE_URLS_JSON` 里不存在的 fab | `RUN_ERROR(FAB_ENDPOINT_NOT_CONFIGURED)` → assistant 错误回复（不再抛异常断流） |
| 上游端口不通 | 把某 fab 的 URL 指向未监听端口后发送 | 同上，`FAB_UPSTREAM_ERROR` |

**验证点**

1. 每种故障下，对话都出现 assistant 错误回复，且刷新后仍在历史。
2. `pnpm server` 控制台不出现未捕获异常（错误已被 FabRoutingAgent 转为事件）。
3. 重复 run 守卫：同一 run 重复 action=run 被拒时返回 `FAB_DUPLICATE_RUN` 结构化错误。

---

## 3. 快速自检清单

- [ ] `!error`：assistant 错误回复出现，刷新后仍在。
- [ ] `!partial-error`：部分回复 + 错误文案在同一气泡内（追加为最后一个 chunk）。
- [ ] `!runtime-error`：不卡 loading，出现 NETWORK_ERROR 回复。
- [ ] 停止生成：无错误回复，历史干净。
- [ ] 删除错误轮次后，历史中不再出现该错误回复。
