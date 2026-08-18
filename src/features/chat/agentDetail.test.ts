import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAgentDetailPath, resolveChatAgentId } from './agentDetail.ts';

test('chat agent id comes from agent/session, not from display-name parsing', () => {
  const displayName = 'FlightAnalysis_Agent-F15B';
  // 回归：曾经用 displayName.split('-')[0] 当 id，得到的是显示名而非真实 agentId
  assert.notEqual(displayName.split('-')[0], 'flight-analysis');
  assert.equal(resolveChatAgentId('flight-analysis', undefined), 'flight-analysis');
  assert.equal(resolveChatAgentId(undefined, 'flight-analysis'), 'flight-analysis');
  assert.equal(resolveChatAgentId(undefined, undefined), 'flight-analysis');
});

test('agent detail path uses the real id verbatim, including dashes', () => {
  assert.equal(buildAgentDetailPath('flight-analysis', 'F15B'), '/market/agent/flight-analysis?fab=F15B');
  assert.equal(buildAgentDetailPath('company-git', 'F18B'), '/market/agent/company-git?fab=F18B');
});
