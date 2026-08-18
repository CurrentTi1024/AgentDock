// FabRoutingAgent：Copilot Runtime 内唯一的远端 Agent Adapter。
// 根据 RunAgentInput.forwardedProps.fab 选择 AGENT_ORCHESTRATION_BASE_URLS_JSON 中的上游，
// 然后委托 @ag-ui/client 的 HttpAgent 调用 {baseUrl}/ag-ui，完整复用官方 AG-UI 事件处理。
import { AbstractAgent, HttpAgent } from '@ag-ui/client';
import type { BaseEvent, RunAgentInput } from '@ag-ui/core';
import { Observable } from 'rxjs';

export interface FabRoutingAgentConfig {
  fabToBaseUrl: Record<string, string>;
  headers?: Record<string, string>;
  path?: string;
}

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
    const baseUrl = this.config.fabToBaseUrl[fab];
    if (!baseUrl) {
      throw new Error(`FAB_ENDPOINT_NOT_CONFIGURED: ${fab}`);
    }
    const path = this.config.path ?? '/ag-ui';
    const upstream = new HttpAgent({
      headers: this.config.headers,
      url: `${baseUrl.replace(/\/+$/, '')}${path}`,
    });
    return upstream.run(input);
  }

  override clone(): FabRoutingAgent {
    return new FabRoutingAgent(this.config);
  }
}
