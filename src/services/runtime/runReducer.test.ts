import assert from 'node:assert/strict';
import test from 'node:test';
import { createRunState, reduceRunEvent } from './runReducer.ts';

test('deduplicates replayed stream ids and pauses for HITL', () => {
  const initial = createRunState('run-1', 'thread-1');
  const started = reduceRunEvent(initial, { streamId: '1', event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'assistant-1', delta: 'A' } });
  const replayed = reduceRunEvent(started, { streamId: '1', event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'assistant-1', delta: 'A' } });
  const paused = reduceRunEvent(replayed, { streamId: '2', event: { type: 'ACTIVITY_SNAPSHOT', messageId: 'hitl-1', activityType: 'agentDock.hitl', content: { requestId: 'request-1' } } });
  assert.equal(paused.messages['assistant-1'].content, 'A');
  assert.equal(paused.status, 'paused');
});

test('collects render_a2ui tool arguments as a surface', () => {
  let state = createRunState('run-2', 'thread-2');
  state = reduceRunEvent(state, { streamId: '1', event: { type: 'TOOL_CALL_START', toolCallId: 'tool-1', toolCallName: 'render_a2ui' } });
  state = reduceRunEvent(state, { streamId: '2', event: { type: 'TOOL_CALL_ARGS', toolCallId: 'tool-1', delta: '{"surfaceId":"surface-1","components":[]}' } });
  state = reduceRunEvent(state, { streamId: '3', event: { type: 'TOOL_CALL_END', toolCallId: 'tool-1' } });
  assert.deepEqual(state.surfaces['surface-1'], { surfaceId: 'surface-1', components: [] });
});
