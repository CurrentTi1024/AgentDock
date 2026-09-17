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

export interface HitlOption {
  description?: string;
  label: string;
  value: string;
}

interface HitlSpecBase {
  allowSkip?: boolean;
  title?: string;
}

export interface HitlConfirmSpec extends HitlSpecBase {
  allowRevision?: boolean;
  kind: 'confirm';
}

export interface HitlTextSpec extends HitlSpecBase {
  kind: 'text';
  label?: string;
  maxLength?: number;
  multiline?: boolean;
  placeholder?: string;
  required?: boolean;
}

export interface HitlChoiceSpec extends HitlSpecBase {
  allowOther?: boolean;
  kind: 'choice';
  multiple?: boolean;
  options: HitlOption[];
  required?: boolean;
}

export type HitlFormField =
  | {
      kind: 'text' | 'textarea';
      label: string;
      maxLength?: number;
      name: string;
      placeholder?: string;
      required?: boolean;
    }
  | {
      kind: 'number';
      label: string;
      maximum?: number;
      minimum?: number;
      name: string;
      required?: boolean;
    }
  | {
      allowOther?: boolean;
      kind: 'choice';
      label: string;
      multiple?: boolean;
      name: string;
      options: HitlOption[];
      required?: boolean;
    }
  | {
      kind: 'date' | 'datetime';
      label: string;
      name: string;
      required?: boolean;
    };

export interface HitlFormSpec extends HitlSpecBase {
  fields: HitlFormField[];
  kind: 'form';
}

export type HitlSpec = HitlChoiceSpec | HitlConfirmSpec | HitlFormSpec | HitlTextSpec;

export interface HitlInterrupt {
  expiresAt?: string;
  fallback?: boolean;
  id: string;
  message: string;
  reason: 'human_input_required';
  spec: HitlSpec;
}

export interface HitlChoiceAnswer {
  other?: string;
  selected: string[];
}

export type HitlAnswer =
  | HitlChoiceAnswer
  | Record<string, HitlChoiceAnswer | number | string>
  | string;

export interface HitlResumePayload {
  action: 'continue' | 'revise' | 'skip' | 'submit';
  answer?: HitlAnswer;
}

export type HitlResumeEntry =
  | { interruptId: string; payload: HitlResumePayload; status: 'resolved' }
  | { interruptId: string; status: 'cancelled' };

export interface RunAgentInput {
  context: unknown[]; messages: RuntimeMessage[]; parentRunId?: string; runId: string; state: unknown; threadId: string; tools: unknown[];
  forwardedProps: { action: RunAction; agentId?: string; fab: string; sessionId: string; group?: AgentGroupInput; mentionAgents?: MentionAgentRef[]; resume?: { lastEventId: string }; hitlResponse?: { requestId: string; mode: string; decision?: 'approve' | 'reject'; editedArguments?: Record<string, unknown>; input?: string; selectedValues?: string[]; formValues?: Record<string, unknown> }; a2uiAction?: { actionName: string; context?: Record<string, unknown>; sourceComponentId?: string; surfaceId: string } };
  /** AG-UI 标准 HITL 恢复数据。仅 checkpoint/恢复路径保存；发送时原样交给 CopilotKit runAgent。 */
  resume?: HitlResumeEntry[];
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
  /** 最近一次 MESSAGES_SNAPSHOT 投影的消息 id；仅用于下一份权威快照的有界替换。 */
  snapshotMessageIds?: string[];
  state: unknown;
  status: RunStatus;
  steps: Record<string, RuntimeStep>;
  surfaces: Record<string, unknown>;
  threadId: string;
  toolCalls: Record<string, RuntimeToolCall>;
}
