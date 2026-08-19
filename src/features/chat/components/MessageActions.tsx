// Adapted from: src/features/Conversation/Messages/User/Actions + Assistant/Actions (LobeHub canary)
// LobeHub 风格消息悬浮操作栏：hover 显示，动作全部走回调 props（不绑定 store）。
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { Copy, RotateCcw, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';
import { memo } from 'react';

import { useI18n } from '@/i18n';

export interface MessageActionsProps {
  canDelete?: boolean;
  canRegenerate?: boolean;
  content: string;
  placement?: 'assistant' | 'user';
  onCopy?: (content: string) => void;
  onDelete?: () => void;
  onDislike?: () => void;
  onLike?: () => void;
  onRegenerate?: () => void;
}

export const MessageActions = memo<MessageActionsProps>(
  ({
    canDelete = true,
    canRegenerate = true,
    content,
    onCopy,
    onDelete,
    onDislike,
    onLike,
    onRegenerate,
    placement = 'assistant',
  }) => {
    const { t } = useI18n();
    return (
      <Flexbox horizontal gap={2} role="menubar">
        {placement === 'assistant' && (
          <>
            {onLike && (
              <ActionIcon
                aria-label={t('chat.like')}
                icon={ThumbsUp}
                size="small"
                title={t('chat.like')}
                onClick={onLike}
              />
            )}
            {onDislike && (
              <ActionIcon
                aria-label={t('chat.dislike')}
                icon={ThumbsDown}
                size="small"
                title={t('chat.dislike')}
                onClick={onDislike}
              />
            )}
          </>
        )}
        {onCopy && (
          <ActionIcon
            aria-label={t('chat.copy')}
            icon={Copy}
            size="small"
            title={t('chat.copy')}
            onClick={() => onCopy(content)}
          />
        )}
        {canRegenerate && onRegenerate && (
          <ActionIcon
            aria-label={t('chat.action.regenerate')}
            icon={RotateCcw}
            size="small"
            title={t('chat.action.regenerate')}
            onClick={onRegenerate}
          />
        )}
        {canDelete && onDelete && (
          <ActionIcon
            aria-label={t('chat.action.delete')}
            icon={Trash2}
            size="small"
            title={t('chat.action.delete')}
            onClick={onDelete}
          />
        )}
      </Flexbox>
    );
  },
);

MessageActions.displayName = 'MessageActions';

export default MessageActions;
