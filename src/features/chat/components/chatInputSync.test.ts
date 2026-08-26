import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chatDraftStorageKey,
  shouldApplyExternalEditorValue,
  shouldClearSubmittedEditor,
  shouldSubmitEditorKey,
} from './chatInputSync.ts';

test('focused editor rejects a stale controlled value so selection and new text survive', () => {
  assert.equal(
    shouldApplyExternalEditorValue({
      currentValue: '正在输入的新内容',
      externalValue: '正在输入',
      focused: true,
      lastReportedValue: '正在输入',
    }),
    false,
  );
});

test('blurred editor accepts an explicit restore value but ignores its own echo', () => {
  assert.equal(
    shouldApplyExternalEditorValue({
      currentValue: '',
      externalValue: '恢复这条消息',
      focused: false,
      lastReportedValue: '',
    }),
    true,
  );
  assert.equal(
    shouldApplyExternalEditorValue({
      currentValue: '当前内容',
      externalValue: '当前内容',
      focused: false,
      lastReportedValue: '当前内容',
    }),
    false,
  );
});

test('draft keys are isolated by conversation context', () => {
  assert.notEqual(chatDraftStorageKey('chat:a'), chatDraftStorageKey('group:a'));
});

test('Enter never submits or clears a draft while a run is active', () => {
  assert.equal(
    shouldSubmitEditorKey({ blocked: true, composing: false, key: 'Enter', shiftKey: false }),
    false,
  );
  assert.equal(
    shouldSubmitEditorKey({ blocked: false, composing: false, key: 'Enter', shiftKey: false }),
    true,
  );
});

test('submitted text clears only after acceptance and never erases newer typing', () => {
  assert.equal(
    shouldClearSubmittedEditor({ accepted: false, currentValue: '原稿', submittedValue: '原稿' }),
    false,
  );
  assert.equal(
    shouldClearSubmittedEditor({ accepted: true, currentValue: '原稿 新输入', submittedValue: '原稿' }),
    false,
  );
  assert.equal(
    shouldClearSubmittedEditor({ accepted: true, currentValue: '原稿', submittedValue: '原稿' }),
    true,
  );
});
