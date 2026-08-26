# LobeHub Chat 源码迁移融合与作业清单

> 完成日期：2026-08-27
> AgentDock 分支：`codex/lobehub-chat-full-copy`
> LobeHub 基线：`/Users/chenguo/lobehub`，canary commit `920880679a7138282e13f18303a6183f63ef677a`
> 范围：Web 前端 Chat / Group Chat 消息展示、流式过程、工具、任务编排、HITL、A2UI、输入草稿；保留 AgentDock 的 FAB、AG-UI/A2UI、Artifact 和自定义 Activity。

## 1. 最终结构

本轮不再把 `@lobehub/ui/chat` 的通用 ChatItem 当作“已复制 LobeHub”。LobeHub 当前 canary 的真实实现位于仓库内 `src/features/Conversation/ChatItem` 与 `src/features/Conversation/Messages`，所以本项目采用以下融合层次：

```text
AG-UI / CopilotKit events
  → runReducer（保留事件顺序和 LobeHub 消息角色）
  → RuntimeRunState / SessionMessageRecord（实时与历史同构）
  → MessageBlocks（过程投影、A2UI、错误）
  → ProcessBlocks / SpecialMessages（LobeHub props 化展示组件）
  → ChatItem（LobeHub 仓库内真实 DOM、气泡、标题和动作区）
  → ChatPage / GroupChatPage
```

原则是“协议和数据源使用 AgentDock，视图结构和交互使用 LobeHub”。没有引入 LobeHub store、TRPC、数据库、模型供应商或 Cloud 代码。

## 2. 顶层消息角色迁移矩阵

角色集合逐项取自上游 `src/features/Conversation/Messages/index.tsx`。

| LobeHub role | AgentDock 展示 | 主要代码 |
|---|---|---|
| `user` | 右侧个人模式气泡；默认隐藏头像和标题 | `ChatItem.tsx` |
| `assistant` | 左侧头像、名称、相对时间、过程块、Markdown 正文、hover 动作 | `ChatItem.tsx`、`MessageBlocks.tsx` |
| `assistantGroup` | AssistantGroup 的 children/reasoning/tools 顺序与最终答案 | `SpecialMessages.tsx` |
| `supervisor` | 复用 AssistantGroup，增加主管标记并保留 group payload | `SpecialMessages.tsx` |
| `task` | TaskAvatar、状态、详情、步骤/工具统计 | `SpecialMessages.tsx` |
| `tasks` | 多任务折叠列表 | `SpecialMessages.tsx` |
| `groupTasks` | 群组头像与任务列表 | `SpecialMessages.tsx` |
| `agentCouncil` | 横向/Tab 两种 Council 成员答复布局 | `SpecialMessages.tsx` |
| `compressedGroup` | 摘要/历史 Tabs | `SpecialMessages.tsx` |
| `tool` | 独立 Tool Inspector、参数、结果、状态和耗时 | `ProcessBlocks.tsx` |
| `verify` | 验证结果卡与失败/成功状态 | `SpecialMessages.tsx` |
| `taskCallback` | 回调原因和结果卡 | `SpecialMessages.tsx` |

`system` 和 `developer` 只作为运行时上下文，不进入可见消息时间线。测试会遍历上述全部可见角色，防止以后再次被降级为通用 Activity。

## 3. 按功能块查看代码

### 3.1 消息外壳

- `src/features/chat/components/ChatItem.tsx`
  - 源自 `src/features/Conversation/ChatItem/{ChatItem,Avatar,Title,Actions,MessageContent,style}`。
  - 迁移 28px 头像、标题/时间布局、用户 bubble、hover 时间与 action、加载态。
  - 保持 props-first，移除 LobeHub store 订阅。

### 3.2 过程、工具、Workflow 与 HITL

- `src/features/chat/components/lobehub/ProcessBlocks.tsx`
  - `Thinking`：流式自动展开、完成自动折叠、加密提示和耗时。
  - `ProcessFold`：LobeHub borderless Accordion 汇总行。
  - `ToolCallBlock`：ToolInspector、参数、结果、执行状态和耗时。
  - `WorkflowStepsBlock`：运行进度、步骤状态、耗时与自动展开/折叠。
  - `HitlBlock`：`toolAuthorization / editArguments / textInput / singleSelect / multiSelect / form` 六种模式。
  - `ActivityBlock`：仅用于 AgentDock 自定义 Activity；LobeHub 原生消息角色不再走这里。

### 3.3 扩展消息角色

- `src/features/chat/components/lobehub/SpecialMessages.tsx`
  - 对应上游 `Messages/{Task,Tasks,GroupTasks,AgentCouncil,CompressedGroup,Tool,Verify,TaskCallback}` 和 `AssistantGroup`。
  - 同一个组件同时服务实时 RuntimeMessage 和 IndexedDB 历史 SessionMessageRecord。
  - payload 中的 `children / tasks / members / metadata / taskDetail / taskCompletions` 原样保留。

### 3.4 事件顺序、历史与 A2UI

- `src/api/runtime/types.ts`
  - 定义全部 `LobeVisibleMessageRole`；`RuntimeMessage` 允许保留结构化扩展字段。
- `src/api/runtime/runReducer.ts`
  - `MESSAGES_SNAPSHOT` 保留原生角色，不再转成 Activity 卡。
  - `TEXT_MESSAGE_*` 也进入 `orderedBlocks`，中间叙述、工具、最终答案按真实到达顺序展示。
  - `system/developer` 与 `lc_run--` 内部占位不显示。
- `src/api/session/sessionHistoryService.ts`
  - 原生角色和 payload 原样持久化。
  - AssistantGroup 中间助手文本落为 `narration`，最终助手文本仍为 `text`。
  - 过程块按 `orderedBlocks` 顺序落库，刷新后顺序不变。
- `src/features/chat/components/MessageBlocks.tsx`
  - 实时/历史投影共用；负责 process collector、A2UI surface、错误和逻辑 surface 去重。
- `src/features/chat/messageBlockOwnership.ts`
  - 每个 run 只选择一个流程块宿主：优先最终 `assistant`，没有普通助手时回退到 `assistantGroup/supervisor`。
  - 实时和历史使用同一规则，避免特殊消息旁出现空助手卡，也避免流程折叠重复或刷新后丢失。

### 3.5 页面接入

- `src/features/chat/ChatPage.tsx`
- `src/features/group/GroupChatPage.tsx`
  - 实时消息严格按 `messageOrder` 渲染。
  - 普通 assistant 走 ChatItem，扩展 role 走 SpecialMessage。
  - 实时与刷新后的历史使用相同角色和 payload，不出现完成后换皮或降级。
  - 新建会话即使历史计数为 0，终态也会重取至少一整轮；单聊和群聊都只在 `agentdock:run-persisted` 确认终态 flush 后重建 live→history DOM，避免消息消失或只剩用户消息。
  - 群聊成员标签由固定文案改为 18 个 locale 共用的 `{count}` 插值，显示真实成员数。
  - AgentDock Artifact 侧栏、FAB 路由、Feedback、A2UI action 保持不变。

## 4. 输入框光标跳走和草稿丢失修复

根因是 `@lobehub/editor` 内部对 `onChange` 防抖，而旧代码同时传入不断变化的受控 `content={value}`、同时监听 `onChange` 与 `onTextChange`，并在 effect 中用父组件的旧值清空再重建 Lexical 文档。消息流或页面状态更新恰好发生在防抖窗口内时，旧值会重置 selection，造成光标跳走和未确认内容丢失。

修复位于：

- `src/features/chat/components/ChatInput.tsx`
  - 输入期间 Lexical 文档是唯一权威源，`content` 固定为空的初始化值。
  - 只使用一条 `onChange` 通道，去除两个独立防抖队列的竞态。
  - 编辑器聚焦时拒绝父组件陈旧回声覆盖文档。
  - 外部候选文本/“恢复到输入框”只在明确的非输入状态同步。
  - 父级完成会话准备并明确接受发送后才清理编辑器和草稿；准备失败时原稿保留。
  - 等待发送接受期间若继续输入，只提交原内容，不清理后来新增的文字。
- `src/features/chat/components/chatInputSync.ts`
  - 把“是否允许外部值覆盖编辑器”的判定拆为纯函数。
  - 草稿按 `home`、`chat:<sessionId>`、`group:<sessionId>` 隔离写入 localStorage。
- `src/features/chat/components/chatInputSync.test.ts`
  - 覆盖聚焦时陈旧值不得覆盖、失焦显式恢复、会话草稿键隔离、发送未接受不得清稿、发送等待期间新输入不得被清理。

## 5. 保留的 AgentDock 专有能力

以下不是 LobeHub 原始业务模型，本轮保留并嵌入 LobeHub 消息 chrome：

- FAB Agent 路由和 `mentionAgents`。
- AG-UI SSE、Copilot Runtime、断线 checkpoint 和 IndexedDB 会话历史。
- A2UI 官方 renderer、Mock catalog 兼容和 surface 去重。
- `agentDock.artifact` 右侧工作面板。
- `agentDock.agentDelegation / tasks / groupTasks / supervisor` 自定义 Activity wire；当后端发送 LobeHub 原生消息 role 时优先使用原生组件，自定义 wire 仍兼容旧编排服务。
- 点赞/点踩反馈、删除、重新生成、复制和恢复到输入框。

## 6. 有意不引入的 LobeHub 代码

源码级迁移不等于把 LobeHub 整个应用依赖复制进来。以下能力没有对应 AgentDock 数据契约或已明确超出产品范围，因此不引入：

- LobeHub Zustand Conversation/Chat/AgentGroup store、数据库 selector 和 server action。
- Cloud、计费、模型供应商、Electron、评论、分享和远程文件上传。
- 依赖 LobeHub workspace/entity 后端的 EditedFilesCard、GoalWorkCard、MessageWorks、SignalCallbacks。
- 消息分支和评论；AgentDock 已确认使用 Feedback 与重新生成流程。

如果未来后端增加对应 payload，应先扩展 `04-frontend-backend-api.md` 和 `RuntimeMessage`，再在 `SpecialMessages.tsx` 以 props 方式接入上游组件，不能退回通用 JSON 卡。

## 7. 验证与维护

本轮交付结果：

- `pnpm run typecheck`：通过。
- `pnpm run test`：88/88 通过。
- `pnpm run build`：通过（Vite 仅报告既有大 chunk 建议，无编译错误）。
- `git diff --check`：通过。
- 浏览器真实交互：连续分段输入保持焦点和完整文本；刷新恢复草稿；发送接受后输入区清空且用户消息立即入列；HITL 暂停时 Enter 不发送/不清稿；批准并完成后暂停期间草稿仍保留；新建群聊终态无需刷新即保留助手消息；群聊实际 2 名成员显示为 `2 个 Agent`。

维护时继续执行：

```bash
pnpm run typecheck
pnpm run test
pnpm run build
```

浏览器验收至少覆盖：

1. 连续中文输入期间触发消息流/状态更新，光标不跳、文字不丢。
2. 刷新或切换回来后按会话恢复未发送草稿；发送后草稿清空。
3. user/assistant 气泡、Thinking、ProcessFold、Tool、Workflow 展开/折叠。
4. HITL 批准/拒绝及六种输入模式。
5. A2UI Surface 实时与刷新恢复。
6. 单聊和群聊的扩展角色顺序一致。

## 8. 最终 Code Review 结论

- 上游 `Messages/index.tsx` 的 12 个可见 role 已逐项覆盖；`system/developer` 按上游语义保持不可见。
- 顶层消息不再降级成通用 Activity；仅 AgentDock 自定义 wire 保持 Activity 兼容层。
- 实时、paused、终态持久化、刷新恢复共用角色/payload/事件顺序；流程块有唯一宿主。
- ChatItem、过程折叠、工具检查器、任务族、Council、压缩消息、Verify、TaskCallback、A2UI 和 HITL 六种模式均已接入单聊与群聊。
- 输入框不存在双 onChange 通道或受控旧值回写；草稿按页面/会话隔离，并以发送接受作为清理边界。
- 保留能力与有意不迁移项见第 5、6 节；这些是缺少 AgentDock 后端契约的 LobeHub 应用层消费者，不属于被通用卡片替代的 Chat role。

升级 LobeHub 时，以本文件顶部 commit 为 diff 起点，优先检查：

- `Conversation/Messages/index.tsx` 是否新增 role。
- `AssistantGroup/components` 是否新增 block 类型或分段规则。
- `ChatItem` DOM/style 是否变化。
- `ChatInput` 的 draft、IME、Enter 和 mention 行为是否变化。
