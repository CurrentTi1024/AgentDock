// Adapted from: src/features/Conversation/Messages + Tool/AssistantGroup (LobeHub canary)
import { ActionIcon, Block, Button, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Brain, CheckCircle2, ChevronDown, ListTodo, Play, Users, Wrench, XCircle } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '@/i18n';
import type { RuntimeRunState, RuntimeStep } from '@/api/runtime/types';
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

export const ReasoningBlock = ({ id, text }: { id: string; text: string }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.block} key={id}>
      <div className={styles.header} onClick={() => setOpen((value) => !value)}>
        <Icon color={cssVar.colorTextDescription} icon={Brain} size={15} />
        <Flexbox flex={1}>
          <Text fontSize={12} weight={500}>
            {t('chat.reasoning')}
          </Text>
          <Text fontSize={11} type="secondary">
            {t('chat.reasoningDone')}
          </Text>
        </Flexbox>
        <Icon icon={ChevronDown} size={14} />
      </div>
      {open && <div className={styles.content}>{text}</div>}
    </div>
  );
};

export const ToolCallBlock = ({ call }: { call: { args: string; name?: string; result?: unknown; status: string } }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const statusKeys: Record<string, 'chat.toolStatus.called' | 'chat.toolStatus.completed' | 'chat.toolStatus.running'> = {
    called: 'chat.toolStatus.called',
    completed: 'chat.toolStatus.completed',
    running: 'chat.toolStatus.running',
  };
  const statusKey = statusKeys[call.status];
  const meta = statusKey
    ? { color: call.status === 'completed' ? ('success' as const) : ('processing' as const), label: t(statusKey) }
    : { color: 'default' as const, label: call.status };
  return (
    <div className={styles.block}>
      <div className={styles.header} onClick={() => setOpen((value) => !value)}>
        <Icon color={cssVar.colorTextDescription} icon={Wrench} size={15} />
        <Text fontSize={12} weight={500} style={{ flex: 1 }}>
          {call.name || t('chat.toolCall')}
        </Text>
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

export const ActivityBlock = ({ activity }: { activity: { activityType?: string; description?: string; title?: string; [key: string]: unknown } }) => {
  const { t } = useI18n();
  const isDelegation = activity.activityType === 'agentDock.agentDelegation';
  return (
    <Block gap={10} padding={14} variant="outlined">
      <Flexbox horizontal align="center" gap={9}>
        <Icon color={cssVar.colorInfo} icon={isDelegation ? Users : ListTodo} />
        <Text weight={500}>
          {isDelegation ? t('chat.activity.agentDelegation') : t('chat.activity.task')}
        </Text>
      </Flexbox>
      {activity.description && <Text type="secondary">{activity.description}</Text>}
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

export const ErrorBlock = ({ message }: { message: string }) => (
  <ErrorBlockInner message={message} />
);

const ErrorBlockInner = ({ message }: { message: string }) => {
  const { t } = useI18n();
  return (
  <Block gap={10} padding={16} variant="outlined">
    <Flexbox horizontal align="center" gap={9}>
      <Icon color={cssVar.colorError} icon={XCircle} />
      <Text weight={500}>{t('chat.error.title')}</Text>
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
            args: record.content || String(payload.args || ''),
            name: typeof payload.name === 'string' ? payload.name : undefined,
            result: payload.result,
            status: String(payload.status || 'completed'),
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
        <A2uiStoredSurface
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
      for (const [id, text] of Object.entries(run.reasoning || {})) blocks.push(<ReasoningBlock id={id} key={`reasoning-${id}`} text={text} />);
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
        if (text !== undefined) blocks.push(<ReasoningBlock id={ref.id} key={`reasoning-${ref.id}`} text={text} />);
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
        } else if (value.activityType === 'agentDock.agentDelegation' || value.activityType === 'agentDock.task') {
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
  if (run.error) blocks.push(<ErrorBlock key="error" message={run.error.message} />);
  return blocks;
};
