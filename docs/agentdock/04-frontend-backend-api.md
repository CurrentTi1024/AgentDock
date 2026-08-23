# AgentDock 前后端 API 契约

> 状态：待前后端评审  
> 文档版本：0.2  
> 日期：2026-08-17  
> 适用范围：AgentDock Browser、AgentDock App Server、公司 FastAPI 业务服务与 Orchestration Service

## 1. 文档目的

本文冻结 AgentDock 前端当前所需的普通业务 API，以及实时 Agent 入口的边界。市场字段参考 LobeHub Market 的列表、详情和导航信息密度，同时按公司内部 FAB 与权限模型调整。

本文不定义 DeepAgents 内部接口、上下文存储、Redis Message Hub 协议或 LobeHub 原后端接口。

## 2. 全局约定

### 2.1 HTTP 与接口命名

- 所有普通业务接口只使用 `POST`。
- 普通接口地址格式为 `POST /api/{接口名称}`。
- 接口名称和前端 Service 方法名一致，使用有完整语义的小驼峰命名。
- 不使用 `/agent/list`、`/skill/detail` 一类按资源拆分的路径。
- 请求和响应使用 `application/json; charset=utf-8`，Skill 创建接口也采用 JSON，通过仓库地址导入，不在首期上传二进制包。
- 时间统一使用带时区的 ISO 8601 字符串。
- `locale` 使用 BCP 47，例如 `zh-CN`、`en-US`；前端优先传用户设置，否则传浏览器语言。
- ID、版本号和 FAB 均使用字符串，前端不得把 FAB 写成枚举常量。

### 2.2 普通响应 envelope

所有普通业务 API 返回：

```json
{
  "code": 0,
  "message": "",
  "data": {}
}
```

- `code = 0`：成功。
- `code != 0`：失败；具体非零码由公司后端规范最终分配。
- `message`：成功时可为空；失败时必须是可展示或可转换为多语言文案的错误信息。
- `data`：接口的具体业务数据；失败时可以为 `null`。
- HTTP 状态码仍应正确表达网络、认证和服务状态；前端同时检查 HTTP 状态与业务 `code`。
- AG-UI SSE 不使用该 envelope，详见第 9 节和 `02-agui-a2ui-runtime-contract.md`。

### 2.3 SSO 与权限

- SSO Cookie 或公司授权头由 **OAuth2 Proxy** 统一注入：浏览器只访问同源 `/api/*`，OAuth2 Proxy 校验登录态、附加授权头后按 path 转发到对应后端；仓库不自建反向代理。
- 请求体不传 `userId`、角色或权限列表。
- FastAPI 根据 SSO 身份判断 `user`、`skill_creator` 角色及资源权限。
- 前端隐藏无权限操作只用于改善体验，不能代替后端鉴权。

### 2.4 市场接口变量 `mode`

```ts
type MarketListMode = 'all' | 'permissioned';
```

- `all`：返回全部可展示资源；每个 `version + fab` 组合通过 `callPermission` 标识当前用户能否调用。
- `permissioned`：只返回用户至少拥有一个可调用组合的资源，并从 `versions` 中过滤所有无权限组合。
- 分类接口的 `count` 必须按相同 `mode` 统计，避免分类数量与列表不一致。
- 后端保证同一资源的一个 FAB 只返回一个当前激活版本，不返回历史不可用版本。

### 2.5 市场 FAB 前置查询

为满足后端 SQL 查询性能，Agent、Skill、MCP 市场统一采用 **FAB 前置** 流程：

- 进入任一市场时，先调用 `getFabOptions({ type: 'agent'|'skill'|'mcp', mode: 'all' })` 渲染 FAB 选择器，再调用 `getFabOptions({ type, mode: 'permissioned' })` 确定默认 FAB（取列表第一项；为空时展示无权限空态，不自动回退到 `all` 发起查询）。
- 用户选择 FAB 后，对应市场的分类、列表、详情接口都携带 `fab`，后端按 `fab + mode` 过滤。
- 三类市场的分类/列表/详情接口，`versions` 只返回当前 `fab` 的当前激活版本（单元素），不返回其他 FAB 或历史版本；详情 Version 页不再按 FAB 分区。
- 切换 FAB 后必须重新请求分类/列表/详情，避免展示与选中 FAB 不一致。

### 2.6 后端服务与 Base URL 路由

- Agent、Skill、MCP 的市场查询和 Skill 创建统一由 **Agent Registry** 提供。它不区分 FAB；OAuth2 Proxy 使用单一环境变量 `AGENT_REGISTRY_BASE_URL` 配置上游地址。
- 除 Agent Chat 的实时接口外，所有普通 REST API 都使用各自固定的后端入口，不得因请求中的 FAB 切换 Base URL。
- Agent Chat 的 Orchestration Service 按 FAB 部署。生产默认使用 **Copilot Runtime proxy**：Browser 始终访问同源 `/api/copilotkit`，Runtime 根据 `forwardedProps.fab` 选择对应 Base URL 并请求 `{baseUrl}/ag-ui`。
- FAB 映射由 Copilot Runtime/CD 的服务端变量 `AGENT_ORCHESTRATION_BASE_URLS_JSON` 配置。这样保留 Runtime middleware、认证透传、A2UI Catalog、审计、限流和统一错误处理。
- 对话实时传输只有 `proxy` 一种方式（direct 直连联调已移除）：Browser 始终访问同源 `/api/copilotkit`，不直接选择 FAB endpoint。
- 未配置请求 FAB 的 Orchestration URL 时必须拒绝执行并返回明确错误，不得静默路由到其他 FAB。

CD 环境变量示例：

```yaml
env:
  - name: AGENT_REGISTRY_BASE_URL
    value: "https://agent-registry.company.example"
  - name: AGENT_ORCHESTRATION_BASE_URLS_JSON
    value: '{"F15B":"https://agent-f15b.company.example","F18B":"https://agent-f18b.company.example"}'
```

市场实体通用字段约束：

- 图标字段统一命名为 `icon`。
- 所有者统一使用扁平字段 `ownerId`、`ownerName`、`ownerType`；类型定义为 `type OwnerType = 'NT' | 'Organization'`。
- 分类在资源列表和详情中使用字符串字段 `category`；仅分类接口返回 `categoryId`、`categoryName`、`icon`、`count`。
- Agent、Skill、MCP 不返回 `identifier`、`author` 或 `tags`。

## 3. 接口清单与优先级

| 优先级 | 接口名称 | 使用页面/功能 |
|---|---|---|
| P0 | `getCurrentUserProfile` | App 初始化、角色和 Skill 创建入口 |
| P0 | `getFabOptions` | Agent/Skill/MCP 市场 FAB 选择器与默认 FAB |
| P0 | `getAgentCategories` | Agent 市场分类（按 FAB） |
| P0 | `getAgentsListByCategoryAndKW` | Agent 市场列表、已授权列表（按 FAB） |
| P0 | `getAgentDetailById` | Agent 详情（按 FAB，Version 页不分区） |
| P0 | `getMentionAgentsList` | 对话输入框 `@Agent` |
| P0 | `getSkillCategories` | Skill 市场分类（按 FAB） |
| P0 | `getSkillsListByCategoryAndKW` | Skill 市场列表、已授权列表（按 FAB） |
| P0 | `getSkillDetailById` | Skill 详情（按 FAB，Version 页不分区） |
| P0 | `getAgentsReferencingSkillBySkillId` | Skill 详情中的“使用此 Skill 的 Agent” |
| P0 | `createAndPublishSkill` | Skill Creator 创建并立即发布 |
| P0 | `getMcpServerCategories` | MCP 市场分类（按 FAB） |
| P0 | `getMcpServersListByCategoryAndKW` | MCP 市场列表、已授权列表（按 FAB） |
| P0 | `getMcpServerDetailById` | MCP 详情、安装方式、Schema（按 FAB，Version 页不分区） |
| P0 | `getAgentsReferencingMcpServerByMcpServerId` | MCP 详情中的“使用此 MCP 的 Agent” |
| P0 | `submitMessageFeedback` | 助手消息点赞/点踩 |
| P1 | `getSupportedAgentGroupOrchestrationModes` | 临时 Agent Group 编排方式 |
| P0 | Copilot Runtime single-route | Agent run、stop、resume、HITL、A2UI Action |

本地 Session History 不在此表中：它只通过 IndexedDB Service 读写，不调用后端。IndexedDB 保存全部会话消息（单 Agent 与 Agent Group 的所有可见消息，包括 reasoning/tool/activity/A2UI/step），每次打开从本地恢复；用户清空浏览器存储后历史为空（不内置 Mock 种子会话）。

## 4. 用户接口

### 4.1 `getCurrentUserProfile`

**HTTP**：`POST /api/getCurrentUserProfile`  
**前端 Service**：`userService.getCurrentUserProfile`  
**使用位置**：App 启动、个人菜单、Skill 创建按钮权限

请求：

```json
{}
```

成功响应：

```json
{
  "code": 0,
  "message": "",
  "data": {
    "userId": "u-10001",
    "displayName": "Alex Chen",
    "avatarUrl": "https://assets.company.example/avatar/u-10001.png",
    "email": "alex.chen@company.example",
    "roles": ["user", "skill_creator"],
    "preferredLocale": "zh-CN"
  }
}
```

规则：

- `roles` 当前只识别 `user` 和 `skill_creator`。
- 不返回 SSO Token、密码或后端权限表达式。
- `preferredLocale` 为空时前端使用浏览器语言。

## 5. Agent 市场接口

### 5.1 `getFabOptions`

**HTTP**：`POST /api/market/getFabOptions`
**前端 Service**：`marketService.getFabOptions`（Agent/Skill/MCP 市场共用）
**使用位置**：Agent/Skill/MCP 市场 FAB 选择器、默认 FAB

请求：

```json
{
  "type": "agent",
  "mode": "all",
  "locale": "zh-CN"
}
```

成功响应：

```json
{
  "code": 0,
  "message": "",
  "data": {
    "fabs": ["F15B", "F18B", "F35A"]
  }
}
```

规则：

- `type` 取值 `agent`、`skill`、`mcp`，与对应市场一致；前端不把 FAB 或 type 写成枚举常量。
- `mode = all`：返回该市场全部可展示 FAB（去重后的完整集合）。
- `mode = permissioned`：只返回当前用户至少拥有一个可调用组合的 FAB。
- 返回顺序即推荐展示顺序；前端默认 FAB 取 `permissioned` 第一项，`permissioned` 为空时展示无可用 Agent 的空态。
- 切换 FAB 后，对应市场的分类、列表、详情请求必须携带新 FAB，避免页面展示与选中 FAB 不一致。

### 5.2 `getAgentCategories`

**HTTP**：`POST /api/getAgentCategories`  
**前端 Service**：`agentMarketService.getAgentCategories`

请求：

```json
{
  "mode": "all",
  "fab": "F15B",
  "locale": "zh-CN"
}
```

成功响应：

```json
{
  "code": 0,
  "message": "",
  "data": {
    "categories": [
      {
        "categoryId": "all",
        "categoryName": "全部",
        "icon": "✨",
        "count": 36
      },
      {
        "categoryId": "programming",
        "categoryName": "编程",
        "icon": "💻",
        "count": 8
      }
    ]
  }
}
```

规则：

- `icon` 是后端存储的图标名或 emoji 字符串，不返回 React 组件。
- `all` 分类建议由后端返回，且 `count` 为当前 `mode` 下去重后的资源总数。
- `fab` 必填，取值必须是 `getFabOptions` 返回的 FAB；分类 `count` 必须按 `fab + mode` 统计，避免分类数量与列表不一致。
- `mode` 是请求变量名，取值只能为 `all` 或 `permissioned`。

### 5.3 `getAgentsListByCategoryAndKW`

**HTTP**：`POST /api/getAgentsListByCategoryAndKW`  
**前端 Service**：`agentMarketService.getAgentsListByCategoryAndKW`

请求：

```json
{
  "mode": "all",
  "fab": "F15B",
  "categoryId": "programming",
  "keyword": "代码",
  "locale": "zh-CN",
  "sortBy": "recommended",
  "sortOrder": "desc",
  "page": 1,
  "pageSize": 20
}
```

成功响应：

```json
{
  "code": 0,
  "message": "",
  "data": {
    "currentPage": 1,
    "pageSize": 20,
    "totalCount": 1,
    "totalPages": 1,
    "hasNextPage": false,
    "items": [
      {
        "agentId": "agent-code-review",
        "agentFullName": "CodeReview_Agent-F15B",
        "icon": "🧑‍💻",
        "description": "审查代码并给出风险和改进建议",
        "ownerId": "133890",
        "ownerName": "lami",
        "ownerType": "NT",
        "category": "编程",
        "isFeatured": true,
        "isValidated": true,
        "usageCount": 1280,
        "skillCount": 2,
        "mcpServerCount": 1,
        "knowledgeCount": 3,
        "createTimeAt": "2026-06-01T09:00:00+08:00",
        "updatedAt": "2026-08-15T10:30:00+08:00",
        "version": "1.3.0",
        "fabPermission": {
          "fab": "F15B",
          "callPermission": true
        }
      }
    ]
  }
}
```

规则：

- `fab` 必填；`agentFullName` 格式固定为 `{AgentName}-{fab}`，与 `getMentionAgentsList` 的展示名一致。
- `version` 为当前 `fab` 的当前激活版本号；`fabPermission.callPermission` 表示当前用户在当前 FAB 上能否调用。
- `mode = permissioned` 时只返回当前 FAB 有调用权限的 Agent；`mode = all` 时返回当前 FAB 可展示的 Agent，并通过 `callPermission` 标记能否调用。
- `categoryId`、`keyword` 可传 `null`；空条件表示不过滤。
- `sortBy` 首期支持 `recommended`、`mostUsage`、`updatedAt`、`haveSkills`。
- 页面禁止根据 `agentFullName` 或本地缓存推断默认 FAB；默认 FAB 来自 `getFabOptions({ mode: 'permissioned' })` 第一项。
- `hasNextPage` 表示是否存在下一页；前端不得用当前页条数自行推断。

### 5.4 `getAgentDetailById`

**HTTP**：`POST /api/getAgentDetailById`  
**前端 Service**：`agentMarketService.getAgentDetailById`

请求：

```json
{
  "agentId": "agent-code-review",
  "fab": "F15B",
  "locale": "zh-CN"
}
```

成功响应：

```json
{
  "code": 0,
  "message": "",
  "data": {
    "agentId": "agent-code-review",
    "agentFullName": "CodeReview_Agent-F15B",
    "icon": "🧑‍💻",
    "description": "审查代码并给出风险和改进建议",
    "summary": "适合 Pull Request、补丁和代码片段审查。",
    "ownerId": "133890",
    "ownerName": "lami",
    "ownerType": "NT",
    "category": "编程",
    "homepageUrl": "https://intranet.example/agents/code-review",
    "isFeatured": true,
    "isValidated": true,
    "usageCount": 1280,
    "skillCount": 2,
    "mcpServerCount": 1,
    "knowledgeCount": 3,
    "createdAt": "2026-06-01T09:00:00+08:00",
    "updatedAt": "2026-08-15T10:30:00+08:00",
    "examples": [
          {
            "title": "审查补丁",
            "userMessage": "请审查这段变更并列出高风险问题。"
          }
        ],
        "skills": [
          {
            "skillId": "skill-secure-review",
            "name": "安全代码审查",
            "icon": "🛡️",
            "version": "1.1.0",
            "fab": "F15B"
          }
        ],
        "mcpServers": [
          {
            "mcpServerId": "mcp-company-git",
            "name": "Company Git MCP",
            "icon": "🔧",
            "version": "2.0.0",
            "fab": "F15B"
          }
        ],
        "overview": "针对 F15B 工程规范优化的代码审查版本。",
        "systemRoleMarkdown": "你是公司内部代码审查助手……",
        "capabilities": ["代码缺陷识别", "安全检查", "改进建议"],
        "versionInfo": {
          "version": "1.3.0",
          "fab": "F15B",
          "callPermission": true,
          "updateAt": "",
          "createAt": "",
          "changeLog": ""
        },
    "relatedAgents": [
      {
        "agentId": "agent-test-generator",
        "agentFullName": "TestGenerator_Agent-F15B",
        "icon": "🧪",
        "description": "根据代码生成测试用例",
        "ownerId": "133890",
        "ownerName": "lami",
        "ownerType": "NT",
        "category": "编程",
        "knowledgeCount": 1
      }
    ]
  }
}
```

规则：

- `fab` 必填；详情只返回当前 FAB 的当前激活版本，Version 页不再按 FAB 分区。
- 版本内容展平在顶层：`overview`、`systemRoleMarkdown`、`capabilities`、`examples`、`skills`、`mcpServers`；`versionInfo` 提供版本号、FAB、调用权限、创建/更新时间与变更记录。
- FAB 由市场/详情页顶部选择器决定，切换 FAB 时重新请求详情；上述版本内容允许随 FAB 版本不同。
- 无调用权限的版本可以在 `all` 场景展示详情，但“开始对话”按钮必须禁用。
- Agent 只供使用，不提供创建、编辑、发布或删除接口。
- 详情顶层字段与 Agent 列表字段保持同名（`agentFullName`、`icon`、`description`、`category` 等）；额外返回详情页所需的 `summary`、主页、创建时间及当前 FAB 版本内容。

### 5.5 `getMentionAgentsList`

**HTTP**：`POST /api/getMentionAgentsList`  
**前端 Service**：`agentMarketService.getMentionAgentsList`

请求：

```json
{
  "keyword": "OCAP",
  "locale": "zh-CN"
}
```

成功响应：

```json
{
  "code": 0,
  "message": "",
  "data": {
    "items": [
      {
        "agentId": "agent-ocap",
        "agentFullName": "OCAP_Agent-F15B",
        "icon": "🛩️",
        "description": "分析 OCAP 数据并生成结论",
        "ownerName": "IMC",
        "version": "1.3.0",
        "fab": "F15B"
      },
      {
        "agentId": "agent-ocap",
        "agentFullName": "OCAP_Agent-F18B",
        "icon": "🛩️",
        "description": "分析 OCAP 数据并生成结论",
        "ownerName": "IMC",
        "version": "1.2.0",
        "fab": "F18B"
      }
    ]
  }
}
```

规则：

- 返回当前用户有权调用的全部 `Agent + FAB` 组合，不在请求中按单个 FAB 过滤。
- 一个 Agent 如果在多个 FAB 有调用权限，必须拆成多条 item；每条 item 对应一个 FAB 的当前激活版本。
- `agentFullName` 是用户输入 `@` 后展示和插入的完整内容，格式固定为 `{Agent名称}-{fab}`，例如 `OCAP_Agent-F18B`。
- `agentFullName` 不得包含空白字符；Agent 名中的多个词使用下划线等非空白分隔符，FAB 前只拼接一个连字符 `-`。
- `keyword` 同时匹配 `agentFullName` 和 FAB；为空时返回后端排序后的常用或推荐组合。
- 选择结果必须保存 `agentId + version + fab`；拼接后的 `agentFullName` 只用于展示和文本解析，不能作为资源主键。
- `ownerName` 用于 `@` 菜单中的来源展示，不参与匹配。

## 6. Skill 市场接口

### 6.1 `getSkillCategories`

**HTTP**：`POST /api/getSkillCategories`  
**前端 Service**：`skillMarketService.getSkillCategories`

请求：

```json
{
  "mode": "all",
  "fab": "F15B",
  "locale": "zh-CN"
}
```

成功响应：

```json
{
  "code": 0,
  "message": "",
  "data": {
    "categories": [
      {
        "categoryId": "all",
        "categoryName": "全部",
        "icon": "✨",
        "count": 42
      },
      {
        "categoryId": "development",
        "categoryName": "开发",
        "icon": "🧩",
        "count": 12
      }
    ]
  }
}
```

规则与 Agent 分类一致；`fab` 必填，`count` 必须按 `fab + mode` 过滤。

### 6.2 `getSkillsListByCategoryAndKW`

**HTTP**：`POST /api/getSkillsListByCategoryAndKW`  
**前端 Service**：`skillMarketService.getSkillsListByCategoryAndKW`

请求：

```json
{
  "mode": "permissioned",
  "fab": "F15B",
  "categoryId": "development",
  "keyword": "文档",
  "locale": "zh-CN",
  "sortBy": "updatedAt",
  "sortOrder": "desc",
  "page": 1,
  "pageSize": 20
}
```

成功响应：

```json
{
  "code": 0,
  "message": "",
  "data": {
    "currentPage": 1,
    "pageSize": 20,
    "totalCount": 1,
    "totalPages": 1,
    "hasNextPage": false,
    "items": [
      {
        "skillId": "skill-document-summary",
        "name": "文档摘要",
        "icon": "📄",
        "description": "提取文档重点并生成结构化摘要",
        "ownerId": "team-knowledge",
        "ownerName": "Knowledge Team",
        "ownerType": "Organization",
        "category": "开发",
        "repositoryUrl": "https://git.company.example/ai/skills/document-summary",
        "homepageUrl": "https://intranet.example/skills/document-summary",
        "license": "Internal",
        "isFeatured": false,
        "isValidated": true,
        "installCount": 326,
        "resourceCount": 3,
        "createTimeAt": "2026-07-01T09:00:00+08:00",
        "updatedAt": "2026-08-14T16:00:00+08:00",
        "versions": [
          {
            "version": "1.0.0",
            "fab": "F15B",
            "callPermission": true
          }
        ]
      }
    ]
  }
}
```

规则：

- `sortBy` 支持 `installCount`、`updatedAt`、`createdAt`、`stars`、`name`；`recommended` 作为默认推荐序兼容（Mock 已实现）。
- `fab` 必填；`versions` 只返回当前 FAB 的当前激活版本（单元素），`mode` 对权限与整个 item 的过滤规则与 Agent 一致。
- `repositoryUrl`、统计字段可为空；UI 对空值隐藏对应区域，不能显示伪造的 0。
- `createTimeAt` 为资源首次创建时间，命名与 Agent、MCP 列表保持一致。
- `hasNextPage` 由 Agent Registry 根据查询结果计算并返回。

### 6.3 `getSkillDetailById`

**HTTP**：`POST /api/getSkillDetailById`  
**前端 Service**：`skillMarketService.getSkillDetailById`

请求：

```json
{
  "skillId": "skill-document-summary",
  "fab": "F15B",
  "locale": "zh-CN"
}
```

成功响应：

```json
{
  "code": 0,
  "message": "",
  "data": {
    "skillId": "skill-document-summary",
    "name": "文档摘要",
    "icon": "📄",
    "description": "提取文档重点并生成结构化摘要",
    "summary": "面向公司文档格式优化的摘要能力。",
    "ownerId": "team-knowledge",
    "ownerName": "Knowledge Team",
    "ownerType": "Organization",
    "category": "开发",
    "repositoryUrl": "https://git.company.example/ai/skills/document-summary",
    "homepageUrl": "https://intranet.example/skills/document-summary",
    "license": "Internal",
    "licenseUrl": "https://intranet.example/licenses/internal",
    "isFeatured": false,
    "isValidated": true,
    "installCount": 326,
    "resourceCount": 3,
    "createdAt": "2026-07-01T09:00:00+08:00",
    "updatedAt": "2026-08-14T16:00:00+08:00",
    "versions": [
      {
        "version": "1.0.0",
        "fab": "F15B",
        "callPermission": true,
        "summary": "F15B 文档摘要规则。",
        "contentMarkdown": "# 文档摘要\n\n使用说明……",
        "changelogMarkdown": "- 首次发布",
        "permissions": ["document:read"],
        "repository": {
          "url": "https://git.company.example/ai/skills/document-summary",
          "branch": "main",
          "path": "/skills/document-summary"
        },
        "resources": [
          {
            "path": "references/output-format.md",
            "size": 2048,
            "sha256": "a41f..."
          }
        ]
      }
    ],
    "relatedSkills": [
      {
        "skillId": "skill-document-translate",
        "name": "文档翻译",
        "icon": "🌐",
        "description": "翻译公司文档",
        "ownerId": "team-knowledge",
        "ownerName": "Knowledge Team",
        "ownerType": "Organization",
        "category": "开发"
      }
    ]
  }
}
```

规则：

- `fab` 必填；详情只返回当前 FAB 的当前激活版本（`versions` 单元素），Version 页不再按 FAB 分区。
- 概述、仓库 URL、使用说明、资源和版本信息足以覆盖 LobeHub Skill 详情的主要内容。
- `contentMarkdown` 只能包含经过后端清理的 Markdown；前端仍需禁用危险 HTML。
- 详情顶层字段与 Skill 列表字段保持同名，并增加详情页所需的说明、许可证链接、创建时间、版本内容和相关 Skill。

### 6.4 `getAgentsReferencingSkillBySkillId`

**HTTP**：`POST /api/getAgentsReferencingSkillBySkillId`  
**前端 Service**：`skillMarketService.getAgentsReferencingSkillBySkillId`

请求：

```json
{
  "skillId": "skill-document-summary",
  "fab": "F15B",
  "locale": "zh-CN",
  "page": 1,
  "pageSize": 20
}
```

成功响应：

```json
{
  "code": 0,
  "message": "",
  "data": {
    "currentPage": 1,
    "pageSize": 20,
    "totalCount": 1,
    "totalPages": 1,
    "hasNextPage": false,
    "items": [
      {
        "agentId": "agent-report-writer",
        "name": "ReportWriter_Agent",
        "icon": "📝",
        "description": "读取资料并生成报告",
        "ownerId": "team-knowledge",
        "ownerName": "Knowledge Team",
        "ownerType": "Organization",
        "category": "办公",
        "knowledgeCount": 2,
        "agentVersion": "2.1.0",
        "skillVersion": "1.0.0",
        "fab": "F15B",
        "callPermission": true
      }
    ]
  }
}
```

规则：

- 返回的是“哪些 Agent 当前激活版本引用此 Skill”，不是历史引用关系。
- 用户无权查看的 Agent 是否完全隐藏，由公司资源可见性规则决定；至少不能通过该接口绕过 Agent 权限。

### 6.5 `createAndPublishSkill`

**HTTP**：`POST /api/createAndPublishSkill`  
**前端 Service**：`skillMarketService.createAndPublishSkill`  
**角色要求**：`skill_creator`

请求：

```json
{
  "name": "飞行日志摘要",
  "icon": "🛫",
  "description": "从飞行日志中提取关键指标和异常",
  "summary": "供飞行测试报告使用。",
  "categoryId": "analysis",
  "locale": "zh-CN",
  "license": "Internal",
  "homepageUrl": "https://intranet.example/skills/flight-log-summary",
  "version": "1.0.0",
  "fabs": ["F15B", "F18A"],
  "repository": {
    "url": "https://git.company.example/ai/skills/flight-log-summary",
    "branch": "main",
    "path": "/"
  },
  "changelogMarkdown": "- 首次发布"
}
```

成功响应：

```json
{
  "code": 0,
  "message": "Skill created and published.",
  "data": {
    "skillId": "skill-flight-log-summary",
    "publicationStatus": "published",
    "version": "1.0.0",
    "fabs": ["F15B", "F18A"],
    "createdAt": "2026-08-17T14:30:00+08:00",
    "detailUrl": "/market/skills/skill-flight-log-summary"
  }
}
```

规则：

- 一个接口完成创建和立即发布，不提供独立 draft、publish、unpublish API。
- 后端生成 `skillId`，并校验名称与仓库路径的业务唯一性、SemVer、仓库可访问性、Skill 清单和 FAB 合法性。
- 前端不能提交 `ownerId`、`ownerName` 或 `ownerType`；后端从 SSO 身份生成。
- 首期从公司 Git 仓库导入。若以后支持文件上传，应新增“获取上传凭据”接口，不在 JSON 中传 Base64 大文件。
- 成功仅代表创建和发布完成；若后端采用异步扫描，应在最终成功前完成安全校验，或另行评审任务状态契约。

## 7. MCP 市场接口

### 7.1 `getMcpServerCategories`

**HTTP**：`POST /api/getMcpServerCategories`  
**前端 Service**：`mcpMarketService.getMcpServerCategories`

请求：

```json
{
  "mode": "all",
  "fab": "F15B",
  "locale": "zh-CN"
}
```

成功响应：

```json
{
  "code": 0,
  "message": "",
  "data": {
    "categories": [
      {
        "categoryId": "all",
        "categoryName": "全部",
        "icon": "✨",
        "count": 18
      },
      {
        "categoryId": "developer",
        "categoryName": "开发工具",
        "icon": "🛠️",
        "count": 6
      }
    ]
  }
}
```

规则与 Agent 分类一致；`fab` 必填，`count` 必须按 `fab + mode` 过滤。

### 7.2 `getMcpServersListByCategoryAndKW`

**HTTP**：`POST /api/getMcpServersListByCategoryAndKW`  
**前端 Service**：`mcpMarketService.getMcpServersListByCategoryAndKW`

请求：

```json
{
  "mode": "all",
  "fab": "F15B",
  "categoryId": "developer",
  "keyword": "git",
  "connectionType": "http",
  "locale": "zh-CN",
  "sortBy": "recommended",
  "sortOrder": "desc",
  "page": 1,
  "pageSize": 20
}
```

成功响应：

```json
{
  "code": 0,
  "message": "",
  "data": {
    "currentPage": 1,
    "pageSize": 20,
    "totalCount": 1,
    "totalPages": 1,
    "hasNextPage": false,
    "items": [
      {
        "mcpServerId": "mcp-company-git",
        "name": "Company Git MCP",
        "icon": "🔧",
        "description": "读取公司 Git 仓库、提交和 Pull Request",
        "ownerId": "team-developer-platform",
        "ownerName": "Developer Platform",
        "ownerType": "Organization",
        "category": "开发工具",
        "connectionTypes": ["http"],
        "capabilities": {
          "tools": true,
          "resources": true,
          "prompts": false
        },
        "toolCount": 8,
        "resourceCount": 2,
        "promptCount": 0,
        "repositoryUrl": "https://git.company.example/ai/mcp/company-git",
        "isOfficial": true,
        "isValidated": true,
        "installCount": 850,
        "createTimeAt": "2026-05-10T09:00:00+08:00",
        "updatedAt": "2026-08-16T11:00:00+08:00",
        "versions": [
          {
            "version": "2.0.0",
            "fab": "F15B",
            "callPermission": true
          }
        ]
      }
    ]
  }
}
```

规则：

- `connectionType` 可为 `http`、`sse`、`stdio` 或 `null`；首期 UI 可只开放公司实际支持的类型。
- `sortBy` 支持 `recommended`、`isFeatured`、`isValidated`、`installCount`、`ratingCount`、`updatedAt`、`createdAt`（Mock 已实现）。
- `fab` 必填；`versions` 只返回当前 FAB 的当前激活版本（单元素），`mode` 对权限与整个 item 的过滤规则与 Agent 一致。
- 不向前端返回 MCP 密钥、Token、实际用户配置值或内部网络凭据。
- `createTimeAt` 为资源首次创建时间，命名与 Agent、Skill 列表保持一致。
- `hasNextPage` 由 Agent Registry 根据查询结果计算并返回。

### 7.3 `getMcpServerDetailById`

**HTTP**：`POST /api/getMcpServerDetailById`  
**前端 Service**：`mcpMarketService.getMcpServerDetailById`

请求：

```json
{
  "mcpServerId": "mcp-company-git",
  "fab": "F15B",
  "locale": "zh-CN"
}
```

成功响应：

```json
{
  "code": 0,
  "message": "",
  "data": {
    "mcpServerId": "mcp-company-git",
    "name": "Company Git MCP",
    "icon": "🔧",
    "description": "读取公司 Git 仓库、提交和 Pull Request",
    "summary": "公司内部只读 Git 数据访问能力。",
    "ownerId": "team-developer-platform",
    "ownerName": "Developer Platform",
    "ownerType": "Organization",
    "category": "开发工具",
    "connectionTypes": ["http"],
    "capabilities": {
      "tools": true,
      "resources": true,
      "prompts": false
    },
    "toolCount": 8,
    "resourceCount": 2,
    "promptCount": 0,
    "repositoryUrl": "https://git.company.example/ai/mcp/company-git",
    "homepageUrl": "https://intranet.example/mcp/company-git",
    "isOfficial": true,
    "isValidated": true,
    "installCount": 850,
    "createdAt": "2026-05-10T09:00:00+08:00",
    "updatedAt": "2026-08-16T11:00:00+08:00",
        "versions": [
          {
            "version": "2.0.0",
            "fab": "F15B",
            "callPermission": true,
            "overviewMarkdown": "# Company Git MCP\n\n提供仓库检索能力……",
            "changelogMarkdown": "- 增加 Pull Request 查询工具",
            "connectionType": "http",
            "installation": {
              "title": "由平台托管",
              "instructionsMarkdown": "选择 Agent 后由平台自动注入，无需本机安装。"
            },
            "deploymentOptions": [
              {
                "type": "remoteHttp",
                "label": "公司托管 HTTP",
                "recommended": true
              }
            ],
            "configurationSchema": {
              "type": "object",
              "properties": {
                "repositoryScope": {
                  "type": "string",
                  "title": "仓库范围"
                }
              },
              "required": ["repositoryScope"]
            },
            "tools": [
              {
                "name": "searchRepositories",
                "description": "搜索用户有权访问的仓库",
                "inputSchema": {
                  "type": "object",
                  "properties": {
                    "keyword": { "type": "string" }
                  },
                  "required": ["keyword"]
                }
              }
            ],
            "resources": [
              {
                "name": "repository",
                "description": "仓库元数据",
                "uriTemplate": "company-git://repositories/{repositoryId}"
              }
            ],
            "prompts": []
          }
        ],
    "relatedMcpServers": [
      {
        "mcpServerId": "mcp-code-search",
        "name": "Code Search MCP",
        "icon": "🔎",
        "description": "搜索公司代码",
        "ownerId": "team-developer-platform",
        "ownerName": "Developer Platform",
        "ownerType": "Organization",
        "category": "开发工具"
      }
    ]
  }
}
```

规则：

- 信息覆盖 LobeHub MCP 详情的 Overview、Deployment、Schema、Agents、Related 和 Version 主导航。
- 安装方式是展示信息；实际注入和凭据管理由后端完成。
- `configurationSchema` 可以描述前端表单，但绝不能回传密钥值。
- `fab` 必填；详情只返回当前 FAB 的当前激活版本（`versions` 单元素），Version 页不再按 FAB 分区。
- 详情顶层字段与 MCP 列表字段保持同名，并增加详情页所需的说明、主页、创建时间、版本部署信息、Schema、Tools、Resources、Prompts 和相关 MCP。

### 7.4 `getAgentsReferencingMcpServerByMcpServerId`

**HTTP**：`POST /api/getAgentsReferencingMcpServerByMcpServerId`  
**前端 Service**：`mcpMarketService.getAgentsReferencingMcpServerByMcpServerId`

请求：

```json
{
  "mcpServerId": "mcp-company-git",
  "fab": "F15B",
  "locale": "zh-CN",
  "page": 1,
  "pageSize": 20
}
```

成功响应：

```json
{
  "code": 0,
  "message": "",
  "data": {
    "currentPage": 1,
    "pageSize": 20,
    "totalCount": 1,
    "totalPages": 1,
    "hasNextPage": false,
    "items": [
      {
        "agentId": "agent-code-review",
        "name": "CodeReview_Agent",
        "icon": "🧑‍💻",
        "description": "审查代码并给出风险和改进建议",
        "ownerId": "133890",
        "ownerName": "lami",
        "ownerType": "NT",
        "category": "编程",
        "knowledgeCount": 3,
        "agentVersion": "1.3.0",
        "mcpServerVersion": "2.0.0",
        "fab": "F15B",
        "callPermission": true
      }
    ]
  }
}
```

规则与 `getAgentsReferencingSkillBySkillId` 一致。

## 8. 对话辅助接口

### 8.1 `submitMessageFeedback`

**HTTP**：`POST /api/submitMessageFeedback`  
**前端 Service**：`messageFeedbackService.submitMessageFeedback`  
**使用位置**：Assistant 消息操作区

请求：

```json
{
  "sessionId": "session-001",
  "threadId": "thread-001",
  "runId": "run-001",
  "messageId": "assistant-001",
  "feedback": "dislike",
  "reasonCode": "incorrect",
  "reasonText": "结论与输入数据不一致"
}
```

成功响应：

```json
{
  "code": 0,
  "message": "",
  "data": {
    "feedbackId": "feedback-001",
    "messageId": "assistant-001",
    "feedback": "dislike",
    "updatedAt": "2026-08-17T16:20:00+08:00"
  }
}
```

规则：

- `feedback` 可为 `like`、`dislike`、`none`；`none` 表示撤销现有反馈。
- `dislike` 时 `reasonCode` 必填；选择“其他”时 `reasonText` 必填。
- 同一用户对同一 `messageId` 只能有一条当前反馈，重复提交执行幂等更新。
- 不上传 reasoning、工具敏感结果或整段对话；后端通过关联 ID 查询允许记录的信息。

建议后端首期提供的 `reasonCode`：`incorrect`、`notRelevant`、`incomplete`、`unsafe`、`poorToolUse`、`other`。若原因选项需要后台动态配置，再新增独立配置接口，不复用市场分类接口。

### 8.2 `getSupportedAgentGroupOrchestrationModes`

**HTTP**：`POST /api/getSupportedAgentGroupOrchestrationModes`  
**前端 Service**：`agentGroupService.getSupportedAgentGroupOrchestrationModes`  
**优先级**：P1，首期菜单隐藏时不请求

请求：

```json
{
  "locale": "zh-CN"
}
```

成功响应：

```json
{
  "code": 0,
  "message": "",
  "data": {
    "defaultModeId": "supervisor",
    "modes": [
      {
        "modeId": "supervisor",
        "name": "主管分配",
        "description": "主管 Agent 分配任务并汇总成员结果。",
        "icon": "🧭",
        "configSchema": {
          "type": "object",
          "properties": {
            "maxIterations": {
              "type": "integer",
              "title": "最大迭代次数",
              "minimum": 1,
              "maximum": 20,
              "default": 6
            }
          },
          "additionalProperties": false
        }
      },
      {
        "modeId": "parallel",
        "name": "并行执行",
        "description": "多个 Agent 并行处理后合并结果。",
        "icon": "⚡",
        "configSchema": {
          "type": "object",
          "properties": {},
          "additionalProperties": false
        }
      }
    ]
  }
}
```

规则：

- 前端不硬编码 Shannon 编排枚举，而是渲染后端返回的模式和 JSON Schema。
- Agent Group 不保存到数据库；用户每次 run 时提交成员、模式和配置。
- `mode` 下线后，前端不能继续发送本地缓存的旧 `mode`。

## 9. Copilot Runtime 与 AG-UI 实时接口

### 9.1 `runAgentThroughCopilotRuntime`

**Browser HTTP（生产默认 proxy）**：`POST /api/copilotkit`，Runtime 再调用 `POST {orchestrationBaseUrl}/ag-ui`  
**响应**：Copilot Runtime/AG-UI 流式响应，不使用普通 envelope

生产 proxy 模式由 Runtime 选择 FAB endpoint；任何模式都不得修改事件语义或生成第二个 `runId`。

**生产 proxy 请求体是官方 single-route envelope**，标准 `RunAgentInput` 位于 `body`：

```json
{
  "method": "agent/run",
  "params": { "agentId": "orchestration", "threadId": "thread-001" },
  "body": {
    "threadId": "thread-001",
    "runId": "run-001",
    "state": {},
    "messages": [{ "id": "message-user-001", "role": "user", "content": "请分析今天的飞行测试数据" }],
    "tools": [],
    "context": [],
    "forwardedProps": { "action": "run", "sessionId": "session-001", "agentId": "flight-analysis-agent", "fab": "F15B" }
  }
}
```

```json
{
  "threadId": "thread-001",
  "runId": "run-001",
  "state": {},
  "messages": [
    {
      "id": "message-user-001",
      "role": "user",
      "content": "请分析今天的飞行测试数据"
    }
  ],
  "tools": [],
  "context": [],
  "forwardedProps": {
    "action": "run",
    "sessionId": "session-001",
    "agentId": "flight-analysis-agent",
    "fab": "F15B"
  }
}
```

最低字段：当前 user message、`agentId`、`fab`、`sessionId`、`threadId`、`runId`。`runId` 只有一个，Orchestration Service 不再生成第二个 ID。

路由规则：

- `fab = F15B` 只允许转发至映射中的 F15B Base URL；其他 FAB 同理。
- Runtime 必须对映射值做 URL 校验，并统一追加 `/ag-ui`，配置值本身只保存 Base URL。
- FAB 未配置时不发起上游请求，返回 `FAB_ENDPOINT_NOT_CONFIGURED`；上游不可达时返回 `FAB_ENDPOINT_UNAVAILABLE`。
- `run`、`resume`、`stop`、`hitlResponse` 和 `a2uiAction` 均携带 `fab`，并路由到同一 FAB 的上游。
- Agent Registry 的所有普通 REST API 继续使用 `AGENT_REGISTRY_BASE_URL`，不按 FAB 切换。

### 9.2 single-route 支持的动作

这些是 `POST /api/copilotkit` 内由 Copilot Runtime 处理的动作，不额外创建五个 HTTP 地址：

| 逻辑动作 | 官方 envelope method | 关键字段 |
|---|---|---|
| 发起执行 | `agent/run` | `sessionId`、`agentId` 或 `group`、`fab`、当前 message（在 `forwardedProps`） |
| 断线恢复 | `agent/connect` | 相同 `runId`/`threadId`；`lastEventId` 语义由后端决定 |
| 停止执行 | `agent/stop` | `agentId`、`threadId` |
| HITL 响应 | `agent/run` + `RunAgentInput.resume[]`（标准 interrupt）或 `forwardedProps.hitlResponse`（后备） | `requestId`、mode 和对应输入 |
| A2UI Action | `agent/run` + `forwardedProps.a2uiAction.userAction` | `surfaceId`、`actionName`、`context`、`sourceComponentId` |

完整请求字段、SSE 格式、事件清单、幂等、断线恢复、HITL 与 A2UI 规则以 `02-agui-a2ui-runtime-contract.md` 为唯一权威来源，本文件不复制另一份事件协议。

## 10. 前端 Service 边界

建议目录：

```text
src/api/user/userService.ts
src/api/market/agentMarketService.ts
src/api/market/skillMarketService.ts
src/api/market/mcpMarketService.ts
src/api/market/marketService.ts
src/api/conversation/messageFeedbackService.ts
src/api/agent-group/agentGroupService.ts
src/api/runtime/{agentRuntimeService,runReducer,sse}.ts
src/api/session/sessionHistoryService.ts
src/lib/{httpClient,mock}.ts
src/mock-data/{user,agentMarket,skillMarket,mcpMarket,...}.ts
```

- 每个普通业务模块在同一个 Service 文件中导出 interface、HTTP 实现、Mock 实现和按环境选择的实例。
- `src/mock-data/` 与 `src/api/` 按功能一一对应，页面不得直接导入 Mock Data。

约束：

- 页面和组件只依赖 Service interface，不直接调用 `fetch`。
- Mock Service 与 HTTP Service 返回相同的 `data` 类型。
- HTTP Client 统一处理 envelope、SSO、超时、取消、locale 和非零 code。
- Service 模式默认取 `VITE_SERVICE_MODE`；设置页「开发预览环境」可运行时切换 `mock`/`http`（持久化到 `localStorage` 的 `agentdock-service-mode`），两种实现仍返回相同 `data` 类型，不改变本契约。
- Agent、Skill、MCP 的 HTTP Service 经 OAuth2 Proxy 访问同一个 Agent Registry（同源 `/api/*`），不自行按 FAB 选择地址。
- 市场页面先通过 `getFabOptions` 获取 FAB 选项与默认 FAB，Agent/Skill/MCP 分类/列表/详情请求必须携带当前 FAB。
- 生产 proxy 由 `@copilotkit/react-core/v2` transport 直接消费 `/api/copilotkit`（single-route envelope）；`agentRuntimeService`（mock runStore）仅用于离线 UI 测试，不套普通业务 API envelope。
- 生产环境中 `agentRuntimeService` 只提交 `fab`；FAB 到 Orchestration Base URL 的选择由 App Server Runtime 完成。
- IndexedDB 由 `sessionHistoryService` 封装，不模拟成 FastAPI 接口。

## 11. 本月明确不提供的 API

- 登录、注册、退出和 Token 刷新：由公司 SSO/宿主处理。
- Session History CRUD：仅存浏览器 IndexedDB。
- Agent 创建、编辑、发布、删除。
- Agent Group 市场、保存、详情、版本、发布和删除。
- Skill draft、publish、unpublish、delete。
- LobeHub 模型、Provider、API Key、计费、额度和 Cloud API。
- Workspace、成员、审计、Eval、Share、Knowledge/Resource API。

## 12. 后续隐藏模块的接口规划

下列模块保留 UI 与 Mock Service，但在功能评审前只冻结 Service 名称，不冻结 HTTP 字段，也不应由隐藏页面发出请求：

| 模块 | 预留 Service 方法 |
|---|---|
| Memory | `getMemorySettings`、`getMemoryItems`、`updateMemoryItem`、`deleteMemoryItem` |
| Task/定时任务 | `getScheduledTasks`、`getScheduledTaskDetailById`、`createScheduledTask`、`updateScheduledTask`、`deleteScheduledTask` |
| Documents | `getDocumentsListByKW`、`getDocumentDetailById` |
| Page/Artifact | `getArtifactsListBySessionId`、`getArtifactDetailById` |
| Channel | `getChannelsList`、`getChannelDetailById` |

Memory 自动注入 Agent context 属于后端运行逻辑，不允许前端把 Memory 文本拼接进 user message。待 Memory 后端方案确定后，应新增独立契约评审，不直接照搬 Mock Data 字段。

## 13. 联调前待确认

- [x] Agent Registry 使用单一 `AGENT_REGISTRY_BASE_URL`，由 OAuth2 Proxy 路由 `/api/*`（仓库不自建反向代理），不区分 FAB。
- [x] Agent Chat 使用 `AGENT_ORCHESTRATION_BASE_URLS_JSON` 按 FAB 配置上游，Browser 仍只访问 `/api/copilotkit`。
- [ ] 非零业务码的具体编号及其多语言错误 key。
- [ ] 公司 SSO 使用 Cookie 还是授权头，以及 Runtime 到 FastAPI 的透传方式。
- [ ] Skill 创建是同步完成仓库校验，还是需要异步导入任务契约。
- [ ] Agent `systemRoleMarkdown` 是否允许向所有可见用户展示；若不允许，后端应直接省略而不是返回后由前端隐藏。
- [ ] 市场统计字段中哪些有真实数据；没有真实数据的字段返回 `null`，前端隐藏，不伪造。
- [ ] Dislike 原因是否固定使用本文枚举，还是由后端动态配置。
