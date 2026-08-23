import { LOBE_TASK_ROLES, type RuntimeMessage, type RuntimeRunState, type StreamedEvent } from './types.ts';
export const createRunState = (runId: string, threadId: string): RuntimeRunState => ({ activities: {}, messageOrder: [], messages: {}, orderedBlocks: [], processedEventIds: [], rawEvents: [], reasoning: {}, reasoningMeta: {}, runId, state: {}, status: 'idle', steps: {}, surfaces: {}, threadId, toolCalls: {} });
/** 消息首次出现时追加到时间线（幂等）；持久化依赖 messageOrder 分配稳定序号。 */
const appendMessageId = (next: RuntimeRunState, id: string) => {
  if (id && !next.messageOrder.includes(id)) next.messageOrder.push(id);
};
const pushOrderedBlock = (next: RuntimeRunState, kind: RuntimeRunState['orderedBlocks'][number]['kind'], id: string) => {
  const key = `${kind}:${id}`;
  if (!next.orderedBlocks.some((block) => `${block.kind}:${block.id}` === key)) next.orderedBlocks.push({ id, kind });
};
/** 公司自定义活动类型：直接投影为 LobeHub activity 卡片。 */
const AGENT_DOCK_ACTIVITY_TYPES = new Set([
  'agentDock.agentDelegation',
  'agentDock.assistantGroup',
  'agentDock.groupTasks',
  'agentDock.supervisor',
  'agentDock.task',
  'agentDock.tasks',
]);
/** MESSAGES_SNAPSHOT 中的 LobeHub 任务类角色 → 对应 activityType。 */
const taskRoleToActivityType = (role: string): string | undefined =>
  LOBE_TASK_ROLES.includes(role as (typeof LOBE_TASK_ROLES)[number]) ? `agentDock.${role}` : undefined;
const applyStateDelta = (state: unknown, delta: unknown) => {
  if (!Array.isArray(delta) || typeof state !== 'object' || !state) return state;
  const next = structuredClone(state) as Record<string, unknown>;
  for (const operation of delta) {
    if (!operation || typeof operation !== 'object') continue;
    const { op, path, value } = operation as { op?: string; path?: string; value?: unknown };
    const key = path?.replace(/^\//, '');
    if (!key || key.includes('/')) continue;
    if (op === 'remove') delete next[key];
    if (op === 'add' || op === 'replace') next[key] = value;
  }
  return next;
};
export function reduceRunEvent(previous: RuntimeRunState, input: StreamedEvent): RuntimeRunState {
  if (input.eventId && previous.processedEventIds.includes(input.eventId)) return previous;
  const next = structuredClone(previous); const event = input.event; const id = String(event.messageId || ''); const toolId = String(event.toolCallId || ''); next.rawEvents.push(event); if (next.rawEvents.length > 1000) next.rawEvents.shift();
  if (input.eventId) { next.latestEventId = input.eventId; next.processedEventIds.push(input.eventId); if (next.processedEventIds.length > 5000) next.processedEventIds.shift(); }
  switch (event.type) {
    case 'RUN_STARTED': next.status = 'running'; break;
    case 'RUN_FINISHED': next.status = 'success'; break;
    case 'RUN_ERROR': next.status = event.code === 'CANCELLED' ? 'cancelled' : 'error'; next.error = { code: String(event.code || ''), message: String(event.message || 'Run failed') }; break;
    case 'TEXT_MESSAGE_START': next.messages[id] = { id, role: String(event.role || 'assistant') as RuntimeMessage['role'], content: '', eventId: input.eventId }; appendMessageId(next, id); break;
    case 'TEXT_MESSAGE_CONTENT': next.messages[id] ||= { id, role: 'assistant', content: '' }; appendMessageId(next, id); next.messages[id].content += String(event.delta || ''); if (input.eventId) next.messages[id].eventId = input.eventId; break;
    case 'TEXT_MESSAGE_CHUNK': next.messages[id] ||= { id, role: 'assistant', content: '' }; appendMessageId(next, id); next.messages[id].content += String(event.delta || event.content || ''); if (input.eventId) next.messages[id].eventId = input.eventId; break;
    case 'TEXT_MESSAGE_END': if (input.eventId && next.messages[id]) next.messages[id].eventId = input.eventId; break;
    case 'REASONING_START': next.reasoningMeta[id] = { ...next.reasoningMeta[id], startedAt: Date.now(), streaming: true }; break;
    case 'REASONING_MESSAGE_START': next.reasoning[id] = ''; next.reasoningMeta[id] = { ...next.reasoningMeta[id], startedAt: Date.now(), streaming: true }; pushOrderedBlock(next, 'reasoning', id); break;
    case 'REASONING_MESSAGE_CONTENT': next.reasoning[id] = (next.reasoning[id] || '') + String(event.delta || ''); next.reasoningMeta[id] = { ...next.reasoningMeta[id], startedAt: next.reasoningMeta[id]?.startedAt ?? Date.now(), streaming: true }; break;
    case 'REASONING_MESSAGE_CHUNK': next.reasoning[id] = (next.reasoning[id] || '') + String(event.delta || ''); next.reasoningMeta[id] = { ...next.reasoningMeta[id], streaming: true }; break;
    case 'REASONING_MESSAGE_END': next.reasoningMeta[id] = { ...next.reasoningMeta[id], finishedAt: Date.now(), streaming: false }; break;
    case 'REASONING_END': {
      const targetId = id || Object.keys(next.reasoning).at(-1) || '';
      if (targetId) next.reasoningMeta[targetId] = { ...next.reasoningMeta[targetId], finishedAt: Date.now(), streaming: false };
      break;
    }
    case 'REASONING_ENCRYPTED_VALUE': next.reasoningMeta[id] = { ...next.reasoningMeta[id], encrypted: true }; break;
    case 'STEP_STARTED': {
      const stepId = String(event.stepId || event.stepName || event.messageId || `step-${Date.now()}`);
      next.steps[stepId] = { id: stepId, name: String(event.stepName || ''), status: 'running', startedAt: Date.now() }; pushOrderedBlock(next, 'step', stepId);
      break;
    }
    case 'STEP_FINISHED': {
      const stepId = String(event.stepId || event.stepName || event.messageId || Object.keys(next.steps).at(-1) || `step-${Date.now()}`);
      const existing = next.steps[stepId];
      next.steps[stepId] = { ...(existing ?? { id: stepId, name: String(event.stepName || ''), status: 'running' }), finishedAt: Date.now(), status: event.error || event.status === 'error' ? 'error' : 'completed' };
      break;
    }
    case 'TOOL_CALL_START': next.toolCalls[toolId] = { apiName: String(event.apiName || event.toolCallName || ''), args: '', name: String(event.toolCallName || ''), startedAt: Date.now(), status: 'running' }; pushOrderedBlock(next, 'tool', toolId); break;
    case 'TOOL_CALL_ARGS': next.toolCalls[toolId] ||= { args: '', startedAt: Date.now(), status: 'running' }; next.toolCalls[toolId].args += String(event.delta || ''); break;
    case 'TOOL_CALL_END': if (next.toolCalls[toolId]) { next.toolCalls[toolId].status = 'called'; next.toolCalls[toolId].finishedAt = next.toolCalls[toolId].finishedAt ?? Date.now(); next.toolCalls[toolId].apiName ||= String(event.apiName || event.toolCallName || next.toolCalls[toolId].name || ''); } break;
    case 'TOOL_CALL_RESULT': next.toolCalls[toolId] ||= { args: '', startedAt: Date.now(), status: 'completed' }; next.toolCalls[toolId].result = event.content ?? event.result; next.toolCalls[toolId].status = 'completed'; next.toolCalls[toolId].finishedAt = Date.now(); next.toolCalls[toolId].resultMsgId = String(event.result_msg_id || event.resultMsgId || ''); next.toolCalls[toolId].apiName ||= String(event.apiName || event.toolCallName || next.toolCalls[toolId].name || ''); break;
    case 'STATE_SNAPSHOT': next.state = event.snapshot ?? event.state; break;
    case 'STATE_DELTA': next.state = applyStateDelta(next.state, event.delta); break;
    case 'MESSAGES_SNAPSHOT': {
      const snapshotMessages = (event.messages as RuntimeMessage[] || []);
      // 协议快照是整段会话的权威顺序：时间线按快照数组重建，本地先插入但快照未覆盖的消息追加在末尾。
      next.messageOrder = snapshotMessages.map((message) => message.id).filter(Boolean);
      for (const messageId of Object.keys(next.messages)) {
        if (!next.messageOrder.includes(messageId)) next.messageOrder.push(messageId);
      }
      for (const message of snapshotMessages) {
        // LobeHub 任务/编排类消息（task/tasks/groupTasks/supervisor/assistantGroup）投影为 activity 卡片，
        // 不进入普通 text 消息列表，避免污染 answer/currentUserMessage 的渲染。
        const activityType = taskRoleToActivityType(String(message.role || ''));
        if (activityType) {
          next.activities[message.id] = { activityType, content: message.content, messageId: message.id };
          pushOrderedBlock(next, 'activity', message.id);
          continue;
        }
        // 只投影用户与助手文本消息。system/developer/tool 等上下文消息
        // （例如 runtime 注入的 A2UI catalog “App Context”）不得渲染为可见对话消息。
        if (message.role !== 'user' && message.role !== 'assistant') continue;
        // 跳过 CopilotKit/checkpoint 内部重复消息（lc_run--<langgraph run id>）：
        // 流式 TEXT 事件用 lc_run-- 占位 id，快照带规范 UUID；保留内部 id 会导致历史重复。
        if (String(message.id).startsWith('lc_run--')) continue;
        // 快照到达时用规范 UUID 替换流式阶段产生的 lc_run-- 占位消息（按角色匹配，
        // 不要求内容相等——快照可能先于流式完成到达，此时占位内容只是部分文本）。
        // 保证同一回复只有一个规范 id，避免“我”+全文两个气泡。
        if (message.role === 'assistant') {
          const placeholderId = Object.keys(next.messages).find(
            (existingId) =>
              existingId.startsWith('lc_run--') &&
              next.messages[existingId].role === 'assistant',
          );
          if (placeholderId) {
            delete next.messages[placeholderId];
            next.messageOrder = next.messageOrder.filter((id) => id !== placeholderId);
          }
        }
        next.messages[message.id] = message;
      }
      break;
    }
    case 'ACTIVITY_SNAPSHOT': {
      const activityType = String(event.activityType || '');
      // 活动内容与 activityType 合并存储：渲染层（renderRunBlocks）需要从活动对象读取类型。
      next.activities[id] = { ...((event.content && typeof event.content === 'object') ? event.content as Record<string, unknown> : { description: event.content }), activityType, messageId: id };
      pushOrderedBlock(next, 'activity', id);
      if (activityType === 'agentDock.hitl') next.status = 'paused';
      if (activityType === 'a2ui.surface' || activityType === 'a2ui-surface') {
        const surfaceId = String(event.surfaceId || id);
        next.surfaces[surfaceId] = event.content;
        pushOrderedBlock(next, 'surface', surfaceId);
      }
      break;
    }
    case 'ACTIVITY_DELTA': next.activities[id] = { ...(next.activities[id] as object || {}), ...(event.patch as object || event.delta as object || {}) }; pushOrderedBlock(next, 'activity', id); break;
    case 'CUSTOM_EVENT': {
      const name = String(event.name || '');
      const value = event.value;
      if (name === 'on_interrupt') {
        // legacy HITL wire：CustomEvent(name=on_interrupt) → agentDock.hitl 暂停块
        const interruptValue = (typeof value === 'object' && value ? value : {}) as { id?: string; message?: string };
        const requestId = String(interruptValue.id || `hitl-${Date.now()}`);
        const activityId = `hitl-${requestId}`;
        next.activities[activityId] = { activityType: 'agentDock.hitl', description: interruptValue.message, messageId: activityId, requestId };
        next.status = 'paused';
        pushOrderedBlock(next, 'activity', activityId);
      } else if (AGENT_DOCK_ACTIVITY_TYPES.has(name)) {
        const activityId = String(event.messageId || event.id || `custom-${Date.now()}-${next.rawEvents.length}`);
        next.activities[activityId] = {
          ...(typeof value === 'object' && value ? (value as Record<string, unknown>) : {}),
          activityType: name,
          description: typeof value === 'string' ? value : (typeof value === 'object' && value && 'description' in value ? String((value as { description?: unknown }).description ?? '') : ''),
          messageId: activityId,
        };
        pushOrderedBlock(next, 'activity', activityId);
      }
      break;
    }
  }
  if (event.type === 'TOOL_CALL_END' && next.toolCalls[toolId]?.name === 'render_a2ui') {
    try { const payload = JSON.parse(next.toolCalls[toolId].args) as { surfaceId?: string; [key: string]: unknown }; const surfaceId = payload.surfaceId || toolId; next.surfaces[surfaceId] = payload; pushOrderedBlock(next, 'surface', surfaceId); } catch { /* retain malformed arguments for diagnostics */ }
  }
  return next;
}
