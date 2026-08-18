# A2UI 端到端管线设计（现状为伪实现，需 P0 落地）

> 状态：Review 完成，待实现  
> 关联：`docs/agentdock/02-agui-a2ui-runtime-contract.md` 第 9 节

## 1. 官方 A2UI 概念

A2UI 是声明式 UI 格式，AG-UI 是传输层。核心概念：

- **Catalog**：组件定义（Zod schema + 自然语言 description）+ React renderer 映射。传给 CopilotKit Provider 后自动启用 A2UI 并注入 `generate_a2ui` 工具（CopilotKit ≥ 1.61.2）。
- **Built-in catalog**：Text、Image、Card 等，`includeBasicCatalog: true` 可同时保留。
- **BYOC**：`createCatalog` 自定义组件。
- **Surface 生命周期**：`createSurface` → `updateComponents` → `updateDataModel`。
- **固定 schema 模式**：Agent 自持 data-only tool 返回 `a2ui_operations`，runtime 只需 `a2ui: true`。
- **动态 schema 模式**：runtime 注入 `generate_a2ui` 工具 + 次 LLM。
- **Action 回传**：前端 `useA2UIActionHandler` 注册处理器；或发送 AG-UI run 携带 `forwardedProps.a2uiAction`。

后端链路（LangGraph/FastAPI + DeepAgents）：

```text
FastAPI app + CopilotKitMiddleware
  └─ create_deep_agent(...) 挂载 AG-UI endpoint（ag-ui-langgraph）
  └─ CopilotKitMiddleware 接收 catalog，注入 generate_a2ui 工具
  └─ Agent 生成 A2UI 组件 JSON → TOOL_CALL_START/ARGS/END（render_a2ui）
  └─ Runtime middleware 建立 Surface → Activity 事件 → 前端 renderer
```

## 2. 当前 AgentDock 实现（伪实现）

### 2.1 已具备

- Mock stream 会输出 `ACTIVITY_SNAPSHOT (activityType: a2ui.surface, surfaceId, content: { catalogId, components })`。
- reducer 把该 activity 存入 `run.surfaces[surfaceId]`。
- `A2uiSurfaceBlock` 渲染折叠块；按钮调用 `sendA2uiAction`。
- `sendA2uiAction` 生成新 runId + `parentRunId=原runId`，action 走 `forwardedProps.a2uiAction` —— 方向正确。

### 2.2 缺口

| # | 缺口 | 影响 | 优先级 |
|---|---|---|---|
| U1 | 无 catalog 定义与 renderer | Surface 无法按组件渲染，只显示 raw JSON | P0 |
| U2 | 无 `@copilotkit/a2ui-renderer`（或等价自研 renderer） | 无法消费 components/updateDataModel | P0 |
| U3 | Action 硬编码 `open_report` + 固定 context | 无法由 surface 按钮数据驱动 | P0 |
| U4 | 无 `useA2UIActionHandler` | 客户端自定义 action 逻辑缺失 | P0 |
| U5 | 右栏 Artifact 面板静态写死 | 与 surface/artifact 数据无关联 | P1 |
| U6 | 无 `updateComponents/updateDataModel` 增量事件处理 | 长生命周期 surface 无法更新 | P1 |
| U7 | 无固定 schema（a2ui_operations）兼容 | 后端若走固定 schema 无法对接 | P1 |

## 3. 目标实现方案

### 3.1 前端

```tsx
// catalog.tsx
import { createCatalog } from '@copilotkit/a2ui-renderer';

const metricCard = { name: 'metricCard', description: '显示一个关键指标', schema: z.object({ label: z.string(), value: z.number() }) };
const actionButton = { name: 'actionButton', description: '可点击按钮，触发 A2UI action', schema: z.object({ label: z.string(), actionName: z.string() }) };

export const agentDockCatalog = createCatalog({
  catalogId: 'agentdock://catalog',
  includeBasicCatalog: true,
  definitions: [metricCard, actionButton],
  renderers: {
    metricCard: MetricCard,
    actionButton: ActionButton,
  },
});
```

Provider：

```tsx
<CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint a2ui={{ catalog: agentDockCatalog }}>
  <AgentDockApp />
</CopilotKit>
```

渲染：A2UI Renderer 自动激活（activity message），或用 `useRenderedMessages`/`useRenderActivityMessage` 在 LobeHub 消息区域内嵌入。

Action：按钮 onClick → `useA2UIActionHandler` 或直接发 run：

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

- 启用 A2UI middleware（官方 runtime 配置 `a2ui: true` 或 catalog 自动启用）。
- 透传 catalog definitions 到上游（DeepAgents 侧 `CopilotKitMiddleware` 需要）。
- 不解析、不合并 A2UI `TOOL_CALL_ARGS`，保持流式原样。

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
