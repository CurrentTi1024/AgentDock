export type ArtifactType = 'report' | 'document' | 'code' | 'data' | 'diagram' | 'image';

export interface ArtifactItem {
  id: string;
  sessionId: string;
  sessionTitle: string;
  title: string;
  type: ArtifactType;
  content: string;
  language?: string;
  createdAt: string;
  updatedAt: string;
  size?: number;
  sourceMessageId?: string;
}

export const artifactMockData: ArtifactItem[] = [
  {
    id: 'artifact-report',
    sessionId: 'session-inbox',
    sessionTitle: '飞行测试分析',
    title: '飞行测试分析报告',
    type: 'report',
    createdAt: '2026-08-19T16:00:00+08:00',
    updatedAt: '2026-08-19T16:00:00+08:00',
    sourceMessageId: 'text:msg-0819-01',
    content: `# 飞行测试分析报告

## 总体状态：稳定

本日共 **12 架次**，1 架次触发复核。

| 架次 | 结果 | 备注 |
| --- | --- | --- |
| FT-0819-01 | 通过 | 平稳 |
| FT-0819-07 | 复核 | 振动峰值 +18% |

## 待复核异常

- 09:42 · Vibration peak +18%
- 10:17 · Temperature spike +6.2°C
`,
  },
  {
    id: 'artifact-code-snippet',
    sessionId: 'session-inbox',
    sessionTitle: '飞行测试分析',
    title: '数据清洗脚本',
    type: 'code',
    language: 'python',
    createdAt: '2026-08-19T15:40:00+08:00',
    updatedAt: '2026-08-19T15:40:00+08:00',
    sourceMessageId: 'text:msg-0819-02',
    content: `import pandas as pd

def clean_flight_data(df: pd.DataFrame) -> pd.DataFrame:
    df = df.dropna(subset=['timestamp', 'altitude'])
    df['vibration_peak'] = df[['vx', 'vy', 'vz']].max(axis=1)
    return df[df['vibration_peak'] < 0.8]
`,
  },
  {
    id: 'artifact-diagram',
    sessionId: 'session-inbox',
    sessionTitle: '飞行测试分析',
    title: '异常检测流程',
    type: 'diagram',
    createdAt: '2026-08-19T15:35:00+08:00',
    updatedAt: '2026-08-19T15:35:00+08:00',
    sourceMessageId: 'text:msg-0819-03',
    content: `flowchart LR
  A[采集数据] --> B[清洗]
  B --> C{峰值检查}
  C -->|超阈值| D[标记复核]
  C -->|正常| E[入库]
`,
  },
  {
    id: 'artifact-review-md',
    sessionId: 'session-review',
    sessionTitle: '代码评审',
    title: '评审意见汇总',
    type: 'document',
    createdAt: '2026-08-18T11:00:00+08:00',
    updatedAt: '2026-08-18T11:00:00+08:00',
    sourceMessageId: 'text:msg-0818-01',
    content: `# 评审意见汇总

1. runReducer 事件顺序渲染已修复，新增 orderedBlocks。
2. 服务端静态目录穿越边界已修复。
3. 构建体积仍偏大，建议拆包。`,
  },
];
