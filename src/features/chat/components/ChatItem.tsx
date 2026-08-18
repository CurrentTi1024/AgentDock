// Adapted from: src/features/Conversation/ChatItem (LobeHub canary)
import { Avatar, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { type ReactNode } from 'react';
import { memo } from 'react';

import { Markdown } from './Markdown';

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  actions: css`
    pointer-events: none;
    opacity: 0;
    transition: opacity 200ms ${token.motionEaseOut};
  `,
  assistant: css`
    &:hover .message-actions,
    &:focus-within .message-actions {
      pointer-events: unset;
      opacity: 1;
    }
  `,
  bubble: css`
    max-width: 72%;
    border-radius: ${token.borderRadiusLG}px 4px ${token.borderRadiusLG}px ${token.borderRadiusLG}px;
    padding: 10px 14px;
    background: ${token.colorFillSecondary};
  `,
  container: css`
    position: relative;
    max-width: 100%;
  `,
  content: css`
    width: 100%;
    overflow: hidden;
    position: relative;
  `,
}));

export interface ChatItemProps {
  actions?: ReactNode;
  avatar: string | ReactNode;
  children?: ReactNode;
  content?: string;
  id: string;
  loading?: boolean;
  name: string;
  role: 'assistant' | 'user';
  time?: string;
}

const ChatItem = memo<ChatItemProps>(
  ({ actions, avatar, children, content, id, loading, name, role, time }) => {
    const isUser = role === 'user';
    const avatarNode =
      typeof avatar === 'string' ? (
        <Avatar avatar={avatar} shape={isUser ? undefined : 'square'} size={32} />
      ) : (
        avatar
      );

    return (
      <Flexbox
        align={isUser ? 'flex-end' : 'flex-start'}
        className={`${styles.container} ${isUser ? '' : styles.assistant}`}
        data-message-id={id}
        gap={8}
        paddingBlock={8}
        style={{ paddingInlineStart: isUser ? 36 : 0 }}
      >
        <Flexbox
          align="center"
          direction={isUser ? 'horizontal-reverse' : 'horizontal'}
          gap={8}
        >
          {avatarNode}
          <Flexbox horizontal align="center" gap={8}>
            <Text fontSize={13} weight={500}>
              {name}
            </Text>
            {time && (
              <Text fontSize={11} type="secondary">
                {time}
              </Text>
            )}
          </Flexbox>
        </Flexbox>
        <Flexbox className={styles.content} gap={8} style={{ maxWidth: '100%' }}>
          {children}
          {content !== undefined &&
            (isUser ? (
              <div className={styles.bubble}>{content}</div>
            ) : (
              <div>
                <Markdown content={content} />
                {loading && <span style={{ color: cssVar.colorPrimary }}> ▍</span>}
              </div>
            ))}
        </Flexbox>
        {actions && (
          <Flexbox className={`${styles.actions} message-actions`} gap={2}>
            {actions}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

ChatItem.displayName = 'ChatItem';

export default ChatItem;
