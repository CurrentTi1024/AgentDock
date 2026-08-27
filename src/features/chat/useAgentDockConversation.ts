// AgentDock 对话 facade：页面只选择当前 Session 的运行投影，Agent 实例与订阅由
// Provider 下常驻的 SessionRuntimeHost/Worker 持有。路由切换不会中断其他 Session。
import { useCallback, useEffect, useRef } from 'react';

import { getChatServiceMode } from '@/api/core/serviceMode';
import type { MentionAgentRef, RunAgentInput, RuntimeRunState } from '@/api/runtime/types';
import { sessionOperationService } from '@/features/chat/runtime/sessionOperationService';
import type { SessionRuntimeContext } from '@/features/chat/runtime/types';
import { selectSessionRun, useSessionOperationStore } from '@/stores/sessionOperationStore';

export interface AgentDockConversationOptions {
  agentId: string;
  fab: string;
  group?: RunAgentInput['forwardedProps']['group'];
  /** 本轮用户消息中 @ 提及的 Agent（后端据此启用 callAgent 委派）。 */
  mentionAgents?: MentionAgentRef[];
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
  send: (message: string, options?: { mentionAgents?: MentionAgentRef[] }) => Promise<void>;
  sendA2uiAction: (
    a2uiAction: NonNullable<RunAgentInput['forwardedProps']['a2uiAction']>,
  ) => Promise<void>;
  stop: () => Promise<void>;
}

const resolveContext = (options: AgentDockConversationOptions): SessionRuntimeContext => ({
  agentId: options.agentId,
  fab: options.fab,
  group: options.group,
  mentionAgents: options.mentionAgents,
  sessionId: options.sessionId,
  threadId: options.threadId || `thread-${options.sessionId}`,
});

export const useAgentDockConversation = (
  options: AgentDockConversationOptions,
): AgentDockConversationResult => {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const run = useSessionOperationStore(selectSessionRun(options.sessionId));
  const runtimeStatus = useSessionOperationStore(
    (state) => state.runtimeBySession[options.sessionId]?.status,
  );

  useEffect(() => {
    sessionOperationService.setViewingSession(options.sessionId);
    return () => {
      if (useSessionOperationStore.getState().viewingSessionId === options.sessionId) {
        sessionOperationService.setViewingSession(undefined);
      }
    };
  }, [options.sessionId]);

  const restore = useCallback(async () => {
    await sessionOperationService.restore(resolveContext(optionsRef.current));
  }, []);

  const send = useCallback(
    async (message: string, sendOptions?: { mentionAgents?: MentionAgentRef[] }) => {
      await sessionOperationService.send(resolveContext(optionsRef.current), message, sendOptions);
    },
    [],
  );

  const stop = useCallback(async () => {
    await sessionOperationService.stop(optionsRef.current.sessionId);
  }, []);

  const respondToHitl = useCallback(
    async (hitlResponse: NonNullable<RunAgentInput['forwardedProps']['hitlResponse']>) => {
      await sessionOperationService.respondToHitl(optionsRef.current.sessionId, hitlResponse);
    },
    [],
  );

  const sendA2uiAction = useCallback(
    async (a2uiAction: NonNullable<RunAgentInput['forwardedProps']['a2uiAction']>) => {
      await sessionOperationService.sendA2uiAction(resolveContext(optionsRef.current), a2uiAction);
    },
    [],
  );

  return {
    agent: undefined,
    isReady: getChatServiceMode() !== 'http' || runtimeStatus === 'ready' || runtimeStatus === undefined,
    respondToHitl,
    restore,
    run,
    send,
    sendA2uiAction,
    stop,
  };
};
