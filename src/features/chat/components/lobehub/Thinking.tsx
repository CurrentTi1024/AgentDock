// Ported from: src/features/Conversation/components/Thinking (LobeHub canary)
// 思考/深度思考卡片：24px 状态块（思考中旋转 Loader / 完成后 Atom）、shiny 标题、
// 自动展开/收起、内容滚动区自动跟随。数据由投影层以 props 注入，不绑定 LobeHub store。
import { Accordion, AccordionItem, Block, Icon, ScrollArea, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Atom, Loader2 } from 'lucide-react';
import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';

import { Markdown } from '@/features/chat/components/Markdown';
import { useI18n } from '@/i18n';

const THINKING_PURPLE = '#bd54c6';

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  contentScroll: css`
    max-height: min(40vh, 320px);
    padding-block-end: 8px;
    padding-inline: 8px;
    color: ${token.colorTextDescription};

    article * {
      color: ${token.colorTextDescription};
    }
  `,
  scrollRoot: css`
    border-radius: 0;
    background: transparent;
  `,
  shinyText: css`
    color: color-mix(in srgb, ${token.colorText} 45%, transparent);

    background: linear-gradient(
      120deg,
      color-mix(in srgb, ${token.colorTextBase} 0%, transparent) 40%,
      ${token.colorTextSecondary} 50%,
      color-mix(in srgb, ${token.colorTextBase} 0%, transparent) 60%
    );
    background-clip: text;
    background-size: 200% 100%;

    animation: lobehub-thinking-shine 1.5s linear infinite;

    @keyframes lobehub-thinking-shine {
      0% {
        background-position: 100%;
      }

      100% {
        background-position: -100%;
      }
    }
  `,
}));

/** LobeHub Thinking StatusIndicator：24×24 轮廓块；思考中旋转 Loader，完成 Atom。 */
export const ThinkingStatus = memo<{ showDetail?: boolean; thinking?: boolean }>(
  ({ thinking, showDetail }) => (
    <Block
      horizontal
      align="center"
      flex="none"
      gap={4}
      height={24}
      justify="center"
      variant="outlined"
      width={24}
      style={{ fontSize: 12 }}
    >
      {thinking ? (
        <Icon color={cssVar.colorTextDescription} icon={Loader2} size={14} spin />
      ) : (
        <Icon
          color={showDetail ? THINKING_PURPLE : cssVar.colorTextDescription}
          icon={Atom}
          size={14}
        />
      )}
    </Block>
  ),
);

ThinkingStatus.displayName = 'ThinkingStatus';

/** LobeHub ThinkingTitle：思考中 shiny 文案；完成后“已深度思考（Xs）”。 */
const ThinkingTitle = memo<{ duration?: number; showDetail?: boolean; thinking?: boolean }>(
  ({ showDetail, thinking, duration }) => {
    const { t } = useI18n();
    return (
      <div style={{ alignItems: 'center', display: 'flex', gap: 6, minWidth: 0 }}>
        <ThinkingStatus showDetail={showDetail} thinking={thinking} />
        {thinking ? (
          <span className={styles.shinyText}>{t('chat.reasoningStreaming')}</span>
        ) : (
          <Text style={{ fontSize: 12 }} type="secondary">
            {!duration
              ? t('chat.reasoningDone')
              : t('chat.reasoningDuration', { seconds: (duration / 1000).toFixed(1) })}
          </Text>
        )}
      </div>
    );
  },
);

ThinkingTitle.displayName = 'ThinkingTitle';

/** 思考中内容自动跟随滚动到底（阈值 120px 内）。 */
const useAutoScroll = <T extends HTMLElement>(deps: unknown[], enabled: boolean, threshold = 120) => {
  const ref = useRef<T>(null);
  const handleScroll = () => {
    const node = ref.current;
    if (!node) return;
    if (node.scrollHeight - node.scrollTop - node.clientHeight > threshold) {
      // 用户上滑查看历史时停止跟随
      (ref as { current: T | null }).current = null;
    }
  };
  useEffect(() => {
    if (!enabled) return;
    const node = ref.current;
    if (node) node.scrollTop = node.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);
  return { handleScroll, ref };
};

export interface ThinkingProps {
  content?: ReactNode;
  duration?: number;
  encrypted?: boolean;
  style?: CSSProperties;
  thinking?: boolean;
  thinkingAnimated?: boolean;
}

/** LobeHub Thinking：思考中自动展开、完成后自动收起；用户可点击切换。 */
const Thinking = memo<ThinkingProps>((props) => {
  const { content, duration, thinking, encrypted, style } = props;
  const { t } = useI18n();
  const [showDetail, setShowDetail] = useState(false);
  const { handleScroll, ref } = useAutoScroll<HTMLDivElement>(
    [content, showDetail],
    !!thinking && !!showDetail,
    120,
  );

  useEffect(() => {
    setShowDetail(!!thinking);
  }, [thinking]);

  return (
    <Accordion
      expandedKeys={showDetail ? ['thinking'] : []}
      gap={8}
      onExpandedChange={(keys) => setShowDetail(keys.length > 0)}
      style={style}
    >
      <AccordionItem
        itemKey="thinking"
        paddingBlock={4}
        paddingInline={4}
        title={<ThinkingTitle duration={duration} showDetail={showDetail} thinking={thinking} />}
      >
        <ScrollArea
          className={styles.scrollRoot}
          contentProps={{
            style: {
              color: 'inherit',
              display: 'block',
              fontSize: 'inherit',
              gap: 0,
              lineHeight: 'inherit',
            },
          }}
          disableContentFit
          scrollFade
          viewportProps={{
            className: styles.contentScroll,
            onScroll: handleScroll,
            ref: ref as RefObject<HTMLDivElement>,
          }}
        >
          {encrypted ? (
            <Text type="secondary">{t('chat.reasoningEncrypted')}</Text>
          ) : typeof content === 'string' ? (
            <Markdown content={content} />
          ) : (
            content
          )}
        </ScrollArea>
      </AccordionItem>
    </Accordion>
  );
});

Thinking.displayName = 'Thinking';

export default Thinking;
