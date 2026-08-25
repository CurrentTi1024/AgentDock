import { create } from 'zustand';
import { agentRuntimeService, createRuntimeAction } from '@/api/runtime/agentRuntimeService';
import { createRunState, reduceRunEvent } from '@/api/runtime/runReducer';
import type { RunAgentInput, RuntimeRunState } from '@/api/runtime/types';
import { flushRunCheckpoint, scheduleRunCheckpoint, sessionHistoryService } from '@/api/session/sessionHistoryService';
interface RunStore { activeInput?: RunAgentInput; controller?: AbortController; run?: RuntimeRunState; execute(input: RunAgentInput): Promise<void>; restoreSession(sessionId: string): Promise<void>; resume(): Promise<void>; stop(): Promise<void>; respondToHitl(payload: NonNullable<RunAgentInput['forwardedProps']['hitlResponse']>): Promise<void>; sendA2uiAction(payload: NonNullable<RunAgentInput['forwardedProps']['a2uiAction']>): Promise<void> }
export const useRunStore = create<RunStore>((set, get) => ({
  async execute(input) {
    get().controller?.abort(); const controller = new AbortController(); const existing = get().run; const nextRun = existing?.runId === input.runId ? { ...existing, status: 'running' as const } : createRunState(input.runId, input.threadId); for (const message of input.messages) { nextRun.messages[message.id] = message; if (!nextRun.messageOrder.includes(message.id)) nextRun.messageOrder.push(message.id); } set({ activeInput: input, controller, run: nextRun });
    try { for await (const streamed of agentRuntimeService.stream(input, { signal: controller.signal })) { const current = get().run!; const run = reduceRunEvent(current, streamed); set({ run }); scheduleRunCheckpoint(input.forwardedProps.sessionId, input, run); } await flushRunCheckpoint(); }
    catch (error) {
      if ((error as DOMException).name !== 'AbortError') {
        const current = get().run;
        if (current) {
          // 与协议事件同一条路径：RUN_ERROR 经 reducer 生成 assistant 错误回复（最后一个 chunk），
          // 界面可见且随快照持久化到历史；不再只是改状态。
          const failed = reduceRunEvent(current, {
            event: {
              code: 'NETWORK_ERROR',
              message: error instanceof Error ? error.message : String(error),
              runId: current.runId,
              threadId: current.threadId,
              type: 'RUN_ERROR',
            },
          });
          set({ run: failed });
          await sessionHistoryService.saveRunCheckpoint(input.forwardedProps.sessionId, input, failed);
        }
      }
    }
  },
  async restoreSession(sessionId) { const checkpoint = await sessionHistoryService.getLatestRun(sessionId); if (!checkpoint) { set({ activeInput: undefined, run: undefined }); return; } set({ activeInput: checkpoint.input, run: checkpoint.snapshot }); if (checkpoint.status === 'running' && checkpoint.latestEventId) await get().resume(); },
  async resume() { const { activeInput, run } = get(); if (!activeInput || !run?.latestEventId) return; await get().execute(createRuntimeAction(activeInput, 'resume', { resume: { lastEventId: run.latestEventId } })); },
  async stop() { const { activeInput, controller } = get(); controller?.abort(); if (activeInput) { const stopInput = createRuntimeAction(activeInput, 'stop'); try { for await (const streamed of agentRuntimeService.stream(stopInput)) set(({ run }) => ({ run: run ? reduceRunEvent(run, streamed) : run })); } catch { /* local abort already stops rendering */ } const stopped = get().run ? { ...get().run!, status: 'cancelled' as const } : undefined; set({ run: stopped }); if (stopped) await sessionHistoryService.saveRunCheckpoint(activeInput.forwardedProps.sessionId, activeInput, stopped); } },
  async respondToHitl(hitlResponse) { const input = get().activeInput; if (input) await get().execute(createRuntimeAction(input, 'hitlResponse', { hitlResponse })); },
  async sendA2uiAction(a2uiAction) { const input = get().activeInput; if (!input) return; const next = { ...createRuntimeAction(input, 'a2uiAction', { a2uiAction }), parentRunId: input.runId, runId: crypto.randomUUID() }; await get().execute(next); },
}));
