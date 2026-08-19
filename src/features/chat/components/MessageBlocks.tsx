// Adapted from: src/features/Conversation/Messages + Tool/AssistantGroup (LobeHub canary)
import { ActionIcon, Block, Button, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { useRenderActivityMessage } from '@copilotkit/react-core/v2';
import { createStaticStyles, cssVar } from 'antd-style';
import { Brain, CheckCircle2, ChevronDown, Crown, Layers, ListTodo, Play, Users, Wrench, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useI18n } from '@/i18n';
import { getChatServiceMode } from '@/api/core/serviceMode';
import type { RuntimeReasoningMeta, RuntimeRunState, RuntimeStep, RuntimeToolCall } from '@/api/runtime/types';
import type { SessionMessageRecord } from '@/api/session/sessionHistoryService';

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  block: css`
    overflow: hidden;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorFillQuaternary};
  `,
  content: css`
    padding: 10px 12px;
    border-block-start: 1px solid ${token.colorBorderSecondary};
    color: ${token.colorTextSecondary};
    font-size: 12px;
    line-height: 1.7;
    white-space: pre-wrap;
  `,
  header: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    cursor: pointer;
  `,
}));

/** LobeHub History 分割线：消息时间跨度较大或历史/实时分界时展示。 */
export const HistoryDivider = ({ label }: { label: string }) => (
  <Flexbox horizontal align="center" gap={12} paddingBlock={10}>
    <div style={{ flex: 1, height: 1, background: cssVar.colorBorderSecondary }} />
    <Text fontSize={12} type="secondary">
      {label}
    </Text>
    <div style={{ flex: 1, height: 1, background: cssVar.colorBorderSecondary }} />
  </Flexbox>
);

const formatDuration = (startedAt?: number, finishedAt?: number) => {
  if (!startedAt || !finishedAt) return undefined;
  const seconds = Math.max(0, Math.round((finishedAt - startedAt) / 100) / 10);
  return seconds;
};

export const ReasoningBlock = ({ id, meta, text }: { id: string; meta?: RuntimeReasoningMeta; text: string }) => {
  const { t } = useI18n();
  const streaming = Boolean(meta?.streaming);
  const duration = formatDuration(meta?.startedAt, meta?.finishedAt);
  const [open, setOpen] = useState(streaming);
  // 流式结束自动折叠（完成后默认收起；用户可点击重新展开）。
  useEffect(() => {
    if (!streaming) setOpen(false);
  }, [streaming]);
  return (
    <div className={styles.block} key={id}>
      <div className={styles.header} onClick={() => setOpen((value) => !value)}>
        <Icon color={cssVar.colorTextDescription} icon={Brain} size={15} />
        <Flexbox flex={1}>
          <Text fontSize={12} weight={500}>
            {streaming ? t('chat.reasoningStreaming') : t('chat.reasoning')}
          </Text>
          <Text fontSize={11} type="secondary">
            {streaming ? t('chat.reasoningInProgress') : duration !== undefined ? t('chat.reasoningDuration', { seconds: duration }) : t('chat.reasoningDone')}
          </Text>
        </Flexbox>
        <Icon icon={ChevronDown} size={14} />
      </div>
      {open && <div className={styles.content}>{meta?.encrypted ? t('chat.reasoningEncrypted') : text}</div>}
    </div>
  );
};

export const ToolCallBlock = ({ call }: { call: RuntimeToolCall }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const duration = formatDuration(call.startedAt, call.finishedAt);
  const statusKeys: Record<RuntimeToolCall['status'], 'chat.toolStatus.called' | 'chat.toolStatus.completed' | 'chat.toolStatus.error' | 'chat.toolStatus.running'> = {
    called: 'chat.toolStatus.called',
    completed: 'chat.toolStatus.completed',
    error: 'chat.toolStatus.error',
    running: 'chat.toolStatus.running',
  };
  const statusKey = statusKeys[call.status] as string | undefined;
  const meta = statusKey
    ? {
        color: (call.status === 'completed' ? ('success' as const) : call.status === 'error' ? ('error' as const) : ('processing' as const)),
        label: t(statusKey as 'chat.toolStatus.called'),
      }
    : { color: 'default' as const, label: call.status };
  return (
    <div className={styles.block}>
      <div className={styles.header} onClick={() => setOpen((value) => !value)}>
        <Icon color={cssVar.colorTextDescription} icon={Wrench} size={15} />
        <Text fontSize={12} weight={500} style={{ flex: 1 }}>
          {call.apiName || call.name || t('chat.toolCall')}
        </Text>
        {duration !== undefined && (
          <Text fontSize={11} type="secondary">
            {t('chat.toolDuration', { seconds: duration })}
          </Text>
        )}
        <Tag color={meta.color} size="small">
          {meta.label}
        </Tag>
        <Icon icon={ChevronDown} size={14} />
      </div>
      {open && (
        <div className={styles.content}>
          <Text weight={500}>{t('chat.toolArgs')}</Text>
          {call.args || t('chat.toolNoArgs')}
          {call.result !== undefined && (
            <>
              <Text weight={500}>{t('chat.toolResult')}</Text>
              {typeof call.result === 'string' ? call.result : JSON.stringify(call.result, null, 2)}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export const WorkflowStepsBlock = ({ steps }: { steps: RuntimeStep[] }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const completed = steps.filter((step) => step.status === 'completed').length;
  return (
    <div className={styles.block}>
      <div className={styles.header} onClick={() => setOpen((value) => !value)}>
        <Icon color={cssVar.colorTextDescription} icon={ListTodo} size={15} />
        <Text fontSize={12} weight={500} style={{ flex: 1 }}>
          {t('chat.steps', { completed, total: steps.length })}
        </Text>
        <Icon icon={ChevronDown} size={14} />
      </div>
      {open && (
        <Flexbox gap={2} padding={10} style={{ borderBlockStart: `1px solid ${cssVar.colorBorderSecondary}` }}>
          {steps.map((step) => (
            <Flexbox horizontal align="center" gap={8} key={step.id} paddingBlock={4}>
              <Icon
                color={step.status === 'completed' ? cssVar.colorSuccess : step.status === 'error' ? cssVar.colorError : cssVar.colorPrimary}
                icon={step.status === 'completed' ? CheckCircle2 : Play}
                size={14}
              />
              <Text fontSize={12} style={{ flex: 1 }}>{step.name || step.id}</Text>
              <Tag color={step.status === 'error' ? 'error' : step.status === 'running' ? 'processing' : 'success'} size="small">
                {step.status === 'running' ? t('chat.toolStatus.running') : step.status === 'error' ? t('chat.error.title') : t('chat.toolStatus.completed')}
              </Tag>
            </Flexbox>
          ))}
        </Flexbox>
      )}
    </div>
  );
};

const ACTIVITY_TYPE_META: Record<string, { icon: typeof ListTodo; labelKey: string }> = {
  'agentDock.agentDelegation': { icon: Users, labelKey: 'chat.activity.agentDelegation' },
  'agentDock.assistantGroup': { icon: Layers, labelKey: 'chat.activity.assistantGroup' },
  'agentDock.groupTasks': { icon: Layers, labelKey: 'chat.activity.groupTasks' },
  'agentDock.supervisor': { icon: Crown, labelKey: 'chat.activity.supervisor' },
  'agentDock.task': { icon: ListTodo, labelKey: 'chat.activity.task' },
  'agentDock.tasks': { icon: ListTodo, labelKey: 'chat.activity.tasks' },
};

export const ActivityBlock = ({ activity }: { activity: { activityType?: string; description?: string; title?: string; [key: string]: unknown } }) => {
  const { t } = useI18n();
  const typeMeta = ACTIVITY_TYPE_META[String(activity.activityType || '')];
  const IconComponent = typeMeta?.icon ?? ListTodo;
  return (
    <Block gap={10} padding={14} variant="outlined">
      <Flexbox horizontal align="center" gap={9}>
        <Icon color={cssVar.colorInfo} icon={IconComponent} />
        <Text weight={500}>
          {typeMeta ? t(typeMeta.labelKey) : t('chat.activity.task')}
        </Text>
      </Flexbox>
      {(activity.description || activity.title) && <Text type="secondary">{activity.description || activity.title}</Text>}
    </Block>
  );
};

export const HitlBlock = ({
  description,
  onApprove,
  onReject,
  requestId,
}: {
  description?: string;
  onApprove: (requestId: string) => void;
  onReject: (requestId: string) => void;
  requestId: string;
}) => (
  <HitlBlockInner description={description} onApprove={onApprove} onReject={onReject} requestId={requestId} />
);

const HitlBlockInner = ({ description, onApprove, onReject, requestId }: { description?: string; onApprove: (requestId: string) => void; onReject: (requestId: string) => void; requestId: string }) => {
  const { t } = useI18n();
  return (
    <Block gap={12} padding={16} variant="outlined">
      <Flexbox horizontal align="center" gap={9}>
        <Icon color={cssVar.colorWarning} icon={Play} />
        <Text weight={500}>{t('chat.hitl.title')}</Text>
        <Tag color="warning" size="small">
          HITL
        </Tag>
      </Flexbox>
      <Text type="secondary">{description || t('chat.hitl.fallback')}</Text>
      <Flexbox horizontal gap={8}>
        <Button size="small" type="primary" onClick={() => onApprove(requestId)}>
          {t('chat.hitl.approve')}
        </Button>
        <Button size="small" onClick={() => onReject(requestId)}>
          {t('chat.hitl.reject')}
        </Button>
      </Flexbox>
    </Block>
  );
};

export const A2uiSurfaceBlock = ({
  payload,
  onAction,
}: {
  onAction?: () => void;
  payload: Record<string, unknown>;
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.block}>
      <div className={styles.header} onClick={() => setOpen((value) => !value)}>
        <Icon color={cssVar.colorInfo} icon={CheckCircle2} size={15} />
        <Text fontSize={12} weight={500} style={{ flex: 1 }}>
          {t('chat.a2uiSurface')}
        </Text>
        <Tag color="info" size="small">
          {String(payload.surfaceId || 'surface')}
        </Tag>
        <Icon icon={ChevronDown} size={14} />
      </div>
      {open && (
        <div className={styles.content}>
          <Flexbox gap={8} style={{ paddingBlockEnd: 8 }}>
            {onAction && (
              <Button icon={Play} size="small" type="primary" onClick={onAction}>
                {t('chat.a2ui.action')}
              </Button>
            )}
          </Flexbox>
          {JSON.stringify(payload, null, 2)}
        </div>
      )}
    </div>
  );
};

// 恢复历史 / Mock 场景的 A2UI Surface 组件化渲染：按 payload.components 重建 catalog 组件，
// 未知组件回退 raw JSON（http 实时路径由官方 renderer 渲染，不走这里）。
export const A2uiStoredSurface = ({
  onAction,
  payload,
}: {
  onAction: (actionName: string) => void;
  payload: Record<string, unknown>;
}) => {
  const components = Array.isArray(payload.components)
    ? (payload.components as Array<Record<string, unknown>>)
    : [];
  const nodes = components.flatMap((component, index) => {
    const name = String(component.type || component.component || '');
    const props = (component.props ?? component) as Record<string, unknown>;
    if (name === 'metricCard') {
      return [(
        <Flexbox
          gap={2}
          key={`metric-${index}`}
          padding={12}
          style={{
            background: cssVar.colorFillQuaternary,
            border: `1px solid ${cssVar.colorBorderSecondary}`,
            borderRadius: cssVar.borderRadiusLG,
            minWidth: 160,
          }}
        >
          <Text fontSize={12} type="secondary">
            {String(props.label ?? '')}
          </Text>
          <Text fontSize={24} weight={600}>
            {String(props.value ?? '')}
          </Text>
        </Flexbox>
      )];
    }
    if (name === 'actionButton' || name === 'button') {
      return [(
        <Button
          key={`action-${index}`}
          size="small"
          type="primary"
          onClick={() => onAction(String(props.actionName ?? ''))}
        >
          {String(props.label ?? '')}
        </Button>
      )];
    }
    return [];
  });
  if (!nodes.length) return <A2uiSurfaceBlock payload={payload} />;
  return <Flexbox gap={8} wrap="wrap">{nodes}</Flexbox>;
};

/**
 * 历史/刷新场景的 A2UI Surface 渲染：
 * - http 实时链路落库的 payload 是官方 `a2ui_operations` 结构 → 用官方 renderer
 *   （useRenderActivityMessage）按 catalog 还原为真实组件，刷新后仍然可见；
 * - mock 场景仍是旧 `components` 结构 → 走 A2uiStoredSurface 兼容渲染。
 */
export const StoredA2uiSurface = ({
  onAction,
  payload,
}: {
  onAction: (actionName: string, surfaceId: string) => void;
  payload: Record<string, unknown>;
}) => {
  const surfaceId = String(payload.surfaceId ?? 'surface');
  const operations = Array.isArray(payload.a2ui_operations) ? payload.a2ui_operations : [];
  if (operations.length > 0) {
    // http 实时链路：快照 payload 是官方 a2ui_operations。仅 http 模式挂载了
    // CopilotKit Provider（useRenderActivityMessage 依赖其 context），mock 模式
    // 遇 ops 快照回退 raw JSON 块，避免 hook 在无 Provider 时抛错。
    if (getChatServiceMode() === 'http') {
      return (
        <HttpStoredA2uiSurface
          key={`surface-${surfaceId}`}
          operations={operations}
          payload={payload}
          surfaceId={surfaceId}
        />
      );
    }
    return <A2uiSurfaceBlock payload={payload} />;
  }
  if (payload.components === undefined) return <A2uiSurfaceBlock payload={payload} />;
  return (
    <A2uiStoredSurface
      onAction={(actionName) => onAction(actionName, surfaceId)}
      payload={{ ...payload, surfaceId }}
    />
  );
};

/** CopilotKit 官方 activity renderer 内层：消息对象用 useMemo 稳定，避免每帧重建触发重复处理。 */
const HttpStoredA2uiSurface = ({
  operations,
  payload,
  surfaceId,
}: {
  operations: Array<Record<string, unknown>>;
  payload: Record<string, unknown>;
  surfaceId: string;
}) => {
  const { renderActivityMessage } = useRenderActivityMessage();
  const message = useMemo(
    () =>
      ({
        activityType: 'a2ui-surface',
        // content 必须严格符合官方 schema：只带 a2ui_operations，
        // 不能附加 surfaceId 等额外字段，否则校验失败返回 null。
        content: { a2ui_operations: operations },
        id: `surface-${surfaceId}`,
        role: 'activity',
      }) as never,
    [operations, surfaceId],
  );
  const rendered = renderActivityMessage(message);
  if (rendered) return <>{rendered}</>;
  return <A2uiSurfaceBlock payload={payload} />;
};

export const ErrorBlock = ({ code, message }: { code?: string; message: string }) => (
  <ErrorBlockInner code={code} message={message} />
);

const ErrorBlockInner = ({ code, message }: { code?: string; message: string }) => {
  const { t } = useI18n();
  return (
  <Block gap={10} padding={16} variant="outlined">
    <Flexbox horizontal align="center" gap={9}>
      <Icon color={cssVar.colorError} icon={XCircle} />
      <Text weight={500}>{t('chat.error.title')}</Text>
      {code && <Tag color="error" size="small">{code}</Tag>}
    </Flexbox>
    <Text type="secondary">{message}</Text>
  </Block>
  );
};

export interface StoredTextMessage {
  blocks: SessionMessageRecord[];
  record: SessionMessageRecord;
}

export const renderStoredBlocks = (
  blocks: SessionMessageRecord[],
  handlers: {
    onApproveHitl: (requestId: string) => void;
    onRejectHitl: (requestId: string) => void;
    onSurfaceAction: (actionName: string, surfaceId: string) => void;
  },
  options: { showReasoning?: boolean; showSurfaces?: boolean } = {},
): React.ReactNode[] => {
  const nodes: React.ReactNode[] = [];
  const stepRecords: SessionMessageRecord[] = [];
  const flushSteps = () => {
    if (!stepRecords.length) return;
    const steps: RuntimeStep[] = stepRecords.map((record) => {
      const payload = (record.payload || {}) as Record<string, unknown>;
      return {
        finishedAt: typeof payload.finishedAt === 'number' ? payload.finishedAt : undefined,
        id: record.id,
        name: typeof payload.name === 'string' ? payload.name : undefined,
        startedAt: typeof payload.startedAt === 'number' ? payload.startedAt : undefined,
        status: payload.status === 'error' ? 'error' : payload.status === 'completed' ? 'completed' : 'running',
      };
    });
    nodes.push(<WorkflowStepsBlock key={`steps-${stepRecords[0].id}`} steps={steps} />);
    stepRecords.length = 0;
  };

  for (const record of blocks) {
    if (record.kind === 'step') {
      stepRecords.push(record);
      continue;
    }
    flushSteps();
    const payload = (record.payload || {}) as Record<string, unknown>;
    if (record.kind === 'reasoning') {
      if (options.showReasoning !== false) {
        nodes.push(<ReasoningBlock id={record.id} key={record.id} text={record.content || ''} />);
      }
    } else if (record.kind === 'tool') {
      nodes.push(
        <ToolCallBlock
          call={{
            apiName: typeof payload.apiName === 'string' ? payload.apiName : undefined,
            args: record.content || String(payload.args || ''),
            finishedAt: typeof payload.finishedAt === 'number' ? payload.finishedAt : undefined,
            name: typeof payload.name === 'string' ? payload.name : undefined,
            result: payload.result,
            resultMsgId: typeof payload.resultMsgId === 'string' ? payload.resultMsgId : undefined,
            startedAt: typeof payload.startedAt === 'number' ? payload.startedAt : undefined,
            status: (payload.status === 'error' || payload.status === 'called' || payload.status === 'running' ? payload.status : 'completed') as RuntimeToolCall['status'],
          }}
          key={record.id}
        />,
      );
    } else if (record.kind === 'activity') {
      if (payload.activityType === 'a2ui.surface' || payload.activityType === 'a2ui-surface') continue;
      const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
      if (requestId) {
        nodes.push(
          <HitlBlock
            description={typeof payload.description === 'string' ? payload.description : undefined}
            key={record.id}
            onApprove={handlers.onApproveHitl}
            onReject={handlers.onRejectHitl}
            requestId={requestId}
          />,
        );
      } else {
        nodes.push(<ActivityBlock activity={payload} key={record.id} />);
      }
    } else if (record.kind === 'surface') {
      if (options.showSurfaces === false) continue;
      const surfaceId = typeof payload.surfaceId === 'string' ? payload.surfaceId : record.id;
      nodes.push(
        <StoredA2uiSurface
          key={record.id}
          onAction={(actionName) => handlers.onSurfaceAction(actionName, surfaceId)}
          payload={{ ...payload, surfaceId }}
        />,
      );
    }
  }
  flushSteps();
  return nodes;
};

export const renderRunBlocks = (
  run: RuntimeRunState | undefined,
  handlers: {
    onApproveHitl: (requestId: string) => void;
    onRejectHitl: (requestId: string) => void;
    onSurfaceAction: (actionName: string) => void;
  },
  options: { showReasoning?: boolean; showSurfaces?: boolean } = {},
) => {
  if (!run) return null;
  const blocks: React.ReactNode[] = [];
  const stepBuffer: RuntimeStep[] = [];
  const flushSteps = () => {
    if (!stepBuffer.length) return;
    blocks.push(<WorkflowStepsBlock key={`steps-${stepBuffer[0].id}`} steps={[...stepBuffer]} />);
    stepBuffer.length = 0;
  };
  const ordered = run.orderedBlocks?.length ? run.orderedBlocks : [];
  if (ordered.length === 0) {
    // 旧检查点兼容：按 map 分组渲染
    if (options.showReasoning !== false) {
      for (const [id, text] of Object.entries(run.reasoning || {})) blocks.push(<ReasoningBlock id={id} key={`reasoning-${id}`} meta={run.reasoningMeta?.[id]} text={text} />);
    }
    for (const [id, call] of Object.entries(run.toolCalls || {})) blocks.push(<ToolCallBlock call={call} key={`tool-${id}`} />);
    const steps = Object.values(run.steps || {}).sort((left, right) => (left.startedAt ?? 0) - (right.startedAt ?? 0));
    if (steps.length) blocks.push(<WorkflowStepsBlock key="steps" steps={steps} />);
    if (options.showSurfaces !== false) {
      for (const [surfaceId, payload] of Object.entries(run.surfaces || {})) {
        if (typeof payload === 'object' && payload !== null) blocks.push(<A2uiStoredSurface key={`surface-${surfaceId}`} onAction={handlers.onSurfaceAction} payload={{ ...(payload as Record<string, unknown>), surfaceId }} />);
      }
    }
  } else {
    for (const ref of ordered) {
      if (ref.kind === 'reasoning') {
        if (options.showReasoning === false) continue;
        const text = run.reasoning?.[ref.id];
        if (text !== undefined) blocks.push(<ReasoningBlock id={ref.id} key={`reasoning-${ref.id}`} meta={run.reasoningMeta?.[ref.id]} text={text} />);
      } else if (ref.kind === 'step') {
        const step = run.steps?.[ref.id];
        if (step) stepBuffer.push(step);
      } else if (ref.kind === 'tool') {
        flushSteps();
        const call = run.toolCalls?.[ref.id];
        if (call) blocks.push(<ToolCallBlock call={call} key={`tool-${ref.id}`} />);
      } else if (ref.kind === 'activity') {
        flushSteps();
        const activity = run.activities?.[ref.id];
        if (!activity || typeof activity !== 'object') continue;
        const value = activity as { activityType?: string; description?: string; requestId?: string; [key: string]: unknown };
        if (value.activityType === 'a2ui.surface' || value.activityType === 'a2ui-surface') continue;
        if (value.requestId) {
          blocks.push(<HitlBlock description={value.description} key={`hitl-${ref.id}`} onApprove={handlers.onApproveHitl} onReject={handlers.onRejectHitl} requestId={value.requestId} />);
        } else if (value.activityType === 'agentDock.hitl') {
          blocks.push(
            <HitlBlock
              description={typeof value.description === 'string' ? value.description : undefined}
              key={`hitl-${ref.id}`}
              onApprove={handlers.onApproveHitl}
              onReject={handlers.onRejectHitl}
              requestId={String(value.requestId || ref.id)}
            />,
          );
        } else if (typeof value.activityType === 'string' && value.activityType.startsWith('agentDock.')) {
          blocks.push(<ActivityBlock activity={value} key={`activity-${ref.id}`} />);
        }
      } else if (ref.kind === 'surface') {
        flushSteps();
        if (options.showSurfaces === false) continue;
        const payload = run.surfaces?.[ref.id];
        if (typeof payload === 'object' && payload !== null) blocks.push(<A2uiStoredSurface key={`surface-${ref.id}`} onAction={handlers.onSurfaceAction} payload={{ ...(payload as Record<string, unknown>), surfaceId: ref.id }} />);
      }
    }
    flushSteps();
  }
  if (run.error) blocks.push(<ErrorBlock code={run.error.code} key="error" message={run.error.message} />);
  return blocks;
};
