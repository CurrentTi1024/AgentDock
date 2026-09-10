import assert from 'node:assert/strict';
import test from 'node:test';

import { createInlineCodePreview, findLatestInlineCodePreview, splitPreviewCodeBlocks } from './htmlArtifact.ts';

test('extracts all supported preview fences and preserves surrounding markdown', () => {
  assert.deepEqual(splitPreviewCodeBlocks('说明\n```svg\n<svg/>\n```\n```mermaid\ngraph TD; A-->B\n```'), [
    { content: '说明\n', kind: 'markdown' },
    { content: '<svg/>', kind: 'preview', previewKind: 'svg' },
    { content: '\n', kind: 'markdown' },
    { content: 'graph TD; A-->B', kind: 'preview', previewKind: 'mermaid' },
  ]);
  assert.deepEqual(splitPreviewCodeBlocks('```md\n# title\n```\n```html\n<div>ok</div>\n```'), [
    { content: '# title', kind: 'preview', previewKind: 'markdown' },
    { content: '\n', kind: 'markdown' },
    { content: '<div>ok</div>', kind: 'preview', previewKind: 'html' },
  ]);
});

test('does not preview ordinary markup, unknown languages, or incomplete fences', () => {
  for (const content of ['普通文字含 <div> 不应预览', '```xml\n<div/>\n```', '```svg\n<svg/>']) {
    assert.deepEqual(splitPreviewCodeBlocks(content), [{ content, kind: 'markdown' }]);
  }
});

test('preview identity includes kind and content', () => {
  const html = createInlineCodePreview('<p>one</p>', 'html');
  const svg = createInlineCodePreview('<p>one</p>', 'svg');
  const other = createInlineCodePreview('<p>two</p>', 'html');
  assert.ok(html && svg && other);
  assert.notEqual(html.artifactId, svg.artifactId);
  assert.notEqual(html.artifactId, other.artifactId);
});

test('finds the latest complete supported preview', () => {
  assert.equal(findLatestInlineCodePreview('```html\n<div>unfinished</div>'), undefined);
  const preview = findLatestInlineCodePreview('```html\n<p>first</p>\n```\ntext\n```mermaid\ngraph TD; A-->B\n```');
  assert.equal(preview?.kind, 'mermaid');
  assert.equal(preview?.body, 'graph TD; A-->B');
});

test('rejects previews larger than the inline limit', () => {
  assert.equal(createInlineCodePreview('a'.repeat(512 * 1024 + 1), 'markdown'), undefined);
});
