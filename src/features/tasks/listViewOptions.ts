// Adapted from: src/features/AgentTasks/AgentTaskList/listViewOptions.ts (LobeHub canary)
import type { TaskStatus } from '@/api/task/scheduledTaskService';
import type { ScheduledTask } from '@/api/task/scheduledTaskService';

export type TaskGroupBy = 'assignee' | 'none' | 'priority' | 'status';
export type TaskOrderBy = 'assignee' | 'createdAt' | 'priority' | 'status' | 'title' | 'updatedAt';
export type TaskOrderDirection = 'asc' | 'desc';

export interface TaskListViewOptions {
  groupBy: TaskGroupBy;
  hideCompleted: boolean;
  orderBy: TaskOrderBy;
  orderCompletedByRecency: boolean;
  orderDirection: TaskOrderDirection;
  subGroupBy: TaskGroupBy;
}

export const HIDDEN_WHEN_COMPLETED_STATUSES: ReadonlyArray<NonNullable<TaskGroupMeta['status']>> = [
  'completed',
  'canceled',
];

export interface TaskGroupMeta {
  assigneeId?: string;
  groupBy: TaskGroupBy;
  key: string;
  label: string;
  priority?: number;
  status?: TaskStatus;
}

export const DEFAULT_TASK_LIST_VIEW_OPTIONS: TaskListViewOptions = {
  groupBy: 'status',
  hideCompleted: true,
  orderBy: 'updatedAt',
  orderCompletedByRecency: true,
  orderDirection: 'asc',
  subGroupBy: 'none',
};

const TASK_GROUP_BY_SET = new Set<TaskGroupBy>(['assignee', 'none', 'priority', 'status']);
const TASK_ORDER_BY_SET = new Set<TaskOrderBy>([
  'assignee',
  'createdAt',
  'priority',
  'status',
  'title',
  'updatedAt',
]);
const TASK_ORDER_DIRECTION_SET = new Set<TaskOrderDirection>(['asc', 'desc']);

export const normalizeTaskListViewOptions = (
  value?: Partial<TaskListViewOptions> | null,
): TaskListViewOptions => {
  const next = value ?? {};
  const groupBy = TASK_GROUP_BY_SET.has(next.groupBy as TaskGroupBy)
    ? (next.groupBy as TaskGroupBy)
    : DEFAULT_TASK_LIST_VIEW_OPTIONS.groupBy;
  const subGroupBy = TASK_GROUP_BY_SET.has(next.subGroupBy as TaskGroupBy)
    ? (next.subGroupBy as TaskGroupBy)
    : DEFAULT_TASK_LIST_VIEW_OPTIONS.subGroupBy;

  return {
    groupBy,
    hideCompleted:
      typeof next.hideCompleted === 'boolean'
        ? next.hideCompleted
        : DEFAULT_TASK_LIST_VIEW_OPTIONS.hideCompleted,
    orderBy: TASK_ORDER_BY_SET.has(next.orderBy as TaskOrderBy)
      ? (next.orderBy as TaskOrderBy)
      : DEFAULT_TASK_LIST_VIEW_OPTIONS.orderBy,
    orderCompletedByRecency:
      typeof next.orderCompletedByRecency === 'boolean'
        ? next.orderCompletedByRecency
        : DEFAULT_TASK_LIST_VIEW_OPTIONS.orderCompletedByRecency,
    orderDirection: TASK_ORDER_DIRECTION_SET.has(next.orderDirection as TaskOrderDirection)
      ? (next.orderDirection as TaskOrderDirection)
      : DEFAULT_TASK_LIST_VIEW_OPTIONS.orderDirection,
    subGroupBy: groupBy === 'none' || subGroupBy !== groupBy ? subGroupBy : 'none',
  };
};

const PRIORITY_RANK_MAP: Record<number, number> = { 0: 4, 1: 0, 2: 1, 3: 2, 4: 3 };

const STATUS_GROUP_RANK_MAP: Record<TaskStatus, number> = {
  paused: 0,
  failed: 1,
  running: 2,
  scheduled: 3,
  backlog: 4,
  completed: 5,
  canceled: 6,
};

const TASK_STATUS_TO_GROUP_MAP: Record<string, TaskStatus> = {
  backlog: 'backlog',
  canceled: 'canceled',
  completed: 'completed',
  failed: 'failed',
  paused: 'paused',
  running: 'running',
  scheduled: 'scheduled',
};

const getPriorityValue = (task: ScheduledTask) => task.priority ?? 0;
const getTaskStatusGroup = (task: ScheduledTask): TaskStatus =>
  TASK_STATUS_TO_GROUP_MAP[task.status] ?? 'backlog';

export const getTaskAssigneeMeta = (task: ScheduledTask): TaskGroupMeta => {
  const agentId = task.assigneeAgentId;
  if (!agentId) {
    return { groupBy: 'assignee', key: 'assignee:unassigned', label: 'Unassigned' };
  }
  return {
    assigneeId: agentId,
    groupBy: 'assignee',
    key: `assignee:${agentId}`,
    label: task.assigneeAgentName || agentId,
  };
};

const toTime = (value?: Date | string | null): number => {
  if (!value) return 0;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
};

const getComparableValue = (task: ScheduledTask, orderBy: TaskOrderBy): number | string => {
  switch (orderBy) {
    case 'assignee':
      return task.assigneeAgentId ?? '';
    case 'createdAt':
      return toTime(task.createdAt);
    case 'priority':
      return PRIORITY_RANK_MAP[getPriorityValue(task)];
    case 'status':
      return STATUS_GROUP_RANK_MAP[getTaskStatusGroup(task)];
    case 'title':
      return task.name || task.identifier;
    case 'updatedAt':
      return toTime(task.updatedAt);
  }
};

export const compareTaskItems = (
  a: ScheduledTask,
  b: ScheduledTask,
  options: TaskListViewOptions,
): number => {
  const { orderBy, orderCompletedByRecency, orderDirection } = options;
  const effectiveOrderDirection =
    orderBy === 'createdAt' || orderBy === 'updatedAt'
      ? orderDirection === 'asc'
        ? 'desc'
        : 'asc'
      : orderDirection;

  if (orderCompletedByRecency && a.status === 'completed' && b.status === 'completed') {
    const byCompletedAt =
      (toTime(a.completedAt) || toTime(a.updatedAt)) - (toTime(b.completedAt) || toTime(b.updatedAt));
    if (byCompletedAt !== 0) return byCompletedAt;
  }

  const valueA = getComparableValue(a, orderBy);
  const valueB = getComparableValue(b, orderBy);
  const compared =
    typeof valueA === 'number' && typeof valueB === 'number'
      ? effectiveOrderDirection === 'asc'
        ? valueA - valueB
        : valueB - valueA
      : effectiveOrderDirection === 'asc'
        ? String(valueA).localeCompare(String(valueB))
        : String(valueB).localeCompare(String(valueA));

  if (compared !== 0) return compared;
  return a.identifier.localeCompare(b.identifier);
};

export const getTaskGroupMeta = (task: ScheduledTask, groupBy: TaskGroupBy): TaskGroupMeta => {
  switch (groupBy) {
    case 'assignee':
      return getTaskAssigneeMeta(task);
    case 'priority': {
      const priority = getPriorityValue(task);
      return {
        groupBy: 'priority',
        key: `priority:${priority}`,
        label: String(priority),
        priority,
      };
    }
    case 'status': {
      const groupedStatus = getTaskStatusGroup(task);
      return {
        groupBy: 'status',
        key: `status:${groupedStatus}`,
        label: groupedStatus,
        status: groupedStatus,
      };
    }
    case 'none':
      return { groupBy: 'none', key: 'all', label: 'All' };
  }
};

const getGroupRank = (group: TaskGroupMeta, groupBy: TaskGroupBy): number => {
  switch (groupBy) {
    case 'priority':
      return group.priority === undefined ? Number.MAX_SAFE_INTEGER : PRIORITY_RANK_MAP[group.priority];
    case 'status':
      return group.status ? STATUS_GROUP_RANK_MAP[group.status] : Number.MAX_SAFE_INTEGER;
    default:
      return Number.MAX_SAFE_INTEGER;
  }
};

export const sortGroupEntries = (
  entries: Array<[TaskGroupMeta, ScheduledTask[]]>,
  groupBy: TaskGroupBy,
  orderDirection?: TaskOrderDirection,
): Array<[TaskGroupMeta, ScheduledTask[]]> => {
  if (groupBy === 'none') return entries;
  const direction = orderDirection ?? 'asc';
  return [...entries].sort(([groupA], [groupB]) => {
    const rankA = getGroupRank(groupA, groupBy);
    const rankB = getGroupRank(groupB, groupBy);
    if (rankA !== rankB) return direction === 'asc' ? rankA - rankB : rankB - rankA;
    return direction === 'asc'
      ? groupA.label.localeCompare(groupB.label)
      : groupB.label.localeCompare(groupA.label);
  });
};
