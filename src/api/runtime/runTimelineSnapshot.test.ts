import assert from 'node:assert/strict';
import test from 'node:test';

import { createRunState, reduceRunEvent } from './runReducer.ts';

test('整段历史快照只用尾部 assistant 替换本轮多个占位，不误绑定上一轮', () => {
  let state = createRunState('run-snapshot-tail', 'thread-snapshot-tail');
  state = reduceRunEvent(state, {
    eventId: 'tail-1',
    event: { type: 'TEXT_MESSAGE_START', messageId: 'lc_run--current-1', role: 'assistant' },
  });
  state = reduceRunEvent(state, {
    eventId: 'tail-2',
    event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'lc_run--current-1', delta: '阶段一' },
  });
  state = reduceRunEvent(state, {
    eventId: 'tail-3',
    event: { type: 'TOOL_CALL_START', toolCallId: 'tail-tool', toolCallName: 'search' },
  });
  state = reduceRunEvent(state, {
    eventId: 'tail-4',
    event: { type: 'TEXT_MESSAGE_START', messageId: 'lc_run--current-2', role: 'assistant' },
  });
  state = reduceRunEvent(state, {
    eventId: 'tail-5',
    event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'lc_run--current-2', delta: '阶段二' },
  });
  state = reduceRunEvent(state, {
    eventId: 'tail-6',
    event: {
      messages: [
        { content: '旧问题', id: 'history-user', role: 'user' },
        { content: '旧回答', id: 'history-assistant', role: 'assistant' },
        { content: '新问题', id: 'current-user', role: 'user' },
        { content: '阶段一完整', id: 'current-assistant-1', role: 'assistant' },
        { content: '阶段二完整', id: 'current-assistant-2', role: 'assistant' },
      ],
      type: 'MESSAGES_SNAPSHOT',
    },
  });

  assert.deepEqual(state.orderedBlocks, [
    { id: 'current-assistant-1', kind: 'text' },
    { id: 'tail-tool', kind: 'tool' },
    { id: 'current-assistant-2', kind: 'text' },
  ]);
  assert.equal(state.messages['history-assistant'].runId, undefined);
  assert.equal(state.messages['current-assistant-1'].runId, 'run-snapshot-tail');
  assert.equal(state.messages['current-assistant-2'].runId, 'run-snapshot-tail');
  assert.equal(state.messages['lc_run--current-1'], undefined);
  assert.equal(state.messages['lc_run--current-2'], undefined);
});
