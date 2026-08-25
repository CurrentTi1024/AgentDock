import assert from 'node:assert/strict';
import test from 'node:test';

import type { MentionAgent } from '../../api/market/agentMarketService.ts';
import type { SessionRecord } from '../../api/session/sessionHistoryService.ts';
import {
  buildAgentSessionPath,
  parseAgentChatSessionId,
  resolveChatRouteQuery,
  resolveAgentIcon,
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

test('AgentSidebar pendingSession 分支：按 agentId+fab 从列表补 icon（Home 右侧头像跟随切换）', () => {
  const pending = sessionRecord({
    agentId: 'code-review',
    agentName: 'CodeReview_Agent-F15B',
    id: 'session-b',
    title: 'CodeReview_Agent-F15B',
  });
  const identity = resolveAgentSidebarIdentity(agents, { pendingSession: pending });
  assert.equal(identity?.icon, '🧑‍💻');
  assert.equal(identity?.agentName, 'CodeReview_Agent-F15B');
});

test('AgentSidebar 已落库会话是权威身份（无 pendingSession 时按 session 显示）', () => {
  const identity = resolveAgentSidebarIdentity(agents, { session: sessionRecord() });
  assert.equal(identity?.agentName, 'CodeReview_Agent-F15B');
  assert.equal(identity?.agentId, 'code-review');
  assert.equal(identity?.fab, 'F15B');
});

test('AgentSidebar 会话 agentName 未回填时按 agentId+fab 从列表补全名称与图标', () => {
  const identity = resolveAgentSidebarIdentity(agents, {
    session: sessionRecord({ agentName: undefined, title: '新对话' }),
  });
  assert.equal(identity?.agentName, 'CodeReview_Agent-F15B');
  assert.equal(identity?.icon, '🧑‍💻');
});

test('parseAgentChatSessionId：/chat/:id 取 id，非会话路由返回 undefined（回归：侧栏在 Routes 外拿不到 useParams）', () => {
  assert.equal(parseAgentChatSessionId('/chat/session-inbox'), 'session-inbox');
  assert.equal(parseAgentChatSessionId('/chat/session-abc?agent=x&fab=F15B'), 'session-abc');
  assert.equal(parseAgentChatSessionId('/chat'), undefined);
  assert.equal(parseAgentChatSessionId('/group/abc'), undefined);
  assert.equal(parseAgentChatSessionId('/market/agent'), undefined);
});

test('buildAgentSessionPath：会话 URL 始终携带 agentId+fab（缺字段时退化为裸路径）', () => {
  assert.equal(
    buildAgentSessionPath('session-1', 'code-review', 'F15B'),
    '/chat/session-1?agent=code-review&fab=F15B',
  );
  assert.equal(
    buildAgentSessionPath('session-1', 'flight-analysis', 'F18B'),
    '/chat/session-1?agent=flight-analysis&fab=F18B',
  );
  assert.equal(buildAgentSessionPath('session-1', undefined, 'F15B'), '/chat/session-1');
});

test('resolveAgentIcon：按 agentId+fab 返回图标，未知 Agent 返回 undefined（切换 Agent 后 icon 跟随）', () => {
  assert.equal(resolveAgentIcon(agents, 'code-review', 'F15B'), '🧑‍💻');
  assert.equal(resolveAgentIcon(agents, 'flight-analysis', 'F15B'), '🛩️');
  assert.equal(resolveAgentIcon(agents, 'unknown', 'F99B'), undefined);
  assert.equal(resolveAgentIcon(agents, undefined, 'F15B'), undefined);
});

test('AgentSidebar 刷新/直达链接：无 session 时用 URL ?agent=&fab= 匹配列表解析名称', () => {
  const identity = resolveAgentSidebarIdentity(agents, {
    queryAgent: 'code-review',
    queryFab: 'F15B',
  });
  assert.equal(identity?.agentName, 'CodeReview_Agent-F15B');
  assert.equal(identity?.icon, '🧑‍💻');
});

test('AgentSidebar URL 显式指定优先于陈旧会话记录（创建时兜底 flight-analysis 的回归）', () => {
  const stale = sessionRecord({ agentId: 'flight-analysis', fab: 'F15B' });
  const identity = resolveAgentSidebarIdentity(agents, {
    queryAgent: 'code-review',
    queryFab: 'F15B',
    session: stale,
  });
  assert.equal(identity?.agentName, 'CodeReview_Agent-F15B');
  assert.equal(identity?.agentId, 'code-review');
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

test('路由守卫：URL 带无权限 agentId+fab 时返回 strip（防手改 URL 越权）', () => {
  assert.deepEqual(
    resolveChatRouteQuery(agents, { agent: 'secret-agent', fab: 'F99B' }, sessionRecord()),
    { type: 'strip' },
  );
  assert.deepEqual(
    resolveChatRouteQuery(agents, { agent: 'code-review', fab: 'F18B' }, sessionRecord()),
    { type: 'strip' },
  );
});

test('路由守卫：URL 参数在可用列表内时保留，不做改动', () => {
  assert.deepEqual(
    resolveChatRouteQuery(agents, { agent: 'code-review', fab: 'F15B' }, sessionRecord()),
    { type: 'keep' },
  );
});

test('路由归一化：URL 未带参数时补上会话的 agentId+fab（进入会话 URL 始终携带）', () => {
  assert.deepEqual(
    resolveChatRouteQuery(agents, { agent: null, fab: null }, sessionRecord()),
    { type: 'set', agent: 'code-review', fab: 'F15B' },
  );
  // 会话 Agent 已不在可用列表：不补参数（避免把无权限 Agent 写进 URL）
  assert.deepEqual(
    resolveChatRouteQuery(agents, { agent: null, fab: null }, sessionRecord({ agentId: 'legacy', fab: 'F99B' })),
    { type: 'keep' },
  );
});

test('路由守卫：候选列表未加载时 keep，由调用方加载完成后重试', () => {
  assert.deepEqual(resolveChatRouteQuery([], { agent: 'code-review', fab: 'F15B' }), {
    type: 'keep',
  });
});
