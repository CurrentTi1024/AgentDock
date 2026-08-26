// Adapted from: src/features/Conversation/Messages + Tool/AssistantGroup (LobeHub canary)
import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { useRenderActivityMessage } from '@copilotkit/react-core/v2';
import { createStaticStyles, cssVar } from 'antd-style';
import { CheckCircle2, Play } from 'lucide-react';
import { useMemo } from 'react';

import { useI18n } from '@/i18n';
import { getChatServiceMode } from '@/api/core/serviceMode';
import { findLogicalSurfaceId } from '@/api/runtime/runReducer';
import type { RuntimeRunState, RuntimeStep, RuntimeToolCall } from '@/api/runtime/types';
import type { SessionMessageRecord } from '@/api/session/sessionHistoryService';
import ErrorAlert from '@/features/chat/components/lobehub/ErrorAlert';
import {
  ActivityBlock,
  formatProcessDuration,
  HitlBlock,
  NarrationBlock,
  ProcessFold,
  ReasoningBlock,
  ToolCallBlock,
  WorkflowStepsBlock,
} from '@/features/chat/components/lobehub/ProcessBlocks';

/** A2UI 内部工具：surface 结果即用户可见输出，调用过程不展示、不计数。 */
const A2UI_TOOL_NAMES = new Set(['generate_a2ui', 'render_a2ui']);
/** 内部中间件步骤（langgraph 管道节点），不是用户可理解的执行步骤，不展示也不计数。 */
const INTERNAL_STEP_RE = /Middleware|^model$/i;
const isInternalStep = (name?: string) => !name || INTERNAL_STEP_RE.test(name);
const isA2uiTool = (apiName?: string) => !!apiName && A2UI_TOOL_NAMES.has(apiName);
/** surface 是否有可渲染 UI：官方 ops 或组件树。中间态（building/progress）跳过，避免 JSON 回退卡。 */
const hasSurfaceContent = (payload: Record<string, unknown>): boolean =>
  Array.isArray(payload.a2ui_operations) || Array.isArray(payload.components);

const styles = createStaticStyles(({ css }) => ({
  // A2UI Surface 属于消息正文（不是过程/思考）：LobeHub 中 A2UI 就是纯内联组件，
  // 不加边框/背景/左竖线，只留一点上下间距，避免再被误认为 thinking 的一部分。
  surfaceBody: css`
    margin-block-start: 4px;
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

/** 剥离 reducer 追加到消息末尾的错误文本（`\n\n{message}`），避免与错误 Alert 重复显示。 */
export const stripRunErrorText = (content: string, errorMessage?: string): string => {
  if (!errorMessage) return content;
  const suffix = `\n\n${errorMessage}`;
  return content.endsWith(suffix) ? content.slice(0, -suffix.length) : content;
};

/** 收集一轮 run 的过程块（思考/工具/步骤），完成后折叠为 ProcessFold 汇总行。 */
const createProcessCollector = (streaming: boolean) => {
  const state = {
    finishedAt: undefined as number | undefined,
    hasReasoning: false,
    hasWork: false,
    nodes: [] as React.ReactNode[],
    // 推理（thinking）与过程分开：正文出来后 thinking 也要常驻显示（默认折叠），
    // 不藏进 ProcessFold；工具/步骤/中间叙述才进过程折叠。
    reasoningNodes: [] as React.ReactNode[],
    startedAt: undefined as number | undefined,
    stepCount: 0,
  };
  const track = (startedAt?: number, finishedAt?: number) => {
    if (startedAt && (!state.startedAt || startedAt < state.startedAt)) state.startedAt = startedAt;
    if (finishedAt && (!state.finishedAt || finishedAt > state.finishedAt)) state.finishedAt = finishedAt;
  };
  const flush = (target: React.ReactNode[]) => {
    if (!state.nodes.length && !state.reasoningNodes.length) return;
    // 快照节点副本再传给组件：state.nodes 随后会被 length=0 原地清空，
    // 若按引用传递，React 渲染时 children 已变成空数组（折叠有标题无内容）。
    const nodes = [...state.nodes];
    const reasoningNodes = [...state.reasoningNodes];
    // 推理独立常驻：正文出来后 thinking 也显示，默认折叠（Thinking 完成自动收起）。
    if (reasoningNodes.length) target.push(...reasoningNodes);
    state.reasoningNodes.length = 0;
    if (nodes.length) {
      // 只有真实步骤/工具（stepCount>0）才汇总为折叠，
      // 避免 narration/HITL 等 0 步过程渲染出「已处理 0 步 · –」的空折叠卡。
      if (state.stepCount > 0) {
        target.push(
          <ProcessFold
            durationText={formatProcessDuration(state.startedAt, state.finishedAt)}
            key={`process-${state.startedAt ?? state.nodes.length}`}
            stepCount={state.stepCount}
            streaming={streaming}
          >
            {nodes}
          </ProcessFold>,
        );
      } else {
        target.push(...nodes);
      }
    }
    state.nodes.length = 0;
    state.stepCount = 0;
    state.startedAt = undefined;
    state.finishedAt = undefined;
    state.hasReasoning = false;
    state.hasWork = false;
  };
  return { flush, state, track };
};

export const A2uiSurfaceBlock = ({
  payload,
  onAction,
}: {
  onAction?: () => void;
  payload: Record<string, unknown>;
}) => {
  const { t } = useI18n();
  // A2UI Surface 属于消息正文，回退渲染保持纯内联（无边框/背景/左竖线），
  // 与 thinking/工具卡彻底区分；仅在小标签 + 原始 JSON 预览。
  return (
    <div className={styles.surfaceBody}>
      {onAction && (
        <Flexbox gap={8} style={{ marginBlockEnd: 8 }}>
          <Button icon={Play} size="small" type="primary" onClick={onAction}>
            {t('chat.a2ui.action')}
          </Button>
        </Flexbox>
      )}
      <Flexbox horizontal align="center" gap={6} style={{ marginBlockEnd: 4 }}>
        <Icon color={cssVar.colorTextTertiary} icon={CheckCircle2} size={14} />
        <Text fontSize={12} type="secondary">
          {t('chat.a2uiSurface')} · {String(payload.surfaceId || 'surface')}
        </Text>
      </Flexbox>
      <pre
        style={{
          color: cssVar.colorTextDescription,
          fontFamily: cssVar.fontFamilyCode,
          fontSize: 12,
          lineHeight: 1.6,
          margin: 0,
          maxHeight: 320,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {JSON.stringify(payload, null, 2)}
      </pre>
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
  // http 实时路径官方渲染器暂不可用（如流式中 ops 未完整）时返回 null：
  // 隐藏原始 JSON 回退卡，避免流式期出现“A2UI Surface”丑陋卡，完成后由历史路径渲染。
  return null;
};

export interface StoredTextMessage {
  blocks: SessionMessageRecord[];
  record: SessionMessageRecord;
}

/** 单个展示单元：同一轮 run 的连续助手文本合并（内容取最终答案，中间文本作 narration）。 */
export interface DisplayUnit {
  blocks: SessionMessageRecord[];
  narration: string[];
  record: SessionMessageRecord;
}

/** 单聊/群聊共用：把 storedMessages 合并为展示单元，blocks 只挂一次。 */
export const buildDisplayUnits = (storedMessages: StoredTextMessage[]): DisplayUnit[] => {
  const units: DisplayUnit[] = [];
  for (const item of storedMessages) {
    const previous = units.at(-1);
    if (
      previous &&
      previous.record.role === 'assistant' &&
      item.record.role === 'assistant' &&
      previous.record.runId &&
      previous.record.runId === item.record.runId
    ) {
      if (previous.record.content && previous.record.content !== item.record.content) {
        previous.narration.push(previous.record.content);
      }
      previous.record = item.record;
      previous.blocks = item.blocks;
    } else {
      units.push({ blocks: item.blocks, narration: [], record: item.record });
    }
  }
  return units;
};

export const renderStoredBlocks = (
  blocks: SessionMessageRecord[],
  handlers: {
    onApproveHitl: (requestId: string, payload?: Record<string, unknown>) => void;
    onRejectHitl: (requestId: string) => void;
    onSurfaceAction: (actionName: string, surfaceId: string) => void;
    onRegenerateError?: (runId?: string) => void;
  },
  options: { deletedKeys?: Set<string>; narration?: string[]; showReasoning?: boolean; showSurfaces?: boolean } = {},
): React.ReactNode[] => {
  const nodes: React.ReactNode[] = [];
  const stepRecords: SessionMessageRecord[] = [];
  const process = createProcessCollector(false);
  // 旧数据防御：同一逻辑 surface 可能以多个记录键落库（a2ui.surface 活动键 + render_a2ui
  // 工具键），按逻辑 surfaceId 去重，只渲染一次。
  const seenSurfaces = new Set<string>();
  const visibleBlocks =
    options.deletedKeys?.size
      ? blocks.filter((record) => !options.deletedKeys!.has(record.id))
      : blocks;
  if (options.narration?.length) {
    for (const text of options.narration) {
      process.state.nodes.push(<NarrationBlock key={`narration-${text.slice(0, 12)}`} text={text} />);
    }
    process.state.hasWork = true;
  }
  const pushStepsIntoProcess = () => {
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
    process.state.nodes.push(<WorkflowStepsBlock key={`steps-${stepRecords[0].id}`} steps={steps} />);
    process.state.hasWork = true;
    process.state.stepCount += steps.length;
    process.track(
      Math.min(...steps.map((step) => step.startedAt ?? Number.POSITIVE_INFINITY)),
      Math.max(...steps.map((step) => step.finishedAt ?? 0)),
    );
    stepRecords.length = 0;
  };
  const flushSteps = () => {
    pushStepsIntoProcess();
    process.flush(nodes);
  };

  for (const record of visibleBlocks) {
    if (record.kind === 'step') {
      const payload = (record.payload || {}) as Record<string, unknown>;
      if (!isInternalStep(typeof payload.name === 'string' ? payload.name : undefined)) {
        stepRecords.push(record);
      }
      continue;
    }
    if (record.kind === 'narration') {
      pushStepsIntoProcess();
      if (record.content?.trim()) {
        process.state.nodes.push(<NarrationBlock key={record.id} text={record.content} />);
        process.state.hasWork = true;
      }
      continue;
    }
    const payload = (record.payload || {}) as Record<string, unknown>;
    if (record.kind === 'reasoning') {
      if (options.showReasoning !== false) {
        // 推理独立常驻（默认折叠）；空内容不渲染，避免“空已深度思考”噪声块。
        if (record.content?.trim()) {
          process.state.reasoningNodes.push(<ReasoningBlock id={record.id} key={record.id} text={record.content} />);
        }
        process.state.hasReasoning = true;
      }
    } else if (record.kind === 'tool') {
      pushStepsIntoProcess();
      if (isA2uiTool(typeof payload.apiName === 'string' ? payload.apiName : undefined)) continue;
      process.state.nodes.push(
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
      process.state.hasWork = true;
      process.state.stepCount += 1;
      process.track(
        typeof payload.startedAt === 'number' ? payload.startedAt : undefined,
        typeof payload.finishedAt === 'number' ? payload.finishedAt : undefined,
      );
    } else if (record.kind === 'activity') {
      if (payload.activityType === 'a2ui.surface' || payload.activityType === 'a2ui-surface' || payload.activityType === 'agentDock.artifact') {
        flushSteps();
        continue;
      }
      if (payload.activityType === 'agentDock.error') {
        flushSteps();
        nodes.push(
          <ErrorAlert
            code={typeof payload.code === 'string' ? payload.code : undefined}
            key={record.id}
            message={String(payload.message || 'Run failed')}
            onRegenerate={
              handlers.onRegenerateError
                ? () => handlers.onRegenerateError?.(record.runId)
                : undefined
            }
          />,
        );
        continue;
      }
      const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
      if (requestId) {
        // HITL 属于过程本身（LobeHub 干预在 workflow 内部）：
        // 暂停时折叠展开可见，完成后随过程一起收起。
        process.state.nodes.push(
          <HitlBlock
            description={typeof payload.description === 'string' ? payload.description : undefined}
            fields={Array.isArray(payload.fields) ? (payload.fields as Array<{ key: string; label: string; type?: string }>) : undefined}
            key={record.id}
            mode={typeof payload.mode === 'string' ? payload.mode : 'toolAuthorization'}
            onApprove={(requestId, approvePayload) =>
              handlers.onApproveHitl(requestId, {
                ...approvePayload,
                mode: payload.mode || 'toolAuthorization',
              })
            }
            onReject={handlers.onRejectHitl}
            options={Array.isArray(payload.options) ? (payload.options as string[]) : undefined}
            requestArgs={typeof payload.requestArgs === 'string' ? payload.requestArgs : undefined}
            requestId={requestId}
          />,
        );
        process.state.hasWork = true;
        continue;
      }
      // supervisor/tasks/groupTasks/agentDelegation 等过程活动并入折叠（LobeHub workflow 内联）。
      if (typeof payload.activityType === 'string' && payload.activityType.startsWith('agentDock.')) {
        process.state.nodes.push(<ActivityBlock activity={payload} key={record.id} />);
        process.state.hasWork = true;
        continue;
      }
      flushSteps();
      nodes.push(<ActivityBlock activity={payload} key={record.id} />);
    } else if (record.kind === 'surface') {
      flushSteps();
      if (options.showSurfaces === false) continue;
      const surfaceId = typeof payload.surfaceId === 'string' ? payload.surfaceId : record.id;
      const logicalId = findLogicalSurfaceId(payload) || surfaceId;
      if (!hasSurfaceContent(payload) || seenSurfaces.has(logicalId)) continue;
      seenSurfaces.add(logicalId);
      // A2UI Surface 是纯正文内容：不加边框/背景/左竖线，直接内联渲染。
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
    onApproveHitl: (requestId: string, payload?: Record<string, unknown>) => void;
    onRejectHitl: (requestId: string) => void;
    onSurfaceAction: (actionName: string) => void;
    onRegenerateError?: () => void;
  },
  options: { deletedKeys?: Set<string>; showReasoning?: boolean; showSurfaces?: boolean } = {},
) => {
  if (!run) return null;
  const blocks: React.ReactNode[] = [];
  const stepBuffer: RuntimeStep[] = [];
  const seenSurfaces = new Set<string>();
  const streaming = run.status === 'running' || run.status === 'paused';
  const process = createProcessCollector(streaming);
  const pushStepsIntoProcess = () => {
    if (!stepBuffer.length) return;
    process.state.nodes.push(<WorkflowStepsBlock key={`steps-${stepBuffer[0].id}`} steps={[...stepBuffer]} streaming={streaming} />);
    process.state.hasWork = true;
    process.state.stepCount += stepBuffer.length;
    process.track(
      Math.min(...stepBuffer.map((step) => step.startedAt ?? Number.POSITIVE_INFINITY)),
      Math.max(...stepBuffer.map((step) => step.finishedAt ?? 0)),
    );
    stepBuffer.length = 0;
  };
  const flushSteps = () => {
    pushStepsIntoProcess();
    process.flush(blocks);
  };
  const ordered = run.orderedBlocks?.length ? run.orderedBlocks : [];
  const finalAssistantId = [...(run.messageOrder || [])]
    .reverse()
    .find((messageId) => run.messages[messageId]?.role === 'assistant');
  const visibleOrdered = options.deletedKeys?.size
    ? ordered.filter((ref) => !options.deletedKeys!.has(`${ref.kind}:${ref.id}`))
    : ordered;
  if (visibleOrdered.length === 0) {
    // 旧检查点兼容：按 map 分组渲染
    if (options.showReasoning !== false) {
      for (const [id, text] of Object.entries(run.reasoning || {})) {
        const meta = run.reasoningMeta?.[id];
        if (text?.trim() || meta?.streaming) {
          process.state.reasoningNodes.push(<ReasoningBlock id={id} key={`reasoning-${id}`} meta={meta} text={text} />);
        }
        process.state.hasReasoning = true;
        process.track(meta?.startedAt, meta?.finishedAt);
      }
    }
    for (const [id, call] of Object.entries(run.toolCalls || {})) {
      if (isA2uiTool(call.apiName)) continue;
      process.state.nodes.push(<ToolCallBlock call={call} key={`tool-${id}`} />);
      process.state.hasWork = true;
      process.state.stepCount += 1;
      process.track(call.startedAt, call.finishedAt);
    }
    const steps = Object.values(run.steps || {}).sort((left, right) => (left.startedAt ?? 0) - (right.startedAt ?? 0));
    const visibleSteps = steps.filter((step) => !isInternalStep(step.name));
    if (visibleSteps.length) {
      process.state.nodes.push(<WorkflowStepsBlock key="steps" steps={visibleSteps} streaming={streaming} />);
      process.state.hasWork = true;
      process.state.stepCount += visibleSteps.length;
      process.track(
        Math.min(...visibleSteps.map((step) => step.startedAt ?? Number.POSITIVE_INFINITY)),
        Math.max(...visibleSteps.map((step) => step.finishedAt ?? 0)),
      );
    }
    flushSteps();
    if (options.showSurfaces !== false) {
      for (const [surfaceId, payload] of Object.entries(run.surfaces || {})) {
        if (typeof payload === 'object' && payload !== null) {
          const logicalId = findLogicalSurfaceId(payload) || surfaceId;
          if (hasSurfaceContent(payload as Record<string, unknown>) && !seenSurfaces.has(logicalId)) {
            seenSurfaces.add(logicalId);
            blocks.push(
              <A2uiStoredSurface key={`surface-${surfaceId}`} onAction={handlers.onSurfaceAction} payload={{ ...(payload as Record<string, unknown>), surfaceId }} />,
            );
          }
        }
      }
    }
  } else {
    for (const ref of visibleOrdered) {
      if (ref.kind === 'text') {
        const message = run.messages?.[ref.id];
        if (
          message?.role === 'assistant' &&
          ref.id !== finalAssistantId &&
          message.content?.trim()
        ) {
          pushStepsIntoProcess();
          process.state.nodes.push(
            <NarrationBlock key={`narration-${ref.id}`} text={message.content} />,
          );
          process.state.hasWork = true;
        }
      } else if (ref.kind === 'reasoning') {
        if (options.showReasoning === false) continue;
        const text = run.reasoning?.[ref.id];
        if (text !== undefined) {
          const meta = run.reasoningMeta?.[ref.id];
          if (text?.trim() || meta?.streaming) {
            process.state.reasoningNodes.push(<ReasoningBlock id={ref.id} key={`reasoning-${ref.id}`} meta={meta} text={text} />);
          }
          process.state.hasReasoning = true;
          process.track(meta?.startedAt, meta?.finishedAt);
        }
      } else if (ref.kind === 'step') {
        const step = run.steps?.[ref.id];
        if (step && !isInternalStep(step.name)) {
          stepBuffer.push(step);
          process.state.hasWork = true;
          process.track(step.startedAt, step.finishedAt);
        }
      } else if (ref.kind === 'tool') {
        pushStepsIntoProcess();
        const call = run.toolCalls?.[ref.id];
        if (call && !isA2uiTool(call.apiName)) {
          process.state.nodes.push(<ToolCallBlock call={call} key={`tool-${ref.id}`} />);
          process.state.hasWork = true;
          process.state.stepCount += 1;
          process.track(call.startedAt, call.finishedAt);
        }
      } else if (ref.kind === 'activity') {
        const activity = run.activities?.[ref.id];
        if (!activity || typeof activity !== 'object') continue;
        const value = activity as { activityType?: string; description?: string; requestId?: string; [key: string]: unknown };
        // MESSAGES_SNAPSHOT 的 task/supervisor 等角色已经由 SpecialMessage 走原生组件展示；
        // reducer 仅保留 diagnosticOnly activity 供诊断，不能再塞进 assistant workflow 重复显示。
        if (value.diagnosticOnly === true) continue;
        if (value.activityType === 'a2ui.surface' || value.activityType === 'a2ui-surface' || value.activityType === 'agentDock.artifact') {
          flushSteps();
          continue;
        }
        if (value.activityType === 'agentDock.error') {
          flushSteps();
          blocks.push(
            <ErrorAlert
              code={typeof value.code === 'string' ? value.code : undefined}
              key={`error-${ref.id}`}
              message={String(value.message || 'Run failed')}
              onRegenerate={handlers.onRegenerateError ? () => handlers.onRegenerateError?.() : undefined}
            />,
          );
          continue;
        }
        if (value.requestId) {
          // HITL 属于过程（LobeHub 干预在 workflow 内部）：进入折叠。
          process.state.nodes.push(
            <HitlBlock
              description={value.description}
              fields={Array.isArray(value.fields) ? (value.fields as Array<{ key: string; label: string; type?: string }>) : undefined}
              key={`hitl-${ref.id}`}
              mode={typeof value.mode === 'string' ? value.mode : 'toolAuthorization'}
              onApprove={(requestId, approvePayload) =>
                handlers.onApproveHitl(requestId, {
                  ...approvePayload,
                  mode: value.mode || 'toolAuthorization',
                })
              }
              onReject={handlers.onRejectHitl}
              options={Array.isArray(value.options) ? (value.options as string[]) : undefined}
              requestArgs={typeof value.requestArgs === 'string' ? value.requestArgs : undefined}
              requestId={value.requestId}
            />,
          );
          process.state.hasWork = true;
        } else if (value.activityType === 'agentDock.hitl') {
          process.state.nodes.push(
            <HitlBlock
              description={typeof value.description === 'string' ? value.description : undefined}
              fields={Array.isArray(value.fields) ? (value.fields as Array<{ key: string; label: string; type?: string }>) : undefined}
              key={`hitl-${ref.id}`}
              mode={typeof value.mode === 'string' ? value.mode : 'toolAuthorization'}
              onApprove={(requestId, approvePayload) =>
                handlers.onApproveHitl(requestId, {
                  ...approvePayload,
                  mode: value.mode || 'toolAuthorization',
                })
              }
              onReject={handlers.onRejectHitl}
              options={Array.isArray(value.options) ? (value.options as string[]) : undefined}
              requestArgs={typeof value.requestArgs === 'string' ? value.requestArgs : undefined}
              requestId={String(value.requestId || ref.id)}
            />,
          );
          process.state.hasWork = true;
        } else if (typeof value.activityType === 'string' && value.activityType.startsWith('agentDock.')) {
          // supervisor/tasks/groupTasks/agentDelegation 等过程活动并入折叠。
          process.state.nodes.push(<ActivityBlock activity={value} key={`activity-${ref.id}`} />);
          process.state.hasWork = true;
        }
      } else if (ref.kind === 'surface') {
        flushSteps();
        if (options.showSurfaces === false) continue;
        const payload = run.surfaces?.[ref.id];
        if (typeof payload === 'object' && payload !== null) {
          const logicalId = findLogicalSurfaceId(payload) || ref.id;
          if (hasSurfaceContent(payload as Record<string, unknown>) && !seenSurfaces.has(logicalId)) {
            seenSurfaces.add(logicalId);
            // A2UI Surface 纯内联渲染（无包装，避免双左竖线/外框观感）。
            blocks.push(
              <A2uiStoredSurface key={`surface-${ref.id}`} onAction={handlers.onSurfaceAction} payload={{ ...(payload as Record<string, unknown>), surfaceId: ref.id }} />,
            );
          }
        }
      }
    }
    flushSteps();
  }
  // RUN_ERROR 的错误文本已由 reducer 作为 assistant 消息内容（最后一个 chunk）渲染，
  // 不再额外推 ErrorBlock，避免同一错误在气泡正文与过程区重复显示。
  return blocks;
};
