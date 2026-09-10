export const MAX_INLINE_HTML_BYTES = 512 * 1024;

export interface HtmlArtifact {
  artifactId: string;
  body: string;
  fileName: string;
  mimeType: 'text/html';
  presentation: {
    autoOpen: boolean;
    defaultTab: 'preview' | 'source';
  };
  revision: number;
  sizeBytes: number;
  title: string;
}

export type MarkdownHtmlSegment =
  | { content: string; kind: 'markdown' }
  | { content: string; kind: 'html' };

/** Only explicit fenced html/htm blocks are previewable; ordinary inline tags remain text. */
export const splitHtmlCodeBlocks = (content: string): MarkdownHtmlSegment[] => {
  const segments: MarkdownHtmlSegment[] = [];
  const fence = /(^|\n)(`{3,}|~{3,})[ \t]*(?:html|htm)[ \t]*\r?\n([\s\S]*?)\r?\n\2[ \t]*(?=\n|$)/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(content)) !== null) {
    const start = match.index + match[1].length;
    if (start > cursor) segments.push({ content: content.slice(cursor, start), kind: 'markdown' });
    segments.push({ content: match[3], kind: 'html' });
    cursor = fence.lastIndex;
  }
  if (cursor < content.length) segments.push({ content: content.slice(cursor), kind: 'markdown' });
  return segments.length ? segments : [{ content, kind: 'markdown' }];
};

export const createInlineHtmlPreview = (body: string): HtmlArtifact | undefined => {
  if (utf8Size(body) > MAX_INLINE_HTML_BYTES) return undefined;
  // Include content in the identity so equal-length fenced blocks cannot reuse panel state.
  let hash = 2166136261;
  for (let index = 0; index < body.length; index += 1) {
    hash ^= body.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return {
    artifactId: `inline-html-${body.length}-${(hash >>> 0).toString(36)}`,
    body,
    fileName: 'inline-html-preview.html',
    mimeType: 'text/html',
    presentation: { autoOpen: false, defaultTab: 'preview' },
    revision: 1,
    sizeBytes: utf8Size(body),
    title: 'HTML preview',
  };
};

/** Return the last complete fenced HTML block in a text message. */
export const findLatestInlineHtmlPreview = (content?: string): HtmlArtifact | undefined => {
  if (!content) return undefined;
  const htmlSegments = splitHtmlCodeBlocks(content).filter((segment) => segment.kind === 'html');
  return htmlSegments.length ? createInlineHtmlPreview(htmlSegments.at(-1)!.content) : undefined;
};

const utf8Size = (value: string) => new TextEncoder().encode(value).byteLength;
const PREVIEW_CSP = [
  "default-src 'none'",
  "img-src data: blob:",
  "style-src 'unsafe-inline'",
  'font-src data:',
  "script-src 'none'",
  "connect-src 'none'",
  "media-src data: blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
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
      if (name.startsWith('on') || ((name === 'href' || name === 'src' || name === 'xlink:href') && value.startsWith('javascript:'))) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  const meta = document.createElement('meta');
  meta.setAttribute('http-equiv', 'Content-Security-Policy');
  meta.setAttribute('content', PREVIEW_CSP);
  document.head.prepend(meta);
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
};

export const htmlArtifactKey = (artifact: HtmlArtifact) => `${artifact.artifactId}:${artifact.revision}`;
