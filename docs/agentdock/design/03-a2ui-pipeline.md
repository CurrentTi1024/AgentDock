# A2UI 端到端管线设计（已落地：catalog + renderer + Runtime middleware）

> 状态：已落地（官方 catalog + renderer + Runtime middleware），action 与后端 fixture 待联调
> 关联：`docs/agentdock/02-agui-a2ui-runtime-contract.md` 第 9 节

## 1. 官方 A2UI 概念

A2UI 是声明式 UI 格式，AG-UI 是传输层。核心概念：

- **Catalog**：组件定义（Zod schema + 自然语言 description）+ React renderer 映射。传给 CopilotKit Provider 后自动启用 A2UI；`generate_a2ui`/`render_a2ui` 工具注入由 Runtime/后端 Middleware 配置决定（动态 schema 时 Runtime 侧 `injectA2UITool: true`，固定 schema 时后端直接返回 `a2ui_operations`）。
- **Built-in catalog**：Text、Image、Card 等，`includeBasicCatalog: true` 可同时保留。
- **BYOC**：`createCatalog` 自定义组件。
- **Surface 生命周期**：`createSurface` → `updateComponents` → `updateDataModel`。
- **固定 schema 模式**：Agent 自持 data-only tool 返回 `a2ui_operations`，runtime 只需 `a2ui: true`。
- **动态 schema 模式**：runtime 注入 `generate_a2ui` 工具 + 次 LLM。
- **Action 回传**：官方 renderer 的 action bridge 自动发送（中间件读取 `forwardedProps.a2uiAction.userAction`）；自研后备路径才用平铺 `forwardedProps.a2uiAction`。

后端链路（LangGraph/FastAPI + DeepAgents）：

```text
FastAPI app + CopilotKitMiddleware
  └─ create_deep_agent(...) 挂载 AG-UI endpoint（ag-ui-langgraph）
  └─ CopilotKitMiddleware 接收 catalog，注入 generate_a2ui 工具
  └─ Agent 生成 A2UI 组件 JSON → TOOL_CALL_START/ARGS/END（render_a2ui）
  └─ Runtime middleware 建立 Surface → Activity 事件 → 前端 renderer
```

## 2. 当前 AgentDock 实现（已落地）

### 2.1 已具备

- `a2ui/catalog.tsx`：`createCatalog` 定义 `metricCard / actionButton` + LobeHub 风格渲染器，Provider `a2ui={{ catalog }}`。
- 官方 Runtime `a2ui: {}` middleware 把 `render_a2ui` 流转成 `a2ui-surface` activity；前端 `useRenderActivityMessage` 渲染。
- Mock/恢复历史用 `A2uiStoredSurface` 按 payload 组件重建；未知组件回退 raw JSON。
- `sendA2uiAction`（自研后备）：新 runId + `parentRunId`；http 路径按官方 `a2uiAction.userAction` 嵌套。

### 2.2 缺口

| # | 缺口 | 影响 | 优先级 |
|---|---|---|---|
| U1 | ~~无 catalog 定义与 renderer~~ | ✅ `a2ui/catalog.tsx` |
| U2 | ~~无官方 renderer~~ | ✅ Provider `a2ui` + `useRenderActivityMessage` |
| U3 | ~~Action 硬编码~~ | ✅ 官方 renderer dispatch + 存储 surface 由 payload 驱动；自研后备保留默认值 |
| U4 | ~~无 action 处理器~~ | ✅ 官方 action bridge + `sendA2uiAction` 双路径 |
| U5 | 右栏 Artifact 面板静态写死 | 与 surface/artifact 数据无关联 | P1 |
| U6 | `updateComponents/updateDataModel` 增量 | 长生命周期 surface 更新由官方 renderer 处理；恢复历史仅快照 | P1(联调) |
| U7 | 固定 schema（a2ui_operations）兼容 | Runtime middleware 已支持；待后端 fixture 验证 | P1(联调) |

## 3. 目标实现方案

### 3.1 前端

```tsx
// catalog.tsx
import { createCatalog } from '@copilotkit/a2ui-renderer';
import { z } from 'zod';

export const agentDockCatalog = createCatalog(
  {
    metricCard: { description: '显示一个关键指标', props: z.object({ label: z.string(), value: z.number() }) },
    actionButton: { description: '可点击按钮，触发 A2UI action', props: z.object({ label: z.string(), actionName: z.string() }) },
  },
  {
    metricCard: MetricCard,
    actionButton: ActionButton,
  },
  { catalogId: 'agentdock://catalog', includeBasicCatalog: true },
);
```

Provider：

```tsx
<CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint a2ui={{ catalog: agentDockCatalog }}>
  <AgentDockApp />
</CopilotKit>
```

渲染：A2UI Renderer 自动激活（activity message），或用 `useRenderedMessages`/`useRenderActivityMessage` 在 LobeHub 消息区域内嵌入。

Action：官方 renderer 的 `dispatch` 自动走 action bridge；自研后备直接发 run：

```json
{
  "forwardedProps": {
    "action": "a2uiAction",
    "sessionId": "...",
    "fab": "F15B",
    "a2uiAction": {
      "surfaceId": "surface-1",
      "actionName": "approve_plan",
      "context": { "planId": "plan-1" },
      "sourceComponentId": "approve-button"
    }
  },
  "threadId": "...",
  "runId": "<new uuid>",
  "parentRunId": "<产生 surface 的 runId>"
}
```

### 3.2 Runtime / App Server

- 启用 A2UI middleware：`CopilotRuntime({ agents, a2ui: {} })`（动态 schema 联调时按需 `injectA2UITool: true`）。
- Catalog definitions 由 Provider 经 `/info` 与 agent context 到达 Core（`CopilotKitMiddleware` 需要）。
- Runtime middleware 解析 `render_a2ui` 流式参数并转成 `a2ui-surface` activity；Orchestration 不解析、不合并 `TOOL_CALL_ARGS`。

### 3.3 Core（DeepAgents + CopilotKitMiddleware）

- FastAPI 挂载 `ag-ui-langgraph` AG-UI endpoint。
- `CopilotKitMiddleware` 提供 `generate_a2ui` 能力（动态 schema）或接受 `a2ui_operations`（固定 schema）。
- Agent 在合适时机输出 A2UI 组件，例如：

```jsonl
{"type":"TOOL_CALL_START","toolCallId":"a2ui-tool-001","toolCallName":"render_a2ui"}
{"type":"TOOL_CALL_ARGS","toolCallId":"a2ui-tool-001","delta":"{\"surfaceId\":\"surface-1\",\"catalogId\":\"agentdock://catalog\","}
{"type":"TOOL_CALL_ARGS","toolCallId":"a2ui-tool-001","delta":"\"components\":[...],\"data\":{...}}"}
{"type":"TOOL_CALL_END","toolCallId":"a2ui-tool-001"}
```

### 3.4 Mock 数据升级（本地可先做）

把 `src/mock-data/agentRuntime.ts` 的 surface activity 改为与目标 catalog 匹配的组件 JSON（`metricCard` / `actionButton`），并补充一条 `updateDataModel` 增量事件，使前端 renderer 在无后端时也能端到端验证。

## 4. 验收

- 输入“请用卡片形式展示三个测试指标”后，页面出现真实组件（非 raw JSON）。
- 点击按钮后新 run 发出，携带正确 `surfaceId/actionName/context/parentRunId`。
- 文本消息与 Surface 同时存在，且顺序正确。
- Surface 更新事件到达后组件数据变化。
- 未知组件不白屏（fallback 卡片 + 日志）。
