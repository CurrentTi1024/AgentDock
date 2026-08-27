// Ported from LobeHub canary 9208806:
// src/features/Conversation/ChatItem/{ChatItem,style,type}.tsx and components/{Avatar,Title,Actions,MessageContent}.tsx
// Store-bound behavior was replaced with props; DOM structure and visual states intentionally follow upstream.
import { Avatar, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { type MouseEventHandler, type ReactNode, memo } from 'react';

import { Markdown } from '@/features/chat/components/Markdown';
import { useI18n } from '@/i18n';
import { formatRelativeTime } from '@/lib/relativeTime';

const styles = createStaticStyles(({ css, cssVar }) => ({
  bubble: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadiusLG};
    background-color: ${cssVar.colorFillTertiary};
  `,
  container: css`
    position: relative;
    max-width: 100%;

    time,
    div[role='menubar'] {
      pointer-events: none;
      opacity: 0;
      transition: opacity 200ms ${cssVar.motionEaseOut};
    }

    time {
      display: inline-block;
      white-space: nowrap;
    }

    div[role='menubar'] {
      display: flex;
    }

    &:has([data-popup-open]) div[role='menubar'],
    &:hover time,
    &:hover div[role='menubar'] {
      pointer-events: unset;
      opacity: 1;
    }
  `,
  disabled: css`
    user-select: none;
    color: ${cssVar.colorTextSecondary};
  `,
  message: css`
    position: relative;
    overflow: hidden;
    max-width: 100%;
  `,
}));

export interface ChatItemProps {
  aboveMessage?: ReactNode;
  actionAddon?: ReactNode;
  actions?: ReactNode;
  afterActions?: ReactNode;
  avatar?: string | ReactNode;
  avatarBackground?: string;
  belowMessage?: ReactNode;
  children?: ReactNode;
  className?: string;
  content?: string;
  customAvatarRender?: (node: ReactNode) => ReactNode;
  disabled?: boolean;
  editing?: boolean;
  enableStream?: boolean;
  id: string;
  loading?: boolean;
  messageExtra?: ReactNode;
  name: string;
  onChange?: (value: string) => void;
  onDoubleClick?: MouseEventHandler<HTMLDivElement>;
  onEditingChange?: (editing: boolean) => void;
  role: 'assistant' | 'user';
  showAvatar?: boolean;
  showTitle?: boolean;
  time?: number;
  titleAddon?: ReactNode;
}

const ChatItem = memo<ChatItemProps>(
  ({
    aboveMessage,
    actionAddon,
    actions,
    afterActions,
    avatar,
    avatarBackground,
    belowMessage,
    children,
    className,
    content,
    customAvatarRender,
    disabled,
    enableStream,
    id,
    loading,
    messageExtra,
    name,
    onDoubleClick,
    role,
    showAvatar,
    showTitle,
    time,
    titleAddon,
  }) => {
    const { locale } = useI18n();
    const isUser = role === 'user';
    const shouldShowAvatar = showAvatar ?? !isUser;
    const shouldShowTitle = showTitle ?? !isUser;
    const avatarNode = (
      <Avatar
        animation={loading}
        avatar={avatar ?? (isUser ? 'LC' : '🤖')}
        background={avatarBackground}
        shape="square"
        size={28}
        title={name}
      />
    );
    const timeText = time
      ? formatRelativeTime(new Date(time).toISOString(), locale)
      : undefined;
    const hasContent = typeof content === 'string' && content.trim().length > 0;

    return (
      <Flexbox
        align={isUser ? 'flex-end' : 'flex-start'}
        className={cx('message-wrapper', styles.container, className)}
        data-message-id={id}
        gap={8}
        paddingBlock={8}
        style={{ paddingInlineStart: isUser ? 36 : 0 }}
      >
        <Flexbox
          horizontal
          align="center"
          className="message-header"
          direction={isUser ? 'horizontal-reverse' : 'horizontal'}
          gap={8}
        >
          {shouldShowAvatar &&
            (customAvatarRender ? customAvatarRender(avatarNode) : avatarNode)}
          {shouldShowTitle && (
            <Text fontSize={14} weight={500}>
              {name}
            </Text>
          )}
          {shouldShowTitle ? titleAddon : undefined}
          {timeText ? (
            <Text
              aria-label="published-date"
              as="time"
              fontSize={12}
              title={new Date(time!).toLocaleString(locale)}
              type="secondary"
            >
              {timeText}
            </Text>
          ) : null}
        </Flexbox>

        <Flexbox
          className="message-body"
          gap={8}
          style={{
            maxWidth: '100%',
            overflow: 'hidden',
            position: 'relative',
            width: isUser ? undefined : '100%',
          }}
        >
          {aboveMessage}
          <Flexbox
            className={cx(styles.message, isUser && styles.bubble, disabled && styles.disabled)}
            gap={16}
            onDoubleClick={onDoubleClick}
          >
            {children}
            {hasContent ? <Markdown content={content!} enableStream={enableStream} /> : null}
            {messageExtra}
          </Flexbox>
          {belowMessage}
        </Flexbox>

        {(actionAddon || actions) && (
          <Flexbox
            horizontal
            align="center"
            gap={4}
            style={{ alignSelf: isUser ? 'flex-end' : 'flex-start' }}
          >
            {!isUser && actionAddon}
            {actions}
            {isUser && actionAddon}
          </Flexbox>
        )}
        {afterActions ? (
          <Flexbox style={{ width: isUser ? undefined : '100%' }}>{afterActions}</Flexbox>
        ) : null}
      </Flexbox>
    );
  },
);

ChatItem.displayName = 'ChatItem';

export default ChatItem;
