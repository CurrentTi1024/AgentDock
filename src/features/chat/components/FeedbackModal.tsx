// LobeHub MessageFeedback：表单式用户反馈（原因 + 补充说明）。
import { Button, Flexbox, Modal, Text, TextArea } from '@lobehub/ui';
import { Checkbox } from '@lobehub/ui/base-ui';
import { memo, useState } from 'react';

import { messageFeedbackService } from '@/api/conversation/messageFeedbackService';
import { useI18n } from '@/i18n';

const REASON_KEYS = [
  'chat.feedback.reason.incorrect',
  'chat.feedback.reason.irrelevant',
  'chat.feedback.reason.misleading',
  'chat.feedback.reason.other',
] as const;

export interface FeedbackTarget {
  messageId: string;
  runId: string;
  sessionId: string;
  threadId: string;
}

const FeedbackModal = memo<{
  onClose: () => void;
  open: boolean;
  target?: FeedbackTarget;
}>(({ onClose, open, target }) => {
  const { t } = useI18n();
  const [reasons, setReasons] = useState<string[]>([]);
  const [detail, setDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const toggleReason = (key: string) =>
    setReasons((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );

  const submit = async () => {
    if (!target) return;
    setSubmitting(true);
    try {
      await messageFeedbackService.submitMessageFeedback({
        feedback: 'dislike',
        messageId: target.messageId,
        reasonCode: reasons[0],
        reasonText: detail.trim() || undefined,
        runId: target.runId,
        sessionId: target.sessionId,
        threadId: target.threadId,
      });
    } finally {
      setSubmitting(false);
      setReasons([]);
      setDetail('');
      onClose();
    }
  };

  return (
    <Modal
      centered
      footer={
        <Flexbox horizontal gap={8} justify="flex-end">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={submitting} type="primary" onClick={() => void submit()}>
            {t('chat.feedback.submit')}
          </Button>
        </Flexbox>
      }
      open={open}
      title={t('chat.feedback.title')}
      onCancel={onClose}
    >
      <Flexbox gap={12}>
        <Flexbox gap={8}>
          {REASON_KEYS.map((key) => (
            <Checkbox
              checked={reasons.includes(key)}
              key={key}
              onChange={() => toggleReason(key)}
            >
              {t(key)}
            </Checkbox>
          ))}
        </Flexbox>
        <TextArea
          autoSize={{ minRows: 2, maxRows: 5 }}
          placeholder={t('chat.feedback.placeholder')}
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
        />
        <Text fontSize={12} type="secondary">
          {t('chat.feedback.hint')}
        </Text>
      </Flexbox>
    </Modal>
  );
});

FeedbackModal.displayName = 'FeedbackModal';

export default FeedbackModal;
