# Agent Registry 集成设计（FAB 前置 + Service + Mock→HTTP）

> 状态：Review 完成  
> 关联：`docs/agentdock/04-frontend-backend-api.md`（接口唯一权威）

## 1. FAB 前置流程（需求）

为满足后端 SQL 查询性能，市场必须“先选 FAB 再查询”：

```text
进入市场
  → getFabOptions({ type, mode: 'all' })           渲染 FAB 选项
  → getFabOptions({ type, mode: 'permissioned' })  决定默认 FAB（第一项）
  → 用户选择 FAB（或默认值）
  → get*Categories({ fab, mode })
  → get*ListByCategoryAndKW({ fab, mode, ... })
  → 点击进入详情 → get*DetailById({ fab, ... })
```

规则：

- `permissioned` 为空时展示无权限空态，不自动回退 `all` 发起查询。
- 切换 FAB 后必须重新请求分类/列表/详情，禁止旧数据残留。
- 详情 Version 页只展示当前 FAB 当前激活版本，无 FAB 分区。
- Agent 详情使用展平 `versionInfo + fabPermission`；Skill/MCP 使用单元素 `versions`。

## 2. 当前实现映射

| 接口 | HTTP Service | Mock Service | 页面 |
|---|---|---|---|
| `getFabOptions` | `marketService` (`/api/market/getFabOptions`) | `marketMockService`（permissioned 固定 F15B） | MarketPage/DetailPage |
| `getAgentCategories` | `agentMarketHttpService` | 按 fab/mode 过滤计数 | MarketPage |
| `getAgentsListByCategoryAndKW` | 同上 | `filterMarketItems + sortMarketItems + page` | MarketPage |
| `getAgentDetailById` | 同上 | `details[agentId@fab]` | DetailPage |
| `getMentionAgentsList` | 同上 | 全部有权限组合 | ChatPage @菜单 |
| Skill/MCP 系列 | `skillMarketHttpService` / `mcpMarketHttpService` | `filterMarketItems + sortMarketItems + page` | MarketPage/DetailPage |
| `createAndPublishSkill` | HTTP | 生成 `skill-{slug}` | CreateSkillPage |

## 3. Mock → HTTP 切换

```env
VITE_SERVICE_MODE=http
VITE_API_BASE_URL=/api
```

生产环境由 **OAuth2 Proxy** 按 path 将 `/api/*` 路由到 `AGENT_REGISTRY_BASE_URL`（注意：普通 REST 不按 FAB 切地址），并注入 SSO 登录 token；`/api/copilotkit` 单独路由到 Copilot Runtime。**仓库不自建反向代理**；本地联调时才需要临时 nginx/代理（见 `design/08` §7、`design/07`）。

HTTP Client（`src/lib/httpClient.ts`）已统一处理 envelope（`code !== 0` 抛错）、`credentials: include`、超时与 signal。Mock 与 HTTP 返回相同 data 类型。

## 4. Review 发现的代码问题

### 4.1 竞态与错误处理（P1）

- ~~MarketPage：分类/列表请求没有 AbortController、没有过期保护、没有 loading/error 状态~~ ✅ 已修复：列表/分类请求带 AbortController + requestId 过期保护 + loading/error 态，快速切换 FAB/分类不会出现旧响应覆盖。
- ~~DetailPage：详情请求没有 AbortController 且无错误提示~~ ✅ 已修复：详情请求带 AbortController + loading/error。
- CreateSkillPage：`publish` 的 `finally` 只关 loading，错误无展示；表单全部 `defaultValue`，用户输入未收集。

建议统一做法：

```ts
useEffect(() => {
  const controller = new AbortController();
  const fabAtRequest = fab;
  setLoading(true);
  fetchList(kind, request, { signal: controller.signal })
    .then((result) => { if (fabAtRequest === currentFabRef.current) setItems(result.items); })
    .catch((error) => { if (!isAbort(error)) setError(error); })
    .finally(() => setLoading(false));
  return () => controller.abort();
}, [fab, category, mode, page, query]);
```

### 4.2 locale 硬编码（P1）

以下位置写死 locale，应改为 `useI18n().locale`（详情页已用 `locale` 格式化日期，但请求仍写死）：

- ~~MarketPage：`getFabOptions` ×2、列表、分类~~ ✅ 已改 `useI18n().locale`。
- ~~DetailPage：`getFabOptions` ×2、详情~~ ✅ 已改 `useI18n().locale`。
- CreateSkillPage：`createAndPublishSkill`（仍写死 `zh-CN`）。
- ~~WorkspacePage GroupPage：`getSupportedAgentGroupOrchestrationModes`~~ → 现位于 GroupChatPage / GroupCreateModal；GroupCreateModal ✅ 已改 `useI18n().locale`，GroupChatPage 仍写死 `zh-CN`。
- ChatPage / HomePage：`getMentionAgentsList`（仍写死 `zh-CN`）。

日期格式化写死：

- ~~`MarketItem`：`toLocaleDateString('zh-CN')`~~ ✅ 已改：使用 `useI18n().locale` 且时间精确到时分（`toLocaleString` + hour/minute）。
- `PublishedTime`：`Intl.DateTimeFormat('en-US')`。
- WorkspacePage Documents/Memory：`toLocaleDateString('zh-CN')`。

### 4.3 Skill 创建发布后死链（P1）

```ts
// CreateSkillPage
onClick={() => navigate('/market/skill/document-summary')}   // 硬编码
```

Mock Service 返回 `detailUrl: /market/skill/skill-${slug}`（例如 `skill-flight-log-summary`），而 Mock details 只有 `document-summary`、`secure-review`。修复：使用返回的 `detailUrl` 跳转，并在 Mock 中注册新创建的 skill 详情（或跳列表 + 成功提示）。

### 4.4 其他（P2）

- ChatPage 默认选中 `mentions[0]`：无提及列表时应空态而非默认选中。
- DetailPage `Sidebar` 的 homepage/repository 按钮无 onClick。
- Skill/MCP 详情的 Install/Add 按钮无实际行为（可接受，标注 Mock）。
- GroupPage 成员硬编码虚拟列表，未从市场数据拉取（本月隐藏，P2）。

## 5. 行动项

| # | 行动 | 优先级 |
|---|---|---|
| G1 | OAuth2 Proxy 配置 `/api/* → AGENT_REGISTRY_BASE_URL`、`/api/copilotkit → Copilot Runtime`（本地联调可用临时 nginx 等价替代）；仓库不实现反向代理 | P0 |
| G2 | MarketPage/DetailPage 请求统一 AbortController + loading/error/竞态保护 | ✅ 已完成 |
| G3 | 全部请求 locale 改用 `useI18n().locale`；日期格式化统一 locale | ⚠️ 部分完成：MarketPage/DetailPage/GroupCreateModal 已改；ChatPage/HomePage/GroupChatPage/CreateSkillPage 仍写死 `zh-CN`（P1） |
| G4 | CreateSkillPage 使用 `detailUrl` 跳转；Mock 补新建 skill 详情 | P1 |
| G5 | ChatPage mention 空态 | P2 |
