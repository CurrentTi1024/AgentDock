// Adapted from: src/features/AgentTasks/features/icons/* (LobeHub canary)
import type { IconType } from '@lobehub/icons';
import { memo } from 'react';

const priorityPath = (filled: number, opacity?: number) => (
  <>
    <path d="M3.5 8h-1a1 1 0 00-1 1v4a1 1 0 001 1h1a1 1 0 001-1V9a1 1 0 00-1-1z" />
    <path
      d="M8.5 5h-1a1 1 0 00-1 1v7a1 1 0 001 1h1a1 1 0 001-1V6a1 1 0 00-1-1z"
      fillOpacity={filled >= 2 ? undefined : opacity}
    />
    <path
      d="M13.5 2h-1a1 1 0 00-1 1v10a1 1 0 001 1h1a1 1 0 001-1V3a1 1 0 00-1-1z"
      fillOpacity={filled >= 3 ? undefined : opacity}
    />
  </>
);

const svg = (children: React.ReactNode) =>
  memo<{ color?: string; size?: number | string; style?: React.CSSProperties }>(
    ({ color = 'currentColor', size = '1em', style, ...rest }) => (
      <svg
        fill="currentColor"
        fillRule="evenodd"
        height={size}
        style={{ flex: 'none', lineHeight: 1, color, ...style }}
        viewBox="0 0 16 16"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        {...rest}
      >
        {children}
      </svg>
    ),
  );

export const PriorityNoneIcon: IconType = svg(
  <>
    <path
      d="M4 7.25H2a.5.5 0 00-.5.5v.5a.5.5 0 00.5.5h2a.5.5 0 00.5-.5v-.5a.5.5 0 00-.5-.5zM9 7.25H7a.5.5 0 00-.5.5v.5a.5.5 0 00.5.5h2a.5.5 0 00.5-.5v-.5a.5.5 0 00-.5-.5zM14 7.25h-2a.5.5 0 00-.5.5v.5a.5.5 0 00.5.5h2a.5.5 0 00.5-.5v-.5a.5.5 0 00-.5-.5z"
      opacity=".9"
    />
  </>,
);

export const PriorityLowIcon: IconType = svg(priorityPath(1, 0.4));
export const PriorityMediumIcon: IconType = svg(priorityPath(2, 0.4));
export const PriorityHighIcon: IconType = svg(priorityPath(3, 0.4));

export const PriorityUrgentIcon: IconType = svg(
  <path d="M3 1c-1.09 0-2 .91-2 2v10c0 1.09.91 2 2 2h10c1.09 0 2-.91 2-2V3c0-1.09-.91-2-2-2H3zm4 3h2l-.246 4.998H7.25L7 4zm2 7a1 1 0 11-2 0 1 1 0 012 0z" />,
);
