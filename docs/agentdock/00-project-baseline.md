# AgentDock 项目范围与决策基线

> 状态：待评审  
> 文档版本：0.1  
> 日期：2026-08-17  
> 适用范围：AgentDock 公司内部版本，不保留 LobeHub 原版运行模式
[https://github.com/lobehub/lobehub](https://github.com/lobehub/lobehub) lobehub源码

## 1. 文档目的

本文冻结 AgentDock 的产品边界和已经确认的架构决策，防止后续开发重新引入 LobeHub 原后端、双版本兼容、无关页面或重复的运行时状态。

## 2. 产品定位

AgentDock 是公司内部使用的 Agent 前端工作台：

- 复用和迁移 LobeHub 已打磨的 UI、UX、页面布局与对话交互。
- 不使用 LobeHub 原生后端、TRPC、数据库和模型供应商体系。
- Agent 由公司后端基于 DeepAgents 提供，AgentDock 只负责发现、选择、运行和展示。
- 普通业务 API 由公司 FastAPI 服务提供。
- Agent 实时通信采用 AG-UI；生成式界面采用 A2UI。
- CopilotKit 用作 AG-UI、HITL、A2UI 的协议和运行时基础，不使用其预制 Chat 替换 LobeHub 对话 UI。

## 3. 角色与权限

### 3.1 user

- 浏览并使用有权限的 Agent、Skill、MCP。
- 使用单 Agent 对话。
- 临时选择多个 Agent 组成 Agent Group。
- 查看本机保存的会话历史。
- 不能创建、编辑、发布或删除 Agent。

### 3.2 skill_creator

- 拥有 `user` 的全部能力。
- 可以创建并立即发布 Skill。
- 首期不提供独立的草稿、publish、unpublish 流程。

### 3.3 认证

- 使用公司 SSO。
- AgentDock 不实现注册、密码登录、社交登录或账号体系。
- 后端根据 SSO 身份判断用户角色和资源权限；业务请求不由前端伪造 `userId`。

## 4. 2026 年 8 月必须交付的范围

### 4.1 P0：Agent 对话链路

- 单 Agent 对话。
- 每次发送必须包含当前 user message、`agentId`、`fab`、`sessionId`、`threadId`、`runId`。
- `fab` 是字符串，例如 `F15B` 或 `F18A`。
- 支持 `@Agent` 选择；列表来自 `getMentionAgentsList`。
- 通过 Copilot Runtime 转发到 Orchestration Service `/ag-ui`。
- 完整消费标准 AG-UI 文本、reasoning、tool、state、activity、lifecycle 和 error 事件。
- 支持停止、错误展示和断线恢复。
- HITL 在架构和消息模型中保留全部模式；联调按后端实际实现逐项启用。
- A2UI 从第一版架构中接入并完成最小 Surface 渲染验证，完整业务 A2UI 延后到下月。

### 4.2 P0：本地会话历史

- IndexedDB 仅保存用户回看页面所需的会话和可见消息。
- 用户刷新页面或重新进入时，可以看到历史对话。
- 不承担 DeepAgents 上下文、checkpoint 或长期记忆存储。
- 不考虑跨设备同步。
- DeepAgents 通过 `threadId` 自己加载和维护上下文。

### 4.3 P0：市场

- Agent、Skill、MCP 分类。分类图标改成和agent头像一样的emoji表情，因为后端存储的就是emoji表情而不是组件。
- Agent、Skill、MCP 分页列表和详情。
- 分类/列表统一支持 `mode: all | permissioned`，不建立三个独立 Own 接口。
- `permissioned` 只显示用户有权限的资源版本/FAB组合。
- Agent、Skill、MCP 详情尽量覆盖 LobeHub Market UI 展示的信息。同时version中增加fab tab，按照详情返回的内容by fab区分显示哪个版本的信息。（后端会保证一个fab只有一个activate版本可用，而且不会返回历史不可用的版本）
- 查询 Skill 被哪些 Agent 使用。
- 查询 MCP 被哪些 Agent 使用。
- Skill Creator 创建并立即发布 Skill。

### 4.4 P0：页面和导航

- 显示我的需求中所有的的菜单和路由，
- 给我一个快捷按钮开启后只显示本月需要的菜单和路由，其余未来保留功能先隐藏，不触发请求。
- 页面风格、布局、信息密度和主要交互参照 LobeHub。lobehub有的就尽量迁移code，没有就参照模式改写，实在没有就新写但是风格、布局、信息密度和主要交互统一。

## 5. 开启后，后续保留但首期隐藏的范围

- Agent Group：不进入市场、不持久化 Group 配置；发送消息时携带完整临时配置。
- Orchestration Mode：由后端返回支持模式和配置 Schema，参考 Shannon orchestration。
- Task/定时任务。
- Documents 文档区域。
- Page/Artifact。
- Memory UI、Mock Service 和 Mock Data。
- Channel 通用 UI、Mock Service 和 Mock Data。
- Web 页面对应的移动端打包能力；首期只交付 Web。

### 5.1 Memory 特别约束

- Mock Memory 和正式 Memory 都必须按相同流程自动注入 Agent context。
- Memory 不能拼接到用户可见消息文本中。
- Memory 检索失败不能阻断对话。
- 首期 Memory UI 隐藏，后端正式存储方式待定。

## 6. 永久移除

- LobeHub 原生后端、TRPC、数据库、PostgreSQL 会话历史。
- LobeHub Cloud、计费、套餐、额度、支付。
- 模型供应商、模型配置、API Key 管理。
- 注册、密码登录、社交登录。
- Agent 创建、编辑、发布、删除。
- Agent Group 市场、发布、版本和持久化 CRUD。
- Eval 评测。
- Workspace、成员、审计和用量页面。
- Share 会话和分享页面。
- Knowledge/Resource。
- 图片/视频生成和下载中心。
- Electron 专属功能。
- LobeHub 原版/公司版双模式和 Company Global Provider。

## 7. 已冻结的标识语义

| 标识 | 产生方 | 语义 | 持久化位置 |
|---|---|---|---|
| `sessionId` | AgentDock | 用户可见的一段本地会话 | IndexedDB |
| `threadId` | AgentDock/后端约定 | DeepAgents 上下文线程 | IndexedDB保存引用，后端保存上下文 |
| `runId` | AG-UI Client | 一次用户提问/Agent 执行 | IndexedDB检查点、后端执行记录 |
| `parentRunId` | AG-UI Client/Runtime | 子执行或续执行的父 Run | 按需 |
| `streamId` | Orchestration Service/Redis | 一个 Run 内的事件游标 | Redis；必要时浏览器检查点 |
| `messageId` | 事件产生方 | 一条用户、助手、reasoning 或 activity 消息 | IndexedDB可见历史 |
| `toolCallId` | Agent/Core | 一次工具调用 | 可见消息块 |
| `surfaceId` | A2UI 工具 | 一个 A2UI Surface | 可见消息块/快照 |

只保留一个 `runId`。Orchestration Service 必须读取并沿用 `RunAgentInput.runId`，不再创建第二个 `orchestrationRunId`。

## 8. 全局 API 约定

- 普通 API 全部使用 POST。
- 普通 API 返回：

```json
{
  "code": 0,
  "message": "",
  "data": {}
}
```

- `code = 0` 表示成功；失败码最终由公司规范确认。
- 流式 AG-UI 接口是例外，返回 `text/event-stream`，不包裹普通响应 envelope。
- Copilot Runtime 使用 single-route 模式，只暴露一个 POST 入口。
- API 函数名称使用完整小驼峰命名，例如 `getAgentsListByCategory`。

## 9. 市场列表权限约定

以下接口统一接受 `mode`：

- `getAgentsListByCategoryAndKW`
- `getSkillsListByCategoryAndKW`
- `getMcpServersListByCategoryAndKW`

```ts
type MarketListMode = 'all' | 'permissioned';
```

- `all`：返回全部可展示资源及权限标记。
- `permissioned`：只返回用户至少拥有一个可调用版本/FAB组合的资源，并过滤无权限组合。

Agent 版本权限结构：

```json
{
  "versions": [
    {
      "version": "1.0.0",
      "fab": "F15B",
      "callPermission": true
    }
  ]
}
```

## 10. 非目标

- AgentDock 不负责 DeepAgents 如何保存上下文。
- IndexedDB 不作为 Agent 后端的状态数据库。
- 前端不解析或执行 Agent 内部 orchestration。
- Agent Group 配置不保存为可复用数据库实体。
- 不为未来功能提前恢复 LobeHub 全量依赖。

## 11. 本文待确认项

- [失败码就是非0] 公司失败码最终使用 `1` 还是 `-1`。
- [ 是的 ] Skill/MCP 是否也采用版本 + FAB 粒度的 `callPermission`。
- [ 已授权 ] 首期市场中 `permissioned` 页签最终显示名称：`可用`、`已授权`或其他。

