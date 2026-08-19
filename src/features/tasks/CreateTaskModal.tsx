// Adapted from: src/features/AgentTasks/CreateTaskModal (LobeHub canary)
import { Button, Flexbox, Form, Input, Modal, Select, TextArea, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useMemo, useState } from 'react';

import {
  scheduledTaskService,
  type ScheduledTask,
} from '@/api/task/scheduledTaskService';
import { useI18n } from '@/i18n';

const styles = createStaticStyles(({ css, cssVar }) => ({
  form: css`
    label {
      font-size: 13px !important;
      color: ${cssVar.colorTextSecondary} !important;
    }
  `,
}));

interface CreateTaskModalProps {
  defaultAssigneeAgentId?: string;
  onClose: () => void;
  onCreated: (task: ScheduledTask) => void;
}

const AGENT_OPTIONS = [
  { label: 'FlightAnalysis_Agent-F15B', value: 'flight-analysis' },
  { label: 'ReportWriter_Agent-F15B', value: 'report-writer' },
  { label: 'CodeReview_Agent-F18B', value: 'code-review' },
];

const CreateTaskModal = memo<CreateTaskModalProps>(
  ({ defaultAssigneeAgentId, onClose, onCreated }) => {
    const { t } = useI18n();
    const [name, setName] = useState('');
    const [instruction, setInstruction] = useState('');
    const [assigneeAgentId, setAssigneeAgentId] = useState<string | undefined>(
      defaultAssigneeAgentId || AGENT_OPTIONS[0].value,
    );
    const [priority, setPriority] = useState(3);
    const [visibility, setVisibility] = useState<'private' | 'public'>('public');
    const [automationMode, setAutomationMode] = useState<'manual' | 'scheduled' | 'heartbeat'>(
      'manual',
    );
    const [schedulePattern, setSchedulePattern] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const priorityOptions = useMemo(
      () =>
        [0, 1, 2, 3, 4].map((level) => ({
          label: t(`tasks.priority.${level === 0 ? 'none' : level === 1 ? 'urgent' : level === 2 ? 'high' : level === 3 ? 'normal' : 'low'}`),
          value: level,
        })),
      [t],
    );

    const handleSubmit = async () => {
      if (!instruction.trim()) {
        setError(t('tasks.create.instructionRequired'));
        return;
      }
      setSubmitting(true);
      setError(null);
      try {
        const task = await scheduledTaskService.createTask({
          instruction: instruction.trim(),
          name: name.trim() || undefined,
          assigneeAgentId,
          priority,
          visibility,
          automationMode: automationMode === 'manual' ? null : automationMode,
          schedulePattern: automationMode === 'scheduled' ? schedulePattern || '0 9 * * 1' : null,
          scheduleTimezone: 'Asia/Shanghai',
        });
        onCreated(task);
        onClose();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <Modal
        footer={
          <Flexbox horizontal gap={8} justify="flex-end" paddingBlock={12} paddingInline={16}>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button loading={submitting} type="primary" onClick={() => void handleSubmit()}>
              {t('tasks.create.submit')}
            </Button>
          </Flexbox>
        }
        onCancel={onClose}
        open
        title={t('tasks.create.title')}
        width="min(80%, 680px)"
      >
        <Form className={styles.form} layout="vertical" style={{ padding: '8px 16px 16px' }}>
          <Form.Item label={t('tasks.create.name')}>
            <Input
              onChange={(event) => setName(event.target.value)}
              placeholder={t('tasks.create.namePlaceholder')}
              value={name}
            />
          </Form.Item>
          <Form.Item label={t('tasks.create.instruction')} required>
            <TextArea
              autoSize={{ maxRows: 6, minRows: 3 }}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder={t('tasks.create.instructionPlaceholder')}
              value={instruction}
            />
          </Form.Item>
          <Flexbox horizontal gap={16}>
            <Form.Item label={t('tasks.create.assignee')} style={{ flex: 1 }}>
              <Select
                onChange={(value) => setAssigneeAgentId(value as string)}
                options={AGENT_OPTIONS}
                value={assigneeAgentId}
              />
            </Form.Item>
            <Form.Item label={t('tasks.create.priority')} style={{ flex: 1 }}>
              <Select
                onChange={(value) => setPriority(value as number)}
                options={priorityOptions}
                value={priority}
              />
            </Form.Item>
          </Flexbox>
          <Flexbox horizontal gap={16}>
            <Form.Item label={t('tasks.create.visibility')} style={{ flex: 1 }}>
              <Select
                onChange={(value) => setVisibility(value as 'private' | 'public')}
                options={[
                  { label: t('tasks.visibility.private'), value: 'private' },
                  { label: t('tasks.visibility.workspace'), value: 'public' },
                ]}
                value={visibility}
              />
            </Form.Item>
            <Form.Item label={t('tasks.create.automation')} style={{ flex: 1 }}>
              <Select
                onChange={(value) => setAutomationMode(value as 'manual' | 'scheduled' | 'heartbeat')}
                options={[
                  { label: t('tasks.automation.manual'), value: 'manual' },
                  { label: t('tasks.automation.scheduled'), value: 'scheduled' },
                  { label: t('tasks.automation.heartbeat'), value: 'heartbeat' },
                ]}
                value={automationMode}
              />
            </Form.Item>
          </Flexbox>
          {automationMode === 'scheduled' && (
            <Form.Item label={t('tasks.create.schedule')}>
              <Input
                onChange={(event) => setSchedulePattern(event.target.value)}
                placeholder="0 9 * * 1"
                value={schedulePattern}
              />
            </Form.Item>
          )}
          {error && (
            <Text style={{ color: cssVar.colorError, fontSize: 13 }}>{error}</Text>
          )}
        </Form>
      </Modal>
    );
  },
);

CreateTaskModal.displayName = 'CreateTaskModal';

export default CreateTaskModal;
