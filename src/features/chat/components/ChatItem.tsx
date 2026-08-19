// Adapted from: src/features/Conversation/ChatItem + Messages/{User,Assistant} (LobeHub canary)
// 包装官方 @lobehub/ui/chat ChatItem：视觉与交互（bubble 卡片、hover 操作栏、标题/时间、
// 加载动画）与 LobeHub 一致；数据由投影层以 props 注入，不绑定任何 store。
import { ChatItem as LobeChatItem, type ChatItemProps as LobeChatItemProps } from '@lobehub/ui/chat';
import { Flexbox } from '@lobehub/ui';
import type { MetaData } from '@lobehub/ui/chat';
import { type ComponentType, type ReactNode } from 'react';
import { memo } from 'react';

export interface ChatItemProps {
  actions?: ReactNode;
  avatar?: string | ReactNode;
  children?: ReactNode;
  content?: string;
  id: string;
  loading?: boolean;
  messageExtra?: ReactNode;
  name: string;
  role: 'assistant' | 'user';
  showTitle?: boolean;
  time?: number;
  titleAddon?: ReactNode;
}

const toEpoch = (time?: number) => (typeof time === 'number' && Number.isFinite(time) ? time : undefined);

// 官方 ChatItem 的类型声明省略了 children（运行时 MessageContent 支持），这里显式补上。
const LobeChatItemWithChildren = LobeChatItem as unknown as ComponentType<
  LobeChatItemProps & { children?: ReactNode }
>;

const ChatItem = memo<ChatItemProps>(
  ({ actions, avatar, children, content, id, loading, messageExtra, name, role, showTitle, time, titleAddon }) => {
    const isUser = role === 'user';
    // 用户气泡显示本人头像（右侧）；agent 使用 docs 变体（无外边框），动作栏独立成行。
    const avatarValue = avatar ?? (isUser ? 'LC' : '🤖');
    const meta: MetaData =
      typeof avatarValue === 'string'
        ? { avatar: avatarValue, title: name }
        : { title: name };
    return (
      <LobeChatItemWithChildren
        actions={actions}
        actionsWrapWidth={isUser ? 10_000 : undefined}
        avatar={meta}
        id={id}
        loading={loading}
        message={content === undefined ? undefined : content}
        messageExtra={messageExtra}
        placement={isUser ? 'right' : 'left'}
        renderMessage={(content) => (
          <Flexbox gap={8} style={{ width: '100%' }}>
            {content}
            {children}
          </Flexbox>
        )}
        showAvatar
        showTitle={showTitle ?? !isUser}
        time={toEpoch(time)}
        titleAddon={titleAddon}
        variant={isUser ? 'bubble' : 'docs'}
      >
        {children}
      </LobeChatItemWithChildren>
    );
  },
);

ChatItem.displayName = 'ChatItem';

export default ChatItem;
