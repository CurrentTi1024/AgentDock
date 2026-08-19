# R4 其余页面全量迁移设计（Tasks / Memory / Documents / Channel / Artifact / Page / Settings）

> 状态：已合入并验证（`pnpm run build` / 28 项测试 / Chrome headless + CDP 冒烟）
> 日期：2026-08-20
> 基线：LobeHub company src（`/private/tmp/lobehub-company-src`）
> 关联：`src/features/{tasks,memory,documents,channel,artifact,page,settings}`、`src/api/{task,document,memory,channel,artifact,page}`、`src/mock-data/*`、`src/i18n/*`、`src/app/router.tsx`、`src/app/providers.tsx`、`src/components/shell/HomeSidebar/Body.tsx`

## 1. 范围与原则

R4 要求八类页面（Group 已有实现，本轮补其余七类）**不留占位符**：把 LobeHub 对应页面的功能与嵌套 UI/UX 完整搬移，改写 hooks 逻辑融合本项目（Service / i18n / router）。

迁移原则（沿用 `docs/agentdock/05`）：

- UI 层直接迁移 LobeHub 源码结构与样式原语（`@lobehub/ui` + `antd-style` + `cssVar`），不重新设计；
- 页面只依赖 Service interface；Mock Service 与 HTTP Service 返回同一数据类型（`selectService` 切换）；
- 页面不得直接 `fetch`、不得直接 `import mock-data`；
- 全部静态文案走 `useI18n().t(key)`，新增 key 补齐 18 种语言；
- 每个迁移文件在文件头标注 LobeHub 上游路径。

## 2. 数据层设计（Service 契约扩展）

所有领域类型从“占位表”扩展为对齐 LobeHub 业务模型的完整类型，Mock 用 `structuredClone` 返回，避免页面意外修改共享数据。

### 2.1 `scheduledTaskService`（Task）

```ts
type TaskStatus = 'backlog' | 'running' | 'scheduled' | 'paused' | 'completed' | 'failed' | 'canceled';
type TaskVisibility = 'private' | 'public';
type TaskAutomationMode = 'manual' | 'scheduled' | 'heartbeat';

interface ScheduledTask {
  identifier: string;            // TASK-1024
  name?: string;
  instruction: string;
  status: TaskStatus;
  priority: number;              // 0 无 / 1 紧急 / 2 高 / 3 普通 / 4 低
  visibility: TaskVisibility;
  assigneeAgentId?: string;
  assigneeAgentName?: string;
  automationMode?: TaskAutomationMode | null;
  schedulePattern?: string | null;   // cron
  scheduleTimezone?: string | null;
  totalSubtasks?: number;
  completedSubtaskCount?: number;
  subtasks?: ScheduledTask[];
}
```

接口：`list(params)`、`groupList(params)`、`getTaskDetailById`、`createTask`、`updateTask`、`updateTaskStatus`、`deleteTask`，并保留 `getScheduledTasks` 兼容。Mock 的 `createTask` 自动推导 `status`（有 `schedulePattern` 即 `scheduled`，否则 `backlog`），`updateTaskStatus` 在置为 `completed` 时写入 `completedAt`。

### 2.2 `documentService`（Documents）

`DocumentItem` 扩展 `category`（report/spec/notes/data/minutes）、`pinned/shared/starred`、`pages`、`content`（Markdown/CSV 原文）、`ownerId`。`getDocumentsListByKW({ keyword, filter })` 支持 `recent | mine | shared` 三种语义；新增 `createDocument/updateDocument/deleteDocument`。

### 2.3 `memoryService`（Memory）

```ts
type MemoryKind = 'context' | 'experience' | 'preference' | 'identity' | 'activity';

interface MemoryItem { kind: MemoryKind; title; category; content; summary?; source?; tags: string[]; pinned?; ... }
interface MemoryPersona { name; role; summary; traits: string[]; updatedAt; }
interface MemoryAnalysisResult { summary; tags; suggestions; range?; }
```

接口：`getMemoryItems({ kind, keyword })`、`getMemoryDetailById`、`createMemoryItem/updateMemoryItem/deleteMemoryItem`、`getMemorySettings/updateMemorySettings`、`getPersona`、`getRoleTags`、`getMemoryAnalysis`。

### 2.4 `channelService`（Channel）

`ChannelPlatform`：`id/name/icon/description/status/enabled/comingSoon/connectedAt/configFields/config/runtimeStatus`；`configFields` 描述凭证表单（`text/password/textarea/number` + required）。接口：`getChannelsList`、`getChannelDetailById`、`connectChannel(id, config)`（写回 config + enabled + status + connectedAt）、`disconnectChannel`、`updateChannel`。

### 2.5 `artifactService`（Artifact）

`ArtifactItem`：`type`（report/document/code/data/diagram/image）、`content`、`language`、`sessionId/sessionTitle`、`sourceMessageId`。接口：`getArtifactsListBySessionId({ sessionId, keyword })`、`getArtifactDetailById`、`createArtifact`、`deleteArtifact`。

### 2.6 `pageService`（Page，新增）

`PageItem`：`title/content/status(draft|published)/agentName/createdAt/updatedAt`。接口：`getPagesList({ keyword, status })`、`getPageDetailById`、`createPage`、`updatePage`、`deletePage`。

## 3. 各页面设计与实现细节

### 3.1 Tasks（`/tasks`）

上游：`AgentTasksPage` / `TaskList` / `KanbanBoard` / `CreateTaskModal` / `AgentTaskItem` / `listViewOptions`。

页面结构（`TasksPage.tsx`）：

- **NavHeader**：左侧标题；右侧依次为可见性筛选（private/workspace/all 三态 Dropdown）、新建（+）、列表⇄看板切换、显示设置 Popover（分组/次级分组/排序字段/升降序/隐藏完成项）。
- **列表视图**：移植 `listViewOptions.ts`（`groupBy: none|status|assignee|priority`、`subGroupBy`、`orderBy: status|priority|updatedAt|createdAt|assignee|title`、`orderDirection`、`hideCompleted`、`orderCompletedByRecency`）；`Accordion` 分组 + 次级分组，组标题含分组前缀图标（状态/执行 Agent 头像/优先级）与计数；`Divider dashed` 分隔行；组内任务行渲染 `TaskItem`。
- **看板**：五列 `backlog / running / needsInput / done / canceled`，列头 = 状态图标 + 列名 + 数量；拖拽用 **HTML5 DnD**（`draggable` + `onDragStart/onDragOver/onDrop`），`droppable` 列映射目标状态（`needsInput→paused`、`done→completed`），乐观更新 + 失败回滚 `refresh()`；不引入 `@dnd-kit` 依赖。
- **任务卡片（`TaskItem.tsx`）**：优先级图标（5 个自绘 SVG `priorityIcons.tsx`）、状态图标（`taskVisuals.ts`，移植 `ExecutionStatus` 的图标/颜色语义）、私密锁、编号、名称、scheduled 徽标（cron 文案）、子任务进度 `完成/总数`、执行 Agent 头像、相对时间、右键菜单（打开 / 复制 ID / 改状态 4 项 / 删除）。右键菜单用 antd `Dropdown trigger={['contextMenu']}`。
- **创建弹窗（`CreateTaskModal.tsx`）**：名称、指令（必填校验）、执行 Agent（下拉）、优先级（0-4）、可见性、自动化（manual/scheduled/heartbeat；scheduled 时显示 cron 输入）、提交后乐观插入列表顶部。
- **详情抽屉**：指令、描述、执行 Agent、优先级、自动化、调度（cron + 时区）、子任务进度；右上角关闭。

hooks 改写：原 `useTaskStore` / SWR / `useGlobalStore`（systemStatus）全部替换为 `TasksPage` 内本地状态 + `scheduledTaskService`；视图偏好持久化到 localStorage（`agentdock-tasks-view`、`agentdock-tasks-options`），刷新不丢。

### 3.2 Memory（`/memory` + 五个子页）

上游：`memory/_layout` + `Sidebar/Nav`、`(home)`、`contexts/experiences/preferences/identities/activities`、`features/{GridView,TimelineView,DetailPanel,EditableModal}`。

- **布局（`MemoryLayout.tsx`）**：左侧 224px NavItem 侧栏（首页 / 身份 / 上下文 / 偏好 / 经验 / 活动）+ `Outlet` 内容区。
- **首页（`MemoryHomePage.tsx`）**：NavHeader 操作（分析按钮、清空）；`Persona` 卡（头像、名称、角色、摘要、特质 Tag）；`RoleTagCloud`（#tag）；`MemoryAnalysis` 结果卡（summary / tags / suggestions）；空态引导“分析”按钮。
- **子页（`MemoryListPage.tsx`）**：`kind` 由路径解析；搜索、新建、网格⇄时间线切换；网格卡（图标、标题、分类/标签、三行摘要、置顶标记、下拉操作）；时间线行（左图标、标题、分类/标签、相对时间）；右侧详情面板（320px，编辑/置顶/删除/来源/更新时间）；编辑/新建 Modal（标题、内容、分类 Select、标签逗号分隔）。
- **数据流**：`kind` 变化触发 `load(signal)`，AbortController 取消旧请求；删除/置顶乐观更新 + 失败回滚。

### 3.3 Documents（`/documents`、`/documents/:id`）

上游：`AgentDocumentPage` / `agent/docs`。

- **列表（`DocumentsPage.tsx`）**：NavHeader 搜索 + 筛选 Segmented（最近/我的/共享）+ 新建；置顶区 + 常规区双网格；卡片含类型图标、标题、mediaType/大小、分类 Tag、共享/星标、owner、更新日期；新建 Modal（标题 + 内容）创建后跳详情。
- **详情（`DocumentDetailPage`）**：标题 + 元信息（类型/大小/owner/时间）+ `Markdown` 渲染；`text/csv` 走等宽原文；删除后返回列表。

### 3.4 Channel（`/channel`）

上游：`agent/channel`（`PlatformGrid` / `PlatformDetail` / 连接凭证）。

- **网格**：平台卡（emoji 图标、名称、描述、状态色点 + Tag、coming soon 徽标、runtimeStatus），点击打开右侧详情面板。
- **详情面板（420px）**：状态、连接时间、配置字段值掩码展示（`••••`）、连接/断开按钮（断开需确认）。
- **连接 Modal**：按 `configFields` 动态渲染凭证表单（text/password/textarea/number + required），`connectChannel(id, values)` 成功后乐观更新列表与面板。

状态语义：`connected / connecting / disconnected / error / pending` → 色点（成功/警告/灰/错误/信息）+ 对应 Tag 文案。

### 3.5 Artifact（`/artifact`）

上游：`Portal/Artifacts`。

- **列表**：按 `sessionTitle` 分组；卡片（类型图标 + 颜色、标题、语言或类型、更新时间、内容摘要）；搜索过滤。
- **预览 Modal**：`Markdown` 渲染（非 code）或 `Highlighter`（code）；下载（Blob + 临时 URL）、删除。

### 3.6 Page（`/page`）

上游：LobeHub `Pages/PageExplorer` 本身为占位组件，本项目落地为可用页面：

- **列表**：搜索 + 状态筛选（全部/草稿/已发布）+ 新建；行 = 图标 + 标题 + 状态 Tag + agent/更新时间 + 删除。
- **编辑器**：全屏覆盖层，NavHeader（返回 / 状态 Select / 保存）；标题 Input（大字号）、正文 TextArea（等宽字体）；保存走 `createPage/updatePage`，按 id 存在性合并本地列表。

### 3.7 Settings（`/settings`）

上游：`Settings/Layout`（SideBar + Body）。

侧栏分栏 + 内容区（原 WorkspacePage 单页分发删除）：

| 分栏 | 内容 |
| --- | --- |
| 通用 | 语言（18 种）、业务 API Mock/HTTP 开关、Chat runtime Mock/HTTP 开关 |
| 外观 | 主题模式（跟随系统/浅色/深色）、推理摘要开关 |
| 记忆 | autoInject 开关（读 `getMemorySettings`、写 `updateMemorySettings`） |
| 关于 | 版本、会话历史（IndexedDB 本地存储）说明 |

## 4. 运行时修复（迁移过程中发现并修复）

### 4.1 `/tasks` 白屏：Accordion 需要 `MotionProvider`

- 现象：列表分组 `Accordion` 渲染即抛 `Please wrap your app with <ConfigProvider> (or <MotionProvider>) and pass the motion component`，页面白屏。
- 根因：`@lobehub/ui` 5.31.1 的 `AccordionMotionContent` 通过 `useMotionComponent()` 读 context，本项目未挂载 MotionProvider。
- 修复：`providers.tsx` 在 `ThemeProvider` 内挂 `<MotionProvider motion={motion}>`；`package.json` 新增 `motion ^12`（与 `@lobehub/ui` 的 peer 一致），离线从 pnpm store 链接。
- 坑：`MotionProvider` 必须显式传 `motion`，否则 context 值为 `undefined` 仍抛错；pnpm 严格 node_modules 下 `src` 直接 `import 'motion/react'` 前必须先声明依赖。

### 4.2 Memory 五个子页错显 contexts 数据

- 现象：`/memory/preferences`、`/memory/experiences` 等内容与 `/memory/contexts` 相同。
- 根因：router 使用显式子路由（`<Route path="contexts">`），`useParams()['*']` 拿不到子路径，全部回退到默认 `contexts`。
- 修复：`MemoryListPage` 从 `location.pathname.split('/memory/')[1]` 解析 tab。
- 坑：react-router 只有 `path="*"` 兜底路由才注入 splat 参数。

### 4.3 `VITE_CHAT_MODE` 与 CopilotKit 挂载

`providers.tsx` 只在 `getChatServiceMode() === 'http'` 时挂 CopilotKit。若 shell 导出了 `VITE_CHAT_MODE=http` 而未起 node server，页面会出现 `/api/copilotkit/info` 404 横幅——这是环境配置，非代码缺陷；本地 mock 冒烟需显式 `VITE_CHAT_MODE=mock VITE_SERVICE_MODE=mock`。

## 5. 路由与导航

- `src/app/router.tsx`：新增 `/tasks`、`/documents`、`/documents/:id`、`/memory`（`MemoryLayout` + 六子路由）、`/channel`、`/artifact`、`/page`、`/settings`；删除 `WorkspacePage` type 分发。
- `src/components/shell/HomeSidebar/Body.tsx`：新增「页面」入口（`nav.page`）；channel / files 分别指向 `/channel`、`/artifact`；本月模式过滤逻辑不变。
- 原 `src/features/workspace/WorkspacePage.tsx` 整体移除（占位实现不再引用）。

## 6. i18n 扩展

- 新增约 110 个 key：`tasks.*`（分组/排序/状态/优先级/列/创建表单/隐藏完成项等）、`memory.*`（tab/分类/操作/分析/编辑表单）、`documents.*`、`channel.*`（状态/连接/配置）、`artifact.*`（类型/预览/下载）、`page.*`（状态/编辑器）、`settings.*`（分栏/关于）、`nav.page`、`common.retry|refresh`。
- 18 种语言全部人工翻译；`dictionaries.test.ts` 守护 key 集合、占位符一致性，并断言非英文词典真实翻译（与 en-US 相同 key < 30）。
- 坑：部分语言的“专有名词”天然与英文相同（Kanban / Backlog / Heartbeat / Status / Normal / Home / Code 等）会触发“未翻译”断言，必须换用本地词（如 de-DE `Kanban→Tafel`、fr-FR `Backlog→En attente`、it-IT `Home→Pagina iniziale`），本轮已逐一修正。

## 7. 验证

- `pnpm run build`：通过（大 chunk 为既有 shiki/katex 体积问题，见 P1 构建体积拆包）。
- `pnpm run test`：28/28 通过（runReducer / session / i18n / chat）。
- Chrome headless + CDP 冒烟：13 条 R4 路由全部渲染、无 JS 异常；按页面核对真实数据（任务行/记忆卡/渠道卡/文档正文/产物/页面/设置分栏）；交互验证通过（任务页“显示”隐藏完成项、设置页切换分栏、Memory 子页数据分流）。
- 提交纪律：工作区存在并行会话 WIP（runReducer/sessionHistoryService/chat 相关），仅提交本任务文件。

## 8. 已知限制与后续

- 看板拖拽为 HTML5 DnD 实现（未引入 `@dnd-kit`），交互等价但动画/可访问性略简。
- 任务详情为右侧抽屉，未实现 LobeHub 完整 `/task/:taskId` 页（评论、依赖、检查点、Review 等后端能力）。
- Page 编辑器为轻量 Markdown 编辑（无协办/权限/版本历史）。
- Channel 凭证为前端表单，真实平台接入与网关状态刷新待后端。
- 全局待办不变：HITL wire 冻结、A2UI fixture、编排路由联调验证、构建体积拆包。

## 9. 嵌套子组件补齐（Code Review 轮，2026-08-20）

对照 LobeHub 源码逐层 review 后补迁的嵌套子组件与架构集成修正：

### 9.1 Tasks

- **`CreateTaskInlineEntry`**（新增文件）：列表视图点「+」展开内联创建行（名称 + 执行 Agent + 优先级 + 指令 + 提交/取消），与 LobeHub `getTaskCreateActionBehavior` 一致——列表视图走内联、看板视图走弹窗。
- **`HiddenColumnsPanel`**：看板顶部「列设置」按钮（`SlidersHorizontal` + Popover），5 个列（backlog/running/needsInput/done/canceled）复选开关，`hiddenColumns` 状态驱动列过滤。
- **`AssigneeAgentSelector`**：任务卡点击执行 Agent 头像弹出候选下拉（图标 + `agentFullName · fab`），选择后 `updateTask({ assigneeAgentId, assigneeAgentName })` 乐观更新；候选数据走 `agentMarketService.getMentionAgentsList`（模块级缓存一次）。
- **数据源集成**：`CreateTaskModal` 与内联创建的执行 Agent 下拉不再硬编码 3 个 Agent，统一从 `getMentionAgentsList` 拉取（失败回退静态表），默认执行 Agent 取数据源第一条。

### 9.2 Memory

- **`FilterBar`**：分类筛选 chips（全部 + 各分类），分类选项**从已加载数据派生**（`[...new Set(items.map(i => i.category))]`），不再硬编码中文分类表；单一分类时不显示筛选条。
- **`TimelineGroups`（PeriodGroup 移植）**：时间线视图按「今天 / 本周 / 本月 / 更早」分组（周一起点），组标题用 `memory.period.*` 文案。
- 编辑弹窗分类下拉同步改为数据驱动（数据为空时回退 kind 默认分类）。

### 9.3 可访问性与通用修复

- `@lobehub/ui` 的 `ActionIcon` 用 `title` 不会生成 `aria-label`（无障碍缺口）：Tasks/Memory/Documents/Channel 全部带 `title` 的 ActionIcon 补 `aria-label`。

### 9.4 i18n 增量

新增 6 个 key（`tasks.columnSettings`、`memory.filterAll`、`memory.period.today|week|month|earlier`），18 种语言全部翻译并过 `dictionaries.test.ts`。

### 9.5 验证（本轮）

- `pnpm run build` 通过；`pnpm run test` 28/28。
- Chrome headless + CDP：内联创建展开（textarea + 提交按钮）、看板列设置（5 列复选、隐藏「待办」列后列头消失）、执行 Agent 切换下拉、Memory FilterBar 分类 chips、时间线「本周」分组、9 条路由渲染全部通过。
