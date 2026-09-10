import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HTML_ARTIFACT_ACTIVITY_TYPE,
  MAX_INLINE_HTML_BYTES,
  createInlineHtmlPreview,
  findLatestHtmlArtifact,
  htmlArtifactKey,
  normalizeHtmlArtifact,
  splitHtmlCodeBlocks,
} from './htmlArtifact.ts';

test('normalizes the canonical AG-UI HTML artifact payload', () => {
  const artifact = normalizeHtmlArtifact({
    activityType: HTML_ARTIFACT_ACTIVITY_TYPE,
    artifactId: 'report-1',
    body: '<h1>Report</h1>',
    fileName: 'flight/report?.html',
    mimeType: 'text/html',
    presentation: { autoOpen: true, defaultTab: 'source' },
    revision: 2,
    title: 'Flight report',
  });
  assert.ok(artifact);
  assert.equal(artifact.fileName, 'flight-report-.html');
  assert.equal(artifact.presentation.defaultTab, 'source');
  assert.equal(htmlArtifactKey(artifact), 'report-1:2');
  assert.equal(artifact.sizeBytes, new TextEncoder().encode('<h1>Report</h1>').byteLength);
});

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

test('selects the highest revision regardless of activity insertion order', () => {
  const latest = findLatestHtmlArtifact([
    { activityType: HTML_ARTIFACT_ACTIVITY_TYPE, artifactId: 'a', body: 'v3', revision: 3 },
    { activityType: HTML_ARTIFACT_ACTIVITY_TYPE, artifactId: 'a', body: 'v1', revision: 1 },
    { activityType: 'agentDock.task', body: 'ignored' },
  ]);
  assert.equal(latest?.body, 'v3');
});

test('rejects wrong activity types, MIME types, missing bodies and oversized HTML', () => {
  assert.equal(normalizeHtmlArtifact({ activityType: 'agentDock.task', body: '<p>x</p>' }), undefined);
  assert.equal(normalizeHtmlArtifact({ activityType: 'agentDock.artifact', body: '<p>x</p>' }), undefined);
  assert.equal(normalizeHtmlArtifact({ activityType: HTML_ARTIFACT_ACTIVITY_TYPE, html: '<p>legacy</p>' }), undefined);
  assert.equal(normalizeHtmlArtifact({ activityType: HTML_ARTIFACT_ACTIVITY_TYPE, body: '<p>x</p>', mimeType: 'image/svg+xml' }), undefined);
  assert.equal(normalizeHtmlArtifact({ activityType: HTML_ARTIFACT_ACTIVITY_TYPE }), undefined);
  assert.equal(normalizeHtmlArtifact({ activityType: HTML_ARTIFACT_ACTIVITY_TYPE, body: 'x'.repeat(MAX_INLINE_HTML_BYTES + 1) }), undefined);
});
