import assert from 'node:assert/strict';
import test from 'node:test';

import type { MentionAgent } from '../../api/market/agentMarketService.ts';
import type { SessionRecord } from '../../api/session/sessionHistoryService.ts';
import {
  resolveAgentSidebarIdentity,
  resolveSessionAgent,
} from './agentIdentity.ts';

const agents: MentionAgent[] = [
  {
    agentFullName: 'FlightAnalysis_Agent-F15B',
    agentId: 'flight-analysis',
    description: '飞行数据分析',
    fab: 'F15B',
    icon: '🛩️',
    ownerName: 'Flight AI Team',
    version: '2.1.0',
  },
  {
    agentFullName: 'CodeReview_Agent-F15B',
    agentId: 'code-review',
    description: '代码审查',
    fab: 'F15B',
    icon: '🧑‍💻',
    ownerName: 'lami',
    version: '1.3.0',
  },
];

const sessionRecord = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  agentId: 'code-review',
  agentName: 'CodeReview_Agent-F15B',
  createdAt: '2026-08-26T00:00:00+08:00',
  fab: 'F15B',
  id: 'session-current',
  pinned: false,
  threadId: 'thread-current',
  title: '审查一下这段代码',
  type: 'agent',
  updatedAt: '2026-08-26T00:00:00+08:00',
  version: '1.3.0',
  ...overrides,
});

test('AgentSidebar 切换 Agent：pendingSession 优先于旧的 session 状态，立即显示新 Agent（不再闪回旧 Agent/「对话」）', () => {
  // 模拟：从 session-A 切到 session-B，导航 state 携带 pendingSession(B)，
  // 但组件内存里的 session 仍是旧记录 A（新会话尚未异步落库）。
  const pending = sessionRecord({
    agentId: 'flight-analysis',
    agentName: 'FlightAnalysis_Agent-F15B',
    id: 'session-b',
    title: 'FlightAnalysis_Agent-F15B',
  });
  const stale = sessionRecord({ id: 'session-a' });
  const identity = resolveAgentSidebarIdentity(agents, { pendingSession: pending, session: stale });
  assert.equal(identity?.agentName, 'FlightAnalysis_Agent-F15B');
  assert.equal(identity?.agentId, 'flight-analysis');
  assert.equal(identity?.fab, 'F15B');
});

test('AgentSidebar 已落库会话是权威身份（无 pendingSession 时按 session 显示）', () => {
  const identity = resolveAgentSidebarIdentity(agents, { session: sessionRecord() });
  assert.equal(identity?.agentName, 'CodeReview_Agent-F15B');
  assert.equal(identity?.agentId, 'code-review');
  assert.equal(identity?.fab, 'F15B');
});

test('AgentSidebar 刷新/直达链接：无 session 时用 URL ?agent=&fab= 匹配列表解析名称', () => {
  const identity = resolveAgentSidebarIdentity(agents, {
    queryAgent: 'code-review',
    queryFab: 'F15B',
  });
  assert.equal(identity?.agentName, 'CodeReview_Agent-F15B');
  assert.equal(identity?.icon, '🧑‍💻');
});

test('AgentSidebar 无可解析来源时返回 undefined（不默认「对话」/错误 Agent）', () => {
  assert.equal(resolveAgentSidebarIdentity(agents, {}), undefined);
  assert.equal(
    resolveAgentSidebarIdentity(agents, { queryAgent: 'unknown', queryFab: 'F18B' }),
    undefined,
  );
});

test('输入框默认选中：会话已有 agentId+fab 时精确匹配，绝不误绑列表第一项', () => {
  const resolved = resolveSessionAgent(agents, sessionRecord());
  assert.equal(resolved?.agentId, 'code-review');
  assert.equal(resolved?.agentFullName, 'CodeReview_Agent-F15B');
});

test('输入框默认选中：会话没有身份时取列表第一项作为默认', () => {
  const resolved = resolveSessionAgent(agents, sessionRecord({ agentId: undefined, fab: 'F15B' }));
  assert.equal(resolved?.agentId, 'flight-analysis');
});

test('输入框默认选中：候选列表为空或会话 Agent 不在列表时返回 undefined', () => {
  assert.equal(resolveSessionAgent([], sessionRecord()), undefined);
  assert.equal(
    resolveSessionAgent(agents, sessionRecord({ agentId: 'missing', fab: 'F18B' })),
    undefined,
  );
});
