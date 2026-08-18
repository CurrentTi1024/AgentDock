# AgentDock 开发规范（AI Coding Agent 指南）

本文件是 AI Coding Agent 在本仓库工作时必须遵守的约定。它是 AgentDock Web 工程的规范，不再沿用 LobeHub 上游仓库的 AGENTS.md。

## 项目速览

- AgentDock：公司内部 Agent 前端工作台，复用 LobeHub UI/UX，只交付 Web 前端。
- 数据一律通过 `src/api/**` Service 提供；默认 Mock，`VITE_SERVICE_MODE=http` 时走真实接口。
- 实时通信走 `/api/copilotkit`（Copilot Runtime single-route）→ 按 `fab` 转发 Orchestration `/ag-ui`（AG-UI SSE）。
- 文档权威源：
  - 产品范围与决策：`docs/agentdock/00-project-baseline.md`
  - 架构：`docs/agentdock/01-frontend-and-runtime-architecture.md`
  - 实时运行时契约：`docs/agentdock/02-agui-a2ui-runtime-contract.md`
  - 接口契约（唯一权威）：`docs/agentdock/04-frontend-backend-api.md`
  - LobeHub 迁移矩阵与 TODO：`docs/agentdock/05-lobehub-source-migration.md`、`docs/agentdock/06-frontend-migration-todo.md`

## 常用命令

```bash
pnpm run dev        # Vite 开发服务，默认 http://127.0.0.1:5173
pnpm run build      # tsc --noEmit + vite build；提交/交付前必须通过
pnpm run test       # node:test 运行时单测（src/api/runtime/*.test.ts）
pnpm run typecheck  # 仅类型检查
```

- 不要引入 LobeHub 的 `bun run check` / vitest 体系；本仓库测试是 `node --experimental-strip-types --test`。
- 修改后至少运行 `pnpm run build`；涉及 `src/api/runtime/` 时同时运行 `pnpm run test`。

## 目录约定（bulletproof-react 范式）

```text
src/
├── app/          # 应用装配：App.tsx、router.tsx（唯一路由表）、providers.tsx
├── api/          # 数据访问层：每域一个 Service（agent-group/market/runtime/session/…）
│   ├── core/     # 共享 API 契约类型（api/core/types.ts）与 serviceMode
│   └── runtime/  # agentRuntimeService / runReducer / sse / types
├── components/   # 全局共享 UI：AppShell + shell（LobeHub 布局原语）
├── features/     # 业务域：chat / market / skill / workspace，各自带 components/
├── i18n/         # locales.ts（18 种语言）+ dictionaries/
├── lib/          # httpClient.ts（postApi/ApiError）、mock.ts（mockDelay/page/filterMarketItems）
├── mock-data/    # 与 api/ 一一对应的 Mock 数据
├── stores/       # Zustand：runStore / uiStore
├── types/        # 全局共享领域类型（MarketItem/AgentDetail/SkillMcpDetail…）
└── main.tsx      # 薄入口
```

规则：

- 不要新建 `src/pages/` 或 feature barrel（`features/*/index.ts`）；页面直接以文件路径懒加载。
- 新增/修改路由只改 `src/app/router.tsx`，页面组件从 `@/features/<domain>/<Page>` 懒加载。
- 业务与 UI 在 `features/<domain>/`；共享 UI 在 `components/`；跨页面复用的领域类型在 `types/`。
- 文件超过约 800 行时拆分（子组件、hooks、helper、types）。

## 数据访问规范

- 页面与组件只能 import `@/api/**` Service，禁止直接 `fetch`、禁止直接 import `mock-data/`。
- 每个普通业务模块在同一个 Service 文件中导出：interface、HTTP 实现、Mock 实现、`selectService` 选中的实例。
- 接口/需求变更流程：先改 `docs/agentdock/04-frontend-backend-api.md`（接口唯一权威）与 `00/06`，再同步 `mock-data` 与 Service，最后改页面。
- HTTP 与 Mock 实现必须返回同一数据类型；Mock 数据用 `structuredClone` 返回，避免页面意外修改共享数据。
- 市场接口必须携带 `fab`；进入市场先 `getFabOptions`，再查分类/列表/详情。Agent 详情是展平的 `version + fabPermission + versionInfo`，Skill/MCP 是当前 FAB 单元素 `versions`。

## i18n 规范

- 全部静态 UI 文案必须走 `useI18n().t(key)`；后端/Mock 返回的数据原文展示，不做翻译。
- 支持 18 种语言（见 `src/i18n/locales.ts`），全部提供本地化词典：`en-US` 为源语言，`zh-CN`/`zh-TW` 与其余 15 种语言已人工翻译。
- 新增 key 时必须同时补全所有 `dictionaries/*.ts`（至少 `en-US` 与 `zh-CN`，其余语言可暂沿用英文值），保持 key 集合一致；`src/i18n/dictionaries.test.ts` 会守护 key 集合与 `{placeholder}` 占位符一致。
- 语言优先级：用户显式设置（localStorage `agentdock-locale`）→ 后端 `preferredLocale` → 浏览器语言。

## 代码风格

- React 19 + TypeScript strict；组件优先 `@lobehub/ui/base-ui`（headless 原语），其次 `@lobehub/ui` 根包，最后才是 antd。
- 样式优先 `createStaticStyles` + `cssVar.*`（零运行时）；只有确实需要运行时计算时才用 `createStyles` + token。
- 页面入口组件默认导出，内部子组件具名导出。
- 从 LobeHub 迁移的文件在文件头保留上游源码路径注释，便于对照升级。

## 测试与验证

- 现有测试：`src/api/runtime/runReducer.test.ts`、`src/api/runtime/sse.test.ts`（`node:test`）。
- 每个 bug 修复必须带回归测试（先复现失败，再修复后通过）。
- 涉及运行时事件处理的改动必须保证 3 个现有测试全部通过。
- i18n 字典完整性由 `src/i18n/dictionaries.test.ts` 守护；需要联网复核翻译时可运行 `node --experimental-strip-types scripts/verify-i18n.mjs`（抽样比对 MyMemory 翻译，低相似度项输出供人工复查）。

## 文档纪律

- 需求、接口、架构的任何变更都要先同步 `docs/agentdock/` 对应文档，再动代码。
- README（启动/配置/路由）与 docs 索引在目录结构或命令变化时同步更新。
- 浏览器视觉验收受限时，用 `pnpm run build` + `pnpm run test` + HTTP 冒烟（`vite preview` 后请求关键路由）代替，并在 task.md 记录。
