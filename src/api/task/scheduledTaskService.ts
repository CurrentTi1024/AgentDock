import { scheduledTaskMockData } from '@/mock-data/scheduledTask';
import { mockDelay } from '@/lib/mock';
import { postApi } from '@/lib/httpClient';
import { selectService } from '@/api/core/serviceMode';
type ScheduledTask = (typeof scheduledTaskMockData)[number];
interface ScheduledTaskService { getScheduledTasks(): Promise<ScheduledTask[]>; getScheduledTaskDetailById(id: string): Promise<ScheduledTask | null>; createScheduledTask(value: Omit<ScheduledTask, 'id'>): Promise<ScheduledTask>; updateScheduledTask(id: string, value: Partial<ScheduledTask>): Promise<ScheduledTask>; deleteScheduledTask(id: string): Promise<{ id: string }> }
export const scheduledTaskHttpService: ScheduledTaskService = { getScheduledTasks: () => postApi('getScheduledTasks', {}), getScheduledTaskDetailById: (id) => postApi('getScheduledTaskDetailById', { id }), createScheduledTask: (value) => postApi('createScheduledTask', value), updateScheduledTask: (id, value) => postApi('updateScheduledTask', { id, ...value }), deleteScheduledTask: (id) => postApi('deleteScheduledTask', { id }) };
export const scheduledTaskMockService: ScheduledTaskService = { getScheduledTasks: async () => { await mockDelay(); return structuredClone(scheduledTaskMockData); }, getScheduledTaskDetailById: async (id) => structuredClone(scheduledTaskMockData.find((item) => item.id === id) || null), createScheduledTask: async (value) => ({ id: crypto.randomUUID(), ...value }), updateScheduledTask: async (id, value) => ({ ...scheduledTaskMockData.find((item) => item.id === id)!, ...value, id }), deleteScheduledTask: async (id) => ({ id }) };
export const scheduledTaskService = selectService(scheduledTaskHttpService, scheduledTaskMockService);
