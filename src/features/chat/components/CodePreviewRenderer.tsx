import { Markdown, Mermaid } from '@lobehub/ui';
import DOMPurify from 'dompurify';
import { memo, useMemo } from 'react';

import type { CodePreview } from '@/features/chat/htmlArtifact';
import { buildSafeHtmlSrcDoc } from '@/features/chat/htmlArtifact';
import { HtmlPreviewRenderer } from './HtmlPreviewRenderer';

const SvgPreviewRenderer = memo<{ content: string }>(({ content }) => {
  const safeSvg = useMemo(() => DOMPurify.sanitize(content, {
    // SVG is mounted in the host document: disallow active content and every
    // attribute that could initiate a network request or execute CSS/handlers.
    FORBID_ATTR: ['href', 'src', 'style', 'xlink:href'],
    FORBID_TAGS: ['base', 'embed', 'foreignObject', 'iframe', 'link', 'object', 'script', 'style'],
    USE_PROFILES: { svg: true, svgFilters: true },
  }), [content]);

  return (
    <div
      style={{ alignItems: 'center', boxSizing: 'border-box', display: 'flex', height: '100%', justifyContent: 'center', overflow: 'auto', padding: 24, width: '100%' }}
      // The SVG is sanitized before it is mounted in the main document.
      dangerouslySetInnerHTML={{ __html: safeSvg }}
    />
  );
});

SvgPreviewRenderer.displayName = 'SvgPreviewRenderer';

/** Renderer dispatch adapted from LobeHub's local Artifacts Renderer. */
export const CodePreviewRenderer = memo<{ preview: CodePreview }>(({ preview }) => {
  if (preview.kind === 'html') {
    return <HtmlPreviewRenderer content={buildSafeHtmlSrcDoc(preview.body)} title={preview.title} />;
  }
  if (preview.kind === 'svg') return <SvgPreviewRenderer content={preview.body} />;
  if (preview.kind === 'mermaid') {
    return <div style={{ height: '100%', overflow: 'auto', padding: 24 }}><Mermaid variant="borderless">{preview.body}</Mermaid></div>;
  }
  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 24 }}>
      <Markdown enableMermaid fullFeaturedCodeBlock variant="chat">{preview.body}</Markdown>
    </div>
  );
});

CodePreviewRenderer.displayName = 'CodePreviewRenderer';
