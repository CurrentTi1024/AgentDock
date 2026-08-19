// AgentDock A2UI Catalog：定义后端可生成的组件 + 前端渲染器（BYOC）
import { createCatalog } from '@copilotkit/a2ui-renderer';
import { Flexbox, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { z } from 'zod';

const styles = createStaticStyles(({ css, cssVar }) => ({
  metricCard: css`
    min-width: 160px;
    padding: 12px 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG}px;
    background: ${cssVar.colorFillQuaternary};
  `,
  actionButton: css`
    padding: 6px 12px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusSM}px;
    background: ${cssVar.colorPrimaryBg};
    color: ${cssVar.colorPrimary};
    cursor: pointer;
    &:hover {
      background: ${cssVar.colorPrimaryBgHover};
    }
  `,
}));

export const agentDockCatalogDefinitions = {
  actionButton: {
    description: '可点击按钮，点击后向 Agent 发送 A2UI action。',
    props: z.object({ actionName: z.string(), label: z.string() }),
  },
  metricCard: {
    description: '展示一个关键指标（标签 + 数值）。',
    props: z.object({ label: z.string(), value: z.number() }),
  },
  // 后端 A2UI 生成器按 a2ui.org v0.9 basic catalog 输出这些组件名；
  // 前端 @copilotkit/a2ui-renderer 的 web_core basic catalog 不含 Metric/Title，
  // 必须在前端 catalog 补齐同名定义，否则渲染为 “Unknown component”。
  Column: {
    description: '垂直排列的容器。',
    props: z.object({ gap: z.number().optional(), children: z.any().optional() }),
  },
  Row: {
    description: '水平排列的容器。',
    props: z.object({ gap: z.number().optional(), children: z.any().optional() }),
  },
  Card: {
    description: '带标题的卡片容器。',
    props: z.object({ title: z.string().optional(), child: z.string().optional() }),
  },
  Title: {
    description: '标题文本。',
    props: z.object({ text: z.string().optional() }),
  },
  Metric: {
    description: '指标数值（标签 + 值）。',
    props: z.object({ label: z.string().optional(), value: z.union([z.string(), z.number()]).optional() }),
  },
};

export const agentDockCatalog = createCatalog(
  agentDockCatalogDefinitions,
  {
    actionButton: ({ dispatch, props }) => (
      <button
        className={styles.actionButton}
        onClick={() => dispatch?.({ name: props.actionName, sourceComponentId: 'action-button' })}
        type="button"
      >
        {props.label}
      </button>
    ),
    metricCard: ({ props }) => (
      <Flexbox className={styles.metricCard} gap={2}>
        <Text fontSize={12} type="secondary">
          {props.label}
        </Text>
        <Flexbox horizontal align="center" gap={8}>
          <Text fontSize={24} weight={600}>
            {props.value}
          </Text>
          <Tag color="info" size="small">
            metric
          </Tag>
        </Flexbox>
      </Flexbox>
    ),
    Column: ({ children, props }) => (
      <Flexbox gap={props.gap ?? 8} style={{ flexDirection: 'column' }}>
        {(props.children ?? []).map((child: unknown) => children(String(child)))}
      </Flexbox>
    ),
    Row: ({ children, props }) => (
      <Flexbox gap={props.gap ?? 8} horizontal wrap="wrap">
        {(props.children ?? []).map((child: unknown) => children(String(child)))}
      </Flexbox>
    ),
    Card: ({ children, props }) => (
      <Flexbox className={styles.metricCard} gap={6} style={{ flexDirection: 'column' }}>
        {props.title && (
          <Text fontSize={13} weight={600}>
            {props.title}
          </Text>
        )}
        {props.child ? children(props.child) : null}
      </Flexbox>
    ),
    Title: ({ props }) => (
      <Text as="h3" fontSize={18} weight={600}>
        {props.text}
      </Text>
    ),
    Metric: ({ props }) => (
      <Flexbox gap={2} horizontal align="baseline">
        <Text fontSize={14} weight={500}>
          {props.label}
        </Text>
        <Text fontSize={22} weight={600}>
          {String(props.value ?? '')}
        </Text>
      </Flexbox>
    ),
  },
  { catalogId: 'agentdock://catalog', includeBasicCatalog: true },
);
