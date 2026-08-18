# AgentDock 前端迁移 TODOLIST

> 状态：执行中  
> 日期：2026-08-18  
> 基线：`/private/tmp/lobehub-canary`  
> 原则：只迁移前端 UI/UX；不引入 LobeHub 后端、TRPC、数据库、Cloud 能力；数据一律通过 AgentDock Service（当前返回 Mock Data）提供；API 契约以 `04-frontend-backend-api.md` 为唯一权威。

## 迁移原则

- UI 层优先直接迁移 canary 源码（组件、样式、交互），只替换数据源与超出 AgentDock 范围的能力。
- 每个迁移文件在文件头标注 LobeHub 上游路径，便于对照升级。
- 页面只能依赖 Service interface；Mock Service 与 HTTP Service 返回相同数据类型。
- 每一步保持 `pnpm run build` 与 `pnpm run test` 通过。
- 只迁移 Web 前端；Electron、移动端、原后端相关代码一律不迁移。

## 需求变更记录

### 2026-08-18：市场 FAB 前置（Agent/Skill/MCP）

- 为满足后端 SQL 查询性能，Agent、Skill、MCP 市场统一改为 **FAB 前置**：进入页面先 `getFabOptions`，用户选择 FAB 后再查询分类/列表/详情。
- `getAgentCategories/getAgentsListByCategoryAndKW/getAgentDetailById`、`getSkillCategories/getSkillsListByCategoryAndKW/getSkillDetailById`、`getMcpServerCategories/getMcpServersListByCategoryAndKW/getMcpServerDetailById` 均新增 `fab` 入参；返回 `versions` 只含当前 FAB 的当前激活版本（单元素），不再返回其他 FAB/历史版本。
- 三类详情 Version 页取消 FAB 分区（原“Version 中增加 FAB Tab”定制作废）；FAB 由页面顶部选择器决定。
- 新增 `getFabOptions` 接口（type=agent|skill|mcp，mode=all|permissioned）。

### 2026-08-18：接口文档修订（用户更新 `04-frontend-backend-api.md`）

- `getFabOptions` 地址改为 `POST /api/market/getFabOptions`，前端统一使用 `marketService.getFabOptions`（Agent/Skill/MCP 市场共用）。
- Agent 列表 `getAgentsListByCategoryAndKW` 响应改为：
  - `agentFullName`：格式 `{AgentName}-{fab}`，替代原来的 `name`；
  - `version`：当前 FAB 的当前激活版本号（字符串）；
  - `fabPermission`：`{ fab, callPermission }`，替代原来的 `versions` 数组。
- Agent 详情 `getAgentDetailById` 响应改为：
  - 顶层新增 `agentFullName`；
  - 版本内容展平到顶层：`overview`、`systemRoleMarkdown`、`capabilities`、`examples`、`skills`、`mcpServers`；
  - 新增 `versionInfo`：`{ version, fab, callPermission, updateAt, createAt, changeLog }`；
  - `relatedAgents` 使用 `agentFullName`。
- `getMentionAgentsList` 响应字段 `name` 改为 `agentFullName`，新增 `ownerName`；请求不再传 `limit`。
- Skill/MCP 接口保持 `versions`（当前 FAB 单元素）结构，不采用 Agent 的展平结构；`getFabOptions` 的 type 仍支持 skill/mcp。
- M2 对话页 `@Agent` 菜单按 `agentFullName` 展示；M3/M4 市场与详情按新结构实现。

## 模块清单

### 目录结构规范（大厂标准：bulletproof-react 范式，已按此重组）

```text
src/
├── app/                        # 应用装配层：App.tsx（根组件）、router.tsx（路由表）、providers.tsx（Provider 组合）
├── api/                        # 数据访问层：按领域拆分的 Service（core/market/runtime/…），页面不得直接 fetch
│   ├── core/                   # 共享契约类型与 serviceMode（http/mock 切换）
│   ├── market/                 # Agent/Skill/MCP 市场与 FAB 服务
│   ├── runtime/                # Copilot/AG-UI 运行时：agentRuntimeService/runReducer/sse/types
│   ├── session/ user/ memory/ … # 其余领域 Service
│   └── runtimeConfig.ts
├── components/                 # 全局共享 UI
│   ├── AppShell.tsx            # 应用壳
│   └── shell/                  # 迁移的 LobeHub 布局原语（NavHeader/SideBarLayout/NavItem/HomeSidebar…）
├── features/                   # 业务域（页面逻辑全部下沉，路由只做懒加载引用）
│   ├── chat/                   # 对话域：ChatPage + components（ChatHeader/ChatItem/ChatInput/MessageBlocks/Welcome）
│   ├── market/                 # 市场域：MarketPage/DetailPage + components（FAB 选择器/分页/列表项）
│   ├── skill/                  # Skill 创建
│   └── workspace/              # 隐藏模块与占位（Group/Tasks/Documents/Memory/Settings/Channel/Artifact）
├── i18n/                       # 国际化：locales + dictionaries（用户设置优先 → 浏览器语言）
├── lib/                        # 可复用基础设施：httpClient（fetch 封装）、mock（mockDelay/page/filterMarketItems）
├── mock-data/                  # 与 api/ 一一对应的 Mock 数据
├── stores/                     # zustand（runStore/uiStore）
├── types/                      # 全局共享领域类型（MarketItem/AgentDetail/SkillMcpDetail…）
├── styles.css
└── main.tsx                    # 薄入口：挂载 Providers + App
```

规则：路由配置集中在 `app/router.tsx`；业务与 UI 在 `features/<domain>/`；共享 UI 在 `components/`；数据访问只在 `api/`（传输与 Mock 工具在 `lib/`）；领域类型在 `types/`。

### M0 基础迁移组件（通用 UI 层）

**目标**：把 canary 中页面共享的基础组件迁移到 `src/components/shell/`，不依赖 LobeHub store/service。

**上游文件**：

- `src/features/NavHeader/index.tsx`
- `src/features/NavPanel/SideBarLayout.tsx`
- `src/features/NavPanel/SideBarHeaderLayout.tsx`
- `src/features/NavPanel/components/NavItem.tsx`
- `src/features/NavPanel/ToggleLeftPanelButton.tsx`、`components/BackButton.tsx`
- `src/features/WideScreenContainer/index.tsx`
- `src/components/PublishedTime`（等价实现）

**迁移内容**：NavHeader、SideBarLayout、SideBarHeaderLayout、NavItem（slim 版）、ToggleLeftPanelButton/BackButton、WideScreenContainer、时间格式化组件。

**替换**：`useGlobalStore`/`useWorkspaceAwareNavigate` 等替换为本地 `useUiStore`（面板状态、本月模式）与 `react-router` 导航。

**验收**：M1 起全部使用这些组件；build/test 通过。

### M1 应用壳与导航

**目标**：把当前 [AppShell.tsx](/Users/chenguo/Documents/ChatGPT/llxiea/src/components/AppShell.tsx) 的旧版图标 rail 结构替换为 canary 的 `NavPanelShell + DraggablePanel + DesktopLayoutContainer` 结构。

**上游文件**：

- `src/routes/(main)/_layout/index.tsx`、`DesktopLayoutContainer.tsx`、`DesktopLayoutContainer/style.ts`
- `src/features/NavPanel/Shell.tsx`、`components/NavPanelDraggable.tsx`
- `src/features/HomeSidebar`、`src/routes/(main)/home/_layout/Header`、`Body`

**迁移内容**：

- `src/stores/uiStore.ts`：左侧面板展开/宽度、**本月模式**开关（localStorage 持久化）。
- `src/components/shell/`：NavPanelDraggable、DesktopLayoutContainer、HomeSidebar（Header/ Body/Footer）。
- 菜单模型：对话、Chat Group、任务、文档、记忆、商场、设置（+后续 Channel/Artifact 占位）。
- 本月模式开关：开启后仅显示对话/商场/设置，其余菜单隐藏且不触发请求；关闭时显示全部菜单。

**替换**：`sessionHistoryService`（会话列表）、`userService`（用户资料）保持 Mock。

**验收**：视觉结构与 canary 一致（左侧可拖拽面板 + 圆角内容容器）；本月模式可切换并持久化；build/test 通过。

### M2 对话页

**目标**：替换当前 [ChatPage.tsx](/Users/chenguo/Documents/ChatGPT/llxiea/src/features/chat/ChatPage.tsx) 的手写 demo 为 canary 对话 UI。

**上游文件**：

- `src/routes/(main)/agent/(chat)/_layout`、`features/Conversation/ConversationArea.tsx`
- `src/features/Conversation/ChatList`、`ChatItem`、`Messages`
- `src/features/ChatInput`（Desktop/InputEditor/SendArea/ActionBar）
- `src/features/Conversation/InterventionBar`、`Markdown`
- `src/features/AgentHome`

**迁移内容**：

- ChatHeader（NavHeader 风格：Agent 信息、Tags、HeaderActions、右侧面板开关）。
- 消息列表 ChatItem：头像/标题/时间/悬浮操作；用户气泡、助手消息、Markdown 渲染。
- 过程折叠：Reasoning、Tool Call、AssistantGroup、Workflow 步骤、HITL Intervention、A2UI Surface。
- ChatInput：自动高度输入框、@Agent-FAB 菜单、发送/停止、错误提示。
- 错误卡片、加载状态、欢迎页（AgentHome 风格）。

**替换**：`useChatStore`/`useAgentStore` → `useRunStore` + AG-UI reducer；`sessionHistoryService` 持久化保持。

**验收**：流式文本、reasoning、tool、HITL、A2UI 渲染与 LobeHub 视觉一致；刷新恢复；未知事件不白屏。

### M3 市场列表（Agent/Skill/MCP）

**目标**：替换当前 [MarketPage.tsx](/Users/chenguo/Documents/ChatGPT/llxiea/src/features/market/MarketPage.tsx) 为 canary community list 布局，并按 2026-08-18 需求实现 Agent FAB 前置。

**上游文件**：

- `src/routes/(main)/community/(list)/_layout`、`agent|skill|mcp/_layout`
- `src/routes/(main)/community/(list)/features/Pagination.tsx`、`SortButton`
- `src/routes/(main)/community/(list)/agent/features/Category`、`List/Item`
- `src/routes/(main)/community/(list)/skill|mcp/features/List/Item`
- `src/routes/(main)/community/features/Search`

**迁移内容**：

- 通用列表框架：NavHeader（搜索 + 排序 + 用户）、WideScreenContainer、分类侧栏、分页、Footer。
- Agent/Skill/MCP 市场：`getFabOptions(type)` 渲染 FAB 选择器 → 选择后按 `fab` 请求分类 + 列表；分类图标使用后端 emoji。
- 列表项迁移：Agent Item、Skill Item（Spotlight/评分/安装数）、MCP Item（官方/验证/连接类型标签）。

**数据替换**：`agentMarketService`/`skillMarketService`/`mcpMarketService`（Mock），Service 增加 `getFabOptions`。

**验收**：Agent 市场先选 FAB 再查询；切换 FAB 重新请求；分页完整；视觉与 canary 一致。

### M4 详情页（Agent/Skill/MCP）

**目标**：替换当前 [DetailPage.tsx](/Users/chenguo/Documents/ChatGPT/llxiea/src/features/market/DetailPage.tsx) 为 canary detail 布局，并按 2026-08-18 需求调整 Agent 详情。

**上游文件**：

- `src/routes/(main)/community/(detail)/_layout`、`agent/features/Details|Sidebar|Header`
- `src/features/CommunitySkillDetail`、`src/features/MCPPluginDetail`

**迁移内容**：

- 详情 Header（返回 + 搜索 + 用户）、Tabs（base-ui `variant="square"`）、内容列 + 右侧 360px 滚动 Sidebar（ActionButton/Summary/Related/Toc）。
- Agent/Skill/MCP 详情：顶部 FAB 选择器（来自 `getFabOptions`），对应详情接口按 `fab` 返回单版本数据；Version 页只展示当前 FAB 激活版本，**无 FAB 分区**；Skill/MCP 保留 `getAgentsReferencing*` 引用查询。
- 无权限状态：详情可看但“开始对话”禁用。

**数据替换**：Market Service Mock 增加 `getFabOptions` 与 `fab` 入参。

**验收**：三类型详情视觉与 canary 一致；Agent 详情切换 FAB 后内容与版本同步更新。

### M5 Skill 创建页

**目标**：对齐 canary Skill 表单视觉（`AgentSkillEdit/SkillEditForm`、`SkillStore/SkillList` 导入表单）。

**上游文件**：`src/features/AgentSkillEdit/SkillEditForm.tsx`、`src/features/SkillStore/SkillList/ImportFromGithubModal.tsx`

**迁移内容**：基本信息/仓库与版本/校验发布 三步的表单控件、校验提示、发布成功态。

**数据替换**：`skillMarketService.createAndPublishSkill`（Mock）。

**验收**：视觉与 canary 表单一致；发布成功跳详情；build/test 通过。

### M6 隐藏模块占位与路由

**目标**：补齐“所有菜单和路由”，隐藏模块在“本月模式”下不渲染、不触发请求。

**内容**：

- Channel、Page/Artifact 占位路由（`/channel`、`/artifact`、`/page`）与占位页面。
- Group/Tasks/Documents/Memory/Settings 页面在“本月模式”下显示“首期隐藏”占位，不调用 Service；关闭本月模式后可访问现有实现。
- 全部菜单项集中在一个路由/菜单配置中，避免硬编码散落。

**验收**：本月模式下隐藏路由不发出任何业务请求；全部模式下所有菜单可见。

### M7 i18n 与最终验证

**目标**：接入 react-i18next，迁移 en-US/zh-CN 文案，默认语言逻辑复用 LobeHub（用户设置 → 浏览器语言）。

**内容**：全局 Provider、语言切换入口、关键页面文案 key；删除硬编码中文。

**验收**：`pnpm run build`、`pnpm run test` 通过；与 canary 截图逐页对比；浏览器实测核心链路。

## 执行顺序与状态

| 模块 | 状态 | 备注 |
|---|---|---|
| M0 基础迁移组件 | 已完成 | NavHeader/SideBarLayout/SideBarHeaderLayout/NavItem/PublishedTime/WideScreenContainer |
| M1 应用壳与导航 | 已完成 | NavPanelDraggable + DesktopLayoutContainer + HomeSidebar + 本月模式开关 |
| M2 对话页 | 已完成 | ChatHeader/ChatItem/ChatInput/MessageBlocks/Welcome；官方 CopilotKit v2 headless（http+proxy）+ 自研 SSE（mock/direct）；IndexedDB v3 全量历史 |
| M3 市场列表 | 已完成 | 三类市场 FAB 前置（getFabOptions→分类/列表），分页、emoji 分类、LobeHub 列表项 |
| M4 详情页 | 已完成 | 三类市场详情 FAB 前置；Agent 展平单版本 Version 页；Skill/MCP 单版本 |
| M5 Skill 创建页 | 已完成 | 表单/步骤/发布态，接入 createAndPublishSkill mock |
| M6 隐藏模块占位与路由 | 已完成 | /channel /artifact /page 占位；本月模式不触发业务请求 |
| M7 i18n 与最终验证 | 已完成（结构 + 全量 UI 文案 + 全量联网复核） | 18 种 LobeHub 语言全部提供人工翻译词典（zh-CN/en-US/zh-TW 手写，其余 15 种也已人工翻译）；`dictionaries.test.ts` 守护 key/占位符一致；15 种语言 × 257 key 全量与机器翻译比对（ar 走 DeepL oneshot，其余走本地 Argos），补齐 12 种语言 13 个漏译 key；build/test 通过 |
| M8 设置页功能接线 | 已完成 | 主题模式（跟随系统/浅色/深色，参照 LobeHub `themeMode`）、显示推理摘要开关、开发预览环境运行时 Mock/HTTP 切换；偏好持久化 localStorage |
| M9 全屏布局与群聊布局 | 已完成 | 修复 ThemeProvider 外层未撑满视口导致的内容区高度塌缩；对话输入区底部通栏 + 840 居中（参照 LobeHub）；侧边栏按路由切换；新增 `/group` 群聊首页与 `/group/:id` 群聊会话页，群组历史在群组侧边栏展示 |

## 剩余跟进项

- [x] 全量 UI 文案迁移到 i18n key；设置页提供 18 种语言切换；语言优先级：用户显式设置 → 后端 preferredLocale → 浏览器语言。
- [x] 设置页开关接线：主题模式（跟随系统/浅色/深色）、显示推理摘要、开发预览环境（运行时 Mock/HTTP 切换）已实现并持久化。
- [x] 布局修复与群聊：外层全屏（100dvh）、对话输入区锚定底部并 840 居中、侧边栏按路由切换、群聊首页/会话页与群组历史落地。
- [x] 新增入口与 FAB 交互：侧边栏 + 下拉菜单仅保留「新建对话 / 新建群聊」（用户不允许新建 Agent，移除市场 Agent 入口）；新建群聊为创建向导（群组名称 + 选择成员 Agent + 后端支持的编排模式，配置随会话持久化，群聊页按配置初始化成员与模式）；市场 FAB 切换改为 Select 下拉（适配 14–20 个 FAB，不再挤压搜索框）；详情页移除 FAB 切换，仅展示列表带入的当前 FAB 版本。
- [x] mock 模式不再挂载 CopilotKit Provider（消除 `/api/copilotkit` 404 报错与错误提示）；对话 hook 按模式拆分为 mock/official 两条路径，页面渲染与发送链路不变。
- [x] 新建会话/群聊统一“先跳转 + 路由携带 pendingSession + 后台落库”，写入完成广播 `sessions-changed` 刷新侧边栏，避免 IndexedDB 慢/卡住时无法进入新会话或列表不更新。
- [x] 群聊会话页与单 Agent 对话对齐：顶部展示成员 Agent（带叉可移除，至少保留 2 个）与「添加 Agent」下拉；头部右上角显示运行状态与群组信息；成员增删即时更新会话 `group` 配置并持久化。
- [x] 非 zh-CN/en-US/zh-TW 的 15 种语言已人工翻译补齐；`dictionaries.test.ts` 守护 18 种语言的 key 集合与占位符一致；全量联网复核见 `task.md`，脚本 `scripts/verify-i18n.mjs` + `scripts/argos-translate-server.py`。
- [x] 需求 Review / Code Review 已输出详细设计与缺口清单：见 `docs/agentdock/design/`（00-10：索引、端到端链路、AG-UI、A2UI、Registry、渲染矩阵、CopilotKit 接入、联调调试指南、最终架构决策、渲染投影层、逐行 Code Review）。
- [ ] 浏览器逐页视觉验收（当前环境无浏览器驱动，已用 build/test + HTTP 冒烟代替）。
- [ ] 真实后端联调（`VITE_SERVICE_MODE=http` 时按新契约走通）。
