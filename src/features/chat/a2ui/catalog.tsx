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
  },
  { catalogId: 'agentdock://catalog', includeBasicCatalog: true },
);
