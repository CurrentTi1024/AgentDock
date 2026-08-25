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
/** 从 A2UI payload 提取“逻辑 surfaceId”：官方 ops 的 createSurface/updateComponents 或顶层 surfaceId。
 *  同一逻辑 surface 在协议里会以两种形态出现（a2ui.surface 活动的 a2ui_operations 与
 *  render_a2ui 工具的 components 参数），统一用逻辑 id 做键才能去重，避免同一界面渲染两次。 */
export const findLogicalSurfaceId = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  if (typeof record.surfaceId === 'string') return record.surfaceId;
  if (Array.isArray(record.a2ui_operations)) {
    for (const op of record.a2ui_operations) {
      if (!op || typeof op !== 'object') continue;
      const create = (op as { createSurface?: { surfaceId?: unknown } }).createSurface?.surfaceId;
      if (typeof create === 'string') return create;
      const update = (op as { updateComponents?: { surfaceId?: unknown } }).updateComponents?.surfaceId;
      if (typeof update === 'string') return update;
    }
  }
  return undefined;
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
/** 终态兜底：无论后端是否发送 REASONING_END，都收尾所有推理块的 streaming 状态，
 *  保证 run 完成后 thinking 必定折叠（ReasoningBlock 的 open 跟随 streaming）。 */
export const finalizeReasoningMeta = (state: RuntimeRunState): RuntimeRunState => {
  const next = structuredClone(state);
  for (const meta of Object.values(next.reasoningMeta)) {
    meta.streaming = false;
    meta.finishedAt ??= Date.now();
  }
  return next;
};
export function reduceRunEvent(previous: RuntimeRunState, input: StreamedEvent): RuntimeRunState {
  if (input.eventId && previous.processedEventIds.includes(input.eventId)) return previous;
  const next = structuredClone(previous); const event = input.event; const id = String(event.messageId || ''); const toolId = String(event.toolCallId || ''); next.rawEvents.push(event); if (next.rawEvents.length > 100) next.rawEvents.shift();
  if (input.eventId) { next.latestEventId = input.eventId; next.processedEventIds.push(input.eventId); if (next.processedEventIds.length > 5000) next.processedEventIds.shift(); }
  switch (event.type) {
    case 'RUN_STARTED': next.status = 'running'; break;
    case 'RUN_FINISHED': {
      next.status = 'success';
      return finalizeReasoningMeta(next);
    }
    case 'RUN_ERROR': {
      next.status = event.code === 'CANCELLED' ? 'cancelled' : 'error';
      next.error = { code: String(event.code || ''), message: String(event.message || 'Run failed') };
      // 真实错误（非用户主动取消）作为本轮 assistant 的“最后一个 chunk”：
      // 已有部分回复则追加在末尾，没有则新建 error-<runId> 消息。
      // 这样错误既在界面上成为可见的 assistant 回复，也会随 persistRunSnapshot
      // 作为 assistant 文本持久化到历史，刷新后不丢失。
      if (event.code !== 'CANCELLED') {
        const errorText = String(event.message || event.code || 'Run failed');
        let targetId = '';
        for (let index = next.messageOrder.length - 1; index >= 0; index -= 1) {
          const messageId = next.messageOrder[index];
          // 只追加到“本轮”的 assistant（runId 匹配）；MESSAGES_SNAPSHOT 会带入上一轮消息，
          // 若误追加到上一轮错误回复，会出现 err2 跑到 Q2 之前的顺序错乱/内容串轮。
          if (next.messages[messageId]?.role === 'assistant' && next.messages[messageId]?.runId === next.runId) {
            targetId = messageId;
            break;
          }
        }
        if (!targetId) targetId = `error-${next.runId}`;
        const existing = next.messages[targetId];
        next.messages[targetId] = {
          ...(existing ?? { content: '', id: targetId, role: 'assistant', runId: next.runId }),
          content: existing?.content ? `${existing.content}\n\n${errorText}` : errorText,
          eventId: input.eventId,
        };
        if (!next.messageOrder.includes(targetId)) next.messageOrder.push(targetId);
      }
      return finalizeReasoningMeta(next);
    }
    case 'TEXT_MESSAGE_START': if (!id) break; next.messages[id] = { id, role: String(event.role || 'assistant') as RuntimeMessage['role'], content: '', eventId: input.eventId, runId: next.runId }; appendMessageId(next, id); break;
    case 'TEXT_MESSAGE_CONTENT': if (!id) break; next.messages[id] ||= { id, role: 'assistant', content: '', runId: next.runId }; appendMessageId(next, id); next.messages[id].content += String(event.delta || ''); if (input.eventId) next.messages[id].eventId = input.eventId; break;
    case 'TEXT_MESSAGE_CHUNK': if (!id) break; next.messages[id] ||= { id, role: 'assistant', content: '', runId: next.runId }; appendMessageId(next, id); next.messages[id].content += String(event.delta || event.content || ''); if (input.eventId) next.messages[id].eventId = input.eventId; break;
    case 'TEXT_MESSAGE_END': if (!id) break; if (input.eventId && next.messages[id]) next.messages[id].eventId = input.eventId; break;
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
            // 占位替换为规范 UUID：继承占位消息的 runId（属于当前 run），
            // 保证后续 RUN_ERROR 仍能识别为“本轮 assistant”并正确追加。
            const placeholderRunId = next.messages[placeholderId]?.runId;
            delete next.messages[placeholderId];
            next.messageOrder = next.messageOrder.filter((id) => id !== placeholderId);
            next.messages[message.id] = { ...message, runId: placeholderRunId ?? next.runId };
            continue;
          }
        }
        // 已存在的消息保留原 runId（跨轮消息不带当前 runId，RUN_ERROR 不会误追加）；
        // 新消息（快照先于流式事件到达）保持快照原样。
        const existing = next.messages[message.id];
        next.messages[message.id] = existing?.runId ? { ...message, runId: existing.runId } : message;
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
        // 中间态（如 {status:'building', progressTokens}）没有可渲染 UI，不建 surface 行；
        // 最终 a2ui_operations 或 components 到达时才渲染，避免正文出现 building JSON 回退卡。
        const content = event.content as Record<string, unknown> | undefined;
        if (
          !content ||
          typeof content !== 'object' ||
          (!Array.isArray(content.a2ui_operations) && !Array.isArray(content.components))
        ) {
          break;
        }
        // 统一以逻辑 surfaceId 为键：与 render_a2ui 工具的 components 版本共用键，
        // pushOrderedBlock 按 `${kind}:${id}` 幂等，不会重复插入同一 surface。
        const surfaceId = findLogicalSurfaceId(event.content) || String(event.surfaceId || id);
        // ops 版本信息更全（官方 renderer 依赖 a2ui_operations），后到则覆盖 components 版。
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
    try {
      const payload = JSON.parse(next.toolCalls[toolId].args) as { surfaceId?: string; [key: string]: unknown };
      const surfaceId = String(payload.surfaceId || toolId);
      // 同一逻辑 surface 已存在（a2ui.surface 活动的 ops 版先到）时不重复创建，
      // 保留官方 a2ui_operations（含完整组件树），避免正文出现重复界面/回退 JSON 卡。
      if (!next.surfaces[surfaceId]) {
        next.surfaces[surfaceId] = payload;
        pushOrderedBlock(next, 'surface', surfaceId);
      }
    } catch { /* retain malformed arguments for diagnostics */ }
  }
  return next;
}
