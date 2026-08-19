# Bug 复盘：聊天消息时间线乱序 / 重复显示

> 日期：2026-08-20
> 现象来源：一次对话连发三条（hi / 今天周几 / 天气如何），刷新后消息顺序完全错乱、同一回复重复出现、时间戳被改写。

## 一、现象

页面渲染顺序与发送顺序不一致，具体表现：

- 用户消息与助手回复交错错位（如第一条用户消息"hi"出现在列表后半段）；
- 同一回复出现两条（时间戳一个是最初的，一个是落库时刻）；
- 消息时间显示混乱（01:13:53 / 01:14:07 / 01:14:29 交错）。

## 二、根因

根因有两层，叠加后产生"完全乱掉"的效果。

### 根因 1：落库时给全部消息行重新分配顺序与时间戳

`src/api/session/sessionHistoryService.ts` 的 `persistRunSnapshot` 每次落库都会把
**整个 run 快照里的全部消息**重新 `bulkPut` 一次，且：

- `sequence = nextSequence()`：给所有消息行重新发序号；
- `createdAt = new Date().toISOString()`：覆盖所有消息的创建时间；
- `runId = snapshot.runId`：把累积进来的旧消息全部改成当前 run 的 id。

而 http 模式下每轮 run 的快照会通过 `MESSAGES_SNAPSHOT` **累积整段会话**：

```text
run1 快照: [u1, a1]
run2 快照: [u1, a1, u2, a2]   ← 携带 run1 的消息
run3 快照: [u1, a1, u2, a2, u3, a3]
```

`send()` 会先把手动插入的当轮用户消息放进 `state.messages`（map 首位），
后到的快照再合并旧消息，于是每轮 flush 都按"本轮用户消息在最前"的 map 迭代序
重写全部行的 sequence——旧消息被反复重排，最终顺序完全错乱，createdAt 也全被覆盖。

### 根因 2：流式占位 id 与快照规范 id 并存，同一回复渲染两次

流式阶段 `TEXT_MESSAGE_*` 事件使用 `lc_run--<langgraph run id>` 占位消息 id，
快照到达时携带规范 UUID。旧逻辑只是"跳过"占位消息，并没有在快照到达后用规范 id
替换占位，导致：

- 占位消息与规范消息在 `messages` map 中并存（两个 id、同一内容）；
- 历史渲染时同一回复出现两条。

### 附带问题：首页 hub 发送丢首条消息

`HomePage.start()` 只创建会话并跳转，**没有真正把输入框内容作为首条消息发出**，
首条消息被当成会话标题后就消失了（端到端测试暴露）。

## 三、LobeHub 的参照逻辑

横向核对 LobeHub（`lobehub-canary`）：

```text
createMessage(params)  → 插入行时一次性写入 createdAt / updatedAt
updateMessage(id, value) → 只更新 content 等字段，绝不重写 createdAt
列表排序              → 按 DB 的创建时间（createdAt）稳定排序
```

即：**消息行创建时定稿时间戳与顺序，之后只做内容更新**。
我们的实现违背了这一点——每次 flush 都整批重写，把"创建一次、更新多次"
做成了"反复重建"。

## 四、修复方法

### 1. 权威时间线 `messageOrder`（运行时状态）

`RuntimeRunState` 新增 `messageOrder: string[]`：

- `MESSAGES_SNAPSHOT` 到达时，以快照数组顺序为权威顺序重建时间线；
- 本地先插入但快照未覆盖的消息（如当轮用户消息）追加在末尾；
- `TEXT_MESSAGE_START / CONTENT / CHUNK` 首次出现时按事件顺序追加；
- `send()` / `runStore.execute()` 直接插入用户消息时同步维护。

### 2. 落库只增不重排（对齐 LobeHub createMessage/updateMessage 语义）

`persistRunSnapshot` 改为 UPSERT：

- 已存在行（同 `kind:id`）：保留 `sequence / createdAt / runId`，只更新内容/payload；
- 新行：按 `messageOrder` 顺序分配一次序号，createdAt 取首次写入时间；
- 兜底：`messageOrder` 未覆盖但存在于 `messages` 的消息追加到末尾，保证不丢。

### 3. 防抖落盘按 runId 分槽

全局单槽 `pendingCheckpoint` 改为 `Map<runId, snapshot>`：
快速连续 / 并发 run 互不覆盖，空闲统一 flush，杜绝丢消息或只落最后一段。

### 4. 快照到达时替换流式占位 id

`MESSAGES_SNAPSHOT` 处理 assistant 消息时，若存在同角色同内容的
`lc_run--` 占位消息，删除占位、用规范 UUID 落地——同一回复只有一个 id。

### 5. 首页 hub 发送不再丢消息

`HomePage.start()` 跳转时把输入内容放进路由 state（`pendingPrompt`），
`ChatPage` 挂载且会话就绪后自动发送一次，发送后 `replace` 清空 state 防重发。

## 五、验证

### 单元测试（`node --experimental-strip-types --test`，28/28 通过）

- 三轮 `MESSAGES_SNAPSHOT` 累积后，text 行顺序保持 `u1,a1,u2,a2,u3,a3`；
- 两轮并发（快速连续）run 都不丢消息、按时间线落库；
- `lc_run--` 占位被规范 UUID 替换，同一回复只有一个 id；
- 既有 removeTurn / updateMessageContent / 会话隔离等全部保持通过。

### 端到端（Chrome headless + CDP，页面实测）

场景与用户报告一致：连发三条（hi / 今天周几 / 天气如何），每轮过 HITL 批准：

```text
DOM 顺序（按页面渲染）：
  USER hi
  AST  今天的飞行测试整体稳定。…
  USER 今天周几
  AST  今天的飞行测试整体稳定。…
  USER 天气如何
  AST  今天的飞行测试整体稳定。…

IndexedDB text 行（按 sequence 升序）：
  seq=...18179001 user   hi         run=0af40a1e
  seq=...1827743005 assistant 回答…  run=0af40a1e
  seq=...1833073011 user   今天周几  run=66458f40
  seq=...1838777014 assistant 回答…  run=66458f40
  seq=...1844126020 user   天气如何  run=fd3f99cf
  seq=...1849834023 assistant 回答…  run=fd3f99cf
```

结论：DOM 与 DB 均严格按时间线排列，无乱序、无重复、无丢失；
首页 hub 发送的首条消息也正确进入会话。

## 六、遗留

- 修复前已产生的脏会话（旧 sequence 错乱的历史数据）不会自动重排；
  需要时删除该会话重开，或另做一次性迁移：按 `createdAt` 重排旧行的 sequence。
- `MESSAGES_SNAPSHOT` 若携带完全不同的消息 id（后端侧重建），前端无法按内容
  判重合并（当前按 id + 占位规则处理），需后端保证快照 id 稳定。

## 七、涉及文件

- `src/api/runtime/types.ts`：`RuntimeRunState.messageOrder`
- `src/api/runtime/runReducer.ts`：messageOrder 维护、快照替换占位 id
- `src/api/session/sessionHistoryService.ts`：UPSERT 保留 sequence/createdAt/runId、
  messageOrder 驱动序号、按 runId 分槽落盘
- `src/features/chat/useAgentDockConversation.ts` / `src/stores/runStore.ts`：
  直接插入用户消息时维护 messageOrder
- `src/features/chat/HomePage.tsx` / `ChatPage.tsx`：hub 首条消息自动发送
- 测试：`src/api/session/sessionHistoryService.test.ts`、`src/api/runtime/runReducer.test.ts`
