import type { RuntimeMessage, RuntimeRunState, StreamedEvent } from './types';
export const createRunState = (runId: string, threadId: string): RuntimeRunState => ({ activities: {}, messages: {}, orderedBlocks: [], processedStreamIds: [], rawEvents: [], reasoning: {}, runId, state: {}, status: 'idle', steps: {}, surfaces: {}, threadId, toolCalls: {} });
const pushOrderedBlock = (next: RuntimeRunState, kind: RuntimeRunState['orderedBlocks'][number]['kind'], id: string) => {
  const key = `${kind}:${id}`;
  if (!next.orderedBlocks.some((block) => `${block.kind}:${block.id}` === key)) next.orderedBlocks.push({ id, kind });
};
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
    case 'TEXT_MESSAGE_START': next.messages[id] = { id, role: String(event.role || 'assistant') as RuntimeMessage['role'], content: '' }; break;
    case 'TEXT_MESSAGE_CONTENT': next.messages[id] ||= { id, role: 'assistant', content: '' }; next.messages[id].content += String(event.delta || ''); break;
    case 'TEXT_MESSAGE_CHUNK': next.messages[id] ||= { id, role: 'assistant', content: '' }; next.messages[id].content += String(event.delta || event.content || ''); break;
    case 'REASONING_MESSAGE_START': next.reasoning[id] = ''; pushOrderedBlock(next, 'reasoning', id); break;
    case 'REASONING_MESSAGE_CONTENT': next.reasoning[id] = (next.reasoning[id] || '') + String(event.delta || ''); break;
    case 'REASONING_MESSAGE_CHUNK': next.reasoning[id] = (next.reasoning[id] || '') + String(event.delta || ''); break;
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
    case 'TOOL_CALL_START': next.toolCalls[toolId] = { args: '', name: String(event.toolCallName || ''), status: 'running' }; pushOrderedBlock(next, 'tool', toolId); break;
    case 'TOOL_CALL_ARGS': next.toolCalls[toolId] ||= { args: '', status: 'running' }; next.toolCalls[toolId].args += String(event.delta || ''); break;
    case 'TOOL_CALL_END': if (next.toolCalls[toolId]) next.toolCalls[toolId].status = 'called'; break;
    case 'TOOL_CALL_RESULT': next.toolCalls[toolId] ||= { args: '', status: 'completed' }; next.toolCalls[toolId].result = event.content ?? event.result; next.toolCalls[toolId].status = 'completed'; break;
    case 'STATE_SNAPSHOT': next.state = event.snapshot ?? event.state; break;
    case 'STATE_DELTA': next.state = applyStateDelta(next.state, event.delta); break;
    case 'MESSAGES_SNAPSHOT': for (const message of (event.messages as RuntimeMessage[] || [])) next.messages[message.id] = message; break;
    case 'ACTIVITY_SNAPSHOT': next.activities[id] = event.content; pushOrderedBlock(next, 'activity', id); if (event.activityType === 'agentDock.hitl') next.status = 'paused'; if (event.activityType === 'a2ui.surface' || event.activityType === 'a2ui-surface') { const surfaceId = String(event.surfaceId || id); next.surfaces[surfaceId] = event.content; pushOrderedBlock(next, 'surface', surfaceId); } break;
    case 'ACTIVITY_DELTA': next.activities[id] = { ...(next.activities[id] as object || {}), ...(event.patch as object || event.delta as object || {}) }; pushOrderedBlock(next, 'activity', id); break;
  }
  if (event.type === 'TOOL_CALL_END' && next.toolCalls[toolId]?.name === 'render_a2ui') {
    try { const payload = JSON.parse(next.toolCalls[toolId].args) as { surfaceId?: string; [key: string]: unknown }; const surfaceId = payload.surfaceId || toolId; next.surfaces[surfaceId] = payload; pushOrderedBlock(next, 'surface', surfaceId); } catch { /* retain malformed arguments for diagnostics */ }
  }
  return next;
}
