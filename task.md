可以继续使用 Copilot Runtime 代理。更优雅的方案是：

```text
Browser
  → 固定同源 /api/copilotkit
  → Copilot Runtime 根据 forwardedProps.fab 选择上游
      ├─ F15B → F15B_BASE_URL/ag-ui
      ├─ F18A → F18A_BASE_URL/ag-ui
      └─ ...
```

浏览器不切换 URL，只在请求中携带：

```json
{
  "forwardedProps": {
    "fab": "F18A",
    "agentId": "OCAP_Agent",
    "action": "run"
  }
}
```

Runtime 从服务端环境变量读取映射：

```env
AGENT_ORCHESTRATION_BASE_URLS_JSON={"F15B":"https://f15b.example","F18A":"https://f18a.example"}
```

然后转发到对应的 `/ag-ui`。这样仍然完整保留：

- Copilot Runtime/Headless 接入
- AG-UI SSE 流式事件
- HITL、A2UI、stop、resume
- 统一认证、Cookie/Token 透传
- 同源请求，无浏览器 CORS 复杂性
- Orchestration 地址不与前端构建产物绑定
- CD 只修改服务端环境变量，不需要重新构建前端

浏览器直接切换 FAB URL 也能实现，例如使用 AG-UI `HttpAgent` 动态指定 URL；但此时流量绕过 Runtime，需要每个厂区分别处理 CORS、认证、恢复、错误规范和观测。它更适合作为本地联调的可选模式，不建议作为生产默认。[AG-UI HttpAgent](https://docs.ag-ui.com/sdk/js/client/http-agent) 支持直接配置后端 URL；CopilotKit 官方也说明直接连接会失去部分 Runtime 中间件能力。[Copilot Runtime 连接说明](https://docs.copilotkit.ai/agno/backend/copilot-runtime)

所以我会按以下方式定稿：

- 生产：固定 `/api/copilotkit`，Runtime 按 FAB 动态选路由。
- 本地联调：保留 `direct` 开关，允许浏览器直接访问 FAB `/ag-ui`。
- Agent Registry 等普通 REST API：统一地址，不按 FAB 切换。
- `VITE_*` 只保留本地 direct 模式配置；生产 FAB 地址放服务端/CD 环境变量。

剩余开发任务已完成，当前可在 [http://127.0.0.1:4173](http://127.0.0.1:4173) 查看。

已完成：

- Agent、Skill、MCP、用户、反馈、Group、任务、文档、记忆、Artifact、Channel 的独立 Service 与对应 `mock-data`
- HTTP/Mock 模式统一切换，页面不直接依赖 Mock Data
- `/api/copilotkit` Runtime 按 FAB 选择 `/ag-ui` 上游
- AG-UI SSE、断线恢复、事件去重、stop、HITL、A2UI Action
- IndexedDB Session、消息和 Run checkpoint 持久化
- HITL 暂停时刷新页面，可恢复并继续原 Run
- Chat 历史消息渲染及 Agent Group 运行流程
- Agent/Skill/MCP 完整详情导航，FAB 位于 Version 二级 Tab
- 窄窗口自适应和桌面双栏布局
- API 文档同步增加 Skill/MCP `createTimeAt` 和实际 Service 目录

验证结果：

- `pnpm run test`：3/3 通过
- `pnpm run build`：通过
- 浏览器实测 Chat、Group HITL、流式文本、A2UI、刷新恢复和市场详情页均正常
- 生产构建输出位于 [dist](/Users/chenguo/Documents/ChatGPT/llxiea/dist)

按之前约定，我暂未生成 ZIP、Docker image 或上传 Docker Hub；等你确认这一版 UIUX 后再执行打包流程。