export const MAX_INLINE_PREVIEW_BYTES = 512 * 1024;

export type CodePreviewKind = 'html' | 'markdown' | 'mermaid' | 'svg';

export interface CodePreview {
  artifactId: string;
  body: string;
  fileName: string;
  kind: CodePreviewKind;
  mimeType: 'image/svg+xml' | 'text/html' | 'text/markdown' | 'text/vnd.mermaid';
  presentation: { autoOpen: boolean; defaultTab: 'preview' | 'source' };
  revision: number;
  sizeBytes: number;
  title: string;
}

export type PreviewCodeSegment =
  | { content: string; kind: 'markdown' }
  | { content: string; kind: 'preview'; previewKind: CodePreviewKind };

const LANGUAGE_KIND: Record<string, CodePreviewKind> = {
  htm: 'html', html: 'html', markdown: 'markdown', md: 'markdown', mermaid: 'mermaid', svg: 'svg',
};

/** Only complete, explicitly typed fences are previewable; ordinary inline markup stays in the message. */
export const splitPreviewCodeBlocks = (content: string): PreviewCodeSegment[] => {
  const segments: PreviewCodeSegment[] = [];
  const fence = /(^|\n)(`{3,}|~{3,})[ \t]*(html|htm|svg|mermaid|markdown|md)[ \t]*\r?\n([\s\S]*?)\r?\n\2[ \t]*(?=\n|$)/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(content)) !== null) {
    const start = match.index + match[1].length;
    if (start > cursor) segments.push({ content: content.slice(cursor, start), kind: 'markdown' });
    segments.push({ content: match[4], kind: 'preview', previewKind: LANGUAGE_KIND[match[3].toLowerCase()] });
    cursor = fence.lastIndex;
  }
  if (cursor < content.length) segments.push({ content: content.slice(cursor), kind: 'markdown' });
  return segments.length ? segments : [{ content, kind: 'markdown' }];
};

const METADATA: Record<CodePreviewKind, Pick<CodePreview, 'fileName' | 'mimeType' | 'title'>> = {
  html: { fileName: 'inline-preview.html', mimeType: 'text/html', title: 'HTML preview' },
  markdown: { fileName: 'inline-preview.md', mimeType: 'text/markdown', title: 'Markdown preview' },
  mermaid: { fileName: 'inline-preview.mmd', mimeType: 'text/vnd.mermaid', title: 'Mermaid preview' },
  svg: { fileName: 'inline-preview.svg', mimeType: 'image/svg+xml', title: 'SVG preview' },
};

export const createInlineCodePreview = (body: string, kind: CodePreviewKind): CodePreview | undefined => {
  const sizeBytes = utf8Size(body);
  if (sizeBytes > MAX_INLINE_PREVIEW_BYTES) return undefined;
  let hash = 2166136261;
  for (let index = 0; index < body.length; index += 1) {
    hash ^= body.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return {
    artifactId: `inline-${kind}-${body.length}-${(hash >>> 0).toString(36)}`,
    body, kind, ...METADATA[kind], presentation: { autoOpen: false, defaultTab: 'preview' }, revision: 1, sizeBytes,
  };
};

/** Return the last complete previewable fenced block in a text message. */
export const findLatestInlineCodePreview = (content?: string): CodePreview | undefined => {
  if (!content) return undefined;
  const previews = splitPreviewCodeBlocks(content).filter((segment) => segment.kind === 'preview');
  const latest = previews.at(-1);
  return latest?.kind === 'preview' ? createInlineCodePreview(latest.content, latest.previewKind) : undefined;
};

const utf8Size = (value: string) => new TextEncoder().encode(value).byteLength;
const PREVIEW_CSP = [
  "default-src 'none'", 'img-src data: blob:', "style-src 'unsafe-inline'", 'font-src data:', "script-src 'none'",
  "connect-src 'none'", 'media-src data: blob:', "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'",
].join('; ');

/** Defense in depth for an untrusted srcDoc rendered in a unique-origin, permissionless iframe. */
export const buildSafeHtmlSrcDoc = (html: string): string => {
  const document = new DOMParser().parseFromString(html, 'text/html');
  document.querySelectorAll('script, iframe, frame, object, embed, base, form').forEach((node) => node.remove());
  document.querySelectorAll('meta[http-equiv], link[rel="preload"], link[rel="modulepreload"], link[rel="stylesheet"]').forEach((node) => node.remove());
  document.querySelectorAll('*').forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || ((name === 'href' || name === 'src' || name === 'xlink:href') && value.startsWith('javascript:'))) element.removeAttribute(attribute.name);
    }
  });
  const meta = document.createElement('meta');
  meta.setAttribute('http-equiv', 'Content-Security-Policy');
  meta.setAttribute('content', PREVIEW_CSP);
  document.head.prepend(meta);
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
};

export const codePreviewKey = (preview: CodePreview) => `${preview.artifactId}:${preview.revision}`;

// Compatibility aliases keep the public surface stable while the panel implementation becomes generic.
export type HtmlArtifact = CodePreview;
export const htmlArtifactKey = codePreviewKey;
