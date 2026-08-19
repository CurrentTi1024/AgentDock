import { LOBE_TASK_ROLES, type RuntimeMessage, type RuntimeRunState, type StreamedEvent } from './types.ts';
export const createRunState = (runId: string, threadId: string): RuntimeRunState => ({ activities: {}, messages: {}, orderedBlocks: [], processedStreamIds: [], rawEvents: [], reasoning: {}, reasoningMeta: {}, runId, state: {}, status: 'idle', steps: {}, surfaces: {}, threadId, toolCalls: {} });
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
  if (input.streamId && previous.processedStreamIds.includes(input.streamId)) return previous;
  const next = structuredClone(previous); const event = input.event; const id = String(event.messageId || ''); const toolId = String(event.toolCallId || ''); next.rawEvents.push(event); if (next.rawEvents.length > 1000) next.rawEvents.shift();
  if (input.streamId) { next.latestStreamId = input.streamId; next.processedStreamIds.push(input.streamId); if (next.processedStreamIds.length > 5000) next.processedStreamIds.shift(); }
  switch (event.type) {
    case 'RUN_STARTED': next.status = 'running'; break;
    case 'RUN_FINISHED': next.status = 'success'; break;
    case 'RUN_ERROR': next.status = event.code === 'CANCELLED' ? 'cancelled' : 'error'; next.error = { code: String(event.code || ''), message: String(event.message || 'Run failed') }; break;
    case 'TEXT_MESSAGE_START': next.messages[id] = { id, role: String(event.role || 'assistant') as RuntimeMessage['role'], content: '', streamId: input.streamId }; break;
    case 'TEXT_MESSAGE_CONTENT': next.messages[id] ||= { id, role: 'assistant', content: '' }; next.messages[id].content += String(event.delta || ''); if (input.streamId) next.messages[id].streamId = input.streamId; break;
    case 'TEXT_MESSAGE_CHUNK': next.messages[id] ||= { id, role: 'assistant', content: '' }; next.messages[id].content += String(event.delta || event.content || ''); if (input.streamId) next.messages[id].streamId = input.streamId; break;
    case 'TEXT_MESSAGE_END': if (input.streamId && next.messages[id]) next.messages[id].streamId = input.streamId; break;
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
      for (const message of (event.messages as RuntimeMessage[] || [])) {
        // LobeHub 任务/编排类消息（task/tasks/groupTasks/supervisor/assistantGroup）投影为 activity 卡片，
        // 不进入普通 text 消息列表，避免污染 answer/currentUserMessage 的渲染。
        const activityType = taskRoleToActivityType(String(message.role || ''));
        if (activityType) {
          next.activities[message.id] = { activityType, content: message.content, messageId: message.id };
          pushOrderedBlock(next, 'activity', message.id);
          continue;
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
