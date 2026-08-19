import { mockDelay } from '@/lib/mock';
import { postApi } from '@/lib/httpClient';
import { selectService } from '@/api/core/serviceMode';
import {
  scheduledTaskMockData,
  type ScheduledTask,
  type TaskAutomationMode,
  type TaskGroupItem,
  type TaskStatus,
  type TaskVisibility,
} from '@/mock-data/scheduledTask';

export type { ScheduledTask, TaskGroupItem, TaskStatus, TaskVisibility, TaskAutomationMode };

export interface TaskListParams {
  keyword?: string;
  statuses?: TaskStatus[];
  visibility?: TaskVisibility;
  assigneeAgentId?: string;
}

export interface TaskCreateInput {
  instruction: string;
  name?: string;
  description?: string;
  priority?: number;
  visibility?: TaskVisibility;
  assigneeAgentId?: string;
  automationMode?: TaskAutomationMode | null;
  schedulePattern?: string | null;
  scheduleTimezone?: string | null;
  parentTaskId?: string | null;
}

interface ScheduledTaskService {
  list(params?: TaskListParams): Promise<{ data: ScheduledTask[]; total: number }>;
  groupList(params: {
    groups: Array<{ key: string; statuses: TaskStatus[] }>;
    visibility?: TaskVisibility;
  }): Promise<{ data: TaskGroupItem[] }>;
  getTaskDetailById(id: string): Promise<ScheduledTask | null>;
  createTask(value: TaskCreateInput): Promise<ScheduledTask>;
  updateTask(id: string, value: Partial<ScheduledTask>): Promise<ScheduledTask>;
  updateTaskStatus(id: string, status: TaskStatus): Promise<ScheduledTask>;
  deleteTask(id: string): Promise<{ id: string }>;
  /** Compatibility: flat list used by simple pages. */
  getScheduledTasks(): Promise<ScheduledTask[]>;
}

const clone = () => structuredClone(scheduledTaskMockData);

export const scheduledTaskHttpService: ScheduledTaskService = {
  list: (params) => postApi('getTaskList', { ...params }),
  groupList: (params) => postApi('getTaskGroupList', params),
  getTaskDetailById: (id) => postApi('getTaskDetailById', { id }),
  createTask: (value) => postApi('createTask', value),
  updateTask: (id, value) => postApi('updateTask', { id, ...value }),
  updateTaskStatus: (id, status) => postApi('updateTaskStatus', { id, status }),
  deleteTask: (id) => postApi('deleteTask', { id }),
  getScheduledTasks: () => postApi('getScheduledTasks', {}),
};

export const scheduledTaskMockService: ScheduledTaskService = {
  list: async (params) => {
    await mockDelay();
    let items = clone();
    const keyword = params?.keyword?.toLowerCase();
    if (keyword) {
      items = items.filter((item) =>
        `${item.name}${item.identifier}${item.instruction}${item.assigneeAgentName ?? ''}`
          .toLowerCase()
          .includes(keyword),
      );
    }
    if (params?.statuses?.length) {
      const statusSet = new Set(params.statuses);
      items = items.filter((item) => statusSet.has(item.status));
    }
    if (params?.visibility) {
      items = items.filter((item) => item.visibility === params.visibility);
    }
    if (params?.assigneeAgentId) {
      items = items.filter((item) => item.assigneeAgentId === params.assigneeAgentId);
    }
    return { data: items, total: items.length };
  },
  groupList: async (params) => {
    await mockDelay();
    const items = clone();
    const data = (params.groups ?? []).map((group) => {
      const statusSet = new Set(group.statuses);
      const tasks = items.filter(
        (item) => statusSet.has(item.status) && (!params.visibility || item.visibility === params.visibility),
      );
      return { key: group.key, statuses: group.statuses, total: tasks.length, tasks };
    });
    return { data };
  },
  getTaskDetailById: async (id) => {
    await mockDelay();
    return structuredClone(clone().find((item) => item.identifier === id) || null);
  },
  createTask: async (value) => {
    await mockDelay();
    const now = new Date().toISOString();
    const maxId = clone().reduce((max, item) => {
      const num = Number(item.identifier.replace(/\D/g, '')) || 0;
      return num > max ? num : max;
    }, 0);
    const task: ScheduledTask = {
      identifier: `TASK-${maxId + 1}`,
      instruction: value.instruction,
      name: value.name,
      description: value.description,
      status: value.schedulePattern ? 'scheduled' : 'backlog',
      priority: value.priority ?? 3,
      visibility: value.visibility ?? 'public',
      assigneeAgentId: value.assigneeAgentId,
      assigneeAgentName: value.assigneeAgentId,
      createdByAgentId: 'user',
      createdAt: now,
      updatedAt: now,
      automationMode: value.automationMode ?? null,
      schedulePattern: value.schedulePattern ?? null,
      scheduleTimezone: value.scheduleTimezone ?? 'Asia/Shanghai',
      parentTaskId: value.parentTaskId ?? null,
    };
    scheduledTaskMockData.unshift(task);
    return structuredClone(task);
  },
  updateTask: async (id, value) => {
    await mockDelay();
    const index = scheduledTaskMockData.findIndex((item) => item.identifier === id);
    if (index < 0) throw new Error(`Task ${id} not found`);
    const next = { ...scheduledTaskMockData[index], ...value, identifier: id, updatedAt: new Date().toISOString() };
    scheduledTaskMockData[index] = next;
    return structuredClone(next);
  },
  updateTaskStatus: async (id, status) => {
    await mockDelay();
    const index = scheduledTaskMockData.findIndex((item) => item.identifier === id);
    if (index < 0) throw new Error(`Task ${id} not found`);
    const current = scheduledTaskMockData[index];
    const next: ScheduledTask = {
      ...current,
      status,
      updatedAt: new Date().toISOString(),
      completedAt: status === 'completed' ? new Date().toISOString() : current.completedAt,
    };
    scheduledTaskMockData[index] = next;
    return structuredClone(next);
  },
  deleteTask: async (id) => {
    await mockDelay();
    const index = scheduledTaskMockData.findIndex((item) => item.identifier === id);
    if (index >= 0) scheduledTaskMockData.splice(index, 1);
    return { id };
  },
  getScheduledTasks: async () => {
    await mockDelay();
    return clone();
  },
};

export const scheduledTaskService = selectService(scheduledTaskHttpService, scheduledTaskMockService);
