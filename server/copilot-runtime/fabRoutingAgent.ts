// FabRoutingAgent：Copilot Runtime 内唯一的远端 Agent Adapter。
// 根据 RunAgentInput.forwardedProps.fab 选择 AGENT_ORCHESTRATION_BASE_URLS_JSON 中的上游，
// 然后委托 @ag-ui/client 的 HttpAgent 调用 {baseUrl}/ag-ui，完整复用官方 AG-UI 事件处理。
import { AbstractAgent, HttpAgent } from '@ag-ui/client';
import type { BaseEvent, RunAgentInput } from '@ag-ui/core';
import { Observable, finalize } from 'rxjs';

export interface FabRoutingAgentConfig {
  fabToBaseUrl: Record<string, string>;
  headers?: Record<string, string>;
  path?: string;
}

/**
 * 并发幂等守卫：同一 threadId+runId 的 action=run 只允许一个在途上游请求。
 * 契约要求“同一个 runId 的重复 action=run 请求不得重复启动 Core 任务”；
 * 客户端重试/重复发送到达时直接拒绝，避免后端并发执行同一轮对话。
 */
const inFlightRuns = new Map<string, string>();
const runKey = (threadId: string, runId: string) => `${threadId}:${runId}`;

export class FabRoutingAgent extends AbstractAgent {
  private readonly config: FabRoutingAgentConfig;

  constructor(config: FabRoutingAgentConfig) {
    super({
      agentId: 'orchestration',
      description: '按 forwardedProps.fab 路由到对应 Orchestration /ag-ui',
    });
    this.config = config;
  }

  override run(input: RunAgentInput): Observable<BaseEvent> {
    const forwarded = (input.forwardedProps ?? {}) as Record<string, unknown>;
    const fab = String(forwarded.fab ?? '');
    console.log(
      `[FabRoutingAgent] run thread=${input.threadId} runId=${input.runId} action=${forwarded.action} session=${forwarded.sessionId}`,
    );
    const isRunAction = forwarded.action === 'run';
    const key = runKey(input.threadId, input.runId);
    if (isRunAction && inFlightRuns.has(key)) {
      throw new Error(`FAB_DUPLICATE_RUN: ${input.runId}`);
    }
    if (isRunAction) inFlightRuns.set(key, fab);
    const baseUrl = this.config.fabToBaseUrl[fab];
    if (!baseUrl) {
      if (isRunAction) inFlightRuns.delete(key);
      throw new Error(`FAB_ENDPOINT_NOT_CONFIGURED: ${fab}`);
    }
    const path = this.config.path ?? '/ag-ui';
    const upstream = new HttpAgent({
      headers: this.config.headers,
      url: `${baseUrl.replace(/\/+$/, '')}${path}`,
    });
    return upstream.run(input).pipe(
      finalize(() => {
        if (isRunAction) inFlightRuns.delete(key);
      }),
    );
  }

  override clone(): FabRoutingAgent {
    return new FabRoutingAgent(this.config);
  }
}
