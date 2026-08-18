# AG-UI/A2UI → LobeHub 渲染适配层方案（投影层，不做事件协议 Adapter）

> 状态：决策定稿（2026-08-18，基于本仓库完整代码 + `/private/tmp/lobehub-canary` 源码逐文件核实）
> 回答的问题：页面组件基本来自 LobeHub，尤其 Chat 相关组件，是否要做 “AG-UI <---> LobeHub event” 的 adapter 层？

## 1. 结论先行

**不需要“AG-UI 事件协议 → LobeHub 事件协议”的 wire-level adapter。**

LobeHub 并没有一套独立的“事件协议”挂在组件上。我们在 canary 源码中逐文件核实到的绑定关系是：

```text
LobeHub 展示组件（ChatItem / Assistant / AssistantGroup / Tool / Reasoning …）
  └─ 读 useConversationStore(dataSelectors.getDisplayMessageById(id))
       └─ 消费的是 UIChatMessage / AssistantContentBlock / ChatToolPayloadWithResult / ModelReasoning
            └─ 这些是 LobeHub 的「视图模型（ViewModel）」，不是网络事件协议
```

AG-UI 是浏览器 ↔ Runtime ↔ Orchestration 的**网络事件协议**；LobeHub 的 `useConversationStore` 是**应用内状态**。两者不是同一层，不存在互相翻译的接口。

所以成熟方案是：

```text
AG-UI / A2UI 事件（wire protocol）
        │ CopilotKit 官方 transport 解析（design/08 方案 A）
        ▼
CopilotKit Agent 状态（唯一状态源：messages / state / activities / runs）
        │ AgentDockProjection（纯函数，只做形状映射，无副作用）
        ▼
AgentDock LobeHub ViewModel（UIChatMessage 子集 + AssistantContentBlock 子集 + …）
        │ props 传递（LobeHub 组件被“props 化”，去掉 store 依赖）
        ▼
LobeHub 风格展示组件（ChatItem / Reasoning / Tool Inspector / Workflow / HITL / A2UI）
```

这个方案里唯一需要“适配”的是**数据形状**（AG-UI message/event → LobeHub 组件期望的 props），以及把 LobeHub 组件的 **store 依赖替换成 props 依赖**。这两件事合称 **投影层（Projection Layer）**，它不是事件 Adapter。

## 2. 代码事实核实（逐文件）

以下结论均来自 `/private/tmp/lobehub-canary` 与 `src/` 实际代码，不是推测。

### 2.1 LobeHub ChatItem 是展示组件，但被 store 包装

`src/features/Conversation/ChatItem/type.ts`：

```ts
export interface ChatItemProps extends Omit<FlexboxProps, 'children' | 'onChange'> {
  avatar: MetaData;
  message?: ReactNode;
  loading?: boolean;
  actions?: ReactNode;
  time?: number;
  placement?: 'left' | 'right';
  // …纯展示字段
}
```

组件本身不订阅协议，但上游 `Messages/Assistant/index.tsx` 这样喂数据：

```tsx
const item = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual)!;
const { agentId, content, createdAt, tools, extra, model, provider, performance, usage, metadata } = item;
…
<ChatItem
  avatar={avatar}
  loading={generating || isCreating}
  message={message}
  time={createdAt}
  messageExtra={<>…</>}
>
  <MessageContent {...item} />
</ChatItem>
```

结论：`ChatItem` 的 props 是稳定的展示契约；要接入 AG-UI，只需要把 `item`（`UIChatMessage`）替换成投影层产出的同形状对象。

### 2.2 AssistantGroup 消费 `AssistantContentBlock`

`Messages/AssistantGroup/components/ContentBlock.tsx` 接收：

```tsx
interface ContentBlockProps extends RenderableAssistantContentBlock {
  assistantId: string;
  disableEditing?: boolean;
}
// 使用字段：content / tools / imageList / reasoning / error / domId / contentOverride
```

`RenderableAssistantContentBlock` 来自 `AssistantGroupSemanticBlock`，核心字段是 `content / reasoning / tools / tasks / metadata`（见 `packages/types/src/message/ui/chat.ts` 的 `AssistantContentBlock`）。

也就是说：**LobeHub 的“一条助手消息”= 一个 content block（正文 + 可选 reasoning + 可选 tools）**。AG-UI 的 `TEXT_MESSAGE_* / REASONING_MESSAGE_* / TOOL_CALL_*` 事件正好可以投影成这个形状。

### 2.3 Tool 组件消费 `ChatToolPayloadWithResult`

`Messages/AssistantGroup/Tool/index.tsx`：

```tsx
const tool = useConversationStore(dataSelectors.getToolInBlock(assistantMessageId, id), isEqual);
const { apiName, identifier, arguments: requestArgs, intervention, result, type, result_msg_id } = tool ?? {};
```

然后传给 `Inspectors / Detail / Debug / Intervention`。AG-UI 的 `TOOL_CALL_START / TOOL_CALL_ARGS / TOOL_CALL_END / TOOL_CALL_RESULT` 可以按这四个字段投影，`result` 流式挂载后即完成一个工具卡片。

### 2.4 Reasoning 组件消费 `ModelReasoning`

`Messages/components/Reasoning.tsx`：

```tsx
interface ReasoningProps {
  content?: string;
  duration?: number;
  id: string;
  isMultimodal?: boolean;
  tempDisplayContent?: MessageContentPart[];
}
```

投影层只需提供 `content + duration + isMultimodal`，渲染由 LobeHub 的 `Thinking` 完成。当前 AgentDock 的 `ReasoningBlock` 是它的简化版，视觉上缺 `Thinking` 的动画/折叠样式，P0 补齐。

### 2.5 HITL / Intervention 消费 `PendingIntervention`

`InterventionBar/index.tsx`：

```tsx
interface InterventionBarProps {
  interventions: PendingIntervention[];
}
// PendingIntervention 含 toolCallId / apiName / identifier / requestArgs / assistantGroupId / toolMessageId
```

AG-UI 的 HITL（无论 legacy `CustomEvent(on_interrupt)` 还是标准 `outcome.interrupts`）投影成 `PendingIntervention[]` 即可复用 LobeHub 的 Intervention 全部模式（approve / reject / edit / input / select / form）。

### 2.6 Markdown 是渲染管线，不是事件协议

`Messages/Assistant/useMarkdown.tsx` 等使用 `react-markdown` + 插件（Thinking / Tool / Task / UserFeedback / Link / LobeArtifact / LobeAgents / Mention / Skill / LocalFile）。这是**纯前端渲染管线**，与 AG-UI 无关，可以直接按需移植。

## 3. 为什么不能直接把 CopilotKit 状态塞给 LobeHub 组件

CopilotKit 的 `agent.messages` 是扁平 `{id, role, content}`（AG-UI messages 模型），而 LobeHub 组件期望：

| LobeHub 组件 | 期望形状 | CopilotKit 原生有没有 |
|---|---|---|
| `ChatItem` | `UIChatMessage`（content/createdAt/error/metadata…） | 部分：content/role，缺 createdAt/metadata |
| `AssistantGroup/ContentBlock` | `AssistantContentBlock`（content + reasoning + tools + tasks） | 缺：一个消息内“正文/思考/工具”分组 |
| `Tool` | `ChatToolPayloadWithResult`（arguments/result/intervention） | 缺：聚合后的 tool 卡片对象（AG-UI 是流式事件） |
| `Reasoning` | `ModelReasoning`（content/duration） | 缺：流式聚合 |
| `InterventionBar` | `PendingIntervention[]` | 缺：官方 hooks 暴露 interrupt 状态，形状不同 |
| A2UI | `renderActivityMessage` 渲染结果 | 有：官方 renderer 直接消费 |

所以必须有一个**纯函数投影层**把官方状态/事件聚合成 LobeHub 形状，这就是用户问的“adapter 层”的正确形态。

## 4. 投影层设计

### 4.1 类型定义（目标 ViewModel，LobeHub 子集）

```ts
// src/features/chat/projection/types.ts
export interface AgentDockReasoning extends ModelReasoning {
  content: string;
  duration?: number;
  streaming?: boolean;   // REASONING_MESSAGE_* 进行中
}

export interface AgentDockToolCall {
  id: string;                    // toolCallId
  apiName: string;               // 或 name
  identifier?: string;
  arguments: string;             // 流式拼接的 JSON
  result?: unknown;              // TOOL_CALL_RESULT
  status: 'running' | 'called' | 'completed' | 'error';
  intervention?: PendingIntervention; // HITL
  startedAt?: number;
  finishedAt?: number;
}

export interface AgentDockAssistantBlock {
  id: string;
  content: string;               // TEXT_MESSAGE_* 聚合
  reasoning?: AgentDockReasoning;
  tools?: AgentDockToolCall[];
  steps?: AgentDockStep[];       // STEP_STARTED/FINISHED → Workflow 渲染
  error?: { code?: string; message: string } | null;
  createdAt: number;
}

export interface AgentDockStep {
  id: string;                    // STEP_STARTED stepId
  name?: string;
  status: 'running' | 'completed' | 'error';
  startedAt?: number;
  finishedAt?: number;
}

export interface AgentDockHITL {
  requestId: string;
  toolCallId: string;
  apiName: string;
  identifier?: string;
  requestArgs?: string;
  description?: string;
  mode: 'toolAuthorization' | 'editArguments' | 'textInput' | 'singleSelect' | 'multiSelect' | 'form';
}

export interface AgentDockMessage {
  id: string;
  role: 'user' | 'assistant' | 'assistantGroup' | 'task';
  content: string;
  createdAt: number;
  blocks?: AgentDockAssistantBlock[];  // assistantGroup 多条过程块
  error?: AgentDockAssistantBlock['error'];
  model?: string;
  provider?: string;
}

export interface AgentDockProjection {
  messages: AgentDockMessage[];        // 按时间排序的展示列表
  hitls: AgentDockHITL[];              // 待处理 HITL
  surfaces: Record<string, A2UISurfacePayload>; // 官方 renderer 的 surface 状态由 Provider 持有，这里只做索引
  status: RunStatus;
  error?: { code?: string; message: string };
  runId?: string;
  threadId: string;
  latestStreamId?: string;
}
```

### 4.2 投影器（纯函数）

```ts
// src/features/chat/projection/projector.ts
export function projectAgentState(input: {
  agentMessages: AGUI.Message[];       // CopilotKit agent.messages 快照
  agentState: Record<string, unknown>; // CopilotKit agent.state
  events: AgUiEvent[];                 // 最近一轮事件（官方回调采集，可选）
  run: { runId: string; threadId: string; status: RunStatus; error?: {…} };
}): AgentDockProjection;
```

规则：

1. **幂等**：相同输入永远产出相同投影（恢复会话 = 用 IndexedDB 里的快照直接重建，不依赖重放）。
2. **顺序**：`messages` 按 `createdAt`/事件顺序排列；assistantGroup 由同一 run 的多个 text/reasoning/tool 片段按 `messageId` 分组，一个 `run` 的最终 answer 合并成一个 block。
3. **无副作用**：投影器不写 store、不写 IndexedDB、不触发 fetch。持久化由 hook 在订阅回调里单独做。
4. **增量友好**：事件回调把增量事件送入 reducer（当前 `runReducer` 改造为“投影 reducer”：输入增量事件 + 旧投影，输出新投影），全量快照（`MESSAGES_SNAPSHOT`）则直接重建。
5. **不吞未知字段**：未知事件进 `rawEvents`（诊断），不阻塞渲染。

### 4.3 Hook 接入点

```ts
// src/features/chat/useAgentDockConversation.ts
const agent = useAgent({ agentId: 'orchestration', threadId });

const projection = useProjectAgentState(agent);   // 订阅 agent.messages / agent.state / events

const send = (text: string) =>
  agent.runAgent({ messages: [{ id: uuid(), role: 'user', content: text }], forwardedProps: { … } });
```

组件消费：

```tsx
{projection.messages.map((message) => (
  <AgentDockMessageItem key={message.id} message={message} />  // 内部用 LobeHub ChatItem
))}
```

### 4.4 组件迁移策略（props 化 LobeHub 展示组件）

目标目录：

```text
src/features/chat/
├── projection/
│   ├── types.ts
│   ├── projector.ts
│   └── projector.test.ts
├── components/
│   ├── ChatItem.tsx              # 已迁移，按上游 type.ts 补齐 props
│   ├── Markdown.tsx              # 迁移 react-markdown + 裁剪插件
│   ├── Reasoning.tsx             # 从 ReasoningBlock 升级为 LobeHub Thinking 视觉
│   ├── ToolInspector.tsx         # 迁移 Inspector/Detail 子集
│   ├── WorkflowSteps.tsx         # 迁移 WorkflowCollapse/ProcessFold 子集（STEP）
│   ├── HitlPanel.tsx             # 迁移 InterventionBar/Content 子集
│   ├── A2uiSurface.tsx           # 嵌入官方 renderer
│   ├── MessageBlocks.tsx         # 重组：按 block 类型分发
│   └── MessageItem.tsx           # ChatItem + blocks + Markdown + actions
└── useAgentDockConversation.ts
```

每个被迁移组件遵守两条规则：

1. **props 进、props 出**：删除 `useConversationStore` / `useChatStore` / `useUserStore` 调用；状态选择器（editing / generating / collapsed…）换成组件本地 state 或投影字段。
2. **只读投影**：按钮（复制/点赞/停止/HITL 审批/A2UI action）通过回调 props 交给 hook 层，组件内不直接调协议。

### 4.5 事件 → ViewModel 映射表（完整）

| AG-UI 事件 | 投影结果 |
|---|---|
| `RUN_STARTED` | `projection.status='running'`；记录 `runId` |
| `STEP_STARTED` | `block.steps[id] = { status:'running' }` |
| `STEP_FINISHED` | `block.steps[id].status='completed'`（补 finishedAt） |
| `REASONING_MESSAGE_START` | `block.reasoning = { content:'', streaming:true }` |
| `REASONING_MESSAGE_CONTENT` | `block.reasoning.content += delta` |
| `TOOL_CALL_START` | `block.tools[id] = { arguments:'', status:'running', apiName }` |
| `TOOL_CALL_ARGS` | `block.tools[id].arguments += delta` |
| `TOOL_CALL_END` | `block.tools[id].status='called'`；`render_a2ui` 同时由官方 renderer 接管 |
| `TOOL_CALL_RESULT` | `block.tools[id].result = content/result; status='completed'` |
| `TEXT_MESSAGE_START` | 新建 `AgentDockAssistantBlock`（若同一 run 已存在则复用当前 block） |
| `TEXT_MESSAGE_CONTENT/CHUNK` | `block.content += delta` |
| `TEXT_MESSAGE_END` | 结束当前 block，等待下一条或 run 结束 |
| `STATE_SNAPSHOT / STATE_DELTA` | `agentState`（不渲染，供诊断/恢复） |
| `MESSAGES_SNAPSHOT` | 全量重建 `projection.messages`（恢复会话） |
| `ACTIVITY_SNAPSHOT (a2ui.surface)` | surface 索引；渲染由官方 A2UI renderer 完成 |
| `ACTIVITY_SNAPSHOT (agentDock.hitl)` / interrupt | 投影为 `AgentDockHITL[]` → `HitlPanel` |
| `CUSTOM_EVENT` | 诊断日志 + 按需扩展（Delegation/Task 等公司自定义 activity） |
| `RUN_FINISHED` | `status='success'`；触发快照落盘 |
| `RUN_ERROR` | `status='error'`；`block.error` / message 级错误 |

## 5. A2UI 的归属（不在投影器里）

投影器**不解析 A2UI JSON、不管理 surface 生命周期**。A2UI 由官方 Provider 的 renderer 持有：

```tsx
<CopilotKit
  runtimeUrl="/api/copilotkit"
  useSingleEndpoint
  a2ui={{ catalog: agentDockCatalog }}
  renderActivityMessages={createA2UIMessageRenderer({ theme, onAction: interceptor })}
>
  <AgentDockApp />
</CopilotKit>
```

`AgentDockProjection.surfaces` 只做“这个 run 有哪些 surface”的索引，渲染入口通过 `useRenderActivityMessage()` 嵌入 LobeHub `ChatItem` 的 children：

```tsx
<ChatItem …>
  <Reasoning … />
  <ToolInspector … />
  <WorkflowSteps … />
  {renderActivityMessage(activityMessage)}
</ChatItem>
```

这样 A2UI 的 updateComponents / updateDataModel 增量全部由官方 renderer 消费，不会和投影器产生第二份 surface 状态（design/08 第 4.2 节“单源”约束）。

## 6. 与“LobeHub 自己的 event 协议”的边界澄清

用户担心“组件绑定 LobeHub 自己的 event 协议”。逐层澄清：

| 层 | LobeHub 实际内容 | AgentDock 是否迁移/使用 |
|---|---|---|
| 网络事件协议 | LobeHub 服务端 OpenAI-compatible streamable / artifact / SSE（自研 runtime） | ❌ 不迁移；用 AG-UI 替代 |
| 客户端 store | `useConversationStore`（actions: sendMessage/regenerate/update…） | ❌ 不迁移；用 CopilotKit agent + 投影层替代 |
| 视图模型 | `UIChatMessage / AssistantContentBlock / ChatToolPayloadWithResult / ModelReasoning` | ✅ 迁移“形状”，由投影层产出 |
| 展示组件 | `ChatItem / Messages/* / InterventionBar` | ✅ 迁移 JSX/样式，props 化 |
| 渲染管线 | `react-markdown + plugins` | ✅ 按需迁移 |

所以：

- **不做**：AG-UI wire → LobeHub store action 的 adapter（等于把 AG-UI 事件灌进 `useConversationStore`，会造出双状态源，正是 design/08 要避免的冲突）。
- **要做**：AG-UI → AgentDock ViewModel 的**投影器** + LobeHub 展示组件的 **props 化移植**。

## 7. 验收标准

- [ ] 一条含 reasoning + 2 个工具 + 中间文本 + 最终答案的 run，渲染顺序与 LobeHub 一致（思考折叠 → 工具卡 → 过程文本 → 最终答案）。
- [ ] `TEXT_MESSAGE_*` 流式时正文逐字出现，Markdown 逐段渲染，不整段闪烁。
- [ ] `TOOL_CALL_ARGS` 流式时工具卡 arguments 实时拼接，`TOOL_CALL_RESULT` 后显示结果与耗时。
- [ ] `STEP_STARTED/FINISHED` 驱动 Workflow 步骤折叠/展开，状态正确。
- [ ] HITL 所有 mode（approve/reject/edit/input/select/form）在 `HitlPanel` 可操作，requestId 正确回传。
- [ ] A2UI surface 由官方 renderer 渲染组件（非 raw JSON），action 通过 interceptor 转发或本地处理。
- [ ] 刷新恢复：IndexedDB 快照 → `MESSAGES_SNAPSHOT`/投影重建，UI 与中断前一致，无重复拼接。
- [ ] 投影器单测：给定固定 AG-UI 事件序列，输出 ViewModel 快照稳定（幂等）；恢复输入与实时输入产出相同结构。

## 8. 关联文档

- `design/08-final-architecture-decision.md`：状态单源（CopilotKit Agent）与整体拓扑，本文是它的渲染侧落地细节。
- `design/05-lobehub-rendering-matrix.md`：每个信息粒度的缺口清单，本文给出补法。
- `design/06-copilotkit-integration-plan.md`：官方依赖接入与迁移路径。
- `design/03-a2ui-pipeline.md`：A2UI catalog/renderer/action 细节。
- `01-end-to-end-runtime-link.md`：ID 语义与 FAB 路由。

## 9. 已落地代码（2026-08-19）

- `src/features/chat/useAgentDockConversation.ts`：双模式对话 hook（mock 走自研 SSE/reducer，http 走官方 `useAgent` + `useCopilotKit`），事件经 `agent.subscribe` 投影为 `RuntimeRunState`。
- `src/features/chat/a2ui/catalog.tsx`：`createCatalog` 定义 `metricCard / actionButton` + LobeHub 风格渲染器，Provider `a2ui={{ catalog }}` 启用官方 renderer。
- `src/app/providers.tsx`：`<CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint a2ui={{ catalog }}>`。
- `src/features/chat/components/Markdown.tsx`、`WorkflowStepsBlock`、`ActivityBlock`：LobeHub 风格渲染补齐。
- `src/api/session/sessionHistoryService.ts`：IndexedDB v3，持久化 text/reasoning/tool/activity/step/surface 全部可见消息，打开恢复、清空即空。
- `server/index.ts` + `server/copilot-runtime/fabRoutingAgent.ts`：官方 Copilot Runtime Node 入口，single-route `/api/copilotkit`，`FabRoutingAgent` 按 fab 选择上游。
