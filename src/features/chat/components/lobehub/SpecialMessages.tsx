// Ported/adapted from LobeHub canary 9208806:
// src/features/Conversation/Messages/{Task,Tasks,GroupTasks,AgentCouncil,CompressedGroup,Tool,Verify,TaskCallback}
// and AssistantGroup. Store subscriptions are replaced with the persisted/runtime message payload.
import {
  Accordion,
  AccordionItem,
  Avatar,
  Block,
  Flexbox,
  GroupAvatar,
  Icon,
  Tag,
  Text,
} from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  Bot,
  Check,
  CircleAlert,
  CircleCheck,
  CircleSlash,
  Columns2,
  History,
  Layers,
  ListChecks,
  ListTodo,
  Footprints,
  Sparkles,
  Target,
  Wrench,
  X,
} from 'lucide-react';
import { Children, type ReactNode, memo, useState } from 'react';

import type { RuntimeMessage, RuntimeToolCall } from '@/api/runtime/types';
import type { SessionMessageRecord } from '@/api/session/sessionHistoryService';
import ChatItem from '@/features/chat/components/ChatItem';
import { Markdown } from '@/features/chat/components/Markdown';
import {
  ProcessFold,
  ReasoningBlock,
  ToolCallBlock,
} from '@/features/chat/components/lobehub/ProcessBlocks';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { useI18n } from '@/i18n';

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  callbackCard: css`
    overflow: hidden;
    padding-block: 12px;
    padding-inline: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 16px;
    background: ${token.colorBgElevated};
  `,
  compressedCard: css`
    margin-block-end: 8px;
    padding-block: 8px;
    padding-inline: 12px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 12px;
    background: ${token.colorBgContainer};
  `,
  council: css`
    overflow-x: auto;
    width: 100%;
    padding-block-end: 8px;
  `,
  councilMember: css`
    flex: 0 0 min(360px, 80vw);
    min-width: 280px;

    & + & {
      padding-inline-start: 16px;
      border-inline-start: 1px dashed ${token.colorBorderSecondary};
    }
  `,
  taskAvatar: css`
    position: relative;
    flex: none;
    width: 28px;
    height: 28px;
  `,
  taskBadge: css`
    position: absolute;
    inset-block-start: -4px;
    inset-inline-end: -4px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: 1px solid ${token.colorBorder};
    border-radius: 4px;
    background: ${token.colorBgContainer};
  `,
  verifyCard: css`
    overflow: hidden;
    padding: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 16px;
    background: ${token.colorBgElevated};
  `,
}));

type MessageLike = RuntimeMessage & Record<string, unknown>;

export interface SpecialMessageProps {
  actions?: ReactNode;
  agentAvatar?: ReactNode | string;
  agentName: string;
  children?: ReactNode;
  content?: string;
  loading?: boolean;
  record: SessionMessageRecord;
}

/** Runtime 快照中的 LobeHub 扩展消息转成与历史渲染一致的只读记录。 */
export const runtimeMessageToSessionRecord = (
  message: RuntimeMessage,
  runId: string,
  sequence: number,
  fallbackCreatedAt = Date.now(),
): SessionMessageRecord => {
  const {
    content,
    createdAt,
    eventId,
    id,
    role,
    runId: _messageRunId,
    ...payload
  } = message;
  const timestamp =
    typeof createdAt === 'number'
      ? new Date(createdAt)
      : typeof createdAt === 'string'
        ? new Date(createdAt)
        : new Date(fallbackCreatedAt);
  return {
    content,
    createdAt: Number.isFinite(timestamp.getTime())
      ? timestamp.toISOString()
      : new Date(fallbackCreatedAt).toISOString(),
    eventId,
    id,
    kind: 'text',
    payload: Object.keys(payload).length ? payload : undefined,
    role,
    runId,
    sequence,
    sessionId: '',
  };
};

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const asMessages = (value: unknown): MessageLike[] =>
  Array.isArray(value)
    ? value.filter((item): item is MessageLike => Boolean(item && typeof item === 'object'))
    : [];

const messageTitle = (message: Record<string, unknown>, fallback: string) => {
  const detail = asObject(message.taskDetail);
  const metadata = asObject(message.metadata);
  return String(detail.title || metadata.taskTitle || message.title || fallback);
};

const taskStatus = (message: Record<string, unknown>) =>
  String(asObject(message.taskDetail).status || message.status || '').toLowerCase();

const isTaskRunning = (status: string) =>
  !status || ['created', 'idle', 'initializing', 'pending', 'processing', 'running'].includes(status);

const TaskAvatar = memo<{ children: ReactNode }>(({ children }) => (
  <div className={styles.taskAvatar}>
    {children}
    <span className={styles.taskBadge}>
      <Icon color={cssVar.colorTextDescription} icon={ListTodo} size={10} />
    </span>
  </div>
));
TaskAvatar.displayName = 'TaskAvatar';

const TaskStatusIndicator = ({ status }: { status: string }) => {
  const failed = ['cancel', 'cancelled', 'error', 'failed'].includes(status);
  const completed = ['completed', 'done', 'success'].includes(status);
  return (
    <Block
      horizontal
      align="center"
      flex="none"
      height={24}
      justify="center"
      variant="outlined"
      width={24}
    >
      {failed ? (
        <Icon color={cssVar.colorError} icon={X} size={14} />
      ) : completed ? (
        <Icon color={cssVar.colorSuccess} icon={ListChecks} size={14} />
      ) : (
        <NeuralNetworkLoading size={16} />
      )}
    </Block>
  );
};

const TaskMetrics = ({ message, status }: { message: Record<string, unknown>; status: string }) => {
  const detail = asObject(message.taskDetail);
  const duration = Number(detail.duration || 0);
  const steps = Number(detail.totalSteps || 0);
  const tools = Number(detail.totalToolCalls || 0);
  if (!duration && !steps && !tools) return null;
  return (
    <Flexbox horizontal align="center" gap={8}>
      {steps > 0 ? (
        <Flexbox horizontal align="center" gap={2}>
          <Icon icon={Footprints} size={12} />
          <Text fontSize={12} type="secondary">{steps}</Text>
        </Flexbox>
      ) : null}
      {tools > 0 ? (
        <Flexbox horizontal align="center" gap={2}>
          <Icon color={cssVar.colorTextTertiary} icon={Wrench} size={12} />
          <Text fontSize={12} type="secondary">{tools}</Text>
        </Flexbox>
      ) : null}
      {duration > 0 && !isTaskRunning(status) ? (
        <Text fontSize={12} type="secondary">{(duration / 1000).toFixed(1)}s</Text>
      ) : null}
    </Flexbox>
  );
};

const TaskList = memo<{ tasks: MessageLike[] }>(({ tasks }) => {
  const [expanded, setExpanded] = useState<string[]>([]);
  const { t } = useI18n();
  return (
    <Accordion expandedKeys={expanded} gap={4} onExpandedChange={(keys) => setExpanded(keys as string[])}>
      {tasks.map((task, index) => {
        const id = String(task.id || `task-${index}`);
        const status = taskStatus(task);
        const title = messageTitle(task, t('chat.activity.task'));
        const detail = asObject(task.taskDetail);
        const instruction = String(asObject(task.metadata).instruction || '');
        return (
          <AccordionItem
            itemKey={id}
            key={id}
            paddingBlock={4}
            paddingInline={4}
            title={
              <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0 }}>
                <TaskStatusIndicator status={status} />
                <Text ellipsis fontSize={14}>{title}</Text>
                <TaskMetrics message={task} status={status} />
              </Flexbox>
            }
          >
            <Block gap={12} padding={12} style={{ marginBlock: 8 }} variant="outlined">
              {instruction ? <Text fontSize={13} type="secondary">{instruction}</Text> : null}
              {task.content ? <Markdown content={String(task.content)} /> : null}
              {isTaskRunning(status) ? (
                <Flexbox horizontal align="center" gap={8}>
                  <NeuralNetworkLoading size={14} />
                  <Text type="secondary">{t('chat.process.streaming')}</Text>
                </Flexbox>
              ) : null}
              {detail.error ? (
                <Text style={{ color: cssVar.colorError }}>{JSON.stringify(detail.error)}</Text>
              ) : null}
            </Block>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
});
TaskList.displayName = 'TaskList';

const toToolCall = (tool: Record<string, unknown>): RuntimeToolCall => {
  const result = asObject(tool.result);
  return {
    apiName: String(tool.apiName || ''),
    args: String(tool.arguments || tool.args || ''),
    finishedAt: typeof tool.finishedAt === 'number' ? tool.finishedAt : undefined,
    name: String(tool.identifier || tool.name || tool.apiName || ''),
    result: tool.result,
    resultMsgId: String(tool.result_msg_id || ''),
    startedAt: typeof tool.startedAt === 'number' ? tool.startedAt : undefined,
    status:
      tool.status === 'error' || result.error
        ? 'error'
        : tool.status === 'running'
          ? 'running'
          : 'completed',
  };
};

const PayloadBlock = ({ block }: { block: Record<string, unknown> }) => {
  const reasoning = asObject(block.reasoning);
  const tools = Array.isArray(block.tools)
    ? block.tools.filter((tool): tool is Record<string, unknown> => Boolean(tool && typeof tool === 'object'))
    : [];
  return (
    <Flexbox gap={8}>
      {reasoning.content ? (
        <ReasoningBlock
          id={String(block.id || 'reasoning')}
          meta={{
            finishedAt: typeof reasoning.finishedAt === 'number' ? reasoning.finishedAt : undefined,
            startedAt: typeof reasoning.startedAt === 'number' ? reasoning.startedAt : undefined,
            streaming: Boolean(reasoning.streaming),
          }}
          text={String(reasoning.content)}
        />
      ) : null}
      {block.content && String(block.content).trim() ? <Markdown content={String(block.content)} /> : null}
      {tools.map((tool, index) => (
        <ToolCallBlock call={toToolCall(tool)} key={String(tool.id || `tool-${index}`)} />
      ))}
    </Flexbox>
  );
};

const PayloadAssistantGroup = ({ payload }: { payload: Record<string, unknown> }) => {
  const blocks = Array.isArray(payload.children)
    ? payload.children.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    : [];
  if (!blocks.length) return null;
  const finalBlock = blocks.at(-1)!;
  const process = blocks.slice(0, -1);
  const stepCount = process.reduce(
    (count, block) => count + 1 + (Array.isArray(block.tools) ? block.tools.length : 0),
    0,
  );
  return (
    <Flexbox gap={8}>
      {process.length ? (
        <ProcessFold stepCount={Math.max(1, stepCount)} streaming={false}>
          {process.map((block, index) => (
            <PayloadBlock block={block} key={String(block.id || `block-${index}`)} />
          ))}
        </ProcessFold>
      ) : null}
      <PayloadBlock block={finalBlock} />
    </Flexbox>
  );
};

const TaskMessage = ({ props }: { props: SpecialMessageProps }) => {
  const { t } = useI18n();
  const payload = props.record.payload || {};
  const title = messageTitle(payload, props.agentName);
  const task = { ...payload, content: props.content || props.record.content, id: props.record.id } as MessageLike;
  return (
    <ChatItem
      showTitle
      actions={props.actions}
      avatar={props.agentAvatar}
      content=""
      customAvatarRender={(node) => <TaskAvatar>{node}</TaskAvatar>}
      id={props.record.id}
      name={title}
      role="assistant"
      time={new Date(props.record.createdAt).getTime()}
      titleAddon={<Tag>{t('chat.activity.task')}</Tag>}
    >
      <TaskList tasks={[task]} />
    </ChatItem>
  );
};

const TasksMessage = ({ props, group }: { group?: boolean; props: SpecialMessageProps }) => {
  const { t } = useI18n();
  const payload = props.record.payload || {};
  const tasks = asMessages(payload.tasks);
  const avatarTasks: Array<Record<string, unknown>> = tasks.length ? tasks : [{ avatar: '🤖' }];
  const avatarNode = group ? (
    <div className={styles.taskAvatar}>
      <GroupAvatar
        avatarShape="square"
        avatars={avatarTasks.slice(0, 4).map((task) => ({
          avatar: String(task.avatar || asObject(task.metadata).avatar || '🤖'),
        }))}
        cornerShape="square"
        size={28}
      />
      <span className={styles.taskBadge}>
        <Icon color={cssVar.colorTextDescription} icon={ListTodo} size={10} />
      </span>
    </div>
  ) : undefined;
  if (!tasks.length && props.record.content) {
    tasks.push({ content: props.record.content, id: props.record.id, role: 'task' });
  }
  return (
    <ChatItem
      showTitle
      actions={props.actions}
      avatar={props.agentAvatar}
      content=""
      customAvatarRender={group ? () => avatarNode : (node) => <TaskAvatar>{node}</TaskAvatar>}
      id={props.record.id}
      name={props.agentName}
      role="assistant"
      time={new Date(props.record.createdAt).getTime()}
      titleAddon={<Tag>{t(group ? 'chat.activity.groupTasks' : 'chat.activity.tasks')}</Tag>}
    >
      <TaskList tasks={tasks} />
    </ChatItem>
  );
};

const AgentCouncilMessage = ({ props }: { props: SpecialMessageProps }) => {
  const payload = props.record.payload || {};
  const members = asMessages(payload.members);
  const [mode, setMode] = useState<'horizontal' | 'tab'>('horizontal');
  const [active, setActive] = useState('0');
  if (!members.length) return null;
  const visible = mode === 'tab' ? members.slice(Number(active), Number(active) + 1) : members;
  return (
    <Flexbox gap={8} paddingBlock={8}>
      <Flexbox horizontal align="center" justify="space-between" height={40}>
        {mode === 'tab' ? (
          <Tabs
            activeKey={active}
            items={members.map((_, index) => ({ icon: <Icon icon={Bot} size={14} />, key: String(index), label: null }))}
            size="small"
            onChange={setActive}
          />
        ) : <span />}
        <Tabs
          activeKey={mode}
          items={[
            { icon: <Icon icon={Columns2} />, key: 'horizontal', label: null },
            { icon: <Icon icon={Layers} />, key: 'tab', label: null },
          ]}
          size="small"
          onChange={(key) => setMode(key as 'horizontal' | 'tab')}
        />
      </Flexbox>
      <Flexbox horizontal className={styles.council} gap={16}>
        {visible.map((member, index) => (
          <div className={styles.councilMember} key={String(member.id || index)}>
            <ChatItem
              showTitle
              avatar={String(member.avatar || asObject(member.metadata).avatar || props.agentAvatar || '🤖')}
              content={String(member.content || '')}
              id={String(member.id || index)}
              name={String(member.name || member.title || member.agentId || props.agentName)}
              role="assistant"
              time={typeof member.createdAt === 'number' ? member.createdAt : undefined}
            />
          </div>
        ))}
      </Flexbox>
    </Flexbox>
  );
};

const CompressedGroupMessage = ({ props }: { props: SpecialMessageProps }) => {
  const { t } = useI18n();
  const [tab, setTab] = useState('summary');
  const payload = props.record.payload || {};
  const messages = asMessages(payload.compressedMessages);
  return (
    <Flexbox className={styles.compressedCard} gap={8}>
      <Tabs
        activeKey={tab}
        items={[
          { icon: <Icon icon={Sparkles} size={14} />, key: 'summary', label: t('chat.activity.assistantGroup') },
          { icon: <Icon icon={History} size={14} />, key: 'history', label: t('chat.history') },
        ]}
        size="small"
        variant="rounded"
        onChange={setTab}
      />
      {tab === 'summary' ? (
        <Markdown content={props.content || props.record.content || ''} />
      ) : (
        <Flexbox gap={8} style={{ maxHeight: 400, overflow: 'auto' }}>
          {messages.map((message, index) => (
            <Flexbox horizontal gap={8} key={String(message.id || index)} paddingBlock={4}>
              <Avatar avatar={message.role === 'user' ? 'LC' : props.agentAvatar || '🤖'} size={28} />
              <Markdown content={String(message.content || '')} />
            </Flexbox>
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
};

const VerifyMessage = ({ props }: { props: SpecialMessageProps }) => {
  const { t } = useI18n();
  const payload = props.record.payload || {};
  const failed = String(payload.status || '').toLowerCase() === 'failed';
  return (
    <Flexbox paddingBlock={8}>
      <Flexbox className={styles.verifyCard} gap={10}>
        <Flexbox horizontal align="center" gap={8}>
          <Icon color={failed ? cssVar.colorError : cssVar.colorSuccess} icon={failed ? CircleAlert : CircleCheck} />
          <Text weight={500}>{String(payload.title || t('chat.toolStatus.completed'))}</Text>
        </Flexbox>
        {props.record.content ? <Markdown content={props.record.content} /> : null}
      </Flexbox>
    </Flexbox>
  );
};

const TaskCallbackMessage = ({ props }: { props: SpecialMessageProps }) => {
  const { t } = useI18n();
  const callback = asObject((props.record.payload || {}).taskCallback || asObject(props.record.payload).metadata);
  const reason = String(callback.reason || 'done');
  const meta = reason === 'error'
    ? { color: cssVar.colorError, icon: CircleAlert }
    : reason === 'interrupted'
      ? { color: cssVar.colorWarning, icon: CircleSlash }
      : { color: cssVar.colorSuccess, icon: CircleCheck };
  return (
    <Flexbox paddingBlock={8}>
      <Flexbox className={styles.callbackCard} gap={8}>
        <Flexbox horizontal align="center" gap={8}>
          <Icon color={meta.color} icon={meta.icon} />
          <Text weight={500}>{String(callback.title || t('chat.activity.task'))}</Text>
          {callback.identifier ? <Tag icon={<Icon icon={Target} size={12} />}>{String(callback.identifier)}</Tag> : null}
        </Flexbox>
        {props.record.content ? <Markdown content={props.record.content} /> : null}
      </Flexbox>
    </Flexbox>
  );
};

/** LobeHub Messages/index.tsx 的 props-first 等价分发器。 */
export const SpecialMessage = memo<SpecialMessageProps>((props) => {
  const { t } = useI18n();
  const role = props.record.role || 'assistant';
  const payload = props.record.payload || {};
  switch (role) {
    case 'assistantGroup':
    case 'supervisor': {
      const hasPayloadBlocks = Array.isArray(payload.children) && payload.children.length > 0;
      const hasExternalBlocks = Children.count(props.children) > 0;
      return (
        <ChatItem
          showTitle
          actions={props.actions}
          avatar={props.agentAvatar}
          content={hasExternalBlocks || hasPayloadBlocks ? '' : (props.content ?? props.record.content)}
          id={props.record.id}
          loading={props.loading}
          name={props.agentName}
          role="assistant"
          time={new Date(props.record.createdAt).getTime()}
          titleAddon={role === 'supervisor' ? <Tag>{t('chat.activity.supervisor')}</Tag> : undefined}
        >
          {hasPayloadBlocks ? <PayloadAssistantGroup payload={payload} /> : props.children}
        </ChatItem>
      );
    }
    case 'task':
      return <TaskMessage props={props} />;
    case 'tasks':
      return <TasksMessage props={props} />;
    case 'groupTasks':
      return <TasksMessage group props={props} />;
    case 'agentCouncil':
      return <AgentCouncilMessage props={props} />;
    case 'compressedGroup':
      return <CompressedGroupMessage props={props} />;
    case 'tool': {
      const call = toToolCall({ ...payload, result: props.record.content || payload.result });
      return <Flexbox paddingBlock={8}><ToolCallBlock call={call} /></Flexbox>;
    }
    case 'verify':
      return <VerifyMessage props={props} />;
    case 'taskCallback':
      return <TaskCallbackMessage props={props} />;
    default:
      return null;
  }
});

SpecialMessage.displayName = 'SpecialMessage';
