export type RunAction = 'a2uiAction' | 'hitlResponse' | 'resume' | 'run' | 'stop';
/** LobeHub Conversation/Messages 当前支持的全部可见消息角色。 */
export type LobeVisibleMessageRole =
  | 'agentCouncil'
  | 'assistant'
  | 'assistantGroup'
  | 'compressedGroup'
  | 'groupTasks'
  | 'supervisor'
  | 'task'
  | 'taskCallback'
  | 'tasks'
  | 'tool'
  | 'user'
  | 'verify';
export const LOBE_VISIBLE_MESSAGE_ROLES: readonly LobeVisibleMessageRole[] = [
  'user',
  'assistant',
  'assistantGroup',
  'supervisor',
  'task',
  'tasks',
  'groupTasks',
  'agentCouncil',
  'compressedGroup',
  'tool',
  'verify',
  'taskCallback',
];
export type RuntimeMessageRole = LobeVisibleMessageRole | 'developer' | 'system';
/**
 * AG-UI 标准字段之外保留 LobeHub 消息的 children/tasks/members/metadata/taskDetail 等字段。
 * 这些字段是展示 ViewModel，不参与 wire 协议判断，但必须原样穿过快照与 IndexedDB。
 */
export interface RuntimeMessage {
  content: string;
  createdAt?: number | string;
  eventId?: string;
  id: string;
  role: RuntimeMessageRole;
  runId?: string;
  [key: string]: unknown;
}
/** LobeHub 任务/编排类消息角色（兼容旧 activity 投影）。 */
export type LobeTaskRole = 'assistantGroup' | 'groupTasks' | 'supervisor' | 'task' | 'tasks';
export const LOBE_TASK_ROLES: readonly LobeTaskRole[] = ['assistantGroup', 'groupTasks', 'supervisor', 'task', 'tasks'];
export interface AgentGroupInput { config?: Record<string, unknown>; members: Array<{ agentId: string; fab: string; version?: string }>; orchestrationMode: string }
/** 用户在本轮消息中 @ 提及的 Agent（对齐 LobeHub mentionedAgents：后端据此启用 callAgent 委派）。 */
export interface MentionAgentRef {
  agentId: string;
  fab: string;
  agentName?: string;
  version?: string;
}
export interface RunAgentInput {
  context: unknown[]; messages: RuntimeMessage[]; parentRunId?: string; runId: string; state: unknown; threadId: string; tools: unknown[];
  forwardedProps: { action: RunAction; agentId?: string; fab: string; sessionId: string; group?: AgentGroupInput; mentionAgents?: MentionAgentRef[]; resume?: { lastEventId: string }; hitlResponse?: { requestId: string; mode: string; decision?: 'approve' | 'reject'; editedArguments?: Record<string, unknown>; input?: string; selectedValues?: string[]; formValues?: Record<string, unknown> }; a2uiAction?: { actionName: string; context?: Record<string, unknown>; sourceComponentId?: string; surfaceId: string } };
}
export interface AgUiEvent { type: string; eventId?: string; rawEvent?: { runId?: string }; [key: string]: unknown }
export interface StreamedEvent { event: AgUiEvent; eventId?: string }
export type RunStatus = 'cancelled' | 'error' | 'idle' | 'paused' | 'running' | 'success';
export type RuntimeBlockKind = 'activity' | 'error' | 'reasoning' | 'step' | 'surface' | 'text' | 'tool';
export interface RuntimeBlockRef { id: string; kind: RuntimeBlockKind }
export interface RuntimeStep { finishedAt?: number; id: string; name?: string; startedAt?: number; status: 'completed' | 'error' | 'running' }
/** Reasoning 元信息：流式状态与耗时（LobeHub Thinking 需要 streaming/duration）。 */
export interface RuntimeReasoningMeta {
  encrypted?: boolean;
  finishedAt?: number;
  startedAt?: number;
  streaming?: boolean;
}
/** Tool Call 视图模型：LobeHub ChatToolPayloadWithResult 子集 + 耗时。 */
export interface RuntimeToolCall {
  apiName?: string;
  args: string;
  finishedAt?: number;
  name?: string;
  result?: unknown;
  resultMsgId?: string;
  startedAt?: number;
  status: 'called' | 'completed' | 'error' | 'running';
}
export interface RuntimeRunState {
  activities: Record<string, unknown>;
  error?: { code?: string; message: string };
  latestEventId?: string;
  /** 消息时间线顺序（LobeHub 以 createdAt 排序的本地等价物）：
   *  由协议权威顺序（MESSAGES_SNAPSHOT 数组）驱动，新消息按首次出现追加；
   *  持久化按此顺序分配 sequence，杜绝快照 map 迭代序/落库时序导致的错乱。 */
  messageOrder: string[];
  messages: Record<string, RuntimeMessage>;
  orderedBlocks: RuntimeBlockRef[];
  processedEventIds: string[];
  rawEvents: AgUiEvent[];
  reasoning: Record<string, string>;
  reasoningMeta: Record<string, RuntimeReasoningMeta>;
  runId: string;
  state: unknown;
  status: RunStatus;
  steps: Record<string, RuntimeStep>;
  surfaces: Record<string, unknown>;
  threadId: string;
  toolCalls: Record<string, RuntimeToolCall>;
}
