// Adapted from: src/features/AgentTasks/AgentTaskList/CreateTaskInlineEntry.tsx (LobeHub canary)
import { Block, Button, Input, Select, TextArea, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { X } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';

import { agentMarketService, type MentionAgent } from '@/api/market/agentMarketService';
import { scheduledTaskService, type ScheduledTask } from '@/api/task/scheduledTaskService';
import { useI18n } from '@/i18n';

interface CreateTaskInlineEntryProps {
  onCancel: () => void;
  onCreated: (task: ScheduledTask) => void;
}

const CreateTaskInlineEntry = memo<CreateTaskInlineEntryProps>(({ onCancel, onCreated }) => {
  const { locale, t } = useI18n();
  const [name, setName] = useState('');
  const [instruction, setInstruction] = useState('');
  const [assigneeAgentId, setAssigneeAgentId] = useState<string | undefined>();
  const [priority, setPriority] = useState(3);
  const [agents, setAgents] = useState<MentionAgent[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void agentMarketService
      .getMentionAgentsList({ locale }, { signal: controller.signal })
      .then(({ items }) => {
        setAgents(items);
        setAssigneeAgentId((current) => current ?? items[0]?.agentId);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          console.warn('[AgentDock] inline assignee agents load failed', reason);
        }
      });
    return () => controller.abort();
  }, [locale]);

  const agentOptions = useMemo(
    () => agents.map((agent) => ({ label: `${agent.agentFullName} · ${agent.fab}`, value: agent.agentId })),
    [agents],
  );

  const priorityOptions = useMemo(
    () =>
      [0, 1, 2, 3, 4].map((level) => ({
        label: t(
          `tasks.priority.${level === 0 ? 'none' : level === 1 ? 'urgent' : level === 2 ? 'high' : level === 3 ? 'normal' : 'low'}`,
        ),
        value: level,
      })),
    [t],
  );

  const handleCreate = async () => {
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
        visibility: 'public',
        automationMode: null,
      });
      onCreated(task);
      onCancel();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Block gap={10} padding={14} variant="filled" style={{ borderRadius: 12 }}>
      <FlexboxRow gap={8}>
        <Input
          onChange={(event) => setName(event.target.value)}
          placeholder={t('tasks.create.namePlaceholder')}
          style={{ flex: 1 }}
          value={name}
        />
        <Select
          onChange={(value) => setAssigneeAgentId(value as string)}
          options={agentOptions}
          placeholder={t('tasks.create.assignee')}
          style={{ width: 220 }}
          value={assigneeAgentId}
        />
        <Select
          onChange={(value) => setPriority(value as number)}
          options={priorityOptions}
          style={{ width: 120 }}
          value={priority}
        />
        <Button loading={submitting} onClick={() => void handleCreate()} size="small" type="primary">
          {t('tasks.create.submit')}
        </Button>
        <Button icon={X} onClick={onCancel} size="small" type="text" />
      </FlexboxRow>
      <TextArea
        autoSize={{ maxRows: 4, minRows: 2 }}
        onChange={(event) => setInstruction(event.target.value)}
        placeholder={t('tasks.create.instructionPlaceholder')}
        value={instruction}
      />
      {error && (
        <Text style={{ color: cssVar.colorError, fontSize: 13 }}>{error}</Text>
      )}
    </Block>
  );
});

CreateTaskInlineEntry.displayName = 'CreateTaskInlineEntry';

const FlexboxRow = ({ children, gap }: { children: React.ReactNode; gap: number }) => (
  <Block horizontal align="center" gap={gap}>
    {children}
  </Block>
);

export default CreateTaskInlineEntry;
