// Adapted from: src/features/Conversation/Markdown (LobeHub canary) — 纯展示渲染管线
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const styles = createStaticStyles(({ css, cssVar }) => ({
  markdown: css`
    font-size: 15px;
    line-height: 1.8;
    word-break: break-word;

    p {
      margin-block: 0 0.75em;
      &:last-child {
        margin-block-end: 0;
      }
    }

    pre {
      overflow-x: auto;
      padding: 12px;
      border-radius: ${cssVar.borderRadiusLG}px;
      background: ${cssVar.colorFillTertiary};
    }

    code {
      font-size: 0.9em;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    table {
      border-collapse: collapse;
      margin-block: 0.75em;
      width: 100%;
      th,
      td {
        border: 1px solid ${cssVar.colorBorderSecondary};
        padding: 6px 10px;
      }
    }

    blockquote {
      margin-inline: 0;
      padding-inline-start: 12px;
      border-inline-start: 3px solid ${cssVar.colorBorderSecondary};
      color: ${cssVar.colorTextDescription};
    }

    a {
      color: ${cssVar.colorPrimary};
    }
  `,
}));

export const Markdown = memo(({ content }: { content: string }) => (
  <div className={styles.markdown}>
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
  </div>
));

Markdown.displayName = 'Markdown';
