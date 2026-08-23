# LobeHub Chat 全量复刻：差距分析与迁移计划

> 日期：2026-08-23
> 基线：`/Users/chenguo/lobehub`（LobeHub canary 源码）
> 原则：纯前端迁移；AG-UI/A2UI 事件经投影层转成 LobeHub 组件 props，不引入 LobeHub store。

## 一、现状盘点（已迁移）

| 能力 | 现状 |
|---|---|
| 消息外壳 ChatItem | 官方 `@lobehub/ui/chat` ChatItem（bubble/头像/标题/hover 时间/操作栏）✅ |
| 正文 Markdown | 官方 `@lobehub/ui` Markdown（代码高亮/mermaid/latex/流式动画）✅ |
| 消息操作栏 | `MessageActions`（点赞/点踩/复制/重新生成/删除）部分 ✅ |
| 用户编辑 | 双击编辑 + branch 替换 ✅ |
| HITL | `HitlBlock`（批准/拒绝 + requestId 回传）部分 ✅ |
| A2UI | 官方 renderer + `A2uiStoredSurface` ✅ |
| 流式/耗时/步骤 | Reasoning 流式态+耗时、Tool 耗时、WorkflowSteps ✅（视觉简化） |
| 会话历史 | IndexedDB v3（顺序/去重已修复）✅ |

## 二、差距矩阵（用户 11 项 + 补充）

| # | LobeHub 能力 | LobeHub 组件 | 本项目现状 | 差距 |
|---|---|---|---|---|
| 1/5 | 思考自动折叠、一级/二级展开、步数与耗时汇总 | `components/Thinking`、`AssistantGroup/ProcessFold`、`WorkflowCollapse` | ReasoningBlock 有自动折叠，但无汇总折叠、无"已处理 N 步·耗时"行、无二级层级 | 缺 ProcessFold / WorkflowCollapse 汇总行为 |
| 2 | 表单式用户反馈 | `MessageFeedback`（反馈弹窗：原因/截图/详情） | 只有点赞/点踩直发 reasonCode | 缺反馈表单弹窗 |
| 3 | 运行中顶部状态提示 + 头像转圈 | `ChatInputNotice`、ChatItem loading（Avatar 动画）、Thinking spinner | ChatItem loading 有；输入区无顶部状态条；Thinking 无转圈图标 | 缺 ChatInputNotice、Thinking spinner |
| 4 | 执行链路/细节组件 | `AssistantGroup`（Tool Inspector 参数/结果/耗时/干预、Reasoning、中间文本、Workflow） | 有简化 ToolCallBlock/WorkflowStepsBlock | 缺 Tool Inspector 视觉、干预详情、过程正文混排 |
| 6 | 正文显示形式 | `Messages/Assistant/useMarkdown` + LobeMarkdown 全插件 | 官方 Markdown 已接 | 基本对齐；缺 citations/artifact/mention 等自定义插件 |
| 7 | 消息底部功能栏（展开更多） | `MessageActionBar`（copy/regenerate/delAndRegenerate/edit/tts/translate/share/branch/comments/restoreToInput…） | 只有 5 个动作 | 缺 tts/translate/share/delAndRegenerate/branch/comments 等 |
| 8 | HITL 全模式 | `InterventionBar/InterventionContent`（approve/reject/edit/input/select/form） | 只有 approve/reject | 缺 edit/input/select/form 与干预详情 |
| 9 | 子助理/委派 + 技能查看 | `AssistantGroup` delegation、`SkillCall`、Agent Council | ActivityBlock 仅标题+描述 | 缺委派树/技能卡/“查看技能页面/调用信息” |
| 10 | 侧边栏详情（artifact/html/portal） | `ChatPortal` / Artifact 面板 | 手动 Artifact 占位面板 | 缺按输出自动打开 portal + 渲染 html/artifact |
| 11 | 输入区顶栏/底部状态 | `ChatInputNotice`、ControlBar、SendArea | 有底部审批行 | 缺运行中顶部提示、ControlBar 语境标签 |

## 三、迁移计划（分步）

### Step 1 ✅（2026-08-23）：思考/过程折叠系统
- `ReasoningBlock` → LobeHub `Thinking` 视觉：转圈图标（Loader2 spin）+ “思考中”/“思考完成 Xs”标题、自动展开/折叠、内容走 Markdown。
- 新增 `ProcessFold`：run 完成后把 reasoning+tool+steps 折叠为一行“已处理 N 步 · Xs”，运行中展开；一级=过程汇总，二级=单个块展开。
- 投影层：复用现有 `reasoningMeta / toolCalls / steps / orderedBlocks`，按 run 汇总耗时与步数。

### Step 2 ✅：运行状态提示（ChatInputNotice）
- `ChatInputNotice`：运行中/中断/错误时输入区顶部状态条。
- Thinking 标题转圈 + ChatItem 头像 loading 文案（已部分有）。

### Step 3 ✅：消息操作栏扩展（更多菜单）
- `delAndRegenerate`（删除并重新生成）、`restoreToInput`（回填输入框）、`tts`（朗读，占位）、`translate`（翻译，占位）、`share`（分享，占位）、branch/comments（占位）。

### Step 4 ✅：反馈表单
- 点踩弹出反馈表单（原因多选 + 文本 + 截图占位），走 `messageFeedbackService`。

### Step 5 ✅：HITL 全模式
- `HitlBlock` → LobeHub Intervention：edit/input/select/form 模式 UI，经投影层把 `AgentDockHITL.mode` 映射到对应表单。

### Step 6 ✅：Tool Inspector 升级
- Tool 卡：参数高亮、结果折叠、耗时、干预状态、工具图标注册。
- WorkflowCollapse：步骤树 + 状态图标 + 运行中 headline（motion 动画可先用 CSS 过渡替代）。

### Step 7 ✅：委派树/技能卡
- `agentDock.agentDelegation` 活动 → 委派树（Supervisor → 子 Agent 列表）；技能卡（查看技能页面/调用信息）接市场详情路由。

### Step 8 ✅：Artifact 侧边栏自动打开
- 输出含 html/artifact 时自动打开右侧面板（iframe 渲染 html、artifact 文件列表）。

### Step 9 ✅：Markdown @Agent 提及插件
- citations（引用角标）、`@agent` mention 卡片、skill 卡片、artifact 链接等自定义 remark/rehype 插件。

## 四、投影层改造原则

- 每个 LobeHub 组件保持 props 化：投影层从 `RuntimeRunState`（AG-UI 事件聚合）产出组件所需 props（如 `ModelReasoning`、`ChatToolPayloadWithResult`、`PendingIntervention`、`WorkflowSummary`）。
- 不引入 LobeHub store；状态仍由 CopilotKit agent + runReducer 持有。
- 新交互（折叠、反馈、portal）写回本地 state / Service / IndexedDB，不碰协议层。
- 每步保持 `pnpm run build` + `pnpm run test` 通过，并浏览器实测。
