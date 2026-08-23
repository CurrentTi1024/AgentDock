import type { AgUiEvent, RunAgentInput } from '@/api/runtime/types';
const delay = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true }); });
export async function* createAgentRuntimeMockEvents(input: RunAgentInput, signal?: AbortSignal): AsyncGenerator<AgUiEvent> {
  const assistantId = `assistant-${input.runId}`; const fab = input.forwardedProps.fab; let sequence = 0;
  const event = (value: AgUiEvent) => ({ ...value, rawEvent: { runId: input.runId, streamId: `${Date.now()}-${sequence++}` } });
  if (input.forwardedProps.action === 'stop') { yield event({ type: 'RUN_ERROR', threadId: input.threadId, runId: input.runId, code: 'CANCELLED', message: 'Run cancelled by user.' }); return; }
  if (input.forwardedProps.action === 'run' || input.forwardedProps.action === 'a2uiAction') yield event({ type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId });
  if (input.forwardedProps.group) {
    yield event({ type: 'CUSTOM_EVENT', name: 'agentDock.supervisor', messageId: `supervisor-${input.runId}`, value: { description: `${input.forwardedProps.group.orchestrationMode} 模式：由 Supervisor Agent 拆解任务并汇总结论。`, status: 'active' } });
  }
  yield event({ type: 'STEP_STARTED', stepName: 'plan' }); await delay(80, signal);
  yield event({ type: 'STEP_FINISHED', stepName: 'plan' });
  yield event({ type: 'REASONING_MESSAGE_START', messageId: `reasoning-${input.runId}` });
  await delay(120, signal);
  yield event({ type: 'REASONING_MESSAGE_CONTENT', messageId: `reasoning-${input.runId}`, delta: '校验输入、权限和数据范围；规划只读工具调用。' });
  yield event({ type: 'REASONING_MESSAGE_END', messageId: `reasoning-${input.runId}` });
  if (input.forwardedProps.action === 'run') {
    yield event({ type: 'ACTIVITY_SNAPSHOT', messageId: `hitl-${input.runId}`, activityType: 'agentDock.hitl', content: { requestId: `hitl-${input.runId}`, mode: 'toolAuthorization', title: '允许读取飞行测试指标', description: '只读操作，不会修改源数据。' } });
    return;
  }
  if (input.forwardedProps.action === 'hitlResponse' && input.forwardedProps.hitlResponse?.decision === 'reject') {
    yield event({ type: 'RUN_ERROR', threadId: input.threadId, runId: input.runId, code: 'CANCELLED', message: 'The requested tool call was rejected.' });
    return;
  }
  if (input.forwardedProps.group) {
    yield event({ type: 'CUSTOM_EVENT', name: 'agentDock.tasks', messageId: `tasks-${input.runId}`, value: { description: '并行子任务：读取飞行测试指标、校验数据完整性与边界。', status: 'running' } });
  }
  yield event({ type: 'TOOL_CALL_START', toolCallId: `tool-${input.runId}`, toolCallName: 'flightData.queryMetrics' });
  yield event({ type: 'TOOL_CALL_ARGS', toolCallId: `tool-${input.runId}`, delta: `{"fab":"${fab}","date":"2026-08-18"}` });
  yield event({ type: 'TOOL_CALL_END', toolCallId: `tool-${input.runId}` }); await delay(100, signal);
  yield event({ type: 'TOOL_CALL_RESULT', toolCallId: `tool-${input.runId}`, content: { anomalies: 2, status: 'ok' } });
  if (input.forwardedProps.group) {
    yield event({ type: 'CUSTOM_EVENT', name: 'agentDock.groupTasks', messageId: `group-tasks-${input.runId}`, value: { description: '群组汇总：飞行数据分析 Agent 与报告 Agent 已并行完成。', status: 'completed' } });
  }
  yield event({
    type: 'ACTIVITY_SNAPSHOT',
    messageId: `activity-${input.runId}`,
    activityType: input.forwardedProps.group ? 'agentDock.agentDelegation' : 'agentDock.task',
    content: {
      status: 'completed',
      fab,
      ...(input.forwardedProps.group
        ? {
            members: input.forwardedProps.group.members.map((member) => ({
              agentId: member.agentId,
              agentFullName: member.agentId,
              fab: member.fab,
              icon: '🤖',
            })),
            skills: [{ id: 'flight-data', name: '飞行数据分析' }],
          }
        : {}),
    },
  });
  yield event({ type: 'TEXT_MESSAGE_START', messageId: assistantId, role: 'assistant' });
  const text = '今天的飞行测试整体稳定。发现 09:42 振动峰值和 10:17 温度跃升两处短时异常，建议复核原始传感器数据并加入下一次试飞检查清单。';
  for (const token of text.match(/.{1,3}/g) || []) { await delay(24, signal); yield event({ type: 'TEXT_MESSAGE_CONTENT', messageId: assistantId, delta: token }); }
  yield event({ type: 'TEXT_MESSAGE_END', messageId: assistantId });
  yield event({ type: 'ACTIVITY_SNAPSHOT', messageId: `surface-${input.runId}`, activityType: 'a2ui.surface', surfaceId: `surface-${input.runId}`, content: { catalogId: 'agentdock://catalog', components: [{ id: 'summary', type: 'metricCard', props: { label: '异常数量', value: 2 } }, { id: 'open', type: 'button', props: { label: '打开报告', actionName: 'open_report' } }] } });
  yield event({
    type: 'ACTIVITY_SNAPSHOT',
    messageId: `artifact-${input.runId}`,
    activityType: 'agentDock.artifact',
    content: {
      title: '飞行测试分析报告',
      html: '<h2>飞行测试概览</h2><table border="1" cellpadding="6"><tr><th>指标</th><th>数值</th><th>状态</th></tr><tr><td>振动峰值</td><td>+18%</td><td style="color:#faad14">关注</td></tr><tr><td>温度跃升</td><td>+6.2°C</td><td style="color:#faad14">关注</td></tr><tr><td>总体状态</td><td>稳定</td><td style="color:#52c41a">通过</td></tr></table><p>建议复核 09:42 与 10:17 两处异常并加入下次检查清单。</p>',
    },
  });
  yield event({ type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId });
}
