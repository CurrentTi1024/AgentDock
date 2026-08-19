// Adapted from: src/features/AgentTasks/AgentTaskList/AgentTasksPage.tsx (LobeHub canary)
import {
  Accordion,
  AccordionItem,
  ActionIcon,
  Block,
  Center,
  DropdownMenu,
  Empty,
  Flexbox,
  Icon,
  Popover,
  Select,
  Text,
} from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ClipboardCheck,
  Globe,
  LayoutGrid,
  LayoutList,
  Lock,
  Plus,
  Settings2,
  UserRound,
  Users,
} from 'lucide-react';
import { Divider } from 'antd';
import { Fragment, memo, useCallback, useEffect, useMemo, useState } from 'react';

import NavHeader from '@/components/shell/NavHeader';
import WideScreenContainer from '@/components/shell/WideScreenContainer';
import {
  scheduledTaskService,
  type ScheduledTask,
  type TaskStatus,
  type TaskVisibility,
} from '@/api/task/scheduledTaskService';
import { useI18n } from '@/i18n';

import CreateTaskModal from './CreateTaskModal';
import CreateTaskInlineEntry from './CreateTaskInlineEntry';
import KanbanBoard from './KanbanBoard';
import {
  compareTaskItems,
  DEFAULT_TASK_LIST_VIEW_OPTIONS,
  getTaskGroupMeta,
  HIDDEN_WHEN_COMPLETED_STATUSES,
  normalizeTaskListViewOptions,
  sortGroupEntries,
  type TaskGroupBy,
  type TaskListViewOptions,
  type TaskOrderBy,
} from './listViewOptions';
import TaskItem, { AssigneeAvatar, PRIORITY_META, TaskPriorityTag } from './TaskItem';
import { TASK_STATUS_VISUALS } from './taskVisuals';

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  page: css`
    overflow: hidden;
    height: 100%;
  `,
  divider: css`
    margin: 0;
  `,
  popoverForm: css`
    width: 280px;
    label {
      font-size: 13px !important;
      color: ${token.colorTextSecondary} !important;
    }
  `,
}));

type TaskViewMode = 'kanban' | 'list';
type VisibilityFilter = 'all' | 'private' | 'workspace';

const VISIBILITY_OPTIONS: Array<{
  icon: typeof Globe;
  key: VisibilityFilter;
  labelKey: string;
}> = [
  { icon: Lock, key: 'private', labelKey: 'tasks.visibility.private' },
  { icon: Users, key: 'workspace', labelKey: 'tasks.visibility.workspace' },
  { icon: Globe, key: 'all', labelKey: 'tasks.visibility.all' },
];

const GROUPING_OPTIONS: TaskGroupBy[] = ['none', 'status', 'assignee', 'priority'];
const ORDER_OPTIONS: TaskOrderBy[] = ['status', 'priority', 'updatedAt', 'createdAt', 'assignee', 'title'];

const readLocal = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    // ignore
  }
  return fallback;
};

const writeLocal = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
};

const TasksPage = memo(() => {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<TaskViewMode>(() => readLocal('agentdock-tasks-view', 'list'));
  const [visibility, setVisibility] = useState<VisibilityFilter>('all');
  const [options, setOptions] = useState<TaskListViewOptions>(() =>
    normalizeTaskListViewOptions(readLocal<Partial<TaskListViewOptions>>('agentdock-tasks-options', {})),
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [inlineOpen, setInlineOpen] = useState(false);
  const [detailTask, setDetailTask] = useState<ScheduledTask | null>(null);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await scheduledTaskService.list({
          visibility: visibility === 'all' ? undefined : visibility === 'private' ? 'private' : 'public',
        });
        if (!signal?.aborted) setTasks(data);
      } catch (reason) {
        if (!signal?.aborted) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [visibility],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const updateOptions = useCallback(
    (updater: (prev: TaskListViewOptions) => TaskListViewOptions) => {
      setOptions((prev) => {
        const next = normalizeTaskListViewOptions(updater(prev));
        writeLocal('agentdock-tasks-options', next);
        return next;
      });
    },
    [],
  );

  const handleViewModeChange = (mode: TaskViewMode) => {
    setViewMode(mode);
    writeLocal('agentdock-tasks-view', mode);
  };

  const visibleTasks = useMemo(
    () => (options.hideCompleted ? tasks.filter((task) => !HIDDEN_WHEN_COMPLETED_STATUSES.includes(task.status)) : tasks),
    [options.hideCompleted, tasks],
  );
  const hiddenCount = tasks.length - visibleTasks.length;

  const grouped = useMemo(() => {
    const sorted = [...visibleTasks].sort((a, b) => compareTaskItems(a, b, options));
    const primaryDirection =
      options.orderBy === options.groupBy ? options.orderDirection : undefined;
    const subDirection =
      options.orderBy === options.subGroupBy ? options.orderDirection : undefined;
    const map = new Map<string, { items: ScheduledTask[]; meta: ReturnType<typeof getTaskGroupMeta> }>();
    for (const task of sorted) {
      const meta = getTaskGroupMeta(task, options.groupBy);
      const bucket = map.get(meta.key);
      if (bucket) bucket.items.push(task);
      else map.set(meta.key, { items: [task], meta });
    }
    return sortGroupEntries(
      [...map.values()].map((entry) => [entry.meta, entry.items] as [typeof entry.meta, ScheduledTask[]]),
      options.groupBy,
      primaryDirection,
    ).map(([meta, items]) => {
      if (options.groupBy === 'none' || options.subGroupBy === 'none') {
        return { meta, items, subGroups: [] as Array<[ReturnType<typeof getTaskGroupMeta>, ScheduledTask[]]> };
      }
      const subMap = new Map<string, { items: ScheduledTask[]; meta: ReturnType<typeof getTaskGroupMeta> }>();
      for (const task of items) {
        const subMeta = getTaskGroupMeta(task, options.subGroupBy);
        const bucket = subMap.get(subMeta.key);
        if (bucket) bucket.items.push(task);
        else subMap.set(subMeta.key, { items: [task], meta: subMeta });
      }
      return {
        meta,
        items,
        subGroups: sortGroupEntries(
          [...subMap.values()].map((entry) => [entry.meta, entry.items] as [typeof entry.meta, ScheduledTask[]]),
          options.subGroupBy,
          subDirection,
        ),
      };
    });
  }, [options, visibleTasks]);

  const groupLabel = useCallback(
    (group: { assigneeId?: string; label: string; priority?: number; status?: TaskStatus; groupBy: TaskGroupBy }) => {
      if (group.groupBy === 'assignee') {
        if (group.assigneeId) return group.assigneeId;
        return t('tasks.unassigned');
      }
      if (group.groupBy === 'priority') {
        return t(PRIORITY_META[group.priority ?? 0]?.labelKey ?? 'tasks.priority.none');
      }
      if (group.groupBy === 'status') {
        return t(`tasks.status.${group.status ?? 'backlog'}`);
      }
      return group.label;
    },
    [t],
  );

  const renderGroupPrefix = (group: { assigneeId?: string; groupBy: TaskGroupBy; priority?: number; status?: TaskStatus }) => {
    if (group.groupBy === 'assignee') {
      return group.assigneeId ? <AssigneeAvatar agentId={group.assigneeId} size={18} /> : <Icon icon={UserRound} size={14} />;
    }
    if (group.groupBy === 'priority') {
      return <TaskPriorityTag priority={group.priority ?? 0} size={16} />;
    }
    if (group.groupBy === 'status') {
      const meta = TASK_STATUS_VISUALS[group.status ?? 'backlog'];
      const StatusIcon = meta.icon;
      return <StatusIcon color={meta.color} size={16} />;
    }
    return null;
  };

  const handleStatusChange = useCallback((task: ScheduledTask, status: TaskStatus) => {
    setTasks((current) =>
      current.map((item) =>
        item.identifier === task.identifier
          ? { ...item, status, updatedAt: new Date().toISOString(), completedAt: status === 'completed' ? new Date().toISOString() : item.completedAt }
          : item,
      ),
    );
    void scheduledTaskService.updateTaskStatus(task.identifier, status).catch((reason) => {
      console.warn('[AgentDock] status update failed', reason);
      void refresh();
    });
  }, [refresh]);

  const handleDelete = useCallback(
    (task: ScheduledTask) => {
      if (!window.confirm(t('tasks.delete.confirm'))) return;
      setTasks((current) => current.filter((item) => item.identifier !== task.identifier));
      void scheduledTaskService.deleteTask(task.identifier).catch((reason) => {
        console.warn('[AgentDock] task delete failed', reason);
        void refresh();
      });
    },
    [refresh, t],
  );

  const handleCreated = useCallback((task: ScheduledTask) => {
    setTasks((current) => [task, ...current]);
  }, []);

  const handleCreateClick = useCallback(() => {
    if (viewMode === 'list') {
      setInlineOpen((open) => !open);
    } else {
      setCreateOpen(true);
    }
  }, [viewMode]);

  const handleAssigneeChange = useCallback(
    (task: ScheduledTask, agentId: string, agentFullName: string) => {
      setTasks((current) =>
        current.map((item) =>
          item.identifier === task.identifier
            ? { ...item, assigneeAgentId: agentId, assigneeAgentName: agentFullName }
            : item,
        ),
      );
      void scheduledTaskService
        .updateTask(task.identifier, { assigneeAgentId: agentId, assigneeAgentName: agentFullName })
        .catch((reason) => {
          console.warn('[AgentDock] assignee update failed', reason);
          void refresh();
        });
    },
    [refresh],
  );

  const skeleton = (
    <Block gap={2} padding={2} variant="borderless">
      {Array.from({ length: 5 }).map((_, index) => (
        <Fragment key={`task-skeleton-${index}`}>
          <div
            style={{ height: 62, borderRadius: 8, background: cssVar.colorFillQuaternary, margin: 2 }}
          />
          {index !== 4 && <Divider dashed style={{ margin: 0 }} />}
        </Fragment>
      ))}
    </Block>
  );

  const emptyState = (
    <Center height="60vh" width="100%">
      <Empty description={t('tasks.empty')} icon={ClipboardCheck} />
    </Center>
  );

  const hiddenFooter = hiddenCount > 0 && (
    <Flexbox horizontal align="center" gap={16} justify="center" paddingBlock={16} style={{ fontSize: 13 }}>
      <Text weight={500}>{t('tasks.hiddenCount', { count: hiddenCount })}</Text>
      <Text
        style={{ cursor: 'pointer' }}
        weight={500}
        onClick={() => updateOptions((prev) => ({ ...prev, hideCompleted: false }))}
      >
        {t('tasks.showHidden')}
      </Text>
    </Flexbox>
  );

  const listContent =
    options.groupBy === 'none' ? (
      <>
        <Block gap={2} padding={2} variant="borderless">
          {(grouped[0]?.items ?? []).map((task, index) => (
            <Fragment key={task.identifier}>
              <TaskItem
                onAssigneeChange={handleAssigneeChange}
                onDelete={handleDelete}
                onOpen={setDetailTask}
                onStatusChange={handleStatusChange}
                task={task}
              />
              {index !== grouped[0].items.length - 1 && <Divider dashed style={{ margin: 0 }} />}
            </Fragment>
          ))}
        </Block>
        {hiddenFooter}
      </>
    ) : (
      <>
        <Accordion gap={16}>
          {grouped.map((group) => (
            <AccordionItem
              defaultExpand
              indicatorPlacement="end"
              itemKey={`group-${group.meta.key}`}
              key={group.meta.key}
              paddingBlock={8}
              paddingInline={14}
              title={
                <Flexbox horizontal align="center" gap={8} justify="space-between">
                  <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0 }}>
                    {renderGroupPrefix(group.meta)}
                    <Text ellipsis weight={500}>
                      {groupLabel(group.meta)}
                    </Text>
                  </Flexbox>
                  <Text fontSize={12} type="secondary">
                    {group.items.length}
                  </Text>
                </Flexbox>
              }
              variant="filled"
            >
              {group.subGroups.length > 0 ? (
                <Accordion gap={6}>
                  {group.subGroups.map(([subMeta, subTasks]) => (
                    <AccordionItem
                      defaultExpand
                      indicatorPlacement="end"
                      itemKey={`sub-${group.meta.key}-${subMeta.key}`}
                      key={`${group.meta.key}-${subMeta.key}`}
                      paddingBlock={6}
                      paddingInline={14}
                      title={
                        <Flexbox horizontal align="center" gap={8} justify="space-between">
                          <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0 }}>
                            {renderGroupPrefix(subMeta)}
                            <Text ellipsis weight={500}>
                              {groupLabel(subMeta)}
                            </Text>
                          </Flexbox>
                          <Text fontSize={12} type="secondary">
                            {subTasks.length}
                          </Text>
                        </Flexbox>
                      }
                    >
                      <Block gap={0} padding={2} variant="borderless">
                        {subTasks.map((task) => (
                          <TaskItem
                            key={task.identifier}
                            onAssigneeChange={handleAssigneeChange}
                            onDelete={handleDelete}
                            onOpen={setDetailTask}
                            onStatusChange={handleStatusChange}
                            task={task}
                          />
                        ))}
                      </Block>
                    </AccordionItem>
                  ))}
                </Accordion>
              ) : (
                <Block gap={0} padding={2} variant="borderless">
                  {group.items.map((task, index) => (
                    <Fragment key={task.identifier}>
                      <TaskItem
                        onAssigneeChange={handleAssigneeChange}
                        onDelete={handleDelete}
                        onOpen={setDetailTask}
                        onStatusChange={handleStatusChange}
                        task={task}
                      />
                      {index !== group.items.length - 1 && <Divider dashed style={{ margin: 0 }} />}
                    </Fragment>
                  ))}
                </Block>
              )}
            </AccordionItem>
          ))}
        </Accordion>
        {hiddenFooter}
      </>
    );

  const currentVisibility =
    VISIBILITY_OPTIONS.find((option) => option.key === visibility) ?? VISIBILITY_OPTIONS[2];
  const CurrentVisibilityIcon = currentVisibility.icon;

  return (
    <Flexbox className={styles.page}>
      <NavHeader
        left={<Text weight={500}>{t('tasks.title')}</Text>}
        right={
          <Flexbox horizontal align="center" gap={4}>
            <DropdownMenu
              items={VISIBILITY_OPTIONS.map((option) => {
                const OptionIcon = option.icon;
                return {
                  icon: <Icon color={cssVar.colorTextSecondary} icon={OptionIcon} size={16} />,
                  key: option.key,
                  label: t(option.labelKey),
                  extra: option.key === visibility ? <Icon color={cssVar.colorTextSecondary} icon={Lock} size={12} /> : undefined,
                  onClick: () => setVisibility(option.key),
                };
              })}
            >
              <ActionIcon
                aria-label={`${t('tasks.visibility.label')}: ${t(currentVisibility.labelKey)}`}
                icon={CurrentVisibilityIcon}
                size="small"
                title={`${t('tasks.visibility.label')}: ${t(currentVisibility.labelKey)}`}
              />
            </DropdownMenu>
            <ActionIcon
              aria-label={t('tasks.new')}
              icon={Plus}
              size="small"
              title={t('tasks.new')}
              onClick={handleCreateClick}
            />
            <ActionIcon
              aria-label={viewMode === 'list' ? t('tasks.kanban') : t('tasks.list')}
              icon={viewMode === 'list' ? LayoutGrid : LayoutList}
              size="small"
              title={viewMode === 'list' ? t('tasks.kanban') : t('tasks.list')}
              onClick={() => handleViewModeChange(viewMode === 'list' ? 'kanban' : 'list')}
            />
            <Popover
              content={
                <Flexbox className={styles.popoverForm} gap={12} paddingBlock={8}>
                  <Flexbox gap={6}>
                    <Text fontSize={12} type="secondary">
                      {t('tasks.groupBy')}
                    </Text>
                    <Select
                      onChange={(value) =>
                        updateOptions((prev) => ({
                          ...prev,
                          groupBy: value as TaskGroupBy,
                          subGroupBy: prev.subGroupBy === (value as TaskGroupBy) ? 'none' : prev.subGroupBy,
                        }))
                      }
                      options={GROUPING_OPTIONS.map((key) => ({ label: t(`tasks.group.${key}`), value: key }))}
                      size="small"
                      value={options.groupBy}
                    />
                  </Flexbox>
                  {options.groupBy !== 'none' && (
                    <Flexbox gap={6}>
                      <Text fontSize={12} type="secondary">
                        {t('tasks.subGroupBy')}
                      </Text>
                      <Select
                        onChange={(value) =>
                          updateOptions((prev) => ({ ...prev, subGroupBy: value as TaskGroupBy }))
                        }
                        options={GROUPING_OPTIONS.filter((key) => key !== options.groupBy || key === 'none').map((key) => ({
                          label: t(`tasks.group.${key}`),
                          value: key,
                        }))}
                        size="small"
                        value={options.subGroupBy}
                      />
                    </Flexbox>
                  )}
                  <Flexbox gap={6}>
                    <Text fontSize={12} type="secondary">
                      {t('tasks.orderBy')}
                    </Text>
                    <Flexbox horizontal gap={4}>
                      <ActionIcon
                        icon={options.orderDirection === 'asc' ? ArrowDownWideNarrow : ArrowUpNarrowWide}
                        size="small"
                        onClick={() =>
                          updateOptions((prev) => ({
                            ...prev,
                            orderDirection: prev.orderDirection === 'asc' ? 'desc' : 'asc',
                          }))
                        }
                      />
                      <Select
                        onChange={(value) => updateOptions((prev) => ({ ...prev, orderBy: value as TaskOrderBy }))}
                        options={ORDER_OPTIONS.map((key) => ({ label: t(`tasks.order.${key}`), value: key }))}
                        size="small"
                        style={{ flex: 1 }}
                        value={options.orderBy}
                      />
                    </Flexbox>
                  </Flexbox>
                  <Flexbox gap={6}>
                    <Text fontSize={12} type="secondary">
                      {t('tasks.hideCompleted')}
                    </Text>
                    <input
                      checked={options.hideCompleted}
                      onChange={(event) => updateOptions((prev) => ({ ...prev, hideCompleted: event.target.checked }))}
                      type="checkbox"
                    />
                  </Flexbox>
                </Flexbox>
              }
              placement="bottomRight"
              trigger="click"
            >
              <ActionIcon
                aria-label={t('tasks.displaySettings')}
                icon={Settings2}
                size="small"
                title={t('tasks.displaySettings')}
              />
            </Popover>
          </Flexbox>
        }
      />
      {error ? (
        <Center flex={1} height="100%">
          <Flexbox gap={12} align="center">
            <Text type="secondary">{error}</Text>
            <ActionIcon icon={ClipboardCheck} onClick={() => void refresh()} title={t('common.retry')} />
          </Flexbox>
        </Center>
      ) : viewMode === 'kanban' ? (
        <KanbanBoard
          isLoading={loading && tasks.length === 0}
          onTaskOpen={setDetailTask}
          tasks={tasks}
        />
      ) : (
        <WideScreenContainer gap={16} paddingBlock={16} wrapperStyle={{ flex: 1, overflowY: 'auto' }}>
          {inlineOpen && (
            <CreateTaskInlineEntry
              onCancel={() => setInlineOpen(false)}
              onCreated={handleCreated}
            />
          )}
          {loading && tasks.length === 0 ? (
            skeleton
          ) : tasks.length === 0 ? (
            emptyState
          ) : (
            listContent
          )}
        </WideScreenContainer>
      )}
      {createOpen && (
        <CreateTaskModal onClose={() => setCreateOpen(false)} onCreated={handleCreated} />
      )}
      {detailTask && <TaskDetailDrawer task={detailTask} onClose={() => setDetailTask(null)} />}
    </Flexbox>
  );
});

TasksPage.displayName = 'TasksPage';

export default TasksPage;

// Adapted from: src/features/AgentTasks/AgentTaskDetail (LobeHub canary) — compact detail surface.
function TaskDetailDrawer({ onClose, task }: { onClose: () => void; task: ScheduledTask }) {
  const { t } = useI18n();
  const meta = TASK_STATUS_VISUALS[task.status];
  const StatusIcon = meta.icon;
  return (
    <Block
      style={{
        position: 'fixed',
        insetInlineEnd: 0,
        top: 0,
        bottom: 0,
        width: 'min(480px, 90vw)',
        background: cssVar.colorBgContainer,
        borderInlineStart: `1px solid ${cssVar.colorBorderSecondary}`,
        zIndex: 1000,
        boxShadow: cssVar.boxShadowSecondary,
      }}
    >
      <Flexbox gap={0} style={{ height: '100%' }}>
        <Flexbox horizontal align="center" justify="space-between" padding={16} style={{ borderBottom: `1px solid ${cssVar.colorBorderSecondary}` }}>
          <Flexbox horizontal align="center" gap={8}>
            <StatusIcon color={meta.color} size={18} />
            <Text weight={500}>{task.name || task.identifier}</Text>
          </Flexbox>
          <ActionIcon
            aria-label={t('common.close')}
            icon={Globe}
            onClick={onClose}
            size="small"
            title={t('common.close')}
          />
        </Flexbox>
        <Flexbox gap={16} padding={16} style={{ overflowY: 'auto', flex: 1 }}>
          <Flexbox gap={6}>
            <Text fontSize={12} type="secondary">
              {t('tasks.create.instruction')}
            </Text>
            <Text>{task.instruction}</Text>
          </Flexbox>
          {task.description && (
            <Flexbox gap={6}>
              <Text fontSize={12} type="secondary">
                {t('tasks.description')}
              </Text>
              <Text>{task.description}</Text>
            </Flexbox>
          )}
          <Flexbox gap={6}>
            <Text fontSize={12} type="secondary">
              {t('tasks.create.assignee')}
            </Text>
            <Flexbox horizontal align="center" gap={8}>
              <AssigneeAvatar agentId={task.assigneeAgentId} size={22} />
              <Text>{task.assigneeAgentName || task.assigneeAgentId || t('tasks.unassigned')}</Text>
            </Flexbox>
          </Flexbox>
          <Flexbox horizontal gap={16}>
            <Flexbox gap={6}>
              <Text fontSize={12} type="secondary">
                {t('tasks.create.priority')}
              </Text>
              <TaskPriorityTag priority={task.priority} size={18} />
            </Flexbox>
            <Flexbox gap={6}>
              <Text fontSize={12} type="secondary">
                {t('tasks.create.automation')}
              </Text>
              <Text>
                {task.automationMode
                  ? t(`tasks.automation.${task.automationMode}`)
                  : t('tasks.automation.manual')}
              </Text>
            </Flexbox>
          </Flexbox>
          {task.schedulePattern && (
            <Flexbox gap={6}>
              <Text fontSize={12} type="secondary">
                {t('tasks.create.schedule')}
              </Text>
              <Text>
                {task.schedulePattern} · {task.scheduleTimezone}
              </Text>
            </Flexbox>
          )}
          {task.totalSubtasks ? (
            <Flexbox gap={6}>
              <Text fontSize={12} type="secondary">
                {t('tasks.subtasks')}
              </Text>
              <Text>
                {task.completedSubtaskCount}/{task.totalSubtasks}
              </Text>
            </Flexbox>
          ) : null}
        </Flexbox>
      </Flexbox>
    </Block>
  );
}
