// AgentDock 对话 hook：
// - proxy（生产）走官方 CopilotKit v2 headless（useAgent + useCopilotKit）
// - mock / direct 走自研 SSE + reducer（runStore），direct 仅用于本地联调
// 官方事件经 agent.subscribe 投影为 RuntimeRunState，并写入 IndexedDB 检查点。
// mock 模式下不挂载 CopilotKit Provider，因此本 hook 按模式拆成两条互斥路径；
// serviceMode 每次会话固定、transport 为编译期常量，页面内不会中途切换。
import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2';
import type { Message } from '@ag-ui/client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { createRunInput } from '@/api/runtime/agentRuntimeService';
import { createRunState, reduceRunEvent } from '@/api/runtime/runReducer';
import type { AgUiEvent, RunAgentInput, RuntimeRunState } from '@/api/runtime/types';
import { getChatServiceMode } from '@/api/core/serviceMode';
import { runtimeConfig } from '@/api/runtimeConfig';
import {
  flushRunCheckpoint,
  scheduleRunCheckpoint,
  sessionHistoryService,
} from '@/api/session/sessionHistoryService';
import { useRunStore } from '@/stores/runStore';

export interface AgentDockConversationOptions {
  agentId: string;
  fab: string;
  group?: RunAgentInput['forwardedProps']['group'];
  sessionId: string;
  threadId?: string;
}

export interface AgentDockConversationResult {
  agent: unknown;
  isReady: boolean;
  respondToHitl: (
    hitlResponse: NonNullable<RunAgentInput['forwardedProps']['hitlResponse']>,
  ) => Promise<void>;
  restore: () => Promise<void>;
  run: RuntimeRunState | undefined;
  send: (message: string) => Promise<void>;
  sendA2uiAction: (
    a2uiAction: NonNullable<RunAgentInput['forwardedProps']['a2uiAction']>,
  ) => Promise<void>;
  stop: () => Promise<void>;
}

const toStreamedEvent = (event: AgUiEvent) => ({
  event,
  streamId:
    event && typeof event === 'object' && 'rawEvent' in event
      ? ((event as { rawEvent?: { streamId?: string } }).rawEvent?.streamId)
      : undefined,
});

const useMockConversation = (options: AgentDockConversationOptions): AgentDockConversationResult => {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const restore = useCallback(async () => {
    await useRunStore.getState().restoreSession(optionsRef.current.sessionId);
  }, []);

  useEffect(() => {
    void restore();
  }, [options.sessionId, restore]);

  const send = useCallback(
    async (message: string) => {
      // 防重入：上一轮 run 未结束（running/paused）时忽略新发送，
      // 避免 UI 门禁延迟导致同一会话并发 run（后端日志曾出现同一时刻两个 /ag-ui POST）。
      const currentRun = useRunStore.getState().run;
      if (currentRun && (currentRun.status === 'running' || currentRun.status === 'paused')) return;
      const { agentId, fab, group, sessionId } = optionsRef.current;
      const threadId = optionsRef.current.threadId || `thread-${sessionId}`;
      await useRunStore
        .getState()
        .execute(createRunInput({ agentId, fab, group, message, sessionId, threadId }));
    },
    [],
  );

  const stop = useCallback(async () => {
    await useRunStore.getState().stop();
  }, []);

  const respondToHitl = useCallback(
    async (hitlResponse: NonNullable<RunAgentInput['forwardedProps']['hitlResponse']>) => {
      await useRunStore.getState().respondToHitl(hitlResponse);
    },
    [],
  );

  const sendA2uiAction = useCallback(
    async (a2uiAction: NonNullable<RunAgentInput['forwardedProps']['a2uiAction']>) => {
      await useRunStore.getState().sendA2uiAction(a2uiAction);
    },
    [],
  );

  return {
    agent: undefined,
    isReady: true,
    respondToHitl,
    restore,
    run: useRunStore((state) => state.run),
    send,
    sendA2uiAction,
    stop,
  };
};

const useOfficialConversation = (
  options: AgentDockConversationOptions,
): AgentDockConversationResult => {
  const resolvedThreadId = options.threadId || `thread-${options.sessionId}`;
  const localAgentId = `agentdock-${options.sessionId}`;
  const { agent, isReady } = useAgent({
    agentId: localAgentId,
    runtimeAgentId: 'orchestration',
    threadId: resolvedThreadId,
  });
  const { copilotkit } = useCopilotKit();
  const [httpRun, setHttpRun] = useState<RuntimeRunState>();
  const runRef = useRef<RuntimeRunState | undefined>(undefined);
  const inputRef = useRef<RunAgentInput | undefined>(undefined);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const applyEvent = useCallback((event: AgUiEvent) => {
    const threadId = optionsRef.current.threadId || `thread-${optionsRef.current.sessionId}`;
    const current = runRef.current ?? createRunState(String(event.runId || crypto.randomUUID()), threadId);
    const next = reduceRunEvent(current, toStreamedEvent(event));
    runRef.current = next;
    setHttpRun(next);
    const input = inputRef.current;
    if (input) scheduleRunCheckpoint(optionsRef.current.sessionId, input, next);
    if (next.status === 'success' || next.status === 'error' || next.status === 'cancelled') {
      void flushRunCheckpoint();
    }
  }, []);

  useEffect(() => {
    if (!isReady) return;
    const subscription = agent.subscribe({
      onActivityDeltaEvent: ({ event }) => applyEvent(event),
      onActivitySnapshotEvent: ({ event }) => applyEvent(event),
      onCustomEvent: ({ event }) => {
        applyEvent(event);
        // legacy HITL wire：CustomEvent(name=on_interrupt)
        const custom = event as { name?: string; value?: { id?: string; message?: string } };
        if (custom.name === 'on_interrupt') {
          const requestId = custom.value?.id ?? '';
          applyEvent({
            activityType: 'agentDock.hitl',
            content: { description: custom.value?.message ?? 'Agent requests your confirmation.', requestId },
            messageId: `hitl-${requestId || Date.now()}`,
            type: 'ACTIVITY_SNAPSHOT',
          });
        }
      },
      onMessagesSnapshotEvent: ({ event }) => applyEvent(event),
      onRawEvent: ({ event }) => applyEvent(event),
      onReasoningMessageContentEvent: ({ event }) => applyEvent(event),
      onReasoningMessageEndEvent: ({ event }) => applyEvent(event),
      onReasoningMessageStartEvent: ({ event }) => applyEvent(event),
      onRunErrorEvent: ({ event }) => applyEvent(event),
      onRunFinishedEvent: (params) => {
        applyEvent(params.event);
        // 标准 AG-UI HITL：RUN_FINISHED outcome=interrupt → 投影为暂停活动块
        if (params.outcome === 'interrupt') {
          for (const interrupt of params.interrupts) {
            applyEvent({
              activityType: 'agentDock.hitl',
              content: { description: interrupt.message ?? 'Agent requests your confirmation.', requestId: interrupt.id },
              messageId: `hitl-${interrupt.id}`,
              type: 'ACTIVITY_SNAPSHOT',
            });
          }
        }
      },
      onRunStartedEvent: ({ event }) => applyEvent(event),
      onStateDeltaEvent: ({ event }) => applyEvent(event),
      onStateSnapshotEvent: ({ event }) => applyEvent(event),
      onStepFinishedEvent: ({ event }) => applyEvent(event),
      onStepStartedEvent: ({ event }) => applyEvent(event),
      onTextMessageContentEvent: ({ event }) => applyEvent(event),
      onTextMessageEndEvent: ({ event }) => applyEvent(event),
      onTextMessageStartEvent: ({ event }) => applyEvent(event),
      onToolCallArgsEvent: ({ event }) => applyEvent(event),
      onToolCallEndEvent: ({ event }) => applyEvent(event),
      onToolCallResultEvent: ({ event }) => applyEvent(event),
      onToolCallStartEvent: ({ event }) => applyEvent(event),
    });
    return () => subscription.unsubscribe();
  }, [agent, applyEvent, isReady]);

  const restore = useCallback(async () => {
    const checkpoint = await sessionHistoryService.getLatestRun(optionsRef.current.sessionId);
    if (!checkpoint) return;
    inputRef.current = checkpoint.input;
    // 后端尚无 streamId 游标恢复：陈旧 running 快照（页面在 run 中途关闭/刷新）
    // 直接转为 cancelled 并落库，避免 restore 自动 resume 重放造成重复/并发 run。
    const restored = checkpoint.status === 'running'
      ? {
          ...checkpoint.snapshot,
          error: { code: 'CANCELLED', message: 'Run interrupted by reload; stream resume is not supported yet.' },
          status: 'cancelled' as const,
        }
      : checkpoint.snapshot;
    runRef.current = restored;
    setHttpRun(restored);
    if (restored !== checkpoint.snapshot) {
      await sessionHistoryService.saveRunCheckpoint(
        optionsRef.current.sessionId,
        checkpoint.input,
        restored,
      );
    }
    // 回填 agent 可见消息，保证下一次 run 携带完整上下文（与 LobeHub 本地历史一致）
    const restoredMessages = [
      ...(checkpoint.input.messages || []),
      ...Object.values(restored.messages || {}),
    ]
      .filter((message) => message?.role === 'user' || message?.role === 'assistant')
      .map((message) => ({ content: message.content, id: message.id, role: message.role }));
    if (restoredMessages.length) agent.setMessages(restoredMessages as Message[]);
    // 注：移除 connectAgent 自动恢复。后端没有 Redis 事件日志/streamId 游标，
    // resume 会重放整轮对话并产生并发 run；HITL(paused) 通过 respondToHitl 的
    // runAgent(resume[]) 续跑，不需要 connectAgent。
  }, [agent]);

  useEffect(() => {
    void restore();
  }, [options.sessionId, restore]);

  const send = useCallback(
    async (message: string) => {
      // 防重入：与官方路径一致，上一轮未结束时忽略新发送。
      const currentRun = runRef.current;
      if (currentRun && (currentRun.status === 'running' || currentRun.status === 'paused')) return;
      const { agentId, fab, group, sessionId } = optionsRef.current;
      const threadId = optionsRef.current.threadId || `thread-${sessionId}`;
      const runId = crypto.randomUUID();
      const input: RunAgentInput = {
        context: [],
        forwardedProps: { action: 'run', agentId, fab, group, sessionId },
        messages: [{ content: message, id: crypto.randomUUID(), role: 'user' }],
        runId,
        state: {},
        threadId,
        tools: [],
      };
      inputRef.current = input;
      runRef.current = createRunState(runId, threadId);
      // 立即把本次用户消息放进投影状态，事件流到达前页面就能显示用户气泡。
      runRef.current.messages[input.messages[0].id] = input.messages[0];
      runRef.current.messageOrder.push(input.messages[0].id);
      setHttpRun(runRef.current);
      agent.addMessage({ content: message, id: input.messages[0].id, role: 'user' });
      try {
        await copilotkit.runAgent({
          agent,
          forwardedProps: input.forwardedProps as Record<string, unknown>,
          runId,
        });
      } catch (error) {
        // runAgent 网络/流错误兜底：写入 RUN_ERROR 让 UI 退出 running，
        // 避免后端已完成但客户端流中断时页面永远卡在“停止生成”。
        // 若事件流已经给出终态（success/error/cancelled），不覆盖为网络错误。
        const terminal = runRef.current?.status;
        if (terminal === 'success' || terminal === 'error' || terminal === 'cancelled') return;
        console.error('[AgentDock] runAgent failed', error);
        applyEvent({
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Run failed',
          runId,
          threadId,
          type: 'RUN_ERROR',
        });
      }
    },
    [agent, applyEvent, copilotkit],
  );

  const stop = useCallback(async () => {
    copilotkit.stopAgent({ agent });
    if (runRef.current?.status === 'running' || runRef.current?.status === 'paused') {
      applyEvent({
        code: 'CANCELLED',
        message: 'Run cancelled by user.',
        runId: runRef.current.runId,
        threadId: optionsRef.current.threadId || `thread-${optionsRef.current.sessionId}`,
        type: 'RUN_ERROR',
      });
    }
  }, [agent, applyEvent, copilotkit]);

  const respondToHitl = useCallback(
    async (hitlResponse: NonNullable<RunAgentInput['forwardedProps']['hitlResponse']>) => {
      const pending = agent.pendingInterrupts || [];
      if (pending.length > 0) {
        const interrupt = pending[0];
        await copilotkit.runAgent({
          agent,
          resume: [{
            interruptId: interrupt.id,
            payload: { decision: hitlResponse.decision, input: hitlResponse.input },
            status: hitlResponse.decision === 'reject' ? 'cancelled' : 'resolved',
          }],
        });
        return;
      }
      const previous = inputRef.current;
      if (!previous) return;
      await copilotkit.runAgent({
        agent,
        forwardedProps: {
          ...(previous.forwardedProps as Record<string, unknown>),
          action: 'hitlResponse',
          hitlResponse,
        },
      });
    },
    [agent, copilotkit],
  );

  const sendA2uiAction = useCallback(
    async (a2uiAction: NonNullable<RunAgentInput['forwardedProps']['a2uiAction']>) => {
      const previous = inputRef.current;
      try {
        // 官方 A2UI middleware 读取 forwardedProps.a2uiAction.userAction
        copilotkit.setProperties({ ...copilotkit.properties, a2uiAction: { userAction: a2uiAction } });
        await copilotkit.runAgent({
          agent,
          forwardedProps: {
            ...(previous?.forwardedProps as Record<string, unknown> | undefined),
            action: 'a2uiAction',
          },
          runId: crypto.randomUUID(),
        });
      } finally {
        if (copilotkit.properties) {
          const { a2uiAction: _, ...rest } = copilotkit.properties;
          copilotkit.setProperties(rest);
        }
      }
    },
    [agent, copilotkit],
  );

  return {
    agent,
    isReady,
    respondToHitl,
    restore,
    run: httpRun,
    send,
    sendA2uiAction,
    stop,
  };
};

export const useAgentDockConversation = (
  options: AgentDockConversationOptions,
): AgentDockConversationResult => {
  const useOfficial = getChatServiceMode() === 'http' && runtimeConfig.transport === 'proxy';
  return useOfficial ? useOfficialConversation(options) : useMockConversation(options);
};
