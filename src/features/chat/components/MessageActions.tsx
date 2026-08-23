// Adapted from: src/features/Conversation/Messages/User/Actions + Assistant/Actions (LobeHub canary)
// LobeHub 风格消息悬浮操作栏：hover 显示，动作全部走回调 props（不绑定 store）。
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { DropdownMenu } from '@lobehub/ui/base-ui';
import {
  AudioLines,
  Copy,
  Languages,
  MoreHorizontal,
  RotateCcw,
  Share2,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import { memo } from 'react';

import { useI18n } from '@/i18n';

export interface MessageActionsProps {
  canDelete?: boolean;
  canRegenerate?: boolean;
  content: string;
  placement?: 'assistant' | 'user';
  onCopy?: (content: string) => void;
  onDelete?: () => void;
  onDeleteAndRegenerate?: () => void;
  onDislike?: () => void;
  onLike?: () => void;
  onRegenerate?: () => void;
  onRestoreToInput?: (content: string) => void;
}

export const MessageActions = memo<MessageActionsProps>(
  ({
    canDelete = true,
    canRegenerate = true,
    content,
    onCopy,
    onDelete,
    onDeleteAndRegenerate,
    onDislike,
    onLike,
    onRegenerate,
    onRestoreToInput,
    placement = 'assistant',
  }) => {
    const { t } = useI18n();
    const moreItems = [
      ...(onRestoreToInput
        ? [{ icon: <RotateCcw size={14} />, key: 'restore', label: t('chat.action.restoreToInput'), onClick: () => onRestoreToInput(content) }]
        : []),
      ...(onDeleteAndRegenerate
        ? [{ icon: <Trash2 size={14} />, key: 'del-regen', label: t('chat.action.delAndRegenerate'), onClick: onDeleteAndRegenerate }]
        : []),
      ...(onRestoreToInput || onDeleteAndRegenerate ? [{ type: 'divider' as const, key: 'divider' }] : []),
      { disabled: true, icon: <AudioLines size={14} />, key: 'tts', label: t('chat.action.tts') },
      { disabled: true, icon: <Languages size={14} />, key: 'translate', label: t('chat.action.translate') },
      { disabled: true, icon: <Share2 size={14} />, key: 'share', label: t('chat.action.share') },
    ];
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
        <DropdownMenu items={moreItems} placement="bottom">
          <ActionIcon
            aria-label={t('chat.action.more')}
            icon={MoreHorizontal}
            size="small"
            title={t('chat.action.more')}
          />
        </DropdownMenu>
      </Flexbox>
    );
  },
);

MessageActions.displayName = 'MessageActions';

export default MessageActions;
