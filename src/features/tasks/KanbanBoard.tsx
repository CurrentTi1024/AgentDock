// Adapted from: src/features/AgentTasks/AgentTaskList/KanbanBoard.tsx (LobeHub canary)
import { ActionIcon, Block, Center, Empty, Flexbox, Popover, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ClipboardCheck, SlidersHorizontal } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';

import {
  scheduledTaskService,
  type ScheduledTask,
  type TaskStatus,
} from '@/api/task/scheduledTaskService';
import { useI18n } from '@/i18n';

import TaskItem from './TaskItem';
import { TASK_STATUS_VISUALS } from './taskVisuals';

const styles = createStaticStyles(({ css }) => ({
  board: css`
    overflow-x: auto;
    display: flex;
    flex: 1;
    gap: 8px;
    padding-block: 0 16px;
    padding-inline: 12px;
  `,
  column: css`
    width: 300px;
    flex: none;
    background: ${cssVar.colorFillTertiary};
    border-radius: ${cssVar.borderRadiusLG}px;
    padding: 8px;
  `,
  columnBody: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 80px;
    transition: background 0.2s ease;
  `,
  columnBodyOver: css`
    background: ${cssVar.colorFillSecondary};
    border-radius: ${cssVar.borderRadiusLG}px;
  `,
}));

interface ColumnDef {
  droppable: boolean;
  key: string;
  targetStatus: 'backlog' | 'canceled' | 'completed' | null;
}

const COLUMNS: ColumnDef[] = [
  { droppable: true, key: 'backlog', targetStatus: 'backlog' },
  { droppable: false, key: 'running', targetStatus: null },
  { droppable: false, key: 'needsInput', targetStatus: null },
  { droppable: true, key: 'done', targetStatus: 'completed' },
  { droppable: true, key: 'canceled', targetStatus: 'canceled' },
];

const toStatusForColumn = (key: string): TaskStatus | null => {
  switch (key) {
    case 'backlog':
      return 'backlog';
    case 'running':
      return 'running';
    case 'needsInput':
      return 'paused';
    case 'done':
      return 'completed';
    case 'canceled':
      return 'canceled';
    default:
      return null;
  }
};

const statusToColumnKey = (status: TaskStatus): string => {
  switch (status) {
    case 'running':
      return 'running';
    case 'paused':
      return 'needsInput';
    case 'completed':
      return 'done';
    case 'canceled':
      return 'canceled';
    default:
      return 'backlog';
  }
};

interface KanbanBoardProps {
  isLoading?: boolean;
  onRetry?: () => void;
  onTaskOpen: (task: ScheduledTask) => void;
  tasks: ScheduledTask[];
}

const KanbanBoard = memo<KanbanBoardProps>(({ isLoading, onRetry, onTaskOpen, tasks }) => {
  const { t } = useI18n();
  const [dragging, setDragging] = useState<ScheduledTask | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const toggleColumn = useCallback((key: string) => {
    setHiddenColumns((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }, []);

  const columnTasks = useMemo(() => {
    const map = new Map<string, ScheduledTask[]>();
    for (const column of COLUMNS) map.set(column.key, []);
    for (const task of tasks) {
      const key = statusToColumnKey(task.status);
      map.get(key)?.push(task);
    }
    return map;
  }, [tasks]);

  const handleDrop = useCallback(
    (columnKey: string) => {
      const column = COLUMNS.find((item) => item.key === columnKey);
      const target = toStatusForColumn(columnKey);
      if (!column || !column.droppable || !target || !dragging || dragging.status === target) {
        setDragging(null);
        setOverColumn(null);
        return;
      }
      void scheduledTaskService.updateTaskStatus(dragging.identifier, target).catch((reason) => {
        console.warn('[AgentDock] kanban move failed', reason);
      });
      setDragging(null);
      setOverColumn(null);
    },
    [dragging],
  );

  if (isLoading) {
    return (
      <Center flex={1} height="100%">
        <Empty description={t('common.loading')} icon={ClipboardCheck} />
      </Center>
    );
  }

  if (tasks.length === 0) {
    return (
      <Center flex={1} height="100%">
        <Empty description={t('tasks.empty')} icon={ClipboardCheck} />
      </Center>
    );
  }

  return (
    <Flexbox flex={1} style={{ overflow: 'hidden' }}>
      <Flexbox horizontal align="center" justify="flex-end" paddingInline={12} paddingBlock={6}>
        <Popover
          content={
            <Flexbox gap={8} style={{ width: 180 }}>
              {COLUMNS.map((column) => (
                <Flexbox horizontal align="center" gap={8} key={column.key}>
                  <input
                    checked={!hiddenColumns.includes(column.key)}
                    onChange={() => toggleColumn(column.key)}
                    type="checkbox"
                  />
                  <Text fontSize={13}>{t(`tasks.column.${column.key}`)}</Text>
                </Flexbox>
              ))}
            </Flexbox>
          }
          placement="bottomRight"
          trigger="click"
        >
          <ActionIcon
            aria-label={t('tasks.columnSettings')}
            icon={SlidersHorizontal}
            size="small"
            title={t('tasks.columnSettings')}
          />
        </Popover>
      </Flexbox>
      <Flexbox className={styles.board} height="100%">
        {COLUMNS.filter((column) => !hiddenColumns.includes(column.key)).map((column) => {
          const meta = TASK_STATUS_VISUALS[toStatusForColumn(column.key) ?? 'backlog'];
          const ColumnIcon = meta.icon;
          const items = columnTasks.get(column.key) ?? [];
          return (
            <Flexbox className={styles.column} gap={8} key={column.key} style={{ height: '100%' }}>
              <Flexbox horizontal align="center" gap={8} paddingInline={6} paddingBlock={4}>
                <ColumnIcon color={meta.color} size={16} />
                <Text style={{ flex: 1 }} weight={500}>
                  {t(`tasks.column.${column.key}`)}
                </Text>
                <Text fontSize={12} type="secondary">
                  {items.length}
                </Text>
              </Flexbox>
              <Flexbox
                className={`${styles.columnBody} ${overColumn === column.key ? styles.columnBodyOver : ''}`}
                flex={1}
                onDragOver={(event) => {
                  if (!column.droppable) return;
                  event.preventDefault();
                  setOverColumn(column.key);
                }}
                onDragLeave={() => setOverColumn((current) => (current === column.key ? null : current))}
                onDrop={() => handleDrop(column.key)}
                style={{ overflowY: 'auto' }}
              >
                {items.map((task) => (
                  <Block
                    draggable={column.droppable}
                    key={task.identifier}
                    onClick={() => onTaskOpen(task)}
                    onDragEnd={() => setDragging(null)}
                    onDragStart={() => setDragging(task)}
                    style={{ cursor: column.droppable ? 'grab' : 'default', borderRadius: 10 }}
                  >
                    <TaskItem key={task.identifier} onOpen={onTaskOpen} task={task} />
                  </Block>
                ))}
                {items.length === 0 && (
                  <Center flex={1} style={{ minHeight: 80 }}>
                    <Text fontSize={12} type="secondary">
                      {t('tasks.column.dropHint')}
                    </Text>
                  </Center>
                )}
              </Flexbox>
            </Flexbox>
          );
        })}
      </Flexbox>
    </Flexbox>
  );
});

KanbanBoard.displayName = 'KanbanBoard';

export default KanbanBoard;
