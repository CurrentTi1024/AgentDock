// Adapted from: src/features/Conversation/Messages/Assistant/useMarkdown (LobeHub canary)
// 直接使用 @lobehub/ui 的 Markdown 渲染管线（代码高亮/mermaid/latex/流式动画），
// 与 LobeHub 对话页视觉一致。
import { Markdown as LobeMarkdown } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useNavigate } from 'react-router-dom';

// LobeHub Mention 插件样式：内联 info 色 chip。
const styles = createStaticStyles(({ css, cssVar: token }) => ({
  mention: css`
    cursor: pointer;
    position: relative;
    display: inline;
    margin-inline: 0.25em;
    padding-block: 0.2em;
    padding-inline: 0.4em;
    border-radius: 0.25em;
    font-size: 0.875em;
    line-height: 1;
    color: ${token.colorInfo};
    word-break: break-word;
    white-space: break-spaces;
    background: ${token.colorInfoBg};

    &:hover {
      background: color-mix(in srgb, ${token.colorInfo} 15%, ${token.colorBgContainer});
    }
  `,
}));

// LobeHub @agent mention：
// - 编辑器序列化的 `<mention name=".." id=".." />` 转成可点击的蓝色 chip（跳 Agent 详情）；
// - 纯文本 @AgentName 转成站内链接（跳市场搜索）。
const AGENT_MENTION_RE = /@([A-Za-z0-9_\-\u4e00-\u9fa5]+)/g;
const MENTION_TAG_RE = /<mention\s+name="([^"]*)"\s+id="([^"]*)"\s*\/?>/g;

const mentionUrlFromId = (id: string) => {
  const [agentId, fab] = id.split('@');
  return `/market/agent/${encodeURIComponent(agentId || '')}?fab=${encodeURIComponent(fab || '')}`;
};

const remarkAgentMention = () => (tree: { type?: string; value?: string; children?: unknown[] }) => {
  const visit = (
    node: { type?: string; value?: string; children?: unknown[] },
    parent?: { children: unknown[]; type?: string },
    index = -1,
  ) => {
    if (node.type === 'text' && typeof node.value === 'string' && node.value.includes('@')) {
      // 纯文本 @AgentName → 链接；link 内部（mention chip 已由预处理生成）不再重复处理。
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
      if (parent?.type !== 'link' && parent && parts.length > 1 && index >= 0) {
        parent.children.splice(index, 1, ...parts);
        parts.forEach((part, offset) => visit(part as { type?: string; value?: string; children?: unknown[] }, parent, index + offset));
        return;
      }
    }
    if (Array.isArray(node.children)) {
      node.children.forEach((child, childIndex) =>
        visit(
          child as { type?: string; value?: string; children?: unknown[] },
          node.type === 'link' ? undefined : (node as unknown as { children: unknown[] }),
          node.type === 'link' ? -1 : childIndex,
        ),
      );
    }
  };
  visit(tree);
};

// <mention name id />（编辑器序列化）在 react-markdown 里是 html 节点而非文本节点，
// 插件不便处理；这里在渲染前直接替换为标准 markdown 链接，走蓝色 chip 链接渲染。
const withMentionLinks = (content: string) =>
  content.replace(MENTION_TAG_RE, (_match, name: string, id: string) => `[@${name}](${mentionUrlFromId(id)})`);

const AgentMentionLink = ({ children, href }: { children?: React.ReactNode; href?: string }) => {
  const navigate = useNavigate();
  return (
    <a
      className={styles.mention}
      href={href}
      onClick={(event) => {
        if (href?.startsWith('/')) {
          event.preventDefault();
          navigate(href);
        }
      }}
    >
      {children}
    </a>
  );
};

interface MarkdownProps {
  content: string;
  enableStream?: boolean;
}

// 历史消息进入 Session 时会整批挂载，默认禁用动画，避免完整内容被当作新 token 重放。
// 当前正在运行的助手消息由调用方显式开启流式动画。
export const Markdown = memo<MarkdownProps>(({ content, enableStream = false }) => (
  <LobeMarkdown
    animated={enableStream}
    components={{ a: AgentMentionLink }}
    enableMermaid
    enableStream={enableStream}
    fullFeaturedCodeBlock
    remarkPlugins={[remarkAgentMention]}
    variant="chat"
  >
    {withMentionLinks(content)}
  </LobeMarkdown>
));

Markdown.displayName = 'Markdown';

export default Markdown;
