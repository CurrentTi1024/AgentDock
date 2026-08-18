# AgentDock 任务清单与进度（需求 / 实现 / 状态 / 引用）

> 更新日期：2026-08-19
> 模式：需求 Review + Code Review + 文档输出（详见 `docs/agentdock/design/`）
> 基线：LobeHub canary `/private/tmp/lobehub-canary`；只迁移前端

## 1. 模块总览

| 模块 | 需求摘要 | 状态 | 引用 |
|---|---|---|---|
| M0/M1 应用壳与导航 | 迁移 LobeHub 壳/导航；本月模式开关 | ✅ 已完成 | `docs/agentdock/06` |
| M2 对话页 | Agent 对话、@Agent、流式、Reasoning/Tool/HITL/A2UI、IndexedDB 全量历史（单 Agent + Group） | ✅ P0 主要完成（HITL wire 待后端冻结） | `design/01`、`design/02`、`design/05`、`design/09` |
| M3 市场列表 | Agent/Skill/MCP 市场，FAB 前置，all/permissioned | ✅ 完成（竞态/locale 已修） | `design/04` |
| M4 详情页 | 三类详情，FAB 前置，Version 不分区 | ✅ 完成（竞态/locale 已修；Reviews/Security/Info 静态样例 P2） | `design/04` |
| M5 Skill 创建 | 三步表单 + 立即发布 | ✅ 完成（受控表单 + detailUrl + Mock 详情注册） | `design/04` |
| M6 隐藏模块 | Channel/Artifact/Page/Group/Tasks/Documents/Memory/Settings | ✅ 本月模式隐藏；占位完成 | `docs/agentdock/00` |
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

**方案**：`marketService.getFabOptions` + `agent/skill/mcpMarketService` 三类 Service；Mock 与 HTTP 同构；`filterMarketItems + page` 实现 Mock 过滤。

**状态**：功能完成。缺口：

- 列表/分类请求无 AbortController、无 loading/error、FAB 切换竞态（P1）。
- locale 硬编码 `zh-CN`（P1）。
- `MarketItem` 日期 `toLocaleDateString('zh-CN')`（P1）。

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

### 2.6 M6 隐藏模块

**需求**：全部菜单可见，本月模式隐藏且不请求。

**方案**：`WorkspacePage` 按 type 分发；channel/artifact/page 为占位；Group/Tasks/Documents/Memory 有 Mock 实现；Settings 含 18 语言切换。

**状态**：完成。Group 成员为虚拟列表（P2）；Settings 暗色/推理开关无实际效果（P2）。

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

待联调项：HITL wire 冻结、A2UI fixture、`AGENT_ORCHESTRATION_BASE_URLS_JSON` 路由验证；前端保留项：构建体积优化。
