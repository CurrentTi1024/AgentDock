# LobeHub 源码迁移矩阵

> 基线：`/private/tmp/lobehub-canary`  
> 原则：迁移 LobeHub 真实页面、组件、样式与交互；只替换服务端依赖和超出 AgentDock 范围的产品能力。

## 迁移规则

- UI 层优先直接迁移源码，不根据截图重新设计。
- 保留 `@lobehub/ui`、`antd-style`、语义化 `cssVar`、响应式断点及原交互状态。
- 原 Store、Server Action、TRPC、数据库和 Cloud 请求，通过 AgentDock adapter 替换为 service interface。
- Mock Service 与未来 HTTP Service 返回同一数据类型，页面不得感知当前数据源。
- 修改过的迁移文件在文件头标记上游源路径，便于后续对照与升级。

## 页面与源码映射

| AgentDock 页面 | LobeHub 源码入口 | 数据替换 |
|---|---|---|
| 应用壳与桌面导航 | `src/spa/router/desktopRouter.config.tsx`、`src/routes/(main)/*/_layout` | 本地路由配置、功能开关 |
| Agent 对话 | `src/routes/(main)/agent/(chat)`、`src/routes/(main)/agent/features/Conversation` | 官方 CopilotKit v2 headless（http+proxy）/ `agentRuntimeService` Mock 与自研 SSE（mock/direct） |
| 消息、推理、工具与任务过程 | `src/features/Conversation/ChatItem`、`Messages/AssistantGroup`、`Messages/Tool`、`Messages/Task` | 标准化本地事件 reducer |
| 对话输入框 | `src/features/ChatInput`、`MainChatInput` | `getMentionAgentsList` mock，返回全部 Agent-FAB 组合 |
| Agent 市场 | `src/routes/(main)/community/(list)/agent` | `agentMarketService` mock；页面顶部增加 FAB 选择器（`getFabOptions`），分类/列表按 FAB 查询 |
| Agent 详情 | `src/routes/(main)/community/(detail)/agent` | 按 FAB 查询的详情 mock；Version 页不再按 FAB 分区 |
| Skill 市场 | `src/routes/(main)/community/(list)/skill` | `skillMarketService` mock；FAB 选择器前置 |
| Skill 详情 | `src/features/CommunitySkillDetail`、`community/(detail)/skill` | 按 FAB 查询的详情 mock；Version 页不再分区 |
| Skill 创建 | Community Skill 表单、Modal 与表单基础组件 | `createAndPublishSkill` mock |
| MCP 市场 | `src/routes/(main)/community/(list)/mcp` | `mcpMarketService` mock；FAB 选择器前置 |
| MCP 详情 | `src/routes/(main)/community/(detail)/mcp` | 按 FAB 查询的详情 mock；Version 页不再分区 |
| Agent Group | `src/routes/(main)/group` | 临时成员、模式与配置 mock |
| Documents | `src/routes/(main)/agent/docs` | 本地文档 mock |
| Memory | `src/routes/(main)/memory` | 本地 Memory mock，不拼接 user message |
| Channel | `src/routes/(main)/agent/channel` | 渠道配置 mock |
| Task / Artifact | LobeHub task、page/artifact 对应 route/features | 本地列表和详情 mock |

## 明确移除

- LobeHub 登录、注册、订阅、计费、模型供应商、API Key 和 Cloud 管理。
- 原后端 TRPC、数据库、Server Action、远端上传及服务端鉴权实现。
- AgentDock 范围外的 Image、Video、Eval、Workspace 管理等入口。

## 当前迁移状态

- 已替换全局主题为 LobeHub `ThemeProvider` 与语义 token。
- 已从三类 Community List Item 源码迁移统一市场卡片结构（FAB 版本右上角、skill/mcp 数量标签、底部时间到时分 + ownerName）；分页迁移为 antd `Pagination`（右下角），排序迁移为 `SortButton` 下拉 + 升降序切换。
- 已从 Conversation ChatItem 源码迁移消息头、消息体、过程折叠和悬浮操作结构。
- 后续按上表逐个替换现有临时页面；临时页面不作为验收结果。
