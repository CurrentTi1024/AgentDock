# A2UI Surface 持久化与前端 catalog 补齐（2026-08-20）

> 状态：已合入并验证
> 关联：`MessageBlocks.tsx`、`ChatPage.tsx`、`features/chat/a2ui/catalog.tsx`

## 1. 现象

1. http 实时模式下刷新页面后 A2UI surface 消失：官方 renderer 只渲染实时 activity 消息，历史恢复没有 surface。
2. 更隐蔽的根因：页面上的 surface 实际从未真正渲染——此前“CPU/内存/磁盘”可见文本是模型文字回复，A2UI 渲染器输出的是 `Unknown component: Metric`。

## 2. 根因

- **组件名不匹配**：后端 A2UI 生成器（ag-ui-a2ui-toolkit 0.0.4 + runtime 中间件）按 `a2ui.org v0.9 basic catalog` 输出 `Column/Title/Row/Card/Metric`；而 `@copilotkit/a2ui-renderer` 的 basic catalog 来自 `@a2ui/web_core`，只有 `Text/Row/Column/Card/Button/...`，没有 `Metric/Title`。渲染器按名查不到组件 → Unknown。
- **历史不渲染**：surface 只作为实时 activity 存在；`run.surfaces` 快照虽落库（`a2ui_operations`），但 `renderStoredBlocks` 在 http 模式下被 `showSurfaces=false` 隐藏，且旧 `A2uiStoredSurface` 只认 mock 的 `components` 结构。

## 3. 修复

### 3.1 前端 catalog 补齐后端组件名（catalog.tsx）

在 `agentDockCatalog` 增加 `Column / Row / Card / Title / Metric` 五个定义与 React renderer（`children(id)` 渲染子组件，Metric 渲染 label+value）。这同时修复实时与历史两条渲染路径。

### 3.2 历史 surface 走官方 renderer（MessageBlocks.tsx）

新增 `StoredA2uiSurface`：

- payload 含 `a2ui_operations` → 用 `useRenderActivityMessage` 构造 `{ activityType: 'a2ui-surface', content: { a2ui_operations } }` 消息渲染（content 必须严格只含 `a2ui_operations`，附加字段会导致 schema 校验失败返回 null）；
- 旧 mock `components` 结构 → 继续走 `A2uiStoredSurface`。

`renderStoredBlocks` 的 surface 分支改用 `StoredA2uiSurface`；ChatPage 历史渲染 `showSurfaces` 改为 `true`（实时 `renderRunBlocks` 仍保持 http 隐藏，由官方 renderer 负责实时）。

## 4. 验证

- 注入 IndexedDB surface 快照（`a2ui_operations`：Column/Title/Row/Card/Metric）后打开会话：CPU/45%/内存/62%/磁盘/78% 全部渲染，无 Unknown、无控制台错误。
- 真实 A2UI 运行：实时渲染出 Metric 组件节点（label+value），无 Unknown，无错误。
- `pnpm run test` 28/28，`pnpm run build` 通过。

## 5. 坑

> ① `renderActivityMessage` 的 content 由 Zod schema 校验：`a2ui_operations` 之外不要附加字段（如 surfaceId），否则静默返回 null。
> ② 不要自己包一层 `@copilotkit/a2ui-renderer` 的 `A2UIProvider`：react-core 自带一份同一包 context，直接复用其 `useRenderActivityMessage` 即可；自行 Provider 会出现“useA2UIActions must be used within an A2UIProvider”或组件名解析不一致。
> ③ 后端生成组件名与前端 web_core basic catalog 不一致是版本组合问题：后端升级/更换生成器时需同步前端 catalog 定义。
