// Adapted from: src/features/Conversation/Messages + Tool/AssistantGroup (LobeHub canary)
import { ActionIcon, Block, Button, Flexbox, Icon, Tag, Text, TextArea } from '@lobehub/ui';
import { useRenderActivityMessage } from '@copilotkit/react-core/v2';
import { createStaticStyles, cssVar } from 'antd-style';
import { Atom, Check, CheckCircle2, ChevronDown, ChevronRight, Crown, Layers, ListTodo, Loader2, Play, Users, Wrench, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Markdown } from '@/features/chat/components/Markdown';
import { useI18n } from '@/i18n';
import { getChatServiceMode } from '@/api/core/serviceMode';
import { findLogicalSurfaceId } from '@/api/runtime/runReducer';
import type { RuntimeReasoningMeta, RuntimeRunState, RuntimeStep, RuntimeToolCall } from '@/api/runtime/types';
import type { SessionMessageRecord } from '@/api/session/sessionHistoryService';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

// LobeHub Thinking 展开态的 Atom 图标色（主题无 purple token，用官方种子色）。
const THINKING_PURPLE = '#bd54c6';

/** A2UI 内部工具：surface 结果即用户可见输出，调用过程不展示、不计数。 */
const A2UI_TOOL_NAMES = new Set(['generate_a2ui', 'render_a2ui']);
/** 内部中间件步骤（langgraph 管道节点），不是用户可理解的执行步骤，不展示也不计数。 */
const INTERNAL_STEP_RE = /Middleware|^model$/i;
const isInternalStep = (name?: string) => !name || INTERNAL_STEP_RE.test(name);
const isA2uiTool = (apiName?: string) => !!apiName && A2UI_TOOL_NAMES.has(apiName);

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
  contentScroll: css`
    max-height: min(40vh, 320px);
    overflow: auto;
    padding-block-end: 8px;
    padding-inline: 8px;
    color: ${token.colorTextDescription};

    article * {
      color: ${token.colorTextDescription};
    }
  `,
  header: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    cursor: pointer;
  `,
  shinyText: css`
    color: color-mix(in srgb, ${token.colorText} 45%, transparent);

    background: linear-gradient(
      120deg,
      color-mix(in srgb, ${token.colorTextBase} 0%, transparent) 40%,
      ${token.colorTextSecondary} 50%,
      color-mix(in srgb, ${token.colorTextBase} 0%, transparent) 60%
    );
    background-clip: text;
    background-size: 200% 100%;

    animation: message-blocks-shine 1.5s linear infinite;

    @keyframes message-blocks-shine {
      0% {
        background-position: 100%;
      }

      100% {
        background-position: -100%;
      }
    }
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
  // A2UI Surface 属于消息正文（不是过程/思考）：LobeHub 中 A2UI 就是纯内联组件，
  // 不加边框/背景/左竖线，只留一点上下间距，避免再被误认为 thinking 的一部分。
  surfaceBody: css`
    margin-block-start: 4px;
  `,
  // LobeHub ProcessFold：borderless Accordion 行（“共执行 N 步 · 点击查看完整记录”），
  // 无整卡边框/背景；展开态才显示过程块，二级单个块再各自折叠。
  processFold: css`
    margin-block-start: 4px;
  `,
  processFoldHeader: css`
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 24px;
    padding-block: 4px;
    cursor: pointer;
    user-select: none;
    width: fit-content;
  `,
  toolTitle: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
    min-width: 0;
    color: ${token.colorTextDescription};
  `,
  toolTitleName: css`
    color: ${token.colorTextDescription};
  `,
  toolApiName: css`
    font-family: ${token.fontFamilyCode};
    color: ${token.colorTextSecondary};
  `,
  toolParamKey: css`
    font-family: ${token.fontFamilyCode};
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  toolParamValue: css`
    font-family: ${token.fontFamilyCode};
    font-size: 12px;
    color: ${token.colorTextSecondary};
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
const formatProcessDuration = (startedAt?: number, finishedAt?: number) => {
  const seconds = formatDuration(startedAt, finishedAt);
  return seconds !== undefined ? `${seconds}s` : undefined;
};

/** 收集一轮 run 的过程块（思考/工具/步骤），完成后折叠为 ProcessFold 汇总行。 */
const createProcessCollector = (streaming: boolean) => {
  const state = {
    finishedAt: undefined as number | undefined,
    hasReasoning: false,
    hasWork: false,
    nodes: [] as React.ReactNode[],
    startedAt: undefined as number | undefined,
    stepCount: 0,
  };
  const track = (startedAt?: number, finishedAt?: number) => {
    if (startedAt && (!state.startedAt || startedAt < state.startedAt)) state.startedAt = startedAt;
    if (finishedAt && (!state.finishedAt || finishedAt > state.finishedAt)) state.finishedAt = finishedAt;
  };
  const flush = (target: React.ReactNode[]) => {
    if (!state.nodes.length) return;
    // 快照节点副本再传给组件：state.nodes 随后会被 length=0 原地清空，
    // 若按引用传递，React 渲染时 children 已变成空数组（折叠有标题无内容）。
    const nodes = [...state.nodes];
    // 单条 reasoning 独立展示（自身可折叠）；只有真实步骤/工具（stepCount>0）才汇总为折叠，
    // 避免 narration/HITL/纯推理等 0 步过程渲染出「已处理 0 步 · –」的空折叠卡。
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
    state.nodes.length = 0;
    state.stepCount = 0;
    state.startedAt = undefined;
    state.finishedAt = undefined;
    state.hasReasoning = false;
    state.hasWork = false;
  };
  return { flush, state, track };
};

// LobeHub Thinking StatusIndicator：24×24 轮廓块，思考中旋转 Loader，完成后 Atom。
const ThinkingStatus = ({ streaming, showDetail }: { streaming: boolean; showDetail: boolean }) => (
  <span className={styles.statusChip}>
    {streaming ? (
      <Icon color={cssVar.colorTextDescription} icon={Loader2} size={14} spin />
    ) : (
      <Icon
        color={showDetail ? THINKING_PURPLE : cssVar.colorTextDescription}
        icon={Atom}
        size={14}
      />
    )}
  </span>
);

export const ReasoningBlock = ({ id, meta, text }: { id: string; meta?: RuntimeReasoningMeta; text: string }) => {
  const { t } = useI18n();
  const streaming = Boolean(meta?.streaming);
  const duration = formatDuration(meta?.startedAt, meta?.finishedAt);
  const [open, setOpen] = useState(streaming);
  // LobeHub Thinking：思考中自动展开，完成自动收起；用户可点击重新展开。
  useEffect(() => {
    setOpen(streaming);
  }, [streaming]);
  return (
    <div className={styles.block} key={id}>
      <div className={styles.header} onClick={() => setOpen((value) => !value)}>
        <ThinkingStatus streaming={streaming} showDetail={open} />
        <Flexbox flex={1} style={{ minWidth: 0 }}>
          {streaming ? (
            <span className={styles.shinyText}>{t('chat.reasoningStreaming')}</span>
          ) : (
            <Text style={{ fontSize: 12 }} type="secondary">
              {duration !== undefined
                ? t('chat.reasoningDuration', { seconds: duration })
                : t('chat.reasoningDone')}
            </Text>
          )}
        </Flexbox>
        <Icon icon={ChevronDown} size={14} />
      </div>
      {open && (
        <div className={styles.contentScroll}>
          {meta?.encrypted ? t('chat.reasoningEncrypted') : <Markdown content={text} />}
        </div>
      )}
    </div>
  );
};

// LobeHub ProcessFold：一轮 run 的思考+工具+步骤在完成后折叠为一行
// “共执行 N 步 · 点击查看完整记录”，运行中展开；一级=过程汇总，二级=单个块。
export const ProcessFold = ({
  children,
  durationText,
  stepCount,
  streaming,
}: {
  children: React.ReactNode;
  durationText?: string;
  stepCount: number;
  streaming: boolean;
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(streaming);
  useEffect(() => {
    setOpen(streaming);
  }, [streaming]);
  return (
    <div className={styles.processFold}>
      <div
        className={styles.processFoldHeader}
        onClick={() => setOpen((value) => !value)}
        title={durationText ? t('chat.process.duration', { duration: durationText }) : undefined}
      >
        <Icon
          color={cssVar.colorTextTertiary}
          icon={ChevronDown}
          size={14}
          style={{
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform 0.2s',
          }}
        />
        <Text style={{ fontSize: 12 }} type="secondary">
          {streaming
            ? t('chat.process.streaming')
            : t('chat.process.done', { count: stepCount })}
        </Text>
      </div>
      {open && (
        <Flexbox gap={8} paddingBlock={8}>
          {children}
        </Flexbox>
      )}
    </div>
  );
};

// LobeHub Tool StatusIndicator：24×24 轮廓块；执行中神经网络动画，完成 Check，失败 X。
const ToolStatusChip = ({ status }: { status: RuntimeToolCall['status'] }) => (
  <span className={styles.statusChip}>
    {status === 'error' ? (
      <Icon color={cssVar.colorError} icon={X} size={14} />
    ) : status === 'completed' ? (
      <Icon color={cssVar.colorSuccess} icon={Check} size={14} />
    ) : (
      <NeuralNetworkLoading size={16} />
    )}
  </span>
);

// LobeHub ToolTitle：单行 title › apiName (key: value)，加载中扫光动画。
const MAX_PARAMS = 1;
const MAX_VALUE_LENGTH = 50;

const truncateValue = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : value.slice(0, maxLength) + '...';

const formatParamValue = (value: unknown): string => {
  if (typeof value === 'string') return truncateValue(value, MAX_VALUE_LENGTH);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return truncateValue(JSON.stringify(value), MAX_VALUE_LENGTH);
  if (typeof value === 'object' && value !== null)
    return truncateValue(JSON.stringify(value), MAX_VALUE_LENGTH);
  return String(value);
};

// LobeHub ExecutionTime：执行中 100ms 刷新耗时（ms / s / min+s）。
const formatElapsedTime = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}min${remainingSeconds}s`;
};

const ToolExecutionTime = ({
  running,
  startedAt,
}: {
  running: boolean;
  startedAt?: number;
}) => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running || !startedAt) return;
    const update = () => setElapsed(Math.max(0, Date.now() - startedAt));
    update();
    const id = window.setInterval(update, 100);
    return () => window.clearInterval(id);
  }, [running, startedAt]);
  if (!running) return null;
  return (
    <Text
      style={{ flexShrink: 0, fontSize: 12, whiteSpace: 'nowrap' }}
      type="secondary"
    >
      {formatElapsedTime(elapsed)}
    </Text>
  );
};

export const ToolCallBlock = ({ call }: { call: RuntimeToolCall }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const running = call.status === 'running' || call.status === 'called';
  // 参数格式化：合法 JSON 缩进展示，否则原文。
  let formattedArgs = call.args;
  try {
    formattedArgs = JSON.stringify(JSON.parse(call.args), null, 2);
  } catch {
    // keep raw args
  }
  let argsObject: Record<string, unknown> | undefined;
  try {
    argsObject = JSON.parse(call.args) as Record<string, unknown>;
  } catch {
    // keep raw
  }
  const params = argsObject ? Object.entries(argsObject).slice(0, MAX_PARAMS) : [];
  const remainingCount = argsObject ? Object.keys(argsObject).length - MAX_PARAMS : 0;
  const formattedResult =
    call.result === undefined
      ? undefined
      : typeof call.result === 'string'
        ? call.result
        : JSON.stringify(call.result, null, 2);
  return (
    <div className={styles.block}>
      <div className={styles.header} onClick={() => setOpen((value) => !value)}>
        <ToolStatusChip status={call.status} />
        <div className={running ? styles.shinyText : styles.toolTitle} style={{ flex: 1 }}>
          <span className={styles.toolTitleName}>{call.name || call.apiName || t('chat.toolCall')}</span>
          {call.apiName && call.apiName !== call.name && (
            <>
              <Icon icon={ChevronRight} size={12} style={{ marginInline: 4 }} />
              <span className={styles.toolApiName}>{call.apiName}</span>
            </>
          )}
          {params.length > 0 && (
            <>
              <span className={styles.toolParamKey}>{' ('}</span>
              <span className={styles.toolParamKey}>{params[0][0]}:</span>
              <span className={styles.toolParamValue}>{formatParamValue(params[0][1])}</span>
              {remainingCount > 0 && (
                <span className={styles.toolParamKey}>{` +${remainingCount}`}</span>
              )}
              <span className={styles.toolParamKey}>{')'}</span>
            </>
          )}
        </div>
        <ToolExecutionTime running={running} startedAt={call.startedAt} />
        <Icon icon={ChevronDown} size={14} />
      </div>
      {open && (
        <div className={styles.content}>
          <Flexbox gap={4}>
            <Text weight={500}>{t('chat.toolArgs')}</Text>
            <pre
              style={{
                margin: 0,
                overflowX: 'auto',
                background: cssVar.colorFillQuaternary,
                borderRadius: 8,
                padding: 8,
                fontSize: 12,
              }}
            >
              {formattedArgs || t('chat.toolNoArgs')}
            </pre>
          </Flexbox>
          {formattedResult !== undefined && (
            <Flexbox gap={4}>
              <div
                className={styles.header}
                onClick={() => setResultOpen((value) => !value)}
                style={{ padding: '6px 8px' }}
              >
                <Text weight={500}>{t('chat.toolResult')}</Text>
                <Tag color="success" size="small">
                  {t('chat.toolStatus.completed')}
                </Tag>
                <Icon icon={ChevronDown} size={12} />
              </div>
              {resultOpen && (
                <pre
                  style={{
                    margin: 0,
                    overflowX: 'auto',
                    background: cssVar.colorFillQuaternary,
                    borderRadius: 8,
                    padding: 8,
                    fontSize: 12,
                  }}
                >
                  {formattedResult}
                </pre>
              )}
            </Flexbox>
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

// 一轮 run 内的中间助手文本（最终答案之前的叙述）收进过程折叠，展开可见。
export const NarrationBlock = ({ text }: { text: string }) => (
  <div className={styles.block}>
    <div className={styles.content}>
      <Markdown content={text} />
    </div>
  </div>
);

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
  const navigate = useNavigate();
  const typeMeta = ACTIVITY_TYPE_META[String(activity.activityType || '')];
  const IconComponent = typeMeta?.icon ?? ListTodo;
  const isDelegation = activity.activityType === 'agentDock.agentDelegation';
  const members = Array.isArray(activity.members)
    ? (activity.members as Array<{ agentId?: string; agentFullName?: string; icon?: string; fab?: string }>)
    : [];
  const skills = Array.isArray(activity.skills)
    ? (activity.skills as Array<{ name?: string; id?: string }>)
    : [];
  const [callInfoOpen, setCallInfoOpen] = useState(false);
  return (
    <Block gap={10} padding={14} variant="outlined">
      <Flexbox horizontal align="center" gap={9}>
        <Icon color={cssVar.colorInfo} icon={IconComponent} />
        <Text weight={500}>
          {typeMeta ? t(typeMeta.labelKey) : t('chat.activity.task')}
        </Text>
      </Flexbox>
      {(activity.description || activity.title) && <Text type="secondary">{activity.description || activity.title}</Text>}
      {isDelegation && members.length > 0 && (
        <Flexbox gap={4}>
          <Flexbox horizontal align="center" gap={6}>
            <Crown size={12} />
            <Text fontSize={12} weight={500}>
              {t('chat.activity.supervisor')}
            </Text>
          </Flexbox>
          {members.map((member) => (
            <Flexbox
              horizontal
              align="center"
              gap={8}
              key={`${member.agentId}@${member.fab}`}
              paddingBlock={2}
              paddingInline={4}
            >
              <Text fontSize={13}>{member.icon || '🤖'}</Text>
              <Text ellipsis fontSize={13} style={{ flex: 1 }}>
                {member.agentFullName || member.agentId}
              </Text>
              {member.fab && <Tag size="small">{member.fab}</Tag>}
            </Flexbox>
          ))}
        </Flexbox>
      )}
      {skills.length > 0 && (
        <Flexbox horizontal gap={6} wrap="wrap">
          {skills.map((skill) => (
            <Tag color="blue" key={skill.id || skill.name}>
              🧩 {skill.name}
            </Tag>
          ))}
        </Flexbox>
      )}
      {(isDelegation || skills.length > 0) && (
        <Flexbox horizontal gap={6}>
          {skills.length > 0 && (
            <Button size="small" onClick={() => navigate('/market/skill')}>
              {t('chat.activity.viewSkill')}
            </Button>
          )}
          <Button size="small" type="text" onClick={() => setCallInfoOpen((value) => !value)}>
            {t('chat.activity.callInfo')}
          </Button>
        </Flexbox>
      )}
      {callInfoOpen && (
        <pre
          style={{
            margin: 0,
            overflowX: 'auto',
            background: cssVar.colorFillQuaternary,
            borderRadius: 8,
            padding: 8,
            fontSize: 11,
          }}
        >
          {JSON.stringify(activity, null, 2)}
        </pre>
      )}
    </Block>
  );
};

export interface HitlBlockProps {
  description?: string;
  fields?: Array<{ key: string; label: string; type?: string }>;
  mode?: string;
  onApprove: (requestId: string, payload?: Record<string, unknown>) => void;
  onReject: (requestId: string) => void;
  options?: string[];
  requestArgs?: string;
  requestId: string;
}

export const HitlBlock = ({
  description,
  fields,
  mode = 'toolAuthorization',
  onApprove,
  onReject,
  options = [],
  requestArgs,
  requestId,
}: HitlBlockProps) => {
  const { t } = useI18n();
  const [editedArgs, setEditedArgs] = useState(requestArgs || '');
  const [textInput, setTextInput] = useState('');
  const [single, setSingle] = useState<string>();
  const [multi, setMulti] = useState<string[]>([]);
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  const toggleMulti = (option: string) =>
    setMulti((current) =>
      current.includes(option) ? current.filter((item) => item !== option) : [...current, option],
    );

  const approveWith = (payload?: Record<string, unknown>) => onApprove(requestId, payload);

  const renderControl = () => {
    switch (mode) {
      case 'editArguments':
        return (
          <TextArea
            autoSize={{ minRows: 2, maxRows: 6 }}
            value={editedArgs}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setEditedArgs(event.target.value)}
          />
        );
      case 'textInput':
        return (
          <TextArea
            autoSize={{ minRows: 1, maxRows: 3 }}
            value={textInput}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setTextInput(event.target.value)}
          />
        );
      case 'singleSelect':
        return (
          <Flexbox gap={4}>
            {options.map((option) => (
              <label key={option} style={{ cursor: 'pointer' }}>
                <input
                  checked={single === option}
                  name={`hitl-${requestId}`}
                  type="radio"
                  onChange={() => setSingle(option)}
                />{' '}
                <Text fontSize={13}>{option}</Text>
              </label>
            ))}
          </Flexbox>
        );
      case 'multiSelect':
        return (
          <Flexbox gap={4}>
            {options.map((option) => (
              <label key={option} style={{ cursor: 'pointer' }}>
                <input
                  checked={multi.includes(option)}
                  type="checkbox"
                  onChange={() => toggleMulti(option)}
                />{' '}
                <Text fontSize={13}>{option}</Text>
              </label>
            ))}
          </Flexbox>
        );
      case 'form':
        return (
          <Flexbox gap={8}>
            {(fields || []).map((field) => (
              <Flexbox gap={4} key={field.key}>
                <Text fontSize={12} weight={500}>
                  {field.label}
                </Text>
                <TextArea
                  autoSize={{ minRows: 1, maxRows: 3 }}
                  value={formValues[field.key] || ''}
                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setFormValues((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                />
              </Flexbox>
            ))}
          </Flexbox>
        );
      default:
        return null;
    }
  };

  const modePayload = (): Record<string, unknown> | undefined => {
    switch (mode) {
      case 'editArguments':
        try {
          return { editedArguments: JSON.parse(editedArgs) };
        } catch {
          return { editedArguments: editedArgs };
        }
      case 'textInput':
        return { input: textInput };
      case 'singleSelect':
        return single ? { input: single } : undefined;
      case 'multiSelect':
        return multi.length ? { selectedValues: multi } : undefined;
      case 'form':
        return { formValues };
      default:
        return undefined;
    }
  };

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
      {renderControl()}
      <Flexbox horizontal gap={8}>
        <Button
          size="small"
          type="primary"
          onClick={() => approveWith(modePayload())}
        >
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
  return <A2uiSurfaceBlock payload={payload} />;
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
    const payload = (record.payload || {}) as Record<string, unknown>;
    if (record.kind === 'reasoning') {
      if (options.showReasoning !== false) {
        process.state.nodes.push(<ReasoningBlock id={record.id} key={record.id} text={record.content || ''} />);
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
      if (seenSurfaces.has(logicalId)) continue;
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
  },
  options: { deletedKeys?: Set<string>; showReasoning?: boolean; showSurfaces?: boolean } = {},
) => {
  if (!run) return null;
  const blocks: React.ReactNode[] = [];
  const stepBuffer: RuntimeStep[] = [];
  const seenSurfaces = new Set<string>();
  const process = createProcessCollector(run.status === 'running' || run.status === 'paused');
  const pushStepsIntoProcess = () => {
    if (!stepBuffer.length) return;
    process.state.nodes.push(<WorkflowStepsBlock key={`steps-${stepBuffer[0].id}`} steps={[...stepBuffer]} />);
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
  const visibleOrdered = options.deletedKeys?.size
    ? ordered.filter((ref) => !options.deletedKeys!.has(`${ref.kind}:${ref.id}`))
    : ordered;
  if (visibleOrdered.length === 0) {
    // 旧检查点兼容：按 map 分组渲染
    if (options.showReasoning !== false) {
      for (const [id, text] of Object.entries(run.reasoning || {})) {
        const meta = run.reasoningMeta?.[id];
        process.state.nodes.push(<ReasoningBlock id={id} key={`reasoning-${id}`} meta={meta} text={text} />);
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
      process.state.nodes.push(<WorkflowStepsBlock key="steps" steps={visibleSteps} />);
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
          if (!seenSurfaces.has(logicalId)) {
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
      if (ref.kind === 'reasoning') {
        if (options.showReasoning === false) continue;
        const text = run.reasoning?.[ref.id];
        if (text !== undefined) {
          const meta = run.reasoningMeta?.[ref.id];
          process.state.nodes.push(<ReasoningBlock id={ref.id} key={`reasoning-${ref.id}`} meta={meta} text={text} />);
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
        if (value.activityType === 'a2ui.surface' || value.activityType === 'a2ui-surface' || value.activityType === 'agentDock.artifact') {
          flushSteps();
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
          if (!seenSurfaces.has(logicalId)) {
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
