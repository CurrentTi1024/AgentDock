// Ported from: src/features/Conversation/ChatItem/components/ErrorContent (LobeHub canary)
// RUN_ERROR 显示：可关闭的错误 Alert（标题=错误信息，可带 code），附“重新生成”按钮。
// 数据由投影层以 props 注入，不绑定 LobeHub store。
import { Alert } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { RotateCcw } from 'lucide-react';
import { memo } from 'react';

import { useI18n } from '@/i18n';

export interface ErrorAlertProps {
  closable?: boolean;
  code?: string;
  message: string;
  onClose?: () => void;
  onRegenerate?: () => void;
  retrying?: boolean;
}

const ErrorAlert = memo<ErrorAlertProps>(
  ({ closable = true, code, message, onClose, onRegenerate, retrying }) => {
    const { t } = useI18n();
    return (
      <Alert
        action={
          onRegenerate ? (
            <Button
              icon={<RotateCcw size={14} />}
              loading={retrying}
              size="small"
              type="fill"
              onClick={onRegenerate}
            >
              {t('chat.action.regenerate')}
            </Button>
          ) : undefined
        }
        afterClose={onClose}
        closable={closable}
        description={code ? `[${code}]` : undefined}
        showIcon
        style={{ overflow: 'hidden', position: 'relative', width: '100%' }}
        title={message}
        type="error"
      />
    );
  },
);

ErrorAlert.displayName = 'ErrorAlert';

export default ErrorAlert;
