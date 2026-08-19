// Adapted from: src/features/AgentTasks/features/AgentTaskItem.tsx (LobeHub canary)
import type { IconType } from '@lobehub/icons';
import { Avatar, Block, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { Dropdown } from 'antd';
import { cssVar } from 'antd-style';
import {
  CalendarClock,
  CircleUser,
  Copy,
  ExternalLink,
  Lock,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';

import {
  type ScheduledTask,
  type TaskStatus,
} from '@/api/task/scheduledTaskService';
import { useI18n } from '@/i18n';

import { PriorityHighIcon, PriorityLowIcon, PriorityMediumIcon, PriorityNoneIcon, PriorityUrgentIcon } from './priorityIcons';
import { TASK_STATUS_VISUALS } from './taskVisuals';

export interface TaskStatusTagProps {
  onChange?: (status: TaskStatus) => void;
  size?: number;
  status: TaskStatus;
}

export const USER_SELECTABLE_STATUSES: TaskStatus[] = [
  'backlog',
  'paused',
  'completed',
  'canceled',
];

export const TaskStatusTag = memo<TaskStatusTagProps>(({ onChange, size = 16, status }) => {
  const { t } = useI18n();
  const meta = TASK_STATUS_VISUALS[status] ?? TASK_STATUS_VISUALS.backlog;
  const StatusIcon = meta.icon;
  return (
    <Tooltip title={t(`tasks.status.${status}`)}>
      <span style={{ display: 'inline-flex' }}>
        <StatusIcon color={meta.color} size={size} />
      </span>
    </Tooltip>
  );
});

export const PRIORITY_META: Record<number, { icon: IconType; labelKey: string; level: number }> = {
  0: { icon: PriorityNoneIcon, labelKey: 'tasks.priority.none', level: 0 },
  1: { icon: PriorityUrgentIcon, labelKey: 'tasks.priority.urgent', level: 1 },
  2: { icon: PriorityHighIcon, labelKey: 'tasks.priority.high', level: 2 },
  3: { icon: PriorityMediumIcon, labelKey: 'tasks.priority.normal', level: 3 },
  4: { icon: PriorityLowIcon, labelKey: 'tasks.priority.low', level: 4 },
};

export const TaskPriorityTag = memo<{
  onChange?: (priority: number) => void;
  priority: number;
  size?: number;
}>(({ onChange, priority = 0, size = 16 }) => {
  const { t } = useI18n();
  const meta = PRIORITY_META[priority] ?? PRIORITY_META[0];
  const PriorityIcon = meta.icon;
  const isUrgent = priority === 1;
  return (
    <Tooltip title={t(meta.labelKey)}>
      <span
        style={{ color: isUrgent ? cssVar.orange : cssVar.colorTextDescription, cursor: 'pointer', display: 'inline-flex' }}
        onClick={(event) => {
          event.stopPropagation();
          onChange?.((priority + 1) % 5);
        }}
      >
        <PriorityIcon size={size} />
      </span>
    </Tooltip>
  );
});

export const AssigneeAvatar = memo<{ agentId?: string | null; size?: number }>(
  ({ agentId, size = 18 }) => {
    const agents = useMemo(() => {
      const known: Record<string, { icon: string; name: string; color?: string }> = {
        'flight-analysis': { icon: '✈️', name: 'FlightAnalysis_Agent-F15B' },
        'report-writer': { icon: '📝', name: 'ReportWriter_Agent-F15B' },
        'code-review': { icon: '🔍', name: 'CodeReview_Agent-F18B' },
      };
      return known;
    }, []);
    const meta = agentId ? agents[agentId] : undefined;
    if (!meta) {
      return (
        <Icon
          color={cssVar.colorTextQuaternary}
          icon={CircleUser}
          size={size}
          style={{ flex: 'none' }}
        />
      );
    }
    return (
      <Avatar
        avatar={meta.icon}
        shape="circle"
        size={size}
        title={meta.name}
        variant="outlined"
        style={{ flex: 'none' }}
      />
    );
  },
);

const formatDate = (value?: string | null, locale = 'en-US') => {
  if (!value) return '';
  const date = new Date(value);
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

interface TaskItemProps {
  onDelete?: (task: ScheduledTask) => void;
  onOpen?: (task: ScheduledTask) => void;
  onStatusChange?: (task: ScheduledTask, status: TaskStatus) => void;
  routeScope?: 'agent' | 'global';
  task: ScheduledTask;
}

const TaskItem = memo<TaskItemProps>(
  ({ onDelete, onOpen, onStatusChange, routeScope = 'global', task }) => {
    const { locale, t } = useI18n();
    const [contextMenuOpen, setContextMenuOpen] = useState(false);
    const status = task.status;
    const time = formatDate(task.updatedAt || task.createdAt, locale);

    const handleCopy = useCallback(() => {
      void navigator.clipboard?.writeText(task.identifier);
    }, [task.identifier]);

    const contextMenu = useMemo(
      () => [
        { key: 'open', icon: <Icon icon={ExternalLink} size={14} />, label: t('tasks.open'), onClick: () => onOpen?.(task) },
        { key: 'copy', icon: <Icon icon={Copy} size={14} />, label: t('tasks.copyId'), onClick: handleCopy },
        { type: 'divider' as const },
        ...USER_SELECTABLE_STATUSES.map((candidate) => ({
          key: `status-${candidate}`,
          label: t(`tasks.status.${candidate}`),
          checked: candidate === status,
          onClick: () => onStatusChange?.(task, candidate),
        })),
        { type: 'divider' as const },
        { key: 'delete', danger: true, icon: <Icon icon={Trash2} size={14} />, label: t('tasks.delete'), onClick: () => onDelete?.(task) },
      ],
      [handleCopy, onDelete, onOpen, onStatusChange, status, t, task],
    );

    const privacyBadge =
      task.visibility === 'private' ? (
        <Tooltip title={t('tasks.visibility.private')}>
          <Icon color={cssVar.colorTextDescription} icon={Lock} size={13} />
        </Tooltip>
      ) : null;

    const scheduledBadge =
      status === 'scheduled' ? (
        <Block
          horizontal
          align="center"
          flex="none"
          gap={4}
          height={20}
          paddingInline={8}
          style={{ borderRadius: 24 }}
          variant="outlined"
        >
          <Icon color={cssVar.colorWarning} icon={CalendarClock} size={12} />
          <Text fontSize={12} type="secondary">
            {task.schedulePattern || t('tasks.status.scheduled')}
          </Text>
        </Block>
      ) : null;

    const subtaskProgress =
      task.totalSubtasks && task.totalSubtasks > 0 ? (
        <Text fontSize={12} type="secondary" style={{ flex: 'none' }}>
          {task.completedSubtaskCount ?? 0}/{task.totalSubtasks}
        </Text>
      ) : null;

    return (
      <Dropdown
        menu={{ items: contextMenu }}
        open={contextMenuOpen}
        trigger={['contextMenu']}
        onOpenChange={setContextMenuOpen}
      >
        <div onContextMenu={(event) => event.preventDefault()} style={{ display: 'contents' }}>
          <Block
            horizontal
            align="center"
            gap={12}
            paddingBlock={10}
            paddingInline={16}
            style={{ minWidth: 0, cursor: 'pointer' }}
            onClick={() => onOpen?.(task)}
          >
            <Flexbox horizontal align="center" gap={8} flex={1} style={{ minWidth: 0 }}>
              <TaskPriorityTag priority={task.priority} />
              <TaskStatusTag status={status} />
              {privacyBadge}
              <Text fontSize={12} type="secondary" style={{ flex: 'none' }}>
                {task.identifier}
              </Text>
              <Text ellipsis weight={500} style={{ minWidth: 0 }}>
                {task.name || task.instruction}
              </Text>
              {scheduledBadge}
              {subtaskProgress}
            </Flexbox>
            <AssigneeAvatar agentId={task.assigneeAgentId} />
            <Text fontSize={12} type="secondary" style={{ flex: 'none', minWidth: 88, textAlign: 'right' }}>
              {time}
            </Text>
            <Icon color={cssVar.colorTextTertiary} icon={MoreHorizontal} size={16} style={{ flex: 'none' }} />
          </Block>
        </div>
      </Dropdown>
    );
  },
);

TaskItem.displayName = 'TaskItem';

export default TaskItem;
