# Chat 全功能架构与设计机制

> 覆盖范围：AgentDock 单聊（`/chat`）与群聊（`/group`）的完整会话能力——运行时、事件投影、
> 历史落库、消息渲染、过程可视化、输入区、消息操作、滚动、数据一致性与并发防护。
> 本文重机制、轻代码，讲清"为什么这样设计"与"机制如何工作"。

## 1. 总体架构与数据流

AgentDock 是纯前端项目，对话能力对外只依赖两类接口：

- **后端 API / Chat API**：通过 Copilot Runtime（`server/index.ts` 的 single-route handler）转发到
  `AG_ORCHESTRATION_BASE_URLS_JSON` 配置的上游（按 fab 路由），上游是 AG-UI over SSE 的 agent 服务，
  提供 `generate_a2ui` 等工具与 A2UI 动态 schema；
- **业务 API**：市场、反馈、提及列表等走 service interface（mock/http 双实现，`selectService` 按
  `VITE_SERVICE_MODE`/localStorage 切换）。

核心数据流是一条单向管道：

```
用户输入 → ChatInput(投影层) → send() → Copilot Runtime → 上游 AG-UI agent
                                              ↓ (SSE 事件流)
                              useAgentDockConversation(运行时 hook)
                                              ↓ (reducer 投影为 RuntimeRunState)
                              ChatPage/GroupChatPage(页面编排)
                                              ↓ (AG-UI 事件 → LobeHub 组件 props)
                              ChatItem / MessageBlocks / ChatInput / OpStatusTray 等
                                              ↓ (终态落库)
                              IndexedDB（messages/checkpoints/sessions）
```

关键设计原则：

- **事件即事实**：页面不臆造消息，只把协议事件（`MESSAGES_SNAPSHOT`、`TOOL_CALL_*`、
  `ACTIVITY_SNAPSHOT`、`REASONING`、`RUN_*`）经 reducer 投影为 UI 状态；
- **AG-UI 事件 → LobeHub 组件 props 投影**：协议结构被标准化为 `RuntimeRunState`（messages / steps /
  toolCalls / reasoning / surfaces / activities），渲染层按该视图模型渲染 LobeHub 组件，不直接消费协议细节；
- **本地优先**：IndexedDB 是历史真相，运行中状态（checkpoint）可恢复，UI 不依赖后端持久化。

## 2. 运行时与状态机

`useAgentDockConversation` 是页面侧 facade；真实运行所有权在常驻 `SessionRuntimeHost/sessionOperationService`，按模式拆成两条互斥路径：

- **http 路径**：每个活跃 Session 一个常驻 `SessionRuntimeWorker`，使用 CopilotKit v2 headless `useAgent`，`agent.subscribe` 订阅事件 → `sessionOperationService.applyEvent` → reducer；
- **mock 路径**：`sessionOperationService` 消费 mock async generator，经同一 reducer 与 Operation Store 投影，保证页面无感。

### 2.1 RuntimeRunState（视图模型）

`RuntimeRunState` 是运行中的单一状态源，字段语义：

- `messages` / `messageOrder`：消息内容与权威时间线顺序（来自 `MESSAGES_SNAPSHOT` 数组，杜绝 map 迭代序错乱）；
- `steps` / `toolCalls` / `reasoning` / `reasoningMeta` / `surfaces` / `activities`：过程块视图模型；
- `orderedBlocks`：协议权威的块顺序（reasoning/tool/step/activity/surface 依次出现的位置）；
- `status`：`idle | running | paused | success | cancelled | error`；
- `processedEventIds` / `latestEventId`：顶层 AG-UI eventId 的去重窗口与断线游标。

### 2.2 防重入与并发防护（三层）

1. **前端 hook 门禁**：`send()` 在 `running/paused` 时忽略新发送（含 UI 层 `running` 判断）；
2. **Runtime 层**：CopilotKit `InMemoryAgentRunner` 对同一线程并发 run 直接拒绝；
3. **FabRoutingAgent 幂等守卫**：同一 `threadId:runId` 在途 run 拒绝（`FAB_DUPLICATE_RUN`），
   杜绝上游重复执行。

### 2.3 恢复与断线

- 刷新时 `restore()` 读取最新 checkpoint：running 且有 `latestEventId` 时以同一 `runId` 请求增量续传；没有游标时转 cancelled。终态不落 checkpoint，历史由 messages 表渲染；
- 断线重连：事件流中断时写入 `RUN_ERROR` 兜底（不卡 running），内容保留；后端按 `lastEventId` 只回放缺失事件，前端按 `processedEventIds` 去重。

## 3. 历史落库与一致性

### 3.1 落库机制（persistRunSnapshot）

每轮 run 结束（或防抖 350ms 空闲）把 `RuntimeRunState` 快照写入 IndexedDB：

- **upsert 而非覆盖**：已存在的消息保留原 `sequence` / `createdAt` / `runId`，新消息按
  `messageOrder` 首次出现位置分配递增序号，避免时间线重排；
- **只落用户可见内容**：过滤 system/developer 上下文（如 A2UI catalog）与流式占位 id（`lc_run--`）；
- **checkpoint 剪枝**：终态只保留最近 3 条，running/paused 始终保留（刷新回放依赖）；
- **`agentdock:run-persisted` 广播**：落库完成后发事件，页面确定性刷新历史，避免与异步落库竞态。

### 3.2 历史分页

首屏只加载最近一页（按文本消息数分页，过程块随所属 run 整轮附带），`加载更早` 按钮按
`beforeSequence` 游标向前翻页；刷新窗口（`reloadHistoryWindow`）按"当前已加载文本数"重取最新窗口，
保留已加载的旧内容不重复。

### 3.3 已删消息墓碑（deletedMessageIds）

**问题**：删除只清本地，后端线程（CopilotKit checkpointer）仍携带被删轮次，新 run 的
`MESSAGES_SNAPSHOT` 会把已删消息带回来（user 重复、旧回复混入新 run）。

**机制**：

- `removeTurn` 删除整轮时，把该轮全部消息 key（`text:/tool:/step:/activity:/surface:/reasoning:`）
  记录到会话 `deletedMessageIds`（墓碑，持久化）；
- `persistRunSnapshot` 跳过墓碑 key，后端带回来的旧消息不再写回；
- 展示层（`ChatPage` / `GroupChatPage` / `renderRunBlocks` / `renderStoredBlocks`）按墓碑过滤，
  运行中与历史都不显示被删内容。

这样不改动 CopilotKit 上下文，也能保证"删除并重新生成"后本地历史永不复活。

## 4. 消息渲染体系

### 4.1 展示单元（buildDisplayUnits）

协议里一轮 run 可能产生多条助手文本（工具调用前的中转文本 + 最终答案）。为避免"两个气泡"，
`buildDisplayUnits` 把同一 `runId` 的连续助手文本合并为一个展示单元：

- 气泡内容取**最后一条**（最终答案）；
- 中间文本作为 `narration` 收进过程折叠（展开可见），不单独成气泡；
- 过程块（折叠/工具/A2UI）只挂载一次，杜绝重复渲染。

单聊与群聊共用该函数（`MessageBlocks.tsx` 导出）。

### 4.2 ChatItem（气泡外壳）

包装官方 `@lobehub/ui/chat ChatItem`：

- 用户：右侧气泡 + 本人头像（`variant="bubble"`）；
- 助手：docs 变体（无外边框），头像/标题/时间；
- 助手正文走带 @Agent 提及插件的 Markdown 管线；过程块（children）渲染在正文**上方**
  （LobeHub 顺序：思考/工具过程在正文之上）；
- 支持编辑态（`editing`）、双击进入编辑、hover 操作栏。

### 4.3 消息操作栏（MessageActions）

- **用户消息**：复制 / 重新生成（按原问题新开一轮）/ 编辑 / 删除 / 更多（回填输入框、删除并重新生成、
  朗读/翻译/分享占位）；
- **助手消息**：点赞/点踩（点踩弹表单反馈）/ 复制 / 重新生成 / 删除 / 更多；
- 操作栏 hover 显示，避免常驻干扰阅读。

### 4.4 历史分割线

连续消息时间间隔超过 30 分钟时插入"历史消息"分割线（`HistoryDivider`）。

## 5. 过程可视化（思考/工具/步骤/A2UI）

### 5.1 可见性过滤（关键机制）

不是所有协议过程都该给用户看：

- **内部中间件步骤**（langgraph 管道节点，如 `PatchToolCallsMiddleware` / `CopilotKitMiddleware` /
  `model` 等）不展示、不计数——它们不是用户可理解的执行步骤；
- **A2UI 内部工具**（`generate_a2ui` / `render_a2ui`）不展示调用过程——其产物（surface）本身就是结果；
- 因此简单问题（如"你好"）运行中只显示"生成中/深度思考中"，完成后没有任何工具痕迹；
  真正要界面的问题，A2UI 界面照常渲染，只是不显示内部工具卡。

### 5.2 思考块（ReasoningBlock / Thinking）

对齐 LobeHub Thinking：

- 24×24 轮廓状态块：思考中旋转 Loader，完成显示 Atom（展开态紫色）；
- 标题：思考中 shinyText"深度思考中…"，完成 secondary"已深度思考（用时 X 秒）"；
- 内容区 ScrollArea 式（max-height 40vh/320px、`colorTextDescription`），思考中自动展开、完成自动收起。

### 5.3 工具卡（ToolCallBlock）

对齐官方 Inspector：

- 24×24 状态 chip：执行中神经网络动画（NeuralNetworkLoading）/ 完成 Check / 失败 X；
- 单行标题 `title › apiName (key:value +N)`（等宽字体、加载中 shiny）；
- 执行中 100ms 实时计时。

### 5.4 过程折叠（ProcessFold）

- 只有真实步骤/工具（`stepCount > 0`）才渲染折叠卡，杜绝"已处理 0 步 · –"空卡；
- 完成态折叠为一行"已处理 N 步 · 耗时"，运行中展开；一级=过程汇总，二级=单个块展开；
- HITL、narration、委派树/技能卡、工作流步骤都收进过程折叠。

### 5.5 A2UI Surface

- 实时渲染：官方 A2UI Provider + catalog（Metric/Title/Card/Column/Row 等）；
- 历史持久化：surface 快照（`a2ui_operations`）经 `StoredA2uiSurface` 还原，刷新后仍可见；
- Action 按钮 → `sendA2uiAction` 回传后端。

### 5.6 HITL（人工确认）

- 暂停即过程：HITL 活动进入过程折叠（暂停时可见、完成收起），支持
  approve/reject、editArguments、textInput、singleSelect、multiSelect、form；
- 自动审批模式：`approvalMode=auto` 时新 HITL 请求自动批准续跑；
- 暂停视为忙态：发送按钮切换为"停止生成"，Enter 不发送、草稿保留，避免误发丢消息。

## 6. 输入区（ChatInput）

单聊/群聊/首页共用同一 `ChatInput`：

- **布局**：圆角 16px 容器 + 自动高度 TextArea（2–8 行）+ 底部工具栏；
- **左下角**：紧凑切换 Agent 下拉（antd v6 DOM 适配锁高 22px）+ 附件/语音（首期禁用占位）；
- **右下角**：发送/停止按钮 + 回车/换行提示；
- **审批模式**：右下角外部"手动/自动"紧凑下拉；
- **@Agent 提及**：输入 `@` 触发 `getMentionAgentsList` 拉取可提及 Agent，菜单选择后回填
  `@AgentName prompt`（群聊关闭强制 @，成员已组队）；
- **IME 防护**：中文输入法组合中按 Enter 只确认候选词，不触发发送（`isComposing` 守卫），
  避免"消息已发出但输入法把文字写回输入框"；
- **发送即清空**：发送路径统一 `setInput('')`，首页/单聊/群聊一致。

### 6.1 运行状态条（OpStatusTray）

输入框上方贴合状态条（对齐 LobeHub）：

- 12px 次级色 + 500 字重 + shiny 扫光 + 主色旋转 glyph（orbit 2s + core 1.5s）；
- 计时器 mm:ss；步骤数 >1 时右侧显示；
- 文案 4s 轮播（28 条官方短语，18 语言），activity 映射：真实工具调用→"调用工具中"、
  流式推理→"思考中"、其余→生成中轮播；
- HITL 暂停时状态条保持。

## 7. 消息操作与 branch 替换

### 7.1 编辑（双击/编辑按钮）

- 双击用户消息进入编辑态（回填原文），Enter/失焦提交；
- `commitEdit` → `replaceTurn`：删除原轮 + 按新内容重跑（branch 替换语义）。

### 7.2 重新生成

- 助手"重新生成"：找到该助手消息前一用户消息，`replaceTurn` 删除整轮（user + 助手 + 过程块 +
  checkpoint）后按原问题重跑；
- 关键修复：历史 id 带 `text:` 前缀，查找需兼容两种形态；回找用户消息必须校验
  `role === 'user'`（同 run 里可能有空助手文本，只判 kind 会取错）；
- 用户"重新生成"：按原问题新开一轮。

### 7.3 删除与删除并重新生成

- 删除：`removeMessage` 删除目标消息及其后随过程块（到下一条文本为止），并清理相关 checkpoint；
- 删除并重新生成：删除整轮后重建 agent 上下文（`refreshAgentContext`）并重跑；
- 两者都通过墓碑机制保证后端线程带回来的内容不会复活。

### 7.4 点赞/点踩反馈

点踩弹出 FeedbackModal（原因多选 + 补充说明）→ `messageFeedbackService`；点赞直接提交。

## 8. 滚动机制（useChatScroll）

单聊/群聊共用 hook：

- **贴底跟随**：距底 <120px 视为贴底；贴底时新消息/发送/运行结束自动滚到最新；
- **不打扰**：用户主动上滑（非贴底）时停止跟随、不被拉回；回到底部附近或再次发送恢复；
- **发送即贴底**：`stickToBottom()` 强制贴底并滚动；
- **运行结束重新贴底**：终态（success/error/cancelled）标记 + `run-persisted` 落库完成后在
  DOM 重建后补滚（双 rAF），避免 live→历史切换把滚动重置回顶部；
- **ResizeObserver**：A2UI/图片等异步内容渲染变高后继续跟随；
- **滚动恢复禁用**：`scrollRestoration = 'manual'`，进入会话一律从最新一条开始。

## 9. 群聊复用（Chat Group）

群聊与单聊共用同一套组件与机制，差异仅在编排上下文：

- 共用：ChatInput、ChatItem、MessageActions、MessageBlocks（buildDisplayUnits/renderStoredBlocks/
  renderRunBlocks/ProcessFold/Tool/Reasoning/HITL/A2UI）、FeedbackModal、OpStatusTray、
  useChatScroll、墓碑过滤、IME 防护、暂停忙态、点击穿透；
- 群聊特化：成员标签管理、编排模式（supervisor 等）设置、不强制 @Agent（mentionEnabled=false）、
  不显示"切换 Agent"下拉；
- 群聊输入区同样有运行状态条（activity/startTime/stepCount）、完整消息操作与反馈。

## 10. 数据一致性与安全

- **时间线权威顺序**：`messageOrder`（协议）→ `sequence`（落库）→ 渲染排序，杜绝 map 迭代序错乱；
- **连续同角色合并**：同 run 助手文本合并为单气泡，中间文本进折叠（narration）；
- **终态保护**：run 终态后不覆盖为网络错误；`RUN_ERROR` 兜底不卡 running；
- **删除一致性**：墓碑（deletedMessageIds）+ 过程块随文本删除 + checkpoint 级联删除；
- **会话级联**：删除会话时消息/检查点级联清理。

## 11. 已知限制与演进

- **后端群编排**：demo 后端 `tools=[]` 不处理 group forwardedProps，群聊真实后端不发消息；
  前端 UI 已按 mock 全链路就绪，等待上游支持；
- **断线 resume**：有顶层 `eventId` 的 running checkpoint 会自动按 `lastEventId` 续传；无游标时安全终结，禁止整轮重放；
- **A2UI 多轮**：真实模型上下文下 secondary 可能偏离 forced render_a2ui，新会话单轮稳定；
- **构建体积**：Markdown 管线 chunk 较大，可后续按需拆分。

---

关联文档：`01-end-to-end-runtime-link.md`（运行时链路）、`02-ag-ui-protocol-implementation.md`（协议实现）、
`03-a2ui-pipeline.md`（A2UI 管道）、`12-lobehub-chat-full-copy-plan.md`（LobeHub Chat 全量复刻计划）、
`13-concurrent-run-guard.md`（并发防护）、`14-a2ui-surface-persistence.md`（surface 持久化）、
`15-orchestration-integration-guide.md`（Orchestration 接入）、`16-indexeddb-storage-plan.md`（存储机制）。
