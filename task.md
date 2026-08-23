# AgentDock 任务清单与进度（需求 / 实现 / 状态 / 引用）

> 更新日期：2026-08-19
> 模式：需求 Review + Code Review + 文档输出（详见 `docs/agentdock/design/`）
> 基线：LobeHub canary `/private/tmp/lobehub-canary`；只迁移前端

## 0. 核心开发需求（总纲）

### R1 完整实时链路：LobeHub 组件 props → AG-UI/A2UI → Copilot Runtime → Orchestration

- LobeHub 展示组件全部“props 化”（不绑定 LobeHub store），由投影层喂数据。
- AG-UI 事件由官方 CopilotKit transport 解析（single-route envelope：`agent/run / connect / stop / info`）。
- A2UI 由官方 catalog + renderer 渲染，action 以 `forwardedProps.a2uiAction.userAction` 回传。
- Copilot Runtime（`server/index.ts` + `FabRoutingAgent`）按 `fab` 路由到 Orchestration `/ag-ui`。
- 后端 DeepAgents + CopilotKitMiddleware 输出 AG-UI SSE；前端逐事件投影到对应组件。
- 端到端保证：流式回显、HITL（标准 resume[] / legacy 双 wire）、断线恢复（按 streamId 游标）、A2UI 增量更新。

### R2 Chat / Group Chat 全量复刻 LobeHub

- 对话页与群聊页完整迁移 LobeHub 页面、组件、样式与交互（消息列表、输入区、过程折叠、操作栏、设置面板、成员管理、返回入口）。
- 所有 agent 消息类型按 LobeHub 显示：assistant / assistantGroup / reasoning / tool / task / tasks / groupTasks / supervisor / activity / a2ui / error 等。
- 组件 props 化 + 投影层落地，视觉与交互与 LobeHub 一致。

### R3 市场全量复刻 LobeHub（融合 FAB，FAB UI/UX 保持不变）

- 保持现有 FAB 选择器 UI/UX 不变。
- 补回 LobeHub 市场右上角：排序条件（sortBy）+ 升降序（sortOrder）。
- Agent 列表卡片补回每个 agent 的 skill/mcp 数量等元信息。
- “进入聊天”按钮颜色/样式与 LobeHub 一致。
- 分类侧栏、卡片密度、详情 Tabs/侧栏、分页等逐项对照补齐（✅ 已核对：菜单仅保留 Agent/Skills/MCP）。
- Agent/Skill/MCP 卡片布局统一：FAB 版本置于右上角，不再显示“已验证”，左下角时间精确到时分，右下角显示 ownerName。
- 市场页搜索框随屏幕宽度自适应（移除 maxWidth: 480，与 LobeHub 一致 width: 100%）。
- 分页改用 LobeHub 原版 antd `Pagination`（数字分页，`alignSelf: flex-end` 位于列表底部右侧）。
- 左侧菜单栏可折叠（对齐 LobeHub）：侧栏头部折叠按钮（PanelLeftClose），折叠后顶部 NavHeader 显示展开按钮（PanelLeftOpen）；宽度/折叠状态持久化到 localStorage。
- Chat Group 侧栏头部增加返回首页（Home）图标；创建群组弹窗优化：Agent 名称搜索、成员列表滚动（max-height 280px）、选中计数（已选 x/y）、空态与选中/悬停视觉。
- Chat Group 侧栏移除顶部“对话”菜单项（返回首页图标已覆盖该入口）。
- 修复群聊发送后输入框未清空：`GroupChatPage` 发送输入框内容时先 `setInput('')`（示例消息路径不受影响）。

> 2026-08-20 更新：R3 前三项已完成并通过 Chrome headless + CDP 验证
> （sortBy 下拉 + 升降序切换、Agent 卡片 skill/mcp 数量标签、
> 三类卡片右上角 FAB 版本/底部时间到时分/右下角 ownerName、搜索框自适应、
> 主色切换为 LobeHub neutral 'primary'：#eeeeee 暗色 / #222222 亮色，
> 详情页“开始对话”按钮颜色与 LobeHub 一致；FAB 选择器 UI/UX 未变）。

### R4 其他页面全量完成（不留占位符）

- Group / Tasks / Documents / Memory / Channel / Artifact / Page / Settings 后续一并完成，不使用占位符。
- 把 LobeHub 对应页面的功能与嵌套 UI/UX 完整搬移，改写 hooks 逻辑融合本项目（Service / i18n / router）。
- 每页按“需求文档 → 迁移 → hooks 改写 → 测试 → 视觉验收”推进。

## 0.1 当前问题 / 后续任务 / 待确认任务

### 现在的问题（已确认存在）

1. **市场未 fully copy LobeHub**（FAB 选择器 UI/UX 保持不变）：
   - ~~右上角缺失排序条件（sortBy）与升降序（sortOrder）~~ ✅ 已补（`SortButton` + `OrderButton`，Mock 已实现排序）。
   - ~~Agent 列表卡片缺失每个 agent 的 skill/mcp 数量等元信息~~ ✅ 已补（TokenTag 风格数量标签）。
   - ~~“进入聊天”按钮颜色/样式与 LobeHub 不一致~~ ✅ 已改（主色 `blue` → `primary`，与 LobeHub 一致）。
   - 分类侧栏、卡片密度、详情 Tabs/侧栏等细节待逐项对照。
2. **Chat / Group Chat 未全量复刻 LobeHub**：消息类型矩阵仍有缺口（assistantGroup / task / tasks / groupTasks / supervisor / activity 等），过程折叠、操作栏、编辑态、群聊设置面板等交互为简化版。
3. **其他页面为占位/简化**：Group / Tasks / Documents / Memory / Channel / Artifact / Page / Settings 未按 LobeHub 全量迁移。
4. **本地环境**：5173 被旧 dev server（PID 54967）占用，测试可能访问旧代码；需 kill 后重启。
5. **构建体积**：主 chunk ~2MB（CopilotKit 依赖 katex/mermaid/shiki），需要拆包优化。
6. **静态样例**：详情页 Reviews / Security / Info 等待真实数据。

### 后续任务（直接执行，无需确认）

- R2：对话页 + 群聊页按 LobeHub 全量复刻（组件、样式、交互、消息类型矩阵），并同步 `design/05` 渲染矩阵。
- R3：~~市场补齐排序/升降序、skill/mcp 数量、进入聊天按钮样式~~ ✅；分类/卡片密度/详情对照（FAB UI/UX 不变）继续。
- R4：Group / Tasks / Documents / Memory / Channel / Artifact / Page / Settings 全量迁移，不留占位符。
- 前端收尾：构建体积拆包（CopilotKit 懒加载/独立 chunk）；每完成一项跑 `pnpm run build` + `pnpm run test`，并在 task.md / docs/06 更新状态。

### 待确认任务（需要用户或后端拍板）

1. **HITL wire**：标准 `RUN_FINISHED(outcome=interrupt) + resume[]` 还是 legacy `on_interrupt`（前端双路径已实现，需后端 fixture 冻结一种）。
2. **A2UI**：动态 schema（Runtime `injectA2UITool: true`）还是固定 schema（`a2ui_operations`）；需要一条真实 `render_a2ui` fixture。
3. **Orchestration connect 语义**：前端已按 `lastStreamId` 游标恢复实现（方向已冻结），需后端确认支持并按游标过滤；Redis event TTL。
4. **threadId 策略**：同一本地会话切换 agent/fab 时是否新建 threadId（建议新建）。
5. **市场字段契约**：sortBy / sortOrder 枚举值；skill/mcp 数量字段名与空值规则；`permissioned` 为空时的文案。
6. **SSO 透传**：Cookie 还是 Authorization，Runtime → Orchestration 的透传方式。
7. **详情真实数据**：Reviews / Security / Info 数据源与字段。
8. **构建体积优化方案确认**：是否接受 CopilotKit 独立 chunk / 懒加载（影响首屏加载策略）。

## 1. 模块总览

| 模块 | 需求摘要 | 状态 | 引用 |
|---|---|---|---|
| M0/M1 应用壳与导航 | 迁移 LobeHub 壳/导航；本月模式开关 | ✅ 已完成 | `docs/agentdock/06` |
| M2 对话页 | Agent 对话、@Agent、流式、Reasoning/Tool/HITL/A2UI、IndexedDB 全量历史（单 Agent + Group） | ⚠️ P0 核心完成；R2 全量复刻 LobeHub 消息类型与交互进行中（HITL wire 待后端冻结） | `design/01`、`design/02`、`design/05`、`design/09` |
| M3 市场列表 | Agent/Skill/MCP 市场，FAB 前置，all/permissioned | ✅ 核心完成（竞态/locale 已修）；R3 排序/升降序、skill/mcp 数量、进入聊天按钮样式已补并 CDP 验证 | `design/04` |
| M4 详情页 | 三类详情，FAB 前置，Version 不分区 | ✅ 完成（竞态/locale 已修；Reviews/Security/Info 静态样例 P2） | `design/04` |
| M5 Skill 创建 | 三步表单 + 立即发布 | ✅ 完成（受控表单 + detailUrl + Mock 详情注册） | `design/04` |
| M6 隐藏模块 | Channel/Artifact/Page/Group/Tasks/Documents/Memory/Settings | ✅ R4 全量迁移完成（2026-08-20）：八类页面按 LobeHub 源码迁移并改写 hooks，无占位符 | `docs/agentdock/00` |
| M7 i18n | 覆盖 LobeHub 全部语言；UI 静态字段 | ✅ 18 种语言词典 + 测试 | `src/i18n` |
| R 运行时链路 | agentId/fab/sessionId/threadId/runId 携带；FAB 路由；AG-UI/A2UI 流式回显 | ⚠️ 官方集成已落地（Provider/hook/server/A2UI catalog），HITL wire 与后端 A2UI fixture 待联调 | `design/01`、`design/02`、`design/03`、`design/06`、`design/08`、`design/09` |
| D 调试 | 公司内无缝调试 Registry + Orchestration + 事件消费回显 | ✅ 文档已输出 | `design/07` |

## 2. 功能需求与实现方案（分模块）

### 2.1 M0/M1 应用壳与导航

**需求**：左侧可拖拽导航面板 + 圆角内容容器 + 本月模式开关；菜单包含对话、Chat Group、任务、文档、记忆、商场、设置及 Channel/Artifact 占位。

**方案**：`src/components/shell/` 迁移 LobeHub `NavPanelShell + DraggablePanel + DesktopLayoutContainer + HomeSidebar`；`uiStore` 持久化面板宽度/展开/本月模式。

**状态**：完成。本月模式开启后隐藏 Group/Tasks/Documents/Memory/Channel/Artifact/Page，且不触发业务请求。

### 2.2 M2 对话页（Agent 对话链路）

**需求**：

- 每次发送携带 `agentId`、`fab`、`sessionId`、`threadId`、`runId`。
- 支持 `@Agent` 选择（`getMentionAgentsList`）。
- 消费 AG-UI 文本/reasoning/tool/step/state/activity/lifecycle/error，LobeHub 风格渲染。
- 支持停止、断线恢复、HITL、A2UI、IndexedDB 历史。
- **IndexedDB 保存全部会话消息**（单 Agent 与 Agent Group 的所有可见消息：文本/reasoning/tool/activity/HITL/surface/step），每次打开从 IndexedDB 恢复；清空浏览器存储后为空（不内置 Mock 种子会话）。

**方案**：

- `agentRuntimeService.createRunInput` 生成 runId/用户消息；`runStore.execute` 驱动 SSE + reducer + checkpoint。
- `runtimeConfig.resolveAgentRuntimeUrl(fab)`：proxy 固定 `/api/copilotkit`；direct 按 FAB 拼 `/ag-ui`。
- `MessageBlocks` 渲染 Reasoning/ToolCall/HITL/A2UI/Error。

**状态**：骨架完成；以下为 Review 缺口：

| 缺口 | 优先级 | 详情 |
|---|---|---|
| ~~未接官方 CopilotKit headless~~ | ✅ 已接 | `CopilotKit Provider + useAgent + useCopilotKit`（`useAgentDockConversation`） |
| ~~A2UI 伪实现~~ | ✅ catalog/renderer 已接 | `a2ui/catalog.tsx` + Provider `a2ui` + `useRenderActivityMessage`；action 拦截待联调 |
| ~~HITL requestId 硬编码空串~~ | ✅ 已修 | activity 的 requestId 现回传至 approve/reject |
| ~~助手消息无 Markdown~~ | ✅ 已修 | `Markdown.tsx`（react-markdown + remark-gfm） |
| ~~STEP_STARTED/FINISHED 无 UI~~ | ✅ 已修 | `RuntimeRunState.steps` + `WorkflowStepsBlock` |
| 复制按钮无 onClick | P2 | 接 clipboard |
| mention 默认选中 items[0] | P2 | 增加空态 |

### 2.3 M3 市场列表

**需求**（FAB 前置）：先 `getFabOptions(type, mode)` 再按 FAB 查分类/列表；`all / permissioned`；分页；分类 emoji 图标。

**方案**：`marketService.getFabOptions` + `agent/skill/mcpMarketService` 三类 Service；Mock 与 HTTP 同构；`filterMarketItems + sortMarketItems + page` 实现 Mock 过滤与排序；分页使用 antd `Pagination`（右下角）。

**状态**：功能完成。缺口：

- ~~列表/分类请求无 AbortController、无 loading/error、FAB 切换竞态（P1）~~ ✅ 已修：AbortController + requestId 过期保护 + loading/error 态。
- ~~locale 硬编码 `zh-CN`（P1）~~ ✅ MarketPage/DetailPage/GroupCreateModal 已用 `useI18n().locale`；ChatPage/HomePage/GroupChatPage/CreateSkillPage 仍写死。
- ~~`MarketItem` 日期 `toLocaleDateString('zh-CN')`（P1）~~ ✅ 已改：跟随 `useI18n().locale` 且时间精确到时分。

### 2.4 M4 详情页

**需求**：三类详情 FAB 前置；Agent 详情展平当前 FAB 版本（`versionInfo + fabPermission`）；Skill/MCP 单元素 `versions`；Version 页不分区；无权限禁用“开始对话”。

**方案**：`DetailPage` 顶部 FabSelector + Tabs（overview/system-role/capabilities/version/related；Skill/MCP 含 install/schema/reviews/info/security/agents）。

**状态**：功能完成。缺口：

- 详情请求无 AbortController/错误态（P1）。
- 请求 locale 硬编码（P1）。
- Reviews/Security/Info 为静态样例（P2，等待真实数据）。
- homepage/repository 按钮无 onClick（P2）。

### 2.5 M5 Skill 创建

**需求**：skill_creator 创建并立即发布（三步表单：基本信息/仓库与版本/校验发布）。

**方案**：`CreateSkillPage` 调用 `createAndPublishSkill`（Mock 返回 `detailUrl`）。

**状态**：完成。缺口：

- 发布成功跳转硬编码 `/market/skill/document-summary`，应使用返回 `detailUrl`；Mock 无该详情（P1）。
- 表单全部 defaultValue，用户输入未收集；错误无展示（P1）。

### 2.6 M6 隐藏模块（R4 全量迁移完成）

**需求**：全部菜单可见，本月模式隐藏且不请求；其余页面不留占位符，按 LobeHub 完整迁移功能与嵌套 UI/UX。

**方案（2026-08-20 落地）**：

- `/tasks`：迁移 `AgentTasksPage`——NavHeader（可见性筛选/新建/列表⇄看板/显示设置），列表分组 Accordion（状态/执行 Agent/优先级 + 次级分组 + 排序），看板五列（HTML5 DnD 拖拽改状态），任务卡片（优先级/状态/私密/编号/子任务进度/头像/时间/右键菜单），创建弹窗（名称/指令/执行 Agent/优先级/可见性/自动化/cron），隐藏完成项页脚，任务详情抽屉。
- `/memory`：迁移 memory `_layout` 侧栏（首页/身份/上下文/偏好/经验/活动）+ 首页（Persona + 角色标签云 + 记忆分析触发 + 空态）+ 五类子页（网格/时间线视图、右侧详情栏、编辑/新建弹窗、置顶/删除）。
- `/documents`：迁移 `AgentDocumentPage`——搜索/筛选（最近/我的/共享）、置顶卡片、详情页 Markdown 阅读（含 CSV 原文）、新建文档弹窗、删除。
- `/channel`：迁移 `agent/channel`——平台渠道网格（状态色点/标签/coming soon）、右侧详情面板（连接信息/配置字段）、连接弹窗（凭证表单）、断开。
- `/artifact`：迁移 `Portal/Artifacts`——按会话分组的产物列表（类型图标/预览摘要）、预览 Modal（Markdown/代码高亮/下载/删除）。
- `/page`：迁移 `Pages/PageExplorer`——页面列表（状态筛选/搜索）、全屏轻量编辑器（标题/正文/保存/发布）。
- `/settings`：迁移 `Settings/Layout`——侧栏分栏（通用/外观/记忆/关于），保留既有功能（18 语言、主题模式、推理摘要、Mock/HTTP 运行时切换、会话历史说明）。

**hooks 改写**：原 LobeHub `useGlobalStore/useUserStore/useTaskStore/useUserMemoryStore/SWR/TRPC` 全部改写为本地 hooks + Service（`scheduledTaskService/documentService/memoryService/channelService/artifactService/pageService`），Mock 与 HTTP 同构；`MotionProvider` 全局挂载修复 Accordion 运行时崩溃；Memory 子页按路径识别 tab。

**状态**：✅ 完成。浏览器冒烟 13 条 R4 路由全部渲染无异常，交互验证通过；build 通过；i18n 新增 ~110 个 key 并补齐 18 种语言翻译。

### 2.7 M7 i18n

**需求**：UI 静态字段全部 i18n，覆盖 LobeHub 全部语言；后端返回数据不翻译。

**方案**：`src/i18n` 自研轻量 provider（localStorage 用户设置 → 浏览器语言）；18 份词典；`dictionaries.test.ts` 守护 key 与占位符一致、非英文词典确实翻译。

**状态**：✅ 完成。`SUPPORTED_LOCALES` 18 种全部注册，无静默回退。

## 3. 运行时链路与编排（重点）

### 3.1 需求

- chat 携带 `agentId / fab / sessionId / threadId / runId`。
- runtime 根据 fab 自动切换 orchestration baseUrl（生产在 CD deployment.yml 注入服务端 env）。
- AG-UI 通信 + 前后端 A2UI pipeline + 流式回显。
- 最终每个信息粒度都有对应渲染（fully copy LobeHub）。

### 3.2 现状（已核实）

- `createRunInput`：runId = `crypto.randomUUID()`；消息、threadId、forwardedProps（action/agentId/fab/sessionId/group）齐全。
- `server/index.ts + fabRoutingAgent.ts`：官方 single-route handler + `AGENT_ORCHESTRATION_BASE_URLS_JSON` → `{fab}/ag-ui`（HttpAgent）。
- `runReducer`：run/text/reasoning/tool/state/activity/surface 事件消费；streamId 去重；IndexedDB checkpoint + resume。
- A2UI Action：新 runId + parentRunId，结构正确。

### 3.3 缺口（P0 汇总）

| # | 缺口 | 行动 |
|---|---|---|
| R1 | ~~无 Copilot Runtime HTTP 挂载~~ | ✅ `server/index.ts` + `FabRoutingAgent`；`pnpm run server` 可启动；/healthz 与 single-route /api/copilotkit 已验证 |
| R2 | ~~自研 transport 与官方 envelope 不一致~~ | ✅ 官方 Runtime handler（/info 返回 agents + a2uiEnabled）已接入；自研 SSE/reducer 仅保留给 mock |
| R3 | ~~A2UI 伪实现~~ | ✅ catalog（metricCard/actionButton）+ Provider `a2ui` + 官方 renderer；Mock surface 保留 raw JSON 回退 |
| R4 | ~~HITL requestId 丢失~~ | ✅ 已修；http 路径用 `agent.pendingInterrupts + resume[]`，legacy wire 保留 forwardedProps 后备 |
| R5 | ~~STEP_* 不消费~~ | ✅ reducer + WorkflowStepsBlock |
| R6 | ~~Markdown 不渲染~~ | ✅ ChatItem 助手消息走 Markdown 渲染 |
| H0 | ~~全量会话历史持久化~~ | ✅ sessionHistoryService v3：text/reasoning/tool/activity/step/surface 全部入 IndexedDB；打开恢复；移除 Mock 种子（清空浏览器即空） |

## 4. Review 输出物（本次新增）

| 文档 | 说明 |
|---|---|
| `docs/agentdock/design/00-design-index.md` | 设计目录索引与 Review 摘要 |
| `docs/agentdock/design/01-end-to-end-runtime-link.md` | 端到端链路、ID 语义、FAB 路由、CD 配置 |
| `docs/agentdock/design/02-ag-ui-protocol-implementation.md` | AG-UI 协议与 reducer 事件矩阵 |
| `docs/agentdock/design/03-a2ui-pipeline.md` | A2UI 端到端管线与落地方案 |
| `docs/agentdock/design/04-agent-registry-integration.md` | Registry 集成、FAB 前置、Mock→HTTP |
| `docs/agentdock/design/05-lobehub-rendering-matrix.md` | LobeHub 渲染矩阵与缺口 |
| `docs/agentdock/design/06-copilotkit-integration-plan.md` | 官方依赖接入方案与迁移路径 |
| `docs/agentdock/design/07-end-to-end-debugging-guide.md` | 公司内联调调试指南（额外文档） |
| `docs/agentdock/design/08-final-architecture-decision.md` | 最终架构决策：官方 CopilotKit + Copilot Runtime、OAuth2 Proxy 分工、状态冲突解法 |
| `docs/agentdock/design/09-agui-lobehub-rendering-adapter.md` | AG-UI/A2UI → LobeHub 渲染适配层：投影层方案（不做事件 Adapter） |

## 5. 验证记录

- `pnpm run test`：通过（runReducer 2 项、sse 1 项、i18n 3 项）。
- `pnpm run build`：通过。
- 浏览器自动化（Chrome headless + CDP）：新建对话/发送/HITL 批准/刷新恢复/群创建全链路点击验证，并逐步读取 IndexedDB 核对 sessions/messages/checkpoints 落库时机，全部符合预期；当前单测 13/13 通过。
- 全盘一致性核对（2026-08-19）：修正 `docs/agentdock/02/03/04/05/06` 与 `design/01/02/03/05/06/07/08/09` 中与代码不一致的内容；联调指南按官方 single-route envelope 重写，Registry 调试路径修正为 `/api/market/getFabOptions`，IndexedDB 名称修正为 v3。
- i18n 联网复核（全量）：15 种新语言 × 全部 257 个 key（共 3855 条）逐一与机器翻译比对。阿拉伯语走 DeepL oneshot，其余 14 种走本地 Argos Translate（模型约 1.5GB，首次需下载）；比对脚本保留为 `scripts/verify-i18n.mjs`（`I18N_BASE_URL` 可指向本地 `scripts/argos-translate-server.py`）。
- i18n 复核修复：全量 flagged 逐条人工复核后，补齐 12 种语言中 13 个英文漏译 key（`nav.newGroup/recentGroups/emptyGroups`、`group.home.*`、`group.welcome.*`、`workspace.settings.mockDesc/themeMode*`），并修正阿拉伯语 `chat.mentionEmpty` 语法、德语 `skillCreate.branch`/`workspace.group.members` 用词；其余 flagged 均为机器错义/同义表达，人工译文保留（如 bg `Tool call` 机器误译为 `Name`、ko/fa/tr 旧模型大量乱译）。
- 浏览器实测：Chat 流式、Group HITL、A2UI 折叠块、刷新恢复、市场/详情导航正常（此前记录）。

## 6. 下一步

按优先级执行：

1. ✅ P0：`server/index.ts` 挂载 Copilot Runtime；OAuth2 Proxy 配置见 `design/08` §7.3。
2. ✅ P0：官方 CopilotKit v2（Provider + `useAgent` + `useCopilotKit`）已接入，`useAgentDockConversation` 双模式运行。
3. ✅ P0：A2UI catalog/renderer、HITL requestId、Markdown、STEP UI。
4. ✅ P0：IndexedDB 全量会话历史（含 Group 消息类型）。
5. ⏳ 联调项（需后端配合）：HITL wire 冻结（标准 resume[] vs legacy on_interrupt）、A2UI fixture 验证、`AGENT_ORCHESTRATION_BASE_URLS_JSON` 路由验证。
6. ✅ 无需联调项已全部完成：市场/详情竞态与 locale、Skill 跳转（Mock 注册新详情）、复制按钮、mention 空态、IndexedDB 防抖与单调序列、恢复历史 A2UI 组件化渲染、Provider mock 下不连 Runtime。
7. P1（保留）：构建产物体积优化（CopilotKit 依赖引入 katex/mermaid/shiki，需拆包重构）。
8. P2：静态样例数据（等真实数据）；Settings 开关已实际生效。

## 7. 深度 Code Review（2026-08-19，详见 `design/10-end-to-end-code-review.md`）

Review 模块：R1 协议入口、R2 前端传输、R3 状态机、R4 官方 headless、R5 页面装配、R6 信息粒度渲染、R7 持久化、R8 A2UI Pipeline、R9 HITL wire。

本轮已修复：

- 事件顺序渲染：`RuntimeRunState.orderedBlocks` + `renderRunBlocks` 按事件到达顺序渲染（reasoning/tool/step/activity 交错时不再按 map 分组错序）。
- 官方 HITL：标准 `RUN_FINISHED(outcome=interrupt)` 与 legacy `on_interrupt` 均投影为 `agentDock.hitl` 暂停块，requestId 正确回传。
- 刷新恢复：http 路径用 checkpoint 回填 `agent.setMessages`，下一轮 run 携带完整上下文。
- 模式边界：`useOfficial` 仅 proxy 生效；http+direct 回退自研 SSE（官方直连需 Enterprise）。
- A2UI action 按官方 `forwardedProps.a2uiAction.userAction` 嵌套；http 下关闭 raw JSON surface 双渲染。
- `chat.steps` 改为 `{completed}/{total}` 占位符并同步 18 语言。
- 服务端：静态目录穿越边界修复、`/api/copilotkit` 精确匹配。

第二轮（2026-08-19，无需联调项全部完成）：

- 市场页/详情页：AbortController 竞态保护、loading/error 展示、locale 使用用户设置。
- Skill 创建：受控表单收集用户输入、错误展示、按返回 `detailUrl` 跳转，Mock 注册新创建详情。
- IndexedDB：`nextSequence()` 单调序列 + `scheduleRunCheckpoint/flushRunCheckpoint` 350ms 防抖。
- A2UI：恢复历史/Mock surface 用 `A2uiStoredSurface` 按组件渲染，actionName 由 payload 驱动。
- Chat：复制按钮接入 clipboard、`@` 菜单空态（`chat.mentionEmpty` 18 语言）。
- 文档/记忆页日期使用用户 locale；Provider 在 mock 模式下不发起 Runtime `/info`。
- 服务端：`AGENT_ORCHESTRATION_BASE_URLS_JSON` 协议由公司内网规范决定，不做强制校验。

第三轮（2026-08-19，浏览器自动化验证后修复）：

- 会话主键 = 路由 id：默认入口 `session-inbox` 与 UUID 会话均 `createSession({ id: sessionId })`，会话行/消息/checkpoint 同键。
- 会话列表刷新：落库后广播 `agentdock:sessions-changed`；侧边栏对路由 `pendingSession` 乐观插入；focus/visibility 兜底重载。
- 切换会话不信任旧 session state：`ensureSession` 仅在同 id 时复用内存状态，避免发送消息更新到上一个会话。
- 刷新去重：落库文本 id 带 `text:` 前缀，渲染过滤时去掉前缀再与 run.messages 比对，历史不再重复。
- 标题修复：agentName 已含 FAB 时不再二次拼接；发送首条消息用前 32 字符更新会话标题。
- 群聊导航：群侧边栏新增“对话”入口、群聊页头部新增返回按钮；群设置面板默认收起（头部信息图标开关）；成员标签超长省略。
- UI 测试稳定选择器：`chat-input / chat-send / chat-stop`（design/07 §10）。

第四轮（2026-08-19，投影层补齐 AG-UI 全事件面 + LobeHub 信息粒度渲染）：

- **投影层（runReducer）**：REASONING_START/END/ENCRYPTED_VALUE 流式态与耗时（`reasoningMeta`）；TOOL_CALL 记录 `apiName/startedAt/finishedAt/resultMsgId` 与错误态；`CUSTOM_EVENT`（agentDock.supervisor/tasks/groupTasks/agentDelegation/assistantGroup/task + legacy on_interrupt）投影为 activity；`MESSAGES_SNAPSHOT` 的 LobeHub 任务类 role（task/tasks/groupTasks/supervisor/assistantGroup）投影为 activity 卡片；`ACTIVITY_SNAPSHOT` 内容合并 activityType，实时路径 activity 卡片可渲染。
- **渲染（MessageBlocks）**：Reasoning 思考中/耗时/加密值；Tool 卡片耗时 + apiName + 错误 Tag；ActivityBlock 全类型图标与 i18n；ErrorBlock 展示 code。
- **Mock fixture**：补 STEP_FINISHED、reasoning 流式延迟、群聊 supervisor/tasks/groupTasks 自定义事件，页面可直接演示完整消息类型矩阵。
- **i18n**：新增 10 个 key（reasoning 流式/耗时/加密、tool 失败/耗时、supervisor/tasks/groupTasks/assistantGroup），18 语言词典全部翻译并过测试。
- **测试**：runReducer 新增 6 项（reasoning 生命周期、tool 耗时、自定义事件投影、legacy HITL、快照任务类 role、activityType 合并），总计 22/22 通过；build 通过；HTTP 冒烟 5 路由 200。

第五轮（2026-08-19，对话页 UI/UX 切换为官方 LobeHub chat 原语）：

- **ChatItem**：弃用自研简化组件，改为包装官方 `@lobehub/ui/chat` ChatItem（LobeHub 本体同款）——bubble 卡片、头像+标题+hover 时间、hover 操作栏（role=menubar）、加载动画全部原生一致；过程块经 `renderMessage` 嵌回消息卡片内（官方发布版会丢弃 children，用 renderMessage 包装解决）。
- **Markdown**：切换为官方 `@lobehub/ui` Markdown 渲染管线（代码高亮/mermaid/流式动画，`variant="chat"`），替换自研 react-markdown。
- **消息动作**：新增 `MessageActions`（点赞/点踩/复制/重新生成/删除），用户消息与助手消息 hover 显示，全部走回调 props；`sessionHistoryService.removeMessage` 删除消息行+关联过程块+含该消息的 checkpoint，避免刷新复活。
- **ChatInput**：LobeHub 桌面输入区样式（圆角边框容器、focus 高亮、自动高度、底部键盘提示 Send/Warp、primary 发送/停止按钮、@Agent 弹层）。
- **群聊页**：同步使用官方 ChatItem + 操作栏。
- **浏览器实测**（Chrome headless + CDP）：欢迎页 → 发送 → 推理耗时块 → 工作流步骤 → HITL 批准 → 工具耗时 → 任务卡片 → A2UI 指标卡/按钮全部渲染；截图存于本机可视化目录。22/22 测试通过，build 通过。

第六轮（2026-08-19，按用户反馈收尾对话页视觉/交互细节）：

- 用户气泡右侧显示本人头像（LC），标题隐藏（LobeHub 个人模式）；agent 消息改用官方 docs 变体（无外边框），过程块保留自身边框卡片。
- 消息动作栏不再与气泡同行：docs 变体天然纵向布局，用户气泡用 `actionsWrapWidth` 强制换行，hover 时显示在气泡下方。
- 输入框圆角 16px + focus 高亮；输入区外新增底部功能行（左侧提示、右侧「审批模式」Select，自动/手动持久化到 uiStore；自动模式下 HITL 出现即自动批准）。
- `@` 懒加载：输入 `@` 或点击 Agent-FAB 按钮才经 `agentMarketService.getMentionAgentsList` 拉取（mock 模式返回 mock 数据，带 loading/缓存），不再挂载时预取。
- i18n 新增 4 个 key（approval label/auto/manual、footer hint）同步 18 语言；修复 fr-FR 同值越界。
- Chrome headless + CDP 实测：圆角 16px、审批模式显示、@ 触发 mention、用户头像在右侧、动作栏独立行全部符合；22/22 测试通过。

第七轮（2026-08-19，逐 code 补齐 LobeHub 对话交互）：

- **用户消息编辑**：双击用户消息打开官方 EditableMessage 编辑（Confirm/Cancel），确认后走 branch 替换（`removeTurn` 整轮删除 + 以编辑文本重跑）；新增 `sessionHistoryService.updateMessageContent/removeTurn`，checkpoint 同步。
- **输入区功能**：斜杠命令菜单（`/` 触发，插入分析/对比/总结建议）；附件、语音按钮已就位但禁用（首期未启用）；与 @Agent 一起组成 LobeHub ActionBar。
- **助手重新生成 = branch 替换**：`regenerateAssistant` 找到该回复之前的用户消息，整轮删除（用户文本+回复+过程块+checkpoint）后重跑，不再是简单重发。
- **live/历史模型修正**：只有 running/paused 的 run 走 live 渲染；完成/取消的 run 刷新后一律按历史消息渲染（可编辑/操作），对齐 LobeHub「无 live 消息」模型。
- **消息分割线 + 连续同角色合并**：时间间隔 >30min 插入 HistoryDivider（历史消息）；连续同角色隐藏重复头像/标题。
- **群聊设置面板**：改为 LobeHub 风格 Tabs（模式/任务/成员管理）。
- **测试**：新增 removeTurn/updateMessageContent 单测（发现并修复了存储顺序导致的分支删除 bug），24/24 通过；build 通过；浏览器实测斜杠菜单、双击编辑打开、live/历史模型修正。

第八轮（2026-08-19，侧边栏对齐 LobeHub 主页排版 + 输入区底部丰富）：

- **侧边栏结构**：按 LobeHub HomeSidebar 排版重排——顶部搜索框 + 功能导航（对话 / Chat Group / 任务 / 文档 / 商场（点击展开 Agent/Skill/MCP 子菜单）/ 记忆 / Channel / 文件）；下方「最近对话」折叠区（最近会话）；再下方「Agents」折叠区（直接展开，数据来自 `getMentionAgentsList` Service，mock 返回 mock 数据）。
- **Agent 直达会话**：点击 Agents 列表项创建并跳转到绑定该 agent/fab 的新会话（路由带 `?agent=&fab=`），与 LobeHub 从侧边栏进入 Agent 一致。
- **输入区底部**：输入框外部底部行左侧显示当前 Agent 名称 + FAB 标签 + 只读数据提示，右侧审批模式 Select（LobeHub ControlBar 位置习惯）。
- **自研折叠区**：framer-motion 未引入，用轻量 SidebarSection（箭头旋转 + hover 操作）替代官方 Accordion，视觉对齐手风琴。
- **NavItem**：新增 `iconNode` 支持，Agents 列表直接渲染头像节点。
- **i18n**：新增 nav.files / nav.agents / nav.emptyAgents，18 语言同步；修复 fr-FR/zh-TW 同值越界。
- **浏览器实测**：侧边栏结构、商场子菜单展开与 Skill 跳转、Agent 点击新建会话（URL 带 agent/fab）、输入区底部元素全部验证通过；24/24 测试通过。

第九轮（2026-08-20，Agent 会话页侧边栏对齐 LobeHub AgentSidebar）：

- **路由分发**：`/chat/:id`（非默认 inbox）展示 Agent 侧边栏，`/chat/session-inbox` 保持主页侧边栏，`/group` 保持群聊侧边栏（LobeHub agent chat 布局）。
- **Header**：当前 Agent 头像 + 名称 + 切换 Agent 下拉（选择后新建该 Agent 会话并跳转，数据来自 `getMentionAgentsList`）。
- **Body 常驻项**：「开启新话题」（同 Agent 新建会话）、搜索框（过滤话题）、「话题」折叠区（该 Agent 的历史会话，来自 IndexedDB sessionHistoryService，兼容现有 AG-UI/A2UI/落库）。
- **自研折叠区**：`SidebarSection` 抽为共享组件（HomeSidebar/AgentSidebar 共用），箭头旋转 + 数量角标 + hover 操作。
- **i18n**：新增 agentSidebar.newTopic/switchAgent/topics，18 语言同步。
- **浏览器实测**：默认 inbox 仍是主页侧边栏；点击 Agent 进入 `/chat/:id?agent=&fab=` 显示 Agent 侧边栏（agent 名/切换按钮/新话题/搜索/话题折叠区）；新话题新建同 Agent 会话；话题列表显示历史会话并支持跳转；24/24 测试通过。
- **补充**：Agent 侧边栏 Header 顶部增加「返回首页」按钮（ChevronLeft，backTo `/chat/session-inbox`），浏览器实测点击后回到主页侧边栏。
- **构建修正**：排查发现 `dist` 曾被 `VITE_SERVICE_MODE=http` 构建污染（默认走 HTTP 导致 Agents 列表 404 为空），重新构建后默认恢复 mock；构建环境未配置该变量时请勿携带 `VITE_SERVICE_MODE=http`。

第十轮（2026-08-20，首页信息架构落地：hub 化 + 列表职责分明）：

- **对话菜单改为首页 hub**：`/chat` 不再指向默认 Agent 会话，改为 hub（welcome + Agent 选择器 + 输入框 + 建议 + 最近会话）；发送时才确定 Agent，新建会话并进入其 Agent 空间；**记住上次使用的 Agent**（localStorage `agentdock-last-agent`），首次使用需显式选择（无静默默认 Agent）；根路由与兜底路由改指 `/chat`。
- **最近对话行补 Agent 身份**：会话行显示 Agent 头像 + Agent 名称 + 相对时间（Intl.RelativeTimeFormat 随 locale 本地化），与 Agents 目录（能力）区分开：最近=续聊、Agents=新聊。
- **Agents 行补描述**：名称 + 版本/FAB + 一句能力描述（hover/直接可见），明确是目录而非会话。
- **返回首页强化**：Agent 空间顶部改为 Home 图标 + 「返回首页」提示，点击回到 `/chat` hub。
- **新建对话入口**：侧边栏 Header「+」改为进入 hub（不再硬编码 FlightAnalysis 建会话）。
- **i18n**：新增 home.welcome/home.selectAgent/agentSidebar.backHome，18 语言同步。
- **浏览器实测**：根路由 → `/chat` hub；选 Agent → 发送 → `/chat/:id?agent=&fab=`（Agent 侧边栏）；返回首页 → `/chat`；最近会话显示「标题 + Agent 名 + 相对时间」，Agents 显示描述；24/24 测试通过。
- **补充（@Agent 快速选择与对话）**：首页 hub 输入框支持 `@` 弹出 Agent 提及菜单（抽为共用 `AgentMentionMenu`，对话输入区同用）；选择即设为目标 Agent 并保留 `@名字` 前缀；发送时若未下拉选择，可从输入文本的 `@名字` 解析目标 Agent（名称/ID 前缀匹配）；无默认系统 Agent，发送前必须确定 Agent（下拉选择或 @ 解析，二者等价）。i18n 新增 home.placeholder。
- **浏览器实测**：hub 输入 `@` → 提及菜单 → 点击 CodeReview_Agent → 输入变为 `@CodeReview_Agent-F15B …` → 发送 → `/chat/:id?agent=code-review&fab=F15B` 全链路通过。
- **补充（输入框改版，按用户反馈）**：移除「记住上次使用的 Agent」（localStorage 读写全部删除，每次打开需选择或 @）；移除输入框顶部大 Select（太丑）；候选问题改为悬浮在输入框外部左上角（无输入时展示）；Agent 选择/附件/语音移入输入框内左下角工具栏（紧凑 Select + 禁用按钮），对话页输入框同样在左下角增加「切换 Agent」选择（新建该 Agent 会话并跳转）；`home.placeholder` 文案更新（18 语言）。
- **提交纪律**：工作区出现用户/其他会话的未提交 WIP（runReducer/sessionHistoryService/useAgentDockConversation/市场排序相关），本轮起只暂存本任务文件，不再 `git add -A`。

第十一轮（2026-08-20，R4 其余页面全量迁移，不留占位符）：

- **Tasks**：LobeHub `AgentTasksPage` 全量搬移（列表/看板/分组/排序/创建/隐藏完成项/详情抽屉），hooks 改为本地 `scheduledTaskService`（Task 全字段模型：status/priority/visibility/automation/subtasks/assignee）。
- **Memory**：`/memory` 布局 + home/contexts/experiences/preferences/identities/activities 六页；网格/时间线 + 右栏 + 编辑/新建；`memoryService` 扩展 persona/roleTags/analysis/CRUD。
- **Documents**：搜索/筛选/置顶/详情 Markdown 阅读/新建/删除；`documentService` 扩展内容与分类字段。
- **Channel**：平台渠道网格 + 状态/连接/断开/凭证配置；`channelService` 扩展平台定义与连接语义。
- **Artifact / Page**：产物分组列表 + 预览下载；页面列表 + 轻量编辑器/发布；新增 `pageService`。
- **Settings**：LobeHub 分栏布局（通用/外观/记忆/关于），既有功能全部保留接线。
- **全局修复**：`MotionProvider(motion)` 挂载（@lobehub/ui Accordion 需要），新增 `motion` 依赖（离线链接）；Memory 子页按 `location.pathname` 识别 tab。
- **i18n**：新增约 110 个 key（tasks/memory/documents/channel/artifact/page/settings/nav.page/common.retry|refresh），18 种语言全部翻译并过 `dictionaries.test.ts`。
- **验证**：`pnpm run build` 通过；Chrome headless + CDP 冒烟 13 条路由全部 PASS、无 JS 异常；交互（显示隐藏完成项、设置分栏、Memory 数据分流）验证通过；26/26 测试通过（注：工作区存在其他会话未提交 WIP，见下）。
- **并行会话说明**：工作区同时存在用户其他会话的提交与未提交 WIP（runReducer/sessionHistoryService/useAgentDockConversation/chat 相关），本轮仅提交本任务文件（`providers.tsx`/`MemoryListPage.tsx`/`package.json`/`pnpm-lock.yaml`），未触碰其他会话 WIP；若其 WIP 使 `pnpm run test` 变红，属该会话进行中状态。

第十二轮（2026-08-20，R4 Code Review：嵌套子组件补齐 + 架构/数据集成）：

- **Review 结论**：八类页面主体迁移完整；对照 LobeHub 逐层检查后补齐嵌套子组件，并修正架构/数据集成问题（详见 `design/13` §9）。
- **Tasks 补齐**：内联创建行 `CreateTaskInlineEntry`（列表视图「+」展开）；看板列设置 `HiddenColumnsPanel`（5 列复选隐藏）；任务卡执行 Agent 切换 `AssigneeAgentSelector`；创建弹窗/内联/卡片三处执行 Agent 候选统一走 `getMentionAgentsList`（模块级缓存 + 失败回退），不再硬编码 3 个 Agent。
- **Memory 补齐**：分类筛选 `FilterBar`（分类选项从数据派生，去掉硬编码中文表）；时间线 `TimelineGroups` 按 今天/本周/本月/更早 分组（周一起点）；编辑弹窗分类下拉数据驱动。
- **可访问性**：`@lobehub/ui` ActionIcon 的 `title` 不生成 `aria-label`，全部补齐 aria-label（Tasks/Memory/Documents/Channel）。
- **i18n**：新增 `tasks.columnSettings`、`memory.filterAll`、`memory.period.*` 共 6 个 key，18 语言翻译并过测试。
- **验证**：build 通过；28/28 测试通过；Chrome headless + CDP 交互验证（内联创建展开、列设置隐藏「待办」列、执行 Agent 切换下拉、FilterBar chips、时间线分组）+ 9 条路由渲染全部通过。
- **提交纪律**：并行会话 WIP（fabRoutingAgent/MessageBlocks/useAgentDockConversation）未触碰，仅提交本任务文件。
- **补充（输入框全站统一）**：首页 hub 输入框改为直接复用 `ChatInput`（唯一输入框组件，彻底统一样式：圆角 16、左下角工具栏 Agent 选择/附件/语音/@/斜杠、底部 Agent 信息行）；`ChatInput` 新增 `sendDisabled`（未选 Agent 且无 @ 前缀时禁用发送）与 `placeholder` 透传；群聊页传 `hideMentionButton`——不强制 @/选 Agent（成员已组队），发送始终可用，也不显示「切换 Agent」选择。
- **浏览器实测**：hub 输入框与对话页同款（左下角 Agent 选择 + 附件/语音，未选 Agent 时发送禁用）；群聊页无 @ 按钮、无切换 Agent、发送不禁用；25/25 测试通过。

待联调项：HITL wire 冻结、A2UI fixture、`AGENT_ORCHESTRATION_BASE_URLS_JSON` 路由验证；前端保留项：构建体积优化。

### LobeHub Chat 全量复刻（分步，见 `docs/agentdock/design/12-lobehub-chat-full-copy-plan.md`）

- **Step 1 ✅（2026-08-23）思考/过程折叠系统**：
  - ReasoningBlock 升级为 LobeHub Thinking 视觉：思考中旋转 Loader + “思考中…”，完成自动收起并显示耗时；内容走 Markdown。
  - 新增 `ProcessFold`：一轮 run 的思考+工具+步骤完成后折叠为一行“已处理 N 步 · Xs”，运行中展开；一级=过程汇总、二级=单个块展开；HITL 属于过程（暂停时可见，完成后随过程收起）。
  - 修复块归属：`storedMessages` 改为按 runId 分组（等价 LobeHub messageId 归属），paused 中间落库不再把前段块排到助手文本之前（刷新丢失/挂错消息）。
  - 修复折叠内容空：flush 把 nodes 副本传给 ProcessFold（原按引用 + length=0 原地清空导致有标题无内容）。
  - 浏览器实测：单一折叠“已处理 2 步 · 0.3s”，展开可见 plan 步骤 + 工具卡；30/30 测试通过。
- **Step 2 ✅ 输入区顶部运行/中断状态提示**：运行中 Alert（转圈）“正在运行…”，完成自动消失；中断显示“已中断”。
- **Step 3 ✅ 消息操作栏扩展**：更多菜单（回填输入框/删除并重新生成/朗读/翻译/分享）。
- **Step 4 ✅ 表单式用户反馈**：点踩弹表单（原因多选 + 补充说明）→ messageFeedbackService。
- **Step 5 ✅ HITL 全模式**：HitlBlock 支持 editArguments/textInput/singleSelect/multiSelect/form，批准回传对应 payload。
- **Step 6 ✅ Tool Inspector 升级**：参数 JSON 缩进、结果独立折叠、耗时/状态。
- **Step 7 ✅ 委派树/技能卡**：agentDelegation 渲染 Supervisor→成员树 + 技能标签 + 查看技能页面/调用信息。
- **Step 8 ✅ Artifact 侧边栏自动打开**：agentDock.artifact 活动触发右侧面板，html 用 sandbox iframe 渲染。
- **Step 9 ✅ Markdown @Agent 提及**：@AgentName 转为站内链接（SPA 导航）。
- 所有步骤均浏览器实测（单 Agent + 群聊）+ 30/30 测试通过；分支 `codex/lobehub-chat-full-copy` 统一提交，最后一起 push。
- **Step 10 ✅（2026-08-23）真实后端端到端补测 + antd6 下拉紧凑修复**：
  - 前后端联调（3000 Node Runtime ↔ 8123 demo 后端 ↔ DeepSeek v4 flash）：运行中状态提示、停止按钮、A2UI Surface（Metric 指标卡）、过程折叠“已处理 9 步 · 10.1s”及展开、答案渲染全部通过；
  - 浏览器逐功能复验：首页侧边栏（搜索/chat/Chat Group/任务/文档/记忆/Channel/文件/商场/最近对话/Agents）、Agent 空间（返回首页/切换 Agent/新话题/搜索/话题折叠）、@ 提及菜单、消息操作栏（复制/重新生成/删除/更多/点赞/点踩→反馈表单）、双击用户消息进入编辑态、审批模式手动/自动；
  - 修复：antd v6 Select DOM 为 `.ant-select-content`，`compactSelect` 原只写 `.ant-select-selector` 未生效，切换 Agent/审批下拉高 36px；显式锁高 22px 并补 `.ant-select-content`/`.ant-select-input` 规则，两类下拉均恢复 22px 紧凑样式；
  - 验证：`pnpm run build` 通过，Chrome 实测下拉 22px、其余全量 PASS。

第十二轮（2026-08-20，前后端联合端到端测试 + 消息组件渲染修复）：

- **联调拓扑打通**：AgentDock（http://127.0.0.1:3000）→ Copilot Runtime `/api/copilotkit`（single-route）→ FabRoutingAgent（`AGENT_ORCHESTRATION_BASE_URLS_JSON={"F15B":"http://127.0.0.1:8123"}`）→ demo 后端 `/ag-ui`（ag-ui-langgraph 0.0.40 + copilotkit 0.1.94 + DeepAgents 0.7.5）→ DeepSeek v4 flash（Responses API）。
- **Runtime A2UI 注入**：`server/index.ts` 显式 `a2ui: { injectA2UITool: true }`；后端不静态注入 `generate_a2ui`，由 CopilotKitMiddleware 依据 `inject_a2ui_tool` 动态构造（文档 golden path：`inject_a2ui_tool=true → generate_a2ui → secondary render_a2ui → a2ui-surface ACTIVITY_SNAPSHOT`）。
- **前端渲染修复**：① `MESSAGES_SNAPSHOT` 过滤 system/developer 上下文（App Context 不再当消息渲染）；② 流式 `lc_run--` 占位消息用快照规范 UUID 替换，历史去重；③ 终态落库后广播 `agentdock:run-persisted` 驱动历史刷新（修复完成态助手回复消失/竞态）；④ `runAgent` 失败兜底 `RUN_ERROR`（不卡 running）；⑤ ReasoningBlock 流式结束自动折叠；⑥ 官方路径发送后立即投影用户消息（事件到达前可见）。
- **模型兼容**：DeepSeek thinking 模式不接受 forced `tool_choice`，`OPENAI_REASONING_EFFORT=none` 换取 A2UI 可用；`use_responses_api=true` 对接 DeepSeek Responses API。
- **构建修复**：SettingsPage `Switch` 改 `@lobehub/ui/base-ui`；TaskItem `ContextMenu` 改 antd Dropdown；WorkspacePage 使用真实字段（assigneeAgentName/schedulePattern/name/identifier）；de/fr/nl 补译至 i18n 阈值下。
- **环境锁定**：`agent-dock/.env` 固化 `VITE_CHAT_MODE=http` + `VITE_SERVICE_MODE=mock`（防止任何一次 `pnpm build` 把对话静默切回 mock）。
- **浏览器测试矩阵（无头 Chrome 实测）**：文本消息 ✅、两轮历史顺序/去重 ✅、工具调用块 ✅、A2UI 指标卡片渲染 ✅（CPU/内存/磁盘 + render_a2ui 8s 已调用 + success）、停止生成 cancelled ✅、mock reasoning 自动折叠 ✅、mock HITL 批准续跑 ✅、mock 工具/文本/surface 全链路 ✅；`pnpm run test` 28/28、`pnpm run build` 通过。
- **已知限制**：真实 DeepSeek reasoning 为加密内容，ag_ui-langgraph 0.0.40 不产生 REASONING 协议事件（Thinking 仅 mock 可验）；A2UI 多轮上下文 secondary 可能偏离 forced render_a2ui（新会话单轮稳定）；刷新后 A2UI surface 不持久化；HITL 真实 wire 待冻结。
- 详见 `docs/agentdock/design/11-e2e-joint-test-report.md`。

第十三轮（2026-08-20，逐项修复并提交：并发 run 防护 / A2UI surface 持久化）：

- **并发 run 防护**（`useAgentDockConversation.ts` + `server/copilot-runtime/fabRoutingAgent.ts`）：
  - hook 层防重入：官方/mock send 在 running/paused 时忽略新发送；
  - runtime 幂等守卫：同一 `threadId:runId` 的 action=run 在途时拒绝（FAB_DUPLICATE_RUN），杜绝重复上游执行；
  - restore 不再自动 resume：陈旧 running checkpoint 本地转 cancelled 落库（后端无 streamId 游标，resume 会重放造成并发 run）；
  - `runAgent` 异常写 RUN_ERROR 兜底，不卡 running。
- **A2UI surface 持久化 + 组件名对齐**（`MessageBlocks.tsx` + `ChatPage.tsx` + `a2ui/catalog.tsx`）：
  - 根因：后端按 a2ui.org v0.9 生成 `Metric/Title/Card/Column/Row`，前端 web_core basic catalog 无 Metric/Title → 页面实际一直渲染 “Unknown component”；
  - 前端 catalog 补齐 5 个组件定义与 renderer，实时与历史 surface 均正常渲染；
  - 历史 surface 快照（`a2ui_operations`）经 `StoredA2uiSurface` + `useRenderActivityMessage` 还原，刷新后仍可见；
  - 坑：renderActivityMessage 的 content 只能含 `a2ui_operations`（额外字段致 schema 校验失败）；不要自包 A2UIProvider（react-core 自带同包 context）。
- **验证**：快速连发只发 1 个 run；刷新后 surface 仍渲染（CPU/45%/内存/62%/磁盘/78%）；真实 A2UI 运行渲染真实 Metric 组件、无 Unknown、无控制台错误；`pnpm run test` 28/28、`pnpm run build` 通过。
- 设计文档：`docs/agentdock/design/13-concurrent-run-guard.md`、`14-a2ui-surface-persistence.md`。

第十四轮（2026-08-20，最终代码评审 + 全面二次批量验证 + 接入指南）：

- **代码评审修复**：
  - `StoredA2uiSurface` 增加 http 模式门控并拆分 `HttpStoredA2uiSurface`（mock 模式无 CopilotKit Provider，遇 ops 快照回退 raw JSON，避免 hook 崩溃）；消息对象 useMemo 稳定，避免每帧重建触发 renderer 重复处理。
  - `runAgent` 失败兜底增加终态保护：事件流已给 success/error/cancelled 时不覆盖为网络错误。
  - `FabRoutingAgent` 幂等拒绝改为返回结构化 `RUN_ERROR(FAB_DUPLICATE_RUN)` 事件（而非抛异常断连）。
- **全面二次批量验证（无头 Chrome，10+ 场景）**：文本完成态（含 settle 等待）、两轮历史顺序/去重、工具调用、A2UI 实时渲染（模型生成时 Metric 组件叶子节点，无 Unknown）、停止生成、快速连发只发 1 run、陈旧 checkpoint 刷新不卡死、mock thinking 自动折叠、mock HITL 批准续跑、全链路工具/文本/surface；`pnpm run test` 30/30、`pnpm run build` 通过。
- **运行时间发现**：CopilotKit Runtime 自带 `InMemoryAgentRunner` 的 Thread already running 防护（并发同线程 run 在 Runtime 层即被拒）；FabRoutingAgent 幂等守卫为第二层，前端 send 防重入为第一层。
- **已知残余**：客户端 SSE 偶发 network error（后端已完成但浏览器流被中断，工具类 run 偶发）——已兜底不卡 UI、内容保留，接入真实 Orchestration 后按其 streamId 重连协议观察。
- **接入指南**：`docs/agentdock/design/15-orchestration-integration-guide.md`（核心链路 mermaid、关键代码、payload/response 约定、14 条坑清单）。

第十五轮（2026-08-20，断线重连 streamId 与真实 HITL 场景补测）：

- **后端升级（demo，非 git 仓库）**：新增 `backend/streaming.py` 自定义 AG-UI 端点——逐事件注入 `rawEvent.streamId`、按 runId 内存缓冲、`action=resume + lastStreamId` 精确回放游标后事件（不重新执行 Core）、未知 run 返回 `RUN_ERROR(STREAM_EXPIRED)`；`agent.py` 启用 `interrupt_on={"write_file": True}` 真实 HITL。
- **断线重连实测**：直连后端首轮 69 事件全部带 streamId；resume 第 40 条游标精确回放 29 条、无模型调用；未知 runId 返回 STREAM_EXPIRED。⚠️ 经 CopilotKit single-route envelope 走纯尾回放会被其 SSE 校验判 INCOMPLETE_STREAM（首事件必须 RUN_STARTED），真实接入用 `agent/connect` 或全量回放 + streamId 去重（前端 reducer 已支持去重）。
- **真实 HITL 实测**：write_file 触发真实 langgraph interrupt → 页面渲染 HitlBlock → 批准请求携带真实 interruptId + decisions payload 到达后端；纯 deepagents 层 resume 后工具执行成功（ToolMessage: Updated file）。残余：ag_ui-langgraph 0.0.40 的 HTTP resume 映射与 langchain HITL interrupt 返回值约定不兼容（ResumeEntry 列表 vs decisions 字典；demo 已做 id 注入与解包适配，续跑执行仍需公司服务层实现或升级适配器）——即契约 §8.2/§14“真实 HITL fixture 待冻结”项。
- **前端 HITL 增强**：legacy `CUSTOM on_interrupt` 记录真实 interruptId；`respondToHitl` 无 pendingInterrupts 时走 `runAgent({ resume: [{interruptId, status, payload:{decisions:[{type:approve|reject}]}}] })` 并携带原 forwardedProps（修复 FAB_ENDPOINT_NOT_CONFIGURED）。
- 文档更新：`docs/agentdock/design/15-orchestration-integration-guide.md` 新增 §6.1 断线重连、§6.2 真实 HITL 实测与坑 15/16。

第十五轮补充（2026-08-20，权威文档同步两块实测结论）：

- `02-agui-a2ui-runtime-contract.md`：§8.2 写入真实 HITL 事件样本（CUSTOM on_interrupt 结构、resume[] 约定、前端行为、ag_ui-langgraph resume 映射限制）；§10 新增 10.5 断线重连实测（streamId 注入/游标回放/STREAM_EXPIRED/runtime SSE 校验限制/前端不自动 resume 策略）；§14 待冻结项勾选更新。
- `03-integration-and-acceptance.md`：Case 8（断线恢复）与 Case 9（真实 HITL）验收状态与遗留项更新。
- `11-e2e-joint-test-report.md`：测试矩阵补 11（断线重连 streamId）与 12（真实 HITL）两行。
