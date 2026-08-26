// Ported/adapted from LobeHub canary 9208806:
// src/features/Conversation/Messages/AssistantGroup/{components/ProcessFold,components/WorkflowCollapse,Tool}
// and src/features/Conversation/Messages/components/Reasoning.
import { Accordion, AccordionItem, Block, Button, Flexbox, Icon, Tag, Text, TextArea } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Check, CheckCircle2, Crown, Layers, ListTodo, Play, Users, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { RuntimeReasoningMeta, RuntimeStep, RuntimeToolCall } from '@/api/runtime/types';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { Markdown } from '@/features/chat/components/Markdown';
import Thinking from '@/features/chat/components/lobehub/Thinking';
import { ToolInspector } from '@/features/chat/components/lobehub/ToolInspector';
import { useI18n } from '@/i18n';

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  workflowProgress: css`
    position: relative;
    overflow: hidden;
    height: 3px;
    margin-block: 2px;
    border-radius: 2px;
    background: ${token.colorFillSecondary};
  `,
  workflowProgressShimmer: css`
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, ${token.colorPrimaryBgHover}, transparent);
    animation: process-blocks-progress-shimmer 2s infinite;

    @keyframes process-blocks-progress-shimmer {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }
  `,
}));

export const formatProcessDuration = (startedAt?: number, finishedAt?: number) => {
  if (!startedAt || !finishedAt) return undefined;
  const seconds = Math.max(0, Math.round((finishedAt - startedAt) / 100) / 10);
  return `${seconds}s`;
};

const WorkflowProgressBar = () => (
  <div className={styles.workflowProgress}>
    <div className={styles.workflowProgressShimmer} />
  </div>
);

const formatDuration = (startedAt?: number, finishedAt?: number) => {
  if (!startedAt || !finishedAt) return undefined;
  return Math.max(0, Math.round((finishedAt - startedAt) / 100) / 10);
};

export const ReasoningBlock = ({ id, meta, text }: { id: string; meta?: RuntimeReasoningMeta; text: string }) => {
  const streaming = Boolean(meta?.streaming);
  const duration = formatDuration(meta?.startedAt, meta?.finishedAt);
  return (
    <Thinking
      content={text}
      duration={duration !== undefined ? duration * 1000 : undefined}
      encrypted={meta?.encrypted}
      key={id}
      thinking={streaming}
    />
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
  const title = (
    <Flexbox horizontal align="center" gap={6} style={{ minHeight: 24, minWidth: 0 }}>
      {streaming ? <NeuralNetworkLoading size={16} /> : null}
      <Text type="secondary">
        {streaming ? t('chat.process.streaming') : t('chat.process.done', { count: stepCount })}
      </Text>
      {durationText ? (
        <Text fontSize={12} type="secondary">
          {t('chat.process.duration', { duration: durationText })}
        </Text>
      ) : null}
    </Flexbox>
  );
  return (
    <Accordion
      expandedKeys={open ? ['process'] : []}
      variant="borderless"
      onExpandedChange={(keys) => setOpen(keys.includes('process'))}
    >
      <AccordionItem itemKey="process" paddingBlock={4} paddingInline={4} title={title}>
        <Flexbox gap={8} paddingBlock="4px 8px">
          {children}
        </Flexbox>
      </AccordionItem>
    </Accordion>
  );
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

export const ToolCallBlock = ({ call }: { call: RuntimeToolCall }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // 参数格式化：合法 JSON 缩进展示，否则原文。
  let formattedArgs = call.args;
  try {
    formattedArgs = JSON.stringify(JSON.parse(call.args), null, 2);
  } catch {
    // keep raw args
  }
  const formattedResult =
    call.result === undefined
      ? undefined
      : typeof call.result === 'string'
        ? call.result
        : JSON.stringify(call.result, null, 2);
  return (
    <Accordion
      expandedKeys={open ? ['tool'] : []}
      gap={8}
      variant="borderless"
      onExpandedChange={(keys) => setOpen(keys.includes('tool'))}
    >
      <AccordionItem
        itemKey="tool"
        paddingBlock={4}
        paddingInline={4}
        title={
          <ToolInspector
            apiName={call.apiName}
            args={call.args}
            finishedAt={call.finishedAt}
            identifier={call.name}
            result={call.result}
            resultMsgId={call.resultMsgId}
            startedAt={call.startedAt}
            status={call.status}
          />
        }
      >
        <Block gap={12} padding={12} style={{ marginBlock: 8 }} variant="outlined">
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
              <Flexbox horizontal align="center" gap={8}>
                <Text weight={500}>{t('chat.toolResult')}</Text>
                <Tag color="success" size="small">
                  {t('chat.toolStatus.completed')}
                </Tag>
              </Flexbox>
              <pre
                style={{
                  margin: 0,
                  maxHeight: 280,
                  overflow: 'auto',
                  background: cssVar.colorFillQuaternary,
                  borderRadius: 8,
                  padding: 8,
                  fontSize: 12,
                }}
              >
                {formattedResult}
              </pre>
            </Flexbox>
          )}
        </Block>
      </AccordionItem>
    </Accordion>
  );
};

// LobeHub WorkflowCollapse / ProcessingState 迁移：
// - 运行中自动展开 + 3px shimmer 进度条 + 当前耗时；
// - 完成后自动收起，头部右侧箭头随状态旋转（展开朝下 / 收起朝右）；
// - 展开列表每行：状态图标（运行=神经网络动画 / 完成=Check / 失败=X）+ 名称 + 耗时 + 状态标签；
// - 完成后页脚：分隔线 + 步数/耗时汇总。
export const WorkflowStepsBlock = ({ steps, streaming }: { steps: RuntimeStep[]; streaming?: boolean }) => {
  const { t } = useI18n();
  // 展开状态跟随 run 的流式状态（LobeHub：整个 run 期间工作流保持展开，
  // 步骤完成但正文仍在生成时也不收起；run 结束/历史渲染才收起）。
  // 未传 streaming（历史渲染）时回退为按步骤状态判断。
  const isStreaming = streaming ?? steps.some((step) => step.status === 'running');
  const completed = steps.filter((step) => step.status === 'completed').length;
  const [open, setOpen] = useState(isStreaming);
  // 运行中自动展开，完成后自动收起；用户可点击重新展开。
  useEffect(() => {
    setOpen(isStreaming);
  }, [isStreaming]);
  const startedAt = steps.reduce(
    (min, step) => (step.startedAt && (!min || step.startedAt < min) ? step.startedAt : min),
    undefined as number | undefined,
  );
  const finishedAt = steps.reduce(
    (max, step) => (step.finishedAt && (!max || step.finishedAt > max) ? step.finishedAt : max),
    undefined as number | undefined,
  );
  const durationText = formatProcessDuration(startedAt, finishedAt);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isStreaming || !startedAt) return;
    const update = () => setElapsed(Math.max(0, Date.now() - startedAt));
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [isStreaming, startedAt]);
  const title = (
    <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0 }}>
      <Block
        horizontal
        align="center"
        flex="none"
        height={24}
        justify="center"
        variant="outlined"
        width={24}
      >
        {isStreaming ? (
          <NeuralNetworkLoading size={16} />
        ) : (
          <Icon
            color={steps.some((step) => step.status === 'error') ? cssVar.colorError : cssVar.colorSuccess}
            icon={steps.some((step) => step.status === 'error') ? X : CheckCircle2}
            size={14}
          />
        )}
      </Block>
      <Text ellipsis type="secondary" style={{ minWidth: 0 }}>
        {t('chat.steps', { completed, total: steps.length })}
      </Text>
      {isStreaming ? (
        <Text fontSize={12} type="secondary">
          {formatElapsedTime(elapsed)}
        </Text>
      ) : durationText ? (
        <Text fontSize={12} type="secondary">
          {durationText}
        </Text>
      ) : null}
    </Flexbox>
  );
  return (
    <Accordion
      expandedKeys={open ? ['workflow'] : []}
      variant="borderless"
      onExpandedChange={(keys) => setOpen(keys.includes('workflow'))}
    >
      <AccordionItem itemKey="workflow" paddingBlock={4} paddingInline={4} title={title}>
        {isStreaming && <WorkflowProgressBar />}
        <Flexbox
          gap={2}
          padding="4px 8px 8px"
        >
          {steps.map((step) => {
            const running = step.status === 'running';
            const failed = step.status === 'error';
            const stepDuration = formatProcessDuration(step.startedAt, step.finishedAt);
            return (
              <Flexbox horizontal align="center" gap={8} key={step.id} paddingBlock={4}>
                {running ? (
                  <NeuralNetworkLoading size={14} />
                ) : (
                  <Icon
                    color={failed ? cssVar.colorError : cssVar.colorSuccess}
                    icon={failed ? X : Check}
                    size={14}
                  />
                )}
                <Text fontSize={12} ellipsis style={{ flex: 1 }}>
                  {step.name || step.id}
                </Text>
                {stepDuration && (
                  <Text fontSize={12} type="secondary">
                    {stepDuration}
                  </Text>
                )}
                <Tag
                  color={failed ? 'error' : running ? 'processing' : 'success'}
                  size="small"
                >
                  {running
                    ? t('chat.toolStatus.running')
                    : failed
                      ? t('chat.error.title')
                      : t('chat.toolStatus.completed')}
                </Tag>
              </Flexbox>
            );
          })}
          {!isStreaming && steps.length > 0 && (
            <Flexbox
              horizontal
              align="center"
              justify="space-between"
              paddingBlock={6}
              style={{ borderBlockStart: `1px solid ${cssVar.colorBorderSecondary}` }}
            >
              <Text fontSize={12} type="secondary">
                {t('chat.steps', { completed, total: steps.length })}
              </Text>
              {durationText && (
                <Text fontSize={12} type="secondary">
                  {t('chat.process.duration', { duration: durationText })}
                </Text>
              )}
            </Flexbox>
          )}
        </Flexbox>
      </AccordionItem>
    </Accordion>
  );
};

// 一轮 run 内的中间助手文本（最终答案之前的叙述）收进过程折叠，展开可见。
export const NarrationBlock = ({ text }: { text: string }) => (
  <Text type="secondary">
    <Markdown content={text} />
  </Text>
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
