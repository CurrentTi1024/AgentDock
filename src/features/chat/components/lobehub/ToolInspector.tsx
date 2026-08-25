// Ported from: src/features/Conversation/Messages/AssistantGroup/Tool/Inspector (LobeHub canary)
// 工具调用标题行：24px 状态块（执行中神经网络动画 / 完成 Check / 失败 X）、
// “名称 › apiName (key: value)”单行、执行耗时。数据由投影层以 props 注入。
import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { AlertTriangle, Check, ChevronRight, X } from 'lucide-react';
import { memo, useEffect, useState } from 'react';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { useI18n } from '@/i18n';
import type { RuntimeToolCall } from '@/api/runtime/types';

const MAX_PARAMS = 1;
const MAX_VALUE_LENGTH = 50;

const truncateValue = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;

const formatParamValue = (value: unknown): string => {
  if (typeof value === 'string') return truncateValue(value, MAX_VALUE_LENGTH);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return truncateValue(JSON.stringify(value), MAX_VALUE_LENGTH);
  if (typeof value === 'object' && value !== null) return truncateValue(JSON.stringify(value), MAX_VALUE_LENGTH);
  return String(value);
};

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  apiName: css`
    font-family: ${token.fontFamilyCode};
    color: ${token.colorTextSecondary};
  `,
  paramKey: css`
    font-family: ${token.fontFamilyCode};
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  paramValue: css`
    font-family: ${token.fontFamilyCode};
    font-size: 12px;
    color: ${token.colorTextSecondary};
  `,
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
    color: ${token.colorTextDescription};
  `,
  statusChip: css`
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: 1px solid ${token.colorBorder};
    border-radius: ${token.borderRadiusSM}px;
  `,
}));

/** LobeHub Tool StatusIndicator：24×24 轮廓块；执行中神经网络动画，完成 Check，失败 X。 */
export const ToolStatusChip = memo<{ status: RuntimeToolCall['status']; successVariant?: 'default' | 'warning' }>(
  ({ status, successVariant }) => (
    <span className={styles.statusChip}>
      {status === 'error' ? (
        <Icon color={cssVar.colorError} icon={X} size={14} />
      ) : status === 'completed' ? (
        <Icon
          color={successVariant === 'warning' ? cssVar.colorWarning : cssVar.colorSuccess}
          icon={successVariant === 'warning' ? AlertTriangle : Check}
          size={14}
        />
      ) : (
        <NeuralNetworkLoading size={16} />
      )}
    </span>
  ),
);

ToolStatusChip.displayName = 'ToolStatusChip';

/** LobeHub ExecutionTime：执行中 100ms 刷新耗时（ms / s / min+s）。 */
const formatElapsedTime = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}min${remainingSeconds}s`;
};

const ToolExecutionTime = memo<{ running: boolean; startedAt?: number }>(({ running, startedAt }) => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running || !startedAt) return;
    const update = () => setElapsed(Math.max(0, Date.now() - startedAt));
    update();
    const id = window.setInterval(update, 100);
    return () => window.clearInterval(id);
  }, [running, startedAt]);
  if (!running || !startedAt) return null;
  return (
    <Text fontSize={12} type="secondary">
      {formatElapsedTime(elapsed)}
    </Text>
  );
});

ToolExecutionTime.displayName = 'ToolExecutionTime';

/** LobeHub ToolTitle：单行 “名称 › apiName (key: value)”。 */
const ToolTitle = memo<{
  apiName?: string;
  args?: Record<string, unknown>;
  isLoading?: boolean;
  name?: string;
}>(({ apiName, args, isLoading, name }) => {
  const { t } = useI18n();
  const params = args ? Object.entries(args).slice(0, MAX_PARAMS) : [];
  const remainingCount = args ? Object.keys(args).length - MAX_PARAMS : 0;
  return (
    <div className={isLoading ? undefined : styles.root}>
      <span style={{ color: cssVar.colorTextDescription }}>{name || apiName || t('chat.toolCall')}</span>
      {apiName && apiName !== name && (
        <>
          <Icon icon={ChevronRight} size={12} style={{ marginInline: 4 }} />
          <span className={styles.apiName}>{apiName}</span>
        </>
      )}
      {params.length > 0 && (
        <>
          <span className={styles.paramKey}>{' ('}</span>
          <span className={styles.paramKey}>{params[0][0]}:</span>
          <span className={styles.paramValue}>{formatParamValue(params[0][1])}</span>
          {remainingCount > 0 && <span className={styles.paramKey}>{` +${remainingCount}`}</span>}
          <span className={styles.paramKey}>{')'}</span>
        </>
      )}
    </div>
  );
});

ToolTitle.displayName = 'ToolTitle';

export interface ToolInspectorProps {
  apiName?: string;
  args?: string;
  finishedAt?: number;
  identifier?: string;
  result?: unknown;
  resultMsgId?: string;
  startedAt?: number;
  status: RuntimeToolCall['status'];
}

/** LobeHub Tool Inspector 标题行（默认分支）：状态块 + 标题 + 耗时。 */
export const ToolInspector = memo<ToolInspectorProps>(
  ({ apiName, args, finishedAt, identifier, result, startedAt, status }) => {
    let argsObject: Record<string, unknown> | undefined;
    try {
      argsObject = args ? (JSON.parse(args) as Record<string, unknown>) : undefined;
    } catch {
      // keep undefined; 流式未完成时展示原文开头
    }
    const running = status === 'running' || status === 'called';
    const hasResult = result !== undefined && result !== null;
    const showExecutionTimer = running && !!(startedAt && finishedAt === undefined);
    return (
      <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0 }}>
        <ToolStatusChip
          status={status === 'called' && hasResult ? 'completed' : status}
        />
        <ToolTitle
          apiName={apiName}
          args={argsObject}
          isLoading={running}
          name={identifier}
        />
        <ToolExecutionTime running={showExecutionTimer} startedAt={startedAt} />
      </Flexbox>
    );
  },
);

ToolInspector.displayName = 'ToolInspector';
