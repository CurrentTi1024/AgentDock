// Adapted from: src/features/Conversation/Messages/Assistant/useMarkdown (LobeHub canary)
// 直接使用 @lobehub/ui 的 Markdown 渲染管线（代码高亮/mermaid/latex/流式动画），
// 与 LobeHub 对话页视觉一致。
import { Markdown as LobeMarkdown } from '@lobehub/ui';
import { memo } from 'react';

interface MarkdownProps {
  content: string;
  enableStream?: boolean;
}

export const Markdown = memo<MarkdownProps>(({ content, enableStream = true }) => (
  <LobeMarkdown
    animated={enableStream}
    enableMermaid
    fullFeaturedCodeBlock
    variant="chat"
  >
    {content}
  </LobeMarkdown>
));

Markdown.displayName = 'Markdown';

export default Markdown;
