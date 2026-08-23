// Adapted from: src/features/Conversation/Messages/Assistant/useMarkdown (LobeHub canary)
// 直接使用 @lobehub/ui 的 Markdown 渲染管线（代码高亮/mermaid/latex/流式动画），
// 与 LobeHub 对话页视觉一致。
import { Markdown as LobeMarkdown } from '@lobehub/ui';
import { memo } from 'react';
import { useNavigate } from 'react-router-dom';

// LobeHub @agent mention：文本中的 @AgentName 转成可点击的站内链接（跳市场/对话）。
const AGENT_MENTION_RE = /@([A-Za-z0-9_\-\u4e00-\u9fa5]+)/g;

const remarkAgentMention = () => (tree: { type?: string; value?: string; children?: unknown[] }) => {
  const visit = (node: { type?: string; value?: string; children?: unknown[] }, parent?: { children: unknown[] }, index = -1) => {
    if (node.type === 'text' && typeof node.value === 'string' && node.value.includes('@')) {
      const parts: unknown[] = [];
      let last = 0;
      const re = new RegExp(AGENT_MENTION_RE.source, 'g');
      let match: RegExpExecArray | null;
      while ((match = re.exec(node.value)) !== null) {
        if (match.index > last) {
          parts.push({ type: 'text', value: node.value.slice(last, match.index) });
        }
        parts.push({
          children: [{ type: 'text', value: `@${match[1]}` }],
          type: 'link',
          url: `/market/agent?kw=${encodeURIComponent(match[1])}`,
        });
        last = match.index + match[0].length;
      }
      if (last < node.value.length) {
        parts.push({ type: 'text', value: node.value.slice(last) });
      }
      if (parent && parts.length > 1 && index >= 0) {
        parent.children.splice(index, 1, ...parts);
        parts.forEach((part, offset) => visit(part as { type?: string; value?: string; children?: unknown[] }, parent, index + offset));
        return;
      }
    }
    if (Array.isArray(node.children)) {
      node.children.forEach((child, childIndex) =>
        visit(child as { type?: string; value?: string; children?: unknown[] }, node as unknown as { children: unknown[] }, childIndex),
      );
    }
  };
  visit(tree);
};

const AgentMentionLink = ({ children, href }: { children?: React.ReactNode; href?: string }) => {
  const navigate = useNavigate();
  return (
    <a
      href={href}
      onClick={(event) => {
        if (href?.startsWith('/')) {
          event.preventDefault();
          navigate(href);
        }
      }}
      style={{ fontWeight: 500 }}
    >
      {children}
    </a>
  );
};

interface MarkdownProps {
  content: string;
  enableStream?: boolean;
}

export const Markdown = memo<MarkdownProps>(({ content, enableStream = true }) => (
  <LobeMarkdown
    animated={enableStream}
    components={{ a: AgentMentionLink }}
    enableMermaid
    fullFeaturedCodeBlock
    remarkPlugins={[remarkAgentMention]}
    variant="chat"
  >
    {content}
  </LobeMarkdown>
));

Markdown.displayName = 'Markdown';

export default Markdown;
