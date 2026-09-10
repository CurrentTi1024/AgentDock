// Adapted from LobeHub canary 920880679a:
// src/features/Portal/Artifacts/Body/Renderer/HTML.tsx and
// src/components/HtmlPreview/InlinePreview.tsx.
import { HtmlPreview } from '@lobehub/ui';
import type { CSSProperties } from 'react';
import { memo } from 'react';

interface HtmlPreviewRendererProps {
  content: string;
  height?: CSSProperties['height'];
  title?: string;
  width?: CSSProperties['width'];
}

const hideHtmlPreviewActions = () => null;

/**
 * LobeHub's HTML preview surface, constrained for untrusted Agent output.
 * The caller supplies a sanitized document with a restrictive CSP; an empty
 * sandbox deliberately prevents script, form, popup and same-origin access.
 */
export const HtmlPreviewRenderer = memo<HtmlPreviewRendererProps>(
  ({ content, height = '100%', title = 'HTML preview', width = '100%' }) => (
    <HtmlPreview
      actionsRender={hideHtmlPreviewActions}
      copyable={false}
      downloadable={false}
      sandbox=""
      shadow={false}
      style={{ height, minHeight: 0, overflow: 'hidden', width }}
      variant="borderless"
      styles={{
        content: { height: '100%' },
        iframe: { background: '#fff', height: '100%' },
      }}
      // HtmlPreview currently owns the iframe title internally. Keep this prop
      // available in our adapter API for the SVG/Mermaid renderer expansion.
      title={title}
    >
      {content}
    </HtmlPreview>
  ),
);

HtmlPreviewRenderer.displayName = 'HtmlPreviewRenderer';
