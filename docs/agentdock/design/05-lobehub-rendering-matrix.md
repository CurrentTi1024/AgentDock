# LobeHub 信息粒度组件渲染矩阵（fully copy LobeHub）

> 状态：P0 渲染缺口已补齐（2026-08-19），剩余为 P1/P2 视觉打磨
> 基线：`/private/tmp/lobehub-canary`
> 落地方式：AG-UI/A2UI 事件统一经投影层转成 LobeHub ViewModel 后再喂给下列组件（不做事件 Adapter），详见 `09-agui-lobehub-rendering-adapter.md`。

## 1. 目的

逐项对照 LobeHub canary 的消息/过程/信息展示组件与 AgentDock 当前实现，找出“视觉与信息粒度不一致”的缺口，保证最终渲染到界面上的每个信息粒度都有对应组件。

## 2. 矩阵

| 信息粒度 | LobeHub 上游组件 | AgentDock 当前组件 | 状态 | 缺口 |
|---|---|---|---|---|
| 消息外壳（头像/名称/时间/操作区） | `Conversation/ChatItem` | `ChatItem` | ✅ 已迁移 | 基本一致；缺少消息分割线/连续同角色合并 |
| 用户消息气泡 | ChatItem 用户分支 | `ChatItem role=user` | ✅ | 基本一致 |
| 助手 Markdown 文本 | `Conversation/Markdown`（react-markdown） | `Markdown.tsx`（react-markdown + remark-gfm） | ✅ | 代码高亮插件可后续增强 |
| 流式光标 | LobeHub typing indicator | `▍` 字符 | ✅ 简化 | 可用，但可换成 LobeHub 风格 |
| Reasoning/思考 | `Messages/Reasoning` + ProcessFold | `ReasoningBlock` | ⚠️ P1 | 无流式状态、无加密值展示、折叠动画简化 |
| Tool Call | `Messages/Tool` + Tool Inspector（参数/结果/耗时/状态） | `ToolCallBlock` | ⚠️ P1 | 无耗时、无工具图标注册、无参数高亮 |
| Task/Workflow 步骤 | `Messages/Task`、`ProcessFold`、`WorkflowCollapse` | `WorkflowStepsBlock` | ✅ | 折叠动画可打磨 |
| Agent Delegation | `AssistantGroup` / activity | `ActivityBlock` | ✅ | 完整 delegation 详情 P2 |
| HITL 审批 | `Intervention`（approve/reject/edit/input/select/form） | `HitlBlock`（approve/reject + requestId） | ⚠️ | 其余 mode 待后端 wire 冻结后逐项启用 |
| A2UI Surface | A2UI Renderer | 官方 renderer（http）+ `A2uiStoredSurface`（恢复/Mock） | ✅ | 动态 schema 联调验证 |
| 错误卡片 | LobeHub error message | `ErrorBlock` | ⚠️ P1 | 无 code、无重试按钮 |
| 状态快照/State | LobeHub debug 面板 | 无 UI | P2 | 可加诊断折叠块 |
| Activity/Task 摘要 | LobeHub activity selectors | 仅 HITL/Surface 命中 | ⚠️ P1 | 通用 activity 渲染器 |
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
- 市场页：分类侧栏、卡片网格、FAB Segmented、分页、已授权/全部切换。
- 详情页：Tabs 方块样式、右侧 360px 侧栏、版本标签、无权限禁用。
- 应用壳：左侧可拖拽面板、圆角内容容器、本月模式开关。
