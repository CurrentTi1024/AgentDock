# AgentDock Session 本地存储方案：现状对比 LobeHub 与完整 IndexedDB（Dexie）设计方案

> 日期：2026-08-24
> 范围：会话 / 消息 / Run 检查点的 IndexedDB 落库、容量监控预警、用户主动导出清理，以及配套的防抖、迁移、跨页面同步机制。
> 结论速览：agent-dock 当前方案“主链路可用”，但与 LobeHub 相比缺少**版本化迁移、lastMessageAt 语义、容量监控、导出/清理、跨标签页同步**五块。本文给出基于 Dexie 的完整方案并落地代码（`src/api/session/sessionHistoryService.ts` + 新增 `src/api/session/sessionStorageService.ts` + 设置页 Storage Tab）。

---

## 1. 现状：agent-dock 的 IndexedDB 存储方案

### 1.1 数据库与表结构

数据库名 `agentdock-session-v3`（历史命名，schema 版本实际为 1），Dexie 定义在 `src/api/session/sessionHistoryService.ts:20-27`：

| 表 | 主键 | 索引 | 说明 |
|---|---|---|---|
| `sessions` | `id` | `threadId, updatedAt, pinned, type` | 会话元信息（agent / group） |
| `messages` | `id`（`${kind}:${rawId}`） | `sessionId, runId, createdAt, sequence` | 消息 + 过程块（text/reasoning/tool/step/activity/surface） |
| `checkpoints` | `runId` | `sessionId, threadId, status, updatedAt` | 每次 Run 的完整 `RuntimeRunState` 快照 |

### 1.2 数据生命周期与既有机制

- **防抖写入**：`scheduleRunCheckpoint`（`:204-210`）按 `runId` 分槽，空闲 350ms 统一 `flushRunCheckpoint`；终态（success/cancelled/error）显式 flush（`runStore.ts:11,15`）。多轮并发互不覆盖。
- **多轮顺序**：`persistRunSnapshot`（`:141-197`）保留已存在消息的 `sequence/createdAt/runId`，新消息按 `messageOrder` 追加，避免时间线错乱。
- **级联删除**：`removeSession` 事务内删除 sessions + messages + checkpoints；`removeMessage(s)/removeTurn` 联动清理 checkpoint 防止快照复活已删消息。
- **跨页面（弱）**：同窗口内靠 `window` CustomEvent（`agentdock:sessions-changed` / `agentdock:run-persisted`）刷新侧栏；`blocked` / `versionchange` 监听处理 schema 升级阻塞（`:18-29`），`AppShell.tsx` 显示阻塞提示。
- **断线恢复**：`getLatestRecoverableRun` 取 `running/paused` 的最新 checkpoint（`:200`）。

### 1.3 已有能力缺口（本方案要补的）

1. **无版本化迁移**：只有 `version(1)`，库名却带 v3 后缀；字段演进没有 `upgrade` 回填钩子。
2. **无 lastMessageAt**：会话只有 `updatedAt`（随 checkpoint 落库刷新，空会话也刷新），无法满足“按 session 内最后一条消息时间”清理。
3. **无容量监控预警**：不读 `navigator.storage.estimate()`，QuotaExceededError 只能让写入失败。
4. **无导出/清理**：只有单条删除，没有批量导出 + 删除能力。
5. **跨标签页不同步**：CustomEvent 只在当前窗口内生效；另一个标签页删除会话后当前页侧栏不刷新。
6. **checkpoint 只增不删**：每次 Run 全量快照，长会话膨胀（详见 `INDEXEDDB_SCHEMA_ANALYSIS.md` §6.1）。
7. **无操作中间层**：会话/存储操作由页面直调 service，状态与监听逻辑散落各页；仅运行态有 `runStore`（zustand）。

---

## 2. LobeHub 存储方案与差距分析

### 2.1 经典 LobeChat 本地库（Dexie，`src/database/_deprecated`）

LobeHub 早期版本的本地库是 Dexie，schema 从 V1 迭代到 V9+（`src/database/_deprecated/core/schemas.ts`），核心设计：

```ts
messages: '&id, role, content, fromModel, favorite, plugin.identifier, plugin.apiName,
           translate.content, createdAt, updatedAt, sessionId, topicId, quotaId, parentId,
           [sessionId+topicId], traceId',
sessions: '&id, type, group, pinned, meta.title, meta.description, meta.tags, createdAt, updatedAt',
topics:   '&id, title, favorite, createdAt, updatedAt, sessionId',
```

关键点：

| 机制 | LobeHub 做法 | 对 agent-dock 的借鉴 |
|---|---|---|
| 版本化迁移 | `this.version(1..11).stores(...)`，每个版本带 `upgrade((trans) => ...)` 数据回填（V4 pinned 归一、V9 function→tool 拆分等） | schema 演进必须走 Dexie version + upgrade 事务，而不是改库名 |
| 写入校验 | `BaseModel` 每次写库前 `schema.safeParse`（zod），失败抛错不落脏数据 | 为 SessionRecord 等加轻量校验（至少关键字段） |
| 复合索引 | `[sessionId+topicId]` 支持“会话内按主题”查询 | 为 Agent Space 场景补 `[agentId+fab]` |
| 消息分支 | `messages.parentId` 表达回复/分支关系 | 目前 agent-dock 用 runId 整轮删除，够用，可后续补 parentId |
| 置顶 | `sessions.pinned` 为 number 并有 UI | agent-dock 已有字段无 UI |
| 导出 | `ConfigService`：`exportType + state + version` 的 JSON 配置包，支持 all/sessions/agents/settings/singleSession；导入时按版本迁移 | 导出文件应带版本与 schema，便于将来导入 |
| 容量展示 | 设置页 `IndexedDBStorage` 用 `navigator.storage.estimate()` 显示 used/quota 进度条 | agent-dock 直接复用该 API |
| 本地/远端统一 | 后续演进为 `localDatabase` 适配器抽象（IndexedDB 单记录库 / Electron SQLite），迁移用只追加 manifest | agent-dock 当前纯浏览器 Dexie，不需要适配器，但迁移 manifest 思想值得保留 |

### 2.2 LobeHub 演进路线（canary 现状）

canary 已把会话数据迁到服务端（drizzle + PostgreSQL），浏览器侧 `src/libs/localDatabase` 变成“单记录库 + 集合前缀”的通用缓存：

- 单 objectStore `records`，key = `collection\0key`，`entriesByPrefix` 按前缀扫；
- 迁移是只追加 manifest（`indexedDBMigrations`，当前 1 条把旧 Dexie schema 整体替换为 records 表）；
- Electron 侧注册 SQLite 适配器，渲染层通过 `localDatabase` 统一访问。

**结论**：agent-dock 是纯本地优先的 chat，不应该学 canary 退化到单记录库（丢失索引查询能力），而是借鉴**经典 Dexie 设计**——版本化 schema、复合索引、写入校验、导出格式、容量展示——并用 Dexie 落地（用户明确要求：用 Dexie，不用 forceStorage/localStorage 全量兜底）。

### 2.3 差距清单（agent-dock → LobeHub）

| 能力 | agent-dock 现状 | LobeHub 参考 | 本方案处理 |
|---|---|---|---|
| Schema 版本 | version(1) | version(1..11) + upgrade 回填 | version(2) + 回填 lastMessageAt |
| 按 Agent 查会话 | 全表扫 + JS filter | 索引/复合索引 | `[agentId+fab]` 索引 |
| 最后活动时间 | 仅 updatedAt | 无独立字段（用 updatedAt） | 新增 `lastMessageAt`（按最后消息时间） |
| 容量监控 | 无 | `navigator.storage.estimate()` 进度条 | 估算 + 阈值事件预警 + 设置页展示 |
| 导出/清理 | 无 | exportType/state/version JSON | 按天数/最旧 N 条导出并删除 |
| 跨标签页 | CustomEvent | （本地模式未强依赖） | BroadcastChannel + CustomEvent 双通道 |
| 卸载 flush | 无 | 无 | pagehide/visibilitychange 兜底 flush |
| checkpoint 膨胀 | 只增不删 | 无明确策略 | 已实现：终态一律不落库（历史以 messages 表为权威），仅 running/paused 保留（断线续传），启动清扫存量终态行 |

---

## 3. 完整方案设计（Dexie）

### 3.1 Schema v2（`sessionHistoryService.ts`）

```ts
this.version(2).stores({
  sessions: 'id,threadId,updatedAt,pinned,type,agentId,fab,[agentId+fab],createdAt,lastMessageAt',
  messages: 'id,sessionId,runId,createdAt,sequence',
  checkpoints: 'runId,sessionId,threadId,status,updatedAt',
});
```

- `sessions.lastMessageAt?: string`：会话内最后一条**消息**（text 行）的 `createdAt`；空会话回退 `createdAt`。
- `[agentId+fab]`：Agent Space 查询走索引（吸收 `INDEXEDDB_SCHEMA_ANALYSIS.md` 方案 A）。
- `upgrade(trans)`：遍历 sessions，取该会话 messages 中 kind=text 的最大 createdAt 回填；无消息的会话回填 createdAt。

### 3.2 lastMessageAt 维护点

写入口统一收敛到 `sessionHistoryService`：

| 操作 | 维护逻辑 |
|---|---|
| `persistRunSnapshot` | 计算本次快照 text 行最大 createdAt，与库内现有值取 max 后写入 |
| `saveRunCheckpoint` | 复用 persist 后的结果 |
| `removeMessage(s)/removeTurn` | 删除后重算该会话 text 行最大值，无消息回退 createdAt |
| `createSession` | 初始化为 `createdAt` |
| `updateSession` | 不覆盖 lastMessageAt（只改标题等） |

### 3.3 checkpoint 生命周期（按用户要求收紧）

checkpoint 是**运行状态快照**（完整 `RuntimeRunState`），用途只有两个：

1. **刷新/断线恢复**：`runStore.restoreSession` 取最新 checkpoint 恢复 `input + snapshot`，`running` 且有 `latestEventId` 时按游标续跑；HITL `paused` 恢复同样依赖。
2. **回放权威数据源**：`messages` 表只是投影渲染行，checkpoint 里才有完整 `messageOrder`、tool 结果、reasoning、activities、surfaces payload；删除/编辑消息时同步清理防“复活”。

**终态 checkpoint 完全不需要**：对话页 `isActiveRun` 仅对 `running/paused` 为真，终态恢复后 run 不参与渲染——历史文本与全部过程块都由 `messages` 表渲染。因此：

- `saveRunCheckpoint` 只对 `running/paused` 落 checkpoint（断线续传 / HITL 恢复）；终态（success/cancelled/error）只写 `messages` 表 + 更新会话时间戳，不写 checkpoint。
- `pruneCheckpoints` 删除会话内全部终态行（顺带回收旧格式存量）；启动时 `sweepTerminalCheckpoints` 全库清扫一次，幂等。
- 下一轮对话上下文不再依赖 checkpoint 回填：`useOfficialConversation.restore` 改为从 `messages` 表重建 `agent.setMessages`（历史权威源）。
- `getLatestRun` 只返回 running/paused（或 undefined）；历史渲染完全由 messages 表承担。

**内容压缩（进一步缩减体积）**：`saveRunCheckpoint` 落库前对快照与输入做最小化裁剪——

- 快照保留：`messages / messageOrder / orderedBlocks / reasoning / reasoningMeta / toolCalls / steps / activities / surfaces / error / status / latestEventId / processedEventIds`（UI 渲染与断线续传全部消费面）。
- 快照丢弃：`rawEvents`（完整 AG-UI 事件日志，UI 零消费，实测单条 run 168 事件占快照 ~57%，压缩后 reducer 从空数组继续追加）、`state`（仅 STATE_SNAPSHOT 时更新，恢复后为 undefined 也正常工作）。
- 输入裁剪：`context/state/tools` 置空（resume/续跑只消费 `forwardedProps + runId/threadId/messages`）。

实测：同一条 run 快照 44.8KB → 19.3KB（省 ~57%）；叠加“终态不落库”后，checkpoints 表在正常会话里趋近于空，存储占用主体只剩 messages 表（即用户要看的完整历史本身）。

### 3.4 防抖写入（保留并增强）

- 保留 per-run 槽 + 350ms 空闲 flush（现有行为，测试已守护）。
- 新增 `pagehide` / `visibilitychange=hidden` 兜底 `flushRunCheckpoint()`：把未落盘的最新快照在页面离开前尽力写入（IndexedDB 在 pagehide 下可用性不保证，作为 best-effort，不影响主链路）。
- QuotaExceededError 捕获：`withBlockedDiagnostic` 之外，落库失败时 dispatch `agentdock:storage-error`，AppShell 提示并引导去设置页清理。

### 3.5 跨页面同步（双通道）

- 新增 `BroadcastChannel('agentdock:session-sync')`：
  - 写入侧：`createSession/updateSession/removeSession/saveRunCheckpoint/removeMessage(s)/removeTurn/exportAndDelete` 后 `postMessage({ type: 'sessions-changed' })`；checkpoint 落库另发 `run-persisted`。
  - 读取侧：提供 `subscribeSessionChanges(callback)`，同时监听 BroadcastChannel 与同窗口 CustomEvent，返回退订函数。各侧栏/首页改用该订阅，跨标签页实时刷新。
- schema 升级：保留 `blocked/versionchange` 监听；`versionchange` 时主动 `db.close()` 并广播 `agentdock:db-versionchange`（其他标签页收到后延迟重试打开新版本）。

### 3.6 容量监控与预警（`src/api/session/sessionStorageService.ts`）

```ts
const STORAGE_WARNING_THRESHOLD = 0.7;  // 70% 提醒
const STORAGE_CRITICAL_THRESHOLD = 0.9; // 90% 高危

interface StorageUsage {
  quota: number;      // navigator.storage.estimate().quota
  usage: number;      // navigator.storage.estimate().usage（整个 origin）
  percent: number;    // usage / quota
  tables: { sessions: number; messages: number; checkpoints: number };
  health: 'ok' | 'warning' | 'critical';
}
```

- `getStorageUsage()`：`navigator.storage.estimate()` + 三表 `count()`；百分比 <1% 显示 1%（LobeHub 同款）。
- `checkStorageHealth(force?)`：阈值判定，跨级（ok→warning/critical、降回 ok）时 dispatch `agentdock:storage-warning`（携带 `{ level, percent, usage, quota }`）；同一级别只提示一次（内存去重）。
- 触发时机：应用启动、每次落库后（10s 节流）、`visibilitychange=visible`、设置页手动刷新。
- 预警 UI：AppShell 监听 `agentdock:storage-warning` → `message.warning`（“本地存储已使用 xx%，建议前往设置-存储清理”）；设置页展示进度条与健康状态。

### 3.7 导出与清理（两种用户主动方式）

**选择语义**（严格以 `lastMessageAt` 为准，不是 `createdAt`）：

```ts
type CleanupCriteria =
  | { daysAgo: number }      // 最后消息时间 < now - daysAgo*86400s
  | { oldestCount: number }; // 按 lastMessageAt 升序取前 N 条
```

实现：

- `selectCleanupCandidates(criteria)`：按 `lastMessageAt` 排序（升序），daysAgo 用 `where('lastMessageAt').below(bound)` 走索引；oldestCount 用 `orderBy('lastMessageAt')` 前 N。返回 `{ sessions, total, sizeEstimateBytes }`，供 UI 预览（标题 + 最后消息时间 + 消息数）。
- `exportSessions(ids)`：事务内读出 sessions + 对应 messages + checkpoints，生成 JSON：
  ```json
  {
    "app": "agentdock",
    "exportType": "sessions",
    "version": 1,
    "exportedAt": "...",
    "criteria": { "daysAgo": 30 },
    "sessions": [...], "messages": [...], "checkpoints": [...]
  }
  ```
  经 Blob + `URL.createObjectURL` 下载，文件名 `agentdock-sessions-YYYYMMDD-HHmm.json`。
- `deleteSessions(ids)`：复用 `removeSession` 级联事务（sessions/messages/checkpoints 一起删）。
- `exportAndDeleteSessions(criteria)`：先导出，再删除，返回 `{ exported, deleted, filename }`；任一步失败不执行另一步（导出失败不删数据，删除失败提示重试且已下载的 JSON 仍有效）。

### 3.8 错误处理

- `QuotaExceededError`：写入 catch → `agentdock:storage-error` → AppShell 提示“存储空间不足”，引导导出清理。
- `blocked`（旧标签页阻塞升级）：沿用现有提示。
- 导出文件过大：提示改用 oldestCount 或分批；当前实现单文件一次性下载，文件行内注释说明可演进为 zip/分片。

### 3.9 后续可演进项（本方案不做，文档保留）

- `persistRunSnapshot` 差量 upsert（JSON.stringify 比较跳过无变化行）。
- messages 冗余 `agentId+fab` 支持跨会话搜索。
- zod 写入校验与 group 配置 schema。

### 3.10 操作中间层（zustand `sessionStore`）

会话与存储操作统一经 `src/stores/sessionStore.ts`（zustand）暴露，页面只消费状态与 action：

- 状态：`sessions`（列表）、`storageUsage`（容量）、`cleanupSelection`（清理预览）、`busy`。
- Action：`refreshSessions`、`refreshStorageUsage`、`previewCleanup`、`exportCleanup`、`exportAndDeleteCleanup`、`removeSession`、`resetCleanup`。
- 模块级订阅 `subscribeSessionChanges`（CustomEvent + BroadcastChannel）：任何会话变更自动刷新列表与容量，页面不再各自挂监听；`focus/visibilitychange` 时刷新容量。

`runStore`（运行态）与 `sessionStore`（存储态）职责分离：前者管流式 run/resume，后者管持久化与容量清理。

### 3.11 断线续传 eventId 生命周期（存储 → 取用 → 发送）

- **存储**：`saveRunCheckpoint` 对 running/paused 落 checkpoint 时保存 `latestEventId`（run 游标）+ `processedEventIds`（重放精确去重）+ 快照内每条消息的 `eventId`；压缩策略保留这三者。messages 表每条消息行也冗余 `eventId`（展示/调试，不参与续传）。
- **取用**：`runStore.restoreSession` 读最新 checkpoint → `run = checkpoint.snapshot`，若 `running && latestEventId` 则续传；http 路径将陈旧 running 转 cancelled（后端无游标回放前不自动续传）。
- **发送**：`runStore.resume` 构造 `createRuntimeAction(input, 'resume', { resume: { lastEventId: run.latestEventId } })`，随 POST body 的 `forwardedProps.resume.lastEventId` 发往后端；demo 后端按 `eventId > lastEventId` 字符串比较回放游标后事件。
- **约束（重要）**：eventId 必须**字符串可排序**（序号定宽补零，如 `{epoch_ms}-{seq:06d}`）。未补零时 run 超过 9 个事件后 `"-10" < "-9"`（字符串比较），resume 会漏事件。前端只做精确去重（`processedEventIds.includes`），不做大小比较，比较完全交给后端。

### 3.12 分页与懒加载（长会话/海量会话）

- **会话列表分页**：`listSessions({ limit, offset })` + `countSessions()`；`sessionStore` 维护首屏 50 条窗口 + `loadMoreSessions()` 追加；HomeSidebar「加载更多」按 updatedAt 倒序继续翻页。搜索态走 `searchSessions`（全量扫标题/Agent 名）。Agent 话题与群组列表改用索引查询 `listSessionsByAgent` / `listGroupSessions`，并各自带“加载更多”。
- **会话内消息懒加载**：messages v3 增加 `[sessionId+sequence]` 复合索引；`getMessagesPage({ beforeSequence, limit })` 以“文本所属 run”为最小完整单位——每页取最近 N 条文本并整轮装载过程块，分页边界不会切断一轮（避免块挂错/重复）；`hasMore` 用索引探测游标之前是否还有文本。ChatPage/GroupChatPage 首屏只加载最近 50 条文本 + 「加载更早消息」按钮；删除/编辑/终态后按“当前已加载文本数”重取窗口，保留已加载的更早内容。
- **收益**：进会话不再全量拉长历史；侧栏不再一次读全部 session；Dexie 索引查询让翻页只读页内数据。

---

## 4. 实施步骤与验收

### 实施

1. `sessionHistoryService.ts`：schema v2 + lastMessageAt 维护 + checkpoint 剪枝（终态留 3）+ BroadcastChannel 订阅 + 卸载 flush + 导出 `db`。
2. 新增 `sessionStorageService.ts`：容量估算/预警 + 候选选择 + 导出 + 级联删除。
3. `sessionStore.ts`（zustand 操作中间层）：收敛会话列表、容量、清理 action 与跨页订阅。
4. `SettingsPage.tsx`：新增 `storage` Tab（进度条 + 预警 + 导出清理表单 + 预览列表 + 确认弹窗），消费 `sessionStore`；`HomePage` 改用 store 的 `sessions`。
5. `AppShell.tsx`：监听 `agentdock:storage-warning` / `agentdock:storage-error` 提示。
6. i18n：18 份词典补 `settings.storage.*` 与 `settings.tab.storage`。
7. 测试：`sessionHistoryService.test.ts` 增加 lastMessageAt、迁移回填、按天数/最旧选择、导出结构、级联删除、checkpoint 剪枝用例。

### 验收

- [ ] `pnpm typecheck`、`pnpm test`、`pnpm build` 通过。
- [ ] 升级 v2 后旧数据保留，lastMessageAt 回填正确。
- [ ] 设置页显示存储用量与健康状态；写入触发阈值时 AppShell 预警一次。
- [ ] 两种清理模式预览数量正确；导出 JSON 可读且含 sessions/messages/checkpoints；导出并删除后列表、消息、checkpoint 全清。
- [ ] 两个标签页同开时，一边删除会话另一边侧栏自动刷新。
- [ ] 页面隐藏/关闭前未落盘快照被兜底 flush。

---

## 5. 风险与回退

- **升级阻塞**：schema v2 升级需要所有标签页先关旧连接；已保留 blocked/versionchange 处理，最坏情况提示用户刷新。
- **storage.estimate 是 origin 级**：包含其他站点/应用的用量，百分比可能偏保守；设置页同时展示本库行数便于判断。预警只提示、不自动删，避免误删。
- **导出大文件**：一次性 JSON 可能较大；先提供预览与数量限制，后续可加分片导出。
- **回退**：`lastMessageAt` 无消息时回退 createdAt，保证空会话也能被清理；若字段缺失，选择逻辑回退 updatedAt 并在结果中标记。
