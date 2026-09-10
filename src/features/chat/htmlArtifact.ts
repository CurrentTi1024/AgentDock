/** Wire-level AG-UI activity discriminator. UI component names must not leak into the backend contract. */
export const HTML_ARTIFACT_ACTIVITY_TYPE = 'artifact';
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

const utf8Size = (value: string) => new TextEncoder().encode(value).byteLength;
const safeFileName = (value: string): string => {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').trim();
  const withExtension = /\.html?$/i.test(cleaned) ? cleaned : `${cleaned || 'artifact'}.html`;
  return withExtension.slice(0, 180);
};

/** Validate the canonical `ACTIVITY_SNAPSHOT(activityType="artifact")` payload. */
export const normalizeHtmlArtifact = (value: unknown): HtmlArtifact | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const payload = value as Record<string, unknown>;
  if (payload.activityType !== HTML_ARTIFACT_ACTIVITY_TYPE) return undefined;
  const mimeType = String(payload.mimeType ?? 'text/html').toLowerCase();
  if (mimeType !== 'text/html') return undefined;
  const body = typeof payload.body === 'string' ? payload.body : undefined;
  if (body === undefined) return undefined;
  const sizeBytes = utf8Size(body);
  if (sizeBytes > MAX_INLINE_HTML_BYTES) return undefined;
  const revision = Number.isSafeInteger(payload.revision) && Number(payload.revision) > 0
    ? Number(payload.revision)
    : 1;
  const artifactId = typeof payload.artifactId === 'string' && payload.artifactId.trim()
    ? payload.artifactId.trim().slice(0, 200)
    : String(payload.messageId || 'html-artifact').slice(0, 200);
  const title = typeof payload.title === 'string' && payload.title.trim()
    ? payload.title.trim().slice(0, 200)
    : 'HTML document';
  const presentation = payload.presentation && typeof payload.presentation === 'object'
    ? payload.presentation as Record<string, unknown>
    : {};
  return {
    artifactId,
    body,
    fileName: safeFileName(typeof payload.fileName === 'string' ? payload.fileName : title),
    mimeType: 'text/html',
    presentation: {
      autoOpen: presentation.autoOpen !== false,
      defaultTab: presentation.defaultTab === 'source' ? 'source' : 'preview',
    },
    revision,
    sizeBytes,
    title,
  };
};

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

export const findLatestHtmlArtifact = (values: Iterable<unknown>): HtmlArtifact | undefined => {
  let latest: HtmlArtifact | undefined;
  for (const value of values) {
    const artifact = normalizeHtmlArtifact(value);
    if (!artifact) continue;
    if (!latest || artifact.artifactId !== latest.artifactId || artifact.revision >= latest.revision) {
      latest = artifact;
    }
  }
  return latest;
};
