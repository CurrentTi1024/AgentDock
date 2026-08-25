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

## 八、追加：部分助手回复只有气泡没有头像

### 现象

同一会话连发多条后，部分 agent 回复只有气泡、没有 agent 头像（也没有标题）。

### 根因

连续同角色合并逻辑只按 `role` 判断：

```ts
const merged = Boolean(previous && previous.role === record.role);
// merged 时隐藏头像与标题：showAvatar={!merged} / showTitle={!merged}
```

三条消息来自三轮独立 run，相邻的助手消息 role 相同 → 第二条/第三条被当成
"同一段连续消息"合并，头像和标题被隐藏，视觉上就成了"孤儿气泡"。

### 修复

合并只应发生在**同一轮 run 内**的连续同角色消息（如一轮里多条助手文本），
不同 run 的独立回复必须各自显示头像与标题：

```ts
const merged = Boolean(
  previous &&
    previous.role === record.role &&
    previous.runId &&
    previous.runId === record.runId,
);
```

`ChatPage` 与 `GroupChatPage` 同步修改；`runId` 缺失的旧数据不合并（保守处理）。

### 验证（页面实测）

三轮对话（hi / 今天周几 / 天气如何）完成后逐条检查：

```text
USER avatar=true hi
AST  avatar=true 今天的飞行测试整体稳定。…
USER avatar=true 今天周几
AST  avatar=true 今天的飞行测试整体稳定。…
USER avatar=true 天气如何
AST  avatar=true 今天的飞行测试整体稳定。…
assistant without avatar: 0
```

每条助手回复都有头像与标题，顺序正确。

## 九、追加：同一回复断裂成两个连续气泡（“我”+全文）

### 现象

顺序恢复后，个别助手回复显示为两个连续气泡：第一个只有一两个字（如“我”），
第二个才是完整回复。

### 根因

流式阶段 `TEXT_MESSAGE_*` 用 `lc_run--` 占位 id 逐字输出；`MESSAGES_SNAPSHOT`
带规范 UUID 与**完整内容**。旧的替换逻辑要求“占位内容与快照内容完全相等”才替换：

```ts
next.messages[existingId].content === message.content
```

当快照先于流式完成到达时，占位内容只是部分文本（“我”），与完整内容不相等
→ 占位行未被删除 → 占位行与规范行**同时落库** → 页面渲染成两个气泡。

### 修复（三层防御）

1. **快照替换按角色匹配**（`runReducer`）：不再要求内容相等，快照出现规范
   assistant 消息时直接删除同角色的 `lc_run--` 占位消息，并同步清理
   `messageOrder`；流式期间已渲染的部分内容被完整内容覆盖。
2. **占位永不落库**（`persistRunSnapshot`）：文本循环与兜底循环都跳过
   `lc_run--` id，规范 UUID 是唯一权威文本行。
3. **渲染过滤历史占位行**（`ChatPage` / `GroupChatPage` 的 `storedMessages`）：
   防御性过滤 `lc_run--` 记录，旧脏数据也不会再显示双气泡。

### 验证

- 单测：快照先于流式完成到达（占位“我” vs 规范全文）→ 只剩规范消息、
  `messageOrder` 无占位 id；持久化跳过占位行、只落 user + 规范 assistant。
- 30/30 测试通过，build 通过。

## 十、追加：聊天页滚到底最后一条消息被输入框遮挡

### 现象

聊天页滚动到底后，最后一条消息仍被底部输入区挡住一段高度，无法继续下滚。

### 根因

消息列的底部留白是固定值（`paddingBottom: 150px`），而输入区高度是动态的：
`ChatInput` 的 textarea 自动增高（2–8 行）+ 底部工具栏/审批行会显著改变高度，
固定留白在小输入框时浪费、大输入框时不够，最后一条消息被绝对定位的输入区遮住。

### 修复

用 `ResizeObserver` 实时测量输入区外层（`surface` 容器）的实际高度，
消息列 `paddingBottom = composerHeight + 32`：

```ts
const surfaceRef = useRef<HTMLDivElement>(null);
const [composerHeight, setComposerHeight] = useState(0);
useEffect(() => {
  const node = surfaceRef.current;
  if (!node) return;
  const update = () => setComposerHeight(node.offsetHeight);
  update();
  const observer = new ResizeObserver(update);
  observer.observe(node);
  return () => observer.disconnect();
}, []);
// 消息列：paddingBottom: composerHeight + 32
```

`ChatPage` 与 `GroupChatPage` 同步修改。

### 验证（页面实测）

输入框输入 6 行（textarea 自动变高到 325px）后滚动到底：

```text
最后一条消息 bottom = 127
输入框 top          = 155
notBlocked = true（最后一条完整显示在输入框上方）
```

## 十一、追加：A2UI Surface 视觉上仍在 thinking 框 + 完成后 thinking 未折叠 + 发送按钮文案错误

> 日期：2026-08-26
> 现象来源：真实 http 会话运行 A2UI（国庆旅游攻略）后，截图显示 A2UI 内容出现在
> 带标题的卡片里（与 thinking/工具卡同款视觉），且 run 结束后思考内容没有全部收起；
> 同时发送按钮文案在所有语言下都被误显示为“已深度思考/Deeply Thought”。

### 现象

1. A2UI surface 回退渲染使用 `A2uiSurfaceBlock`，它复用了 thinking/工具卡同款
   `styles.block`（整卡边框 + header 行 + ChevronDown），视觉上像“思考框”；
   历史里同一 surface 还会出现两个“A2UI Surface”标题卡。
2. run 完成后 thinking（ReasoningBlock / ProcessFold）偶尔不折叠：后端漏发
   `REASONING_MESSAGE_END` 时 `reasoningMeta.streaming` 一直是 true，`ReasoningBlock`
   的 `open` 状态跟随 `streaming` 保持展开。
3. 发送按钮文案：18 个语言文件的 `chat.send` 键被误填成 `chat.reasoningDone`
   的值（“已深度思考 / Deeply Thought”），导致发送按钮永远显示思考完成文案。

### 根因

#### 根因 1：A2UI 回退渲染与 thinking 共用视觉组件

`MessageBlocks.tsx` 里 `A2uiSurfaceBlock` 直接使用 `styles.block` + `styles.header`，
与 `ReasoningBlock`/`ToolCallBlock` 同款边框卡；当官方 renderer 不可用
（mock 模式、payload 缺 `a2ui_operations`、schema 校验失败）时，A2UI 内容
就以“thinking 卡”的样子出现在正文里。另外 live 渲染路径（`renderRunBlocks`
ordered 分支）推送 surface 时漏包 `surfaceBody`（左侧主色条插件块），
与历史路径不一致，进一步强化“混在思考块里”的观感。

#### 根因 2：终态没有兜底收尾 reasoning

`runReducer` 的 `RUN_FINISHED / RUN_ERROR` 只改 `status`，没有把仍在
`streaming: true` 的 `reasoningMeta` 收尾；`ReasoningBlock` 的
`useEffect([streaming])` 依赖 `meta.streaming`，后端一旦漏发
`REASONING_MESSAGE_END / REASONING_END`（中断、超时、异常终止），
thinking 在 run 结束后永远展开。刷新恢复中断 run 时（`restore` 把 running
checkpoint 转 cancelled）同样没有收尾 reasoning。

#### 根因 3：i18n 键值复制错误

早期把“已深度思考”的文案直接写到了 `chat.send` 键上（18 个语言文件），
发送按钮从此永远显示思考完成文案，而不是“发送”。

### 修复方法

1. **A2UI 正文插件块视觉**（`MessageBlocks.tsx`）：
   - `A2uiSurfaceBlock` 改为 `styles.surfaceBody`（左侧 3px 主色条、无整卡边框、
     flat header + `<pre>` 内容），与 thinking/工具卡彻底区分；
   - `renderRunBlocks` ordered 分支的 surface 与历史路径一致，统一包
     `<div className={styles.surfaceBody} data-testid="a2ui-surface-body">`。
2. **终态兜底收尾 reasoning**（`runReducer.ts`）：
   - 新增导出函数 `finalizeReasoningMeta(state)`：把全部 `reasoningMeta`
     的 `streaming` 置 false、`finishedAt` 兜底；
   - `RUN_FINISHED`、`RUN_ERROR` 分支返回前调用；
   - `useAgentDockConversation.restore()` 把 running checkpoint 转 cancelled
     时同样调用，刷新后中断 run 的 thinking 也必定折叠。
3. **i18n 修正**（18 个语言文件）：`chat.send` 恢复为“发送 / Send / Enviar /
   Gönder …”，`chat.reasoningDone` 保持“已深度思考”。

### 验证（浏览器实测）

- mock 端到端：批准 HITL 后跑完一轮，终态 `reasonExpanded=false`、
  “已处理 2 步 · 2.9s”折叠为一行、surface 在折叠卡外（`surfaceWraps=1`）；
- http 真实 run（用户会话，国庆旅游攻略 A2UI）：完成后
  `surfaceWraps=2`（两个 surface 均为左侧 3px 插件块，无“A2UI Surface”回退卡）、
  `expandedReasoning=[]`（thinking 全部收起）、`已处理 1 步 · 23.9s` 折叠一行、
  surface 在折叠卡之后、正文在最后；刷新后不再误显“已中断”。
- 发送按钮文案回归“发送”。
