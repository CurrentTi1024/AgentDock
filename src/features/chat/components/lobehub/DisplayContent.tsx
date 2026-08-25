// Ported from: src/features/Conversation/Messages/components/DisplayContent (LobeHub canary)
// 助手正文显示：工具调用生成中不渲染正文占位（工具卡自身可见）；
// 内容为空且生成中显示 ContentLoading；否则走 Markdown 管线。
import { memo } from 'react';

import { Markdown } from '@/features/chat/components/Markdown';
import ContentLoading from './ContentLoading';

export interface DisplayContentProps {
  content: string;
  generating?: boolean;
  hasImages?: boolean;
  isToolCallGenerating?: boolean;
  startTime?: number;
}

const DisplayContent = memo<DisplayContentProps>(
  ({ content, generating, hasImages, isToolCallGenerating, startTime }) => {
    // 工具调用生成中：不显示正文占位（工具卡/思考块已可见）。
    if (isToolCallGenerating) return null;
    if (!content && !hasImages) {
      return generating ? <ContentLoading startTime={startTime} /> : null;
    }
    return <Markdown content={content} />;
  },
);

DisplayContent.displayName = 'DisplayContent';

export default DisplayContent;
