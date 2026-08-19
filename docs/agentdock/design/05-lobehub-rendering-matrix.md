# LobeHub 信息粒度组件渲染矩阵（fully copy LobeHub）

> 状态：P0 渲染缺口已补齐（2026-08-19），剩余为 P1/P2 视觉打磨
> 基线：`/private/tmp/lobehub-canary`
> 落地方式：AG-UI/A2UI 事件统一经投影层转成 LobeHub ViewModel 后再喂给下列组件（不做事件 Adapter），详见 `09-agui-lobehub-rendering-adapter.md`。

## 1. 目的

逐项对照 LobeHub canary 的消息/过程/信息展示组件与 AgentDock 当前实现，找出“视觉与信息粒度不一致”的缺口，保证最终渲染到界面上的每个信息粒度都有对应组件。

## 2. 矩阵

| 信息粒度 | LobeHub 上游组件 | AgentDock 当前组件 | 状态 | 缺口 |
|---|---|---|---|---|
| 消息外壳（头像/名称/时间/操作区） | `Conversation/ChatItem` | 官方 `@lobehub/ui/chat` ChatItem 包装 | ✅ 已迁移 | 与 LobeHub 本体同款原语：bubble 卡片、头像+标题+hover 时间、hover 操作栏、加载动画 |
| 用户消息气泡 | ChatItem 用户分支 | 官方 ChatItem `placement=right` bubble | ✅ | 右对齐气泡、无头像/标题（LobeHub 个人模式），hover 显示操作 |
| 助手 Markdown 文本 | `Conversation/Markdown`（LobeHub 管线） | 官方 `@lobehub/ui` Markdown（`variant="chat"`） | ✅ | 代码高亮/mermaid/流式动画原生支持 |
| 流式光标 | LobeHub typing indicator | `▍` 字符 + LoadingDots 空态 | ✅ 简化 | 空内容时显示 LobeHub LoadingDots；正文流式时保留光标 |
| 消息动作栏 | `MessageActionBar`（copy/regenerate/delete/feedback） | `MessageActions`（hover 显示） | ✅ 已补齐 | 用户/助手消息均支持点赞/点踩/复制/重新生成/删除，动作走回调 props |
| Reasoning/思考 | `Messages/Reasoning` + ProcessFold | `ReasoningBlock` | ✅ 已补齐 | 流式态（思考中…）、耗时、加密值展示已由 `RuntimeReasoningMeta` 投影；折叠动画可继续打磨 |
| Tool Call | `Messages/Tool` + Tool Inspector（参数/结果/耗时/状态） | `ToolCallBlock` | ✅ 已补齐 | `startedAt/finishedAt/apiName/resultMsgId` 由投影层记录，卡片显示耗时与错误态；参数高亮/工具图标注册可继续打磨 |
| Task/Workflow 步骤 | `Messages/Task`、`ProcessFold`、`WorkflowCollapse` | `WorkflowStepsBlock` | ✅ | 折叠动画可打磨 |
| Agent Delegation / Supervisor / Tasks / GroupTasks | `AssistantGroup` / activity | `ActivityBlock` | ✅ 已补齐 | `agentDock.supervisor/tasks/groupTasks/agentDelegation/assistantGroup` 统一投影为 activity 卡片（Crown/Layers/Users/ListTodo 图标 + i18n 文案）；完整 delegation 详情 P2 |
| HITL 审批 | `Intervention`（approve/reject/edit/input/select/form） | `HitlBlock`（approve/reject + requestId） | ⚠️ | 其余 mode 待后端 wire 冻结后逐项启用 |
| A2UI Surface | A2UI Renderer | 官方 renderer（http）+ `A2uiStoredSurface`（恢复/Mock） | ✅ | 动态 schema 联调验证 |
| 错误卡片 | LobeHub error message | `ErrorBlock` | ✅ 已补齐 | 展示 error code + message；重试按钮 P2 |
| 状态快照/State | LobeHub debug 面板 | 无 UI | P2 | 可加诊断折叠块 |
| Activity/Task 摘要 | LobeHub activity selectors | 通用 activity 渲染器 | ✅ | `CUSTOM_EVENT` 与 `MESSAGES_SNAPSHOT` 任务类 role 均投影为 activity 卡片；未知类型进 rawEvents 不白屏 |
| 欢迎页 | `AgentHome` | `Welcome` | ✅ | 建议按钮只 setInput 不自动发送（当前行为） |
| 会话历史列表 | `HomeSidebar/Body` | `HomeSidebar` | ✅ | 已接 sessionHistoryService |
| 市场列表卡片 | `community/(list)/{agent,skill,mcp}/Item` | `MarketItem` | ✅ | 结构已迁移；日期 locale P1 |
| 市场详情 Tabs/侧栏 | `community/(detail)/*` | `DetailPage` | ⚠️ | 结构已迁移；部分 Tab 内容为静态样例（Reviews/Security/Info） |
| Artifact/工作面板 | LobeHub Artifact | 静态占位 | ❌ P2 | 需接 artifact 数据 |
| Group 编排 | LobeHub Group | 极简 GroupPage | ⚠️ P2 | 本月隐藏；后续按 orchestration 输出渲染 |
| 未知事件 | 忽略/日志 | rawEvents | ✅ | 不白屏 |

## 3. P0 渲染缺口详述

### 3.1 Markdown（助手消息）

现状：✅ 已用 `Markdown.tsx`（react-markdown + remark-gfm）渲染助手消息；用户消息保持纯文本气泡。后续可补代码高亮插件。

### 3.2 Task/Workflow Steps

现状：✅ `RuntimeRunState.steps` + `orderedBlocks`，`WorkflowStepsBlock` 按事件顺序折叠渲染。

### 3.3 HITL

现状：✅ `HitlBlock` 携带 `requestId` 回传；标准 interrupt 与 legacy `on_interrupt` 双 wire 投影。其余 mode 与防抖在 HITL wire 冻结后按真实 fixture 启用。

### 3.4 A2UI

见 `design/03-a2ui-pipeline.md`。

## 4. 视觉一致性检查点（浏览器逐页）

- 对话页：消息气泡圆角、消息间距、hover 操作区、推理/工具折叠箭头、HITL 高亮色、A2UI 组件、输入框自动高度。
- 市场页：分类侧栏、卡片网格（FAB 版本右上角、skill/mcp 数量标签、时间到时分/ownerName）、FAB Select、排序（sortBy 下拉 + 升降序）、antd 分页（右下角）、已授权/全部切换。
- 详情页：Tabs 方块样式、右侧 360px 侧栏、版本标签、无权限禁用。
- 应用壳：左侧可拖拽面板（支持折叠/展开）、圆角内容容器、本月模式开关。
