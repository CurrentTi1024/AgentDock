// FabRoutingAgent：Copilot Runtime 内唯一的远端 Agent Adapter。
// 根据 RunAgentInput.forwardedProps.fab 选择 AGENT_ORCHESTRATION_BASE_URLS_JSON 中的上游，
// 然后委托 @ag-ui/client 的 HttpAgent 调用 {baseUrl}/ag-ui，完整复用官方 AG-UI 事件处理。
import { AbstractAgent, HttpAgent } from '@ag-ui/client';
import type { BaseEvent, RunAgentInput } from '@ag-ui/core';
import { Observable, catchError, finalize } from 'rxjs';

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

/** 构造结构化 RUN_ERROR AG-UI 事件流：客户端能渲染错误回复并持久化，而不是收到断流/network error。 */
const runErrorObservable = (input: RunAgentInput, code: string, message: string): Observable<BaseEvent> =>
  new Observable<BaseEvent>((subscriber) => {
    subscriber.next({
      code,
      message,
      runId: input.runId,
      threadId: input.threadId,
      type: 'RUN_ERROR',
    } as unknown as BaseEvent);
    subscriber.complete();
  });

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
      // 返回结构化 AG-UI 错误事件而非抛异常：客户端能渲染 RUN_ERROR，
      // 不会因为连接被直接掐断而误报 network error。
      return runErrorObservable(input, 'FAB_DUPLICATE_RUN', `Duplicate run rejected: ${input.runId}`);
    }
    if (isRunAction) inFlightRuns.set(key, fab);
    const baseUrl = this.config.fabToBaseUrl[fab];
    if (!baseUrl) {
      if (isRunAction) inFlightRuns.delete(key);
      // 不再抛异常（会让 runtime 流挂掉/前端收到 network error），改为结构化 RUN_ERROR。
      return runErrorObservable(input, 'FAB_ENDPOINT_NOT_CONFIGURED', `FAB_ENDPOINT_NOT_CONFIGURED: ${fab}`);
    }
    const path = this.config.path ?? '/ag-ui';
    try {
      const upstream = new HttpAgent({
        headers: this.config.headers,
        url: `${baseUrl.replace(/\/+$/, '')}${path}`,
      });
      return upstream.run(input).pipe(
        catchError((error) =>
          // 上游 Orchestration 请求失败/流中断/内部 run 报错：统一转成 RUN_ERROR，
          // 前端据此渲染 assistant 错误回复并持久化，而不是断流导致 runtime 挂掉。
          runErrorObservable(
            input,
            'FAB_UPSTREAM_ERROR',
            error instanceof Error ? error.message : 'Upstream orchestration error',
          ),
        ),
        finalize(() => {
          if (isRunAction) inFlightRuns.delete(key);
        }),
      );
    } catch (error) {
      // 同步抛错时 finalize 不会执行：必须手动释放幂等守卫，避免该 key 永久卡死。
      if (isRunAction) inFlightRuns.delete(key);
      return runErrorObservable(
        input,
        'FAB_UPSTREAM_ERROR',
        error instanceof Error ? error.message : 'Upstream unavailable',
      );
    }
  }

  override clone(): FabRoutingAgent {
    return new FabRoutingAgent(this.config);
  }
}
