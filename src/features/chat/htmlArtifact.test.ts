import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createInlineHtmlPreview,
  findLatestInlineHtmlPreview,
  splitHtmlCodeBlocks,
} from './htmlArtifact.ts';

test('extracts only explicit fenced HTML blocks and preserves surrounding markdown', () => {
  assert.deepEqual(splitHtmlCodeBlocks('说明\n```html\n<div>ok</div>\n```\n结尾'), [
    { content: '说明\n', kind: 'markdown' },
    { content: '<div>ok</div>', kind: 'html' },
    { content: '\n结尾', kind: 'markdown' },
  ]);
  assert.deepEqual(splitHtmlCodeBlocks('普通文字含 <div> 不应预览'), [
    { content: '普通文字含 <div> 不应预览', kind: 'markdown' },
  ]);
  assert.deepEqual(splitHtmlCodeBlocks('```xml\n<div/>\n```'), [
    { content: '```xml\n<div/>\n```', kind: 'markdown' },
  ]);
});

test('inline preview identity differs for equal-length HTML bodies', () => {
  const first = createInlineHtmlPreview('<p>one</p>');
  const second = createInlineHtmlPreview('<p>two</p>');
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.artifactId, second.artifactId);
});

test('finds only the latest complete fenced HTML preview', () => {
  assert.equal(findLatestInlineHtmlPreview('```html\n<div>unfinished</div>'), undefined);
  const preview = findLatestInlineHtmlPreview(
    '```html\n<p>first</p>\n```\ntext\n```htm\n<p>second</p>\n```',
  );
  assert.equal(preview?.body, '<p>second</p>');
});
