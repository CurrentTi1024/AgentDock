// Adapted from: src/components/ExecutionStatus.ts (LobeHub canary)
import { cssVar } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import {
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  CircleX,
  Clock,
  Hand,
} from 'lucide-react';

import type { TaskStatus } from '@/api/task/scheduledTaskService';

export interface ExecutionStatusVisual {
  color: string;
  icon: LucideIcon;
}

const VISUALS = {
  backlog: { color: cssVar.colorTextQuaternary, icon: CircleDashed },
  canceled: { color: cssVar.colorTextSecondary, icon: CircleSlash },
  completed: { color: cssVar.colorSuccess, icon: CircleCheck },
  failed: { color: cssVar.colorError, icon: CircleX },
  paused: { color: cssVar.colorInfo, icon: Hand },
  running: { color: cssVar.colorWarning, icon: CircleDot },
  scheduled: { color: cssVar.colorWarning, icon: Clock },
  idle: { color: cssVar.colorTextTertiary, icon: Circle },
} satisfies Record<string, ExecutionStatusVisual>;

export const TASK_STATUS_VISUALS: Record<TaskStatus, ExecutionStatusVisual> = {
  backlog: VISUALS.backlog,
  canceled: VISUALS.canceled,
  completed: VISUALS.completed,
  failed: VISUALS.failed,
  paused: VISUALS.paused,
  running: VISUALS.running,
  scheduled: VISUALS.scheduled,
};
