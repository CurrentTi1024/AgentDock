# 消息历史与渲染修复记录（2026-08-20）

> 状态：已合入并验证
> 关联：`runReducer.ts`、`sessionHistoryService.ts`、`ChatPage.tsx`、`useAgentDockConversation.ts`、`MessageBlocks.tsx`、`server/index.ts`、`agent-dock/.env`

## 1. 完成态回复从页面消失（历史刷新与 IndexedDB 落库竞态）

### 现象

run 结束后助手回复短暂可见，随后从页面消失；刷新后历史里只有用户消息。原因是终态时两条异步链竞态：

1. `RUN_FINISHED` 到达 → `applyEvent` 更新 UI 状态为 success；
2. 同时 `flushRunCheckpoint()` 异步把快照写入 IndexedDB（`checkpoints` + `messages` bulkPut）；
3. ChatPage 的 `[run?.status]` effect 立刻 `getMessages()`，大概率读到**尚未写入助手回复**的中间快照 → 历史为空/缺助手消息，且之后不再刷新。

### 修复

- **主修复（事件驱动，确定性）**：`saveRunCheckpoint` 落库完成后广播 `window.dispatchEvent(new CustomEvent('agentdock:run-persisted'))`；ChatPage 监听该事件刷新历史。
- **兜底**：保留终态后 600ms 延迟刷新（大 run 落库耗时超过事件回调窗口时的第二道保险）。

### 坑

> 不要用固定 setTimeout 作为唯一机制：A2UI/RAW 事件可能让快照达到数 MB，IndexedDB 写入时间不可预估；必须由“落库完成”这个事实驱动刷新。

## 2. 历史重复：`lc_run--<langgraph run id>` 与规范 UUID 双份

### 现象

同一助手回复在历史里出现两条：

- 流式阶段：`TEXT_MESSAGE_START` 的 `messageId` 是 `lc_run--<langgraph run_id>`（ag_ui-langgraph 透传 langchain 内部消息 id）；
- 终态快照：`MESSAGES_SNAPSHOT` 携带同一回复的规范 UUID id。

reducer 对两者都写入 `messages`，落库后重复显示。

### 修复（runReducer `MESSAGES_SNAPSHOT`）

```ts
if (String(message.id).startsWith('lc_run--')) continue;               // 快照里的内部 id 直接跳过
if (message.role === 'assistant') {
  const placeholderId = Object.keys(next.messages).find(
    (id) => id.startsWith('lc_run--')
      && next.messages[id].role === 'assistant'
      && next.messages[id].content === message.content,
  );
  if (placeholderId) delete next.messages[placeholderId];              // 流式占位 → 规范 UUID
}
next.messages[message.id] = message;
```

效果：同一回复只保留一个规范 id，且流式期间已渲染的内容不丢失。

### 坑

> 不要简单“跳过所有 `lc_run--`”：流式 TEXT 事件本身就用 `lc_run--` 作为 messageId，直接跳过会让实时气泡没有内容载体；必须“快照到达时替换占位”。

## 3. 页面显示 mock 的根因：构建环境变量被并行会话覆盖

### 现象

`VITE_SERVICE_MODE` 曾同时控制“市场 API”与“对话 runtime”。并行会话在重新构建 dist 时未携带 `VITE_CHAT_MODE`，chat 回退到 `VITE_SERVICE_MODE=mock` → 页面对话全部走 mock SSE。

### 修复

1. `serviceMode.ts` 拆分两个独立开关：
   - 市场等普通 API：`VITE_SERVICE_MODE` + localStorage `agentdock-service-mode`；
   - 对话 runtime：`VITE_CHAT_MODE`（缺省回退 `VITE_SERVICE_MODE`）+ localStorage `agentdock-chat-mode`。
2. 全部对话链路（Provider 挂载、`useAgentDockConversation` 官方路径、`agentRuntimeService`、`runtimeConfig`、ChatPage surface 门控）改用 `getChatServiceMode()`。
3. 写入 `agent-dock/.env` 固化：`VITE_CHAT_MODE=http` + `VITE_SERVICE_MODE=mock`，任何一次 `pnpm build` 都保持该组合。

### 坑

> 并行会话/CI 构建时若漏配 `VITE_CHAT_MODE`，页面会静默回退 mock；必须把关键运行时开关写进仓库内 `.env`，并在 dist 产物中验证（`serviceMode-*.js` 内 chat 默认值应为 `http`）。

## 4. 构建失败：`@lobehub/ui` 不存在的导出

### 现象

新迁移页面引用了 `@lobehub/ui` 根包不存在的 `Switch` / `ContextMenu`，`vite build` 报 `MISSING_EXPORT`；另有一批 TS 类型错误（`Block.center`、`Text.flex`、`Input.TextArea`、`ScheduledTask` 字段等）。

### 修复

- `Switch`：改从 `@lobehub/ui/base-ui` 导入（WorkspacePage 同款用法）。
- `ContextMenu`：改为 antd `Dropdown`（`trigger={['contextMenu']}` + 外层 div `onContextMenu` preventDefault）。
- `Block.center` → style `display:flex; align-items/justify-content:center`；`Text.flex` → style `flex:1; minWidth:0`；`Input.TextArea` → 独立 `TextArea`；`ScheduledTask` 使用真实字段（`assigneeAgentName/schedulePattern/name/identifier`）。
- de/fr/nl 缺失 i18n key 补译至“与 en-US 相同 key < 30”阈值以下。

### 坑

> 从 LobeHub 迁移组件时，`@lobehub/ui` 根包与 `base-ui` 子路径导出集合不同；先 `rg` 确认导出存在再引用。`pnpm run build` 是 `tsc --noEmit && vite build`，新页面必须同时过类型检查。

## 5. 附：本轮其他渲染修复

- `ReasoningBlock`：`useState(streaming)` 只初始化一次，流式结束不会自动收起 → 增加 `useEffect` 在 `streaming=false` 时 `setOpen(false)`（完成自动折叠，可点击展开）。
- 官方路径 `send()`：发送后立即把用户消息写入投影状态（事件流到达前页面即可见用户气泡）。
- `runAgent` 异常兜底：`try/catch` 写 `RUN_ERROR(NETWORK_ERROR)`，避免客户端流中断时 UI 永久卡 running。

## 6. 验证

- 单元：`pnpm run test` 28/28（含快照 system 过滤、`lc_run--` 占位替换回归用例）。
- 构建：`pnpm run build` 通过。
- 浏览器（无头 Chrome）：文本/历史顺序/工具/A2UI/停止/mock thinking 折叠/HITL 全链路通过，详见 `11-e2e-joint-test-report.md`。
