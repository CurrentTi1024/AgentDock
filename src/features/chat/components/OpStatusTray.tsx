// Adapted from: src/features/Conversation/ChatInput/OpStatusTray (LobeHub canary)
// 输入框上方运行状态条：主色旋转 glyph + 12px 次级色文案（生成短语 4s 轮播）+ 耗时 + 步数。
import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cx, cssVar } from 'antd-style';
import { Footprints } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';

import type { RunStatus } from '@/api/runtime/types';
import { useI18n } from '@/i18n';

// Cycle the generating phrase like a carousel so a long-running task doesn't
// stare back with the same line the whole time.
const STATUS_PHRASE_ROTATION_MS = 4000;

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  container: css`
    container-type: inline-size;

    padding-block: 8px;
    padding-inline: 14px;
    border: 1px solid ${token.colorFillSecondary};
    border-block-end: none;
    border-start-start-radius: 12px;
    border-start-end-radius: 12px;

    font-size: 12px;
    color: ${token.colorTextSecondary};

    background: ${token.colorBgElevated};
  `,
  divider: css`
    width: 1px;
    height: 12px;
    background: ${token.colorBorderSecondary};
  `,
  metric: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;

    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  `,
  metricGroup: css`
    display: inline-flex;
    flex: none;
    gap: 10px;
    align-items: center;
  `,
  metricIcon: css`
    flex: none;
    color: ${token.colorTextTertiary};
  `,
  metricValue: css`
    overflow: hidden;
    max-width: 56px;
    text-overflow: ellipsis;
  `,
  statusMetric: css`
    overflow: hidden;
    flex: 1 1 auto;
    min-width: 0;
  `,
  statusText: css`
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  statusPhrase: css`
    @keyframes op-status-tray-phrase-enter {
      from {
        transform: translateY(3px);
        opacity: 0;
      }

      to {
        transform: translateY(0);
        opacity: 1;
      }
    }

    display: inline-block;
    animation: op-status-tray-phrase-enter 0.4s ease;
  `,
  timerValue: css`
    flex: none;
    color: ${token.colorTextTertiary};
  `,
  activityGlyph: css`
    overflow: visible;
    flex: none;

    width: 16px;
    height: 16px;

    color: ${token.colorPrimary};

    @keyframes op-status-tray-glyph-spin {
      to {
        transform: rotate(360deg);
      }
    }

    @keyframes op-status-tray-glyph-core {
      0%,
      100% {
        transform: scale(0.86);
        opacity: 0.9;
      }

      50% {
        transform: scale(1);
        opacity: 1;
      }
    }
  `,
  glyphCore: css`
    transform-origin: center;
    transform-box: fill-box;
    fill: ${token.colorPrimary};
    animation: op-status-tray-glyph-core 1.5s ease-in-out infinite;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  `,
  glyphOrbit: css`
    transform-origin: center;
    transform-box: fill-box;

    fill: none;
    stroke: color-mix(in srgb, ${token.colorPrimary} 76%, transparent);
    stroke-dasharray: 9 18;
    stroke-linecap: round;
    stroke-width: 1.5;

    animation: op-status-tray-glyph-spin 2s linear infinite;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
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

    animation: op-status-tray-shine 1.5s linear infinite;

    @keyframes op-status-tray-shine {
      0% {
        background-position: 100%;
      }

      100% {
        background-position: -100%;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  `,
}));

export type OpStatusActivity = 'compressing' | 'generating' | 'reasoning' | 'searching' | 'toolCalling';

const parseStatusPhrases = (raw: string | string[]): string[] => {
  if (Array.isArray(raw)) {
    return raw
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof raw !== 'string') return [];

  return raw
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
};

const hashString = (input: string): number => {
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash;
};

/**
 * Cycle through phrases over time so the status text reads like a carousel.
 * `step` advances once per rotation tick; the seed keeps the starting phrase
 * stable per operation so two concurrent operations don't sync up.
 */
const pickRotatingStatusPhrase = (
  phrases: string[],
  seed: string,
  step: number,
): string | undefined => {
  if (phrases.length === 0) return undefined;
  const start = hashString(seed) % phrases.length;
  const safeStep = Number.isFinite(step) ? Math.max(0, Math.floor(step)) : 0;
  return phrases[(start + safeStep) % phrases.length];
};

const formatElapsedClockTime = (ms: number) => {
  const normalizedMs = Math.max(0, ms);
  const totalSeconds = Math.floor(normalizedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};

const ActivityGlyph = memo(() => (
  <svg aria-hidden className={styles.activityGlyph} viewBox="0 0 16 16">
    <circle className={styles.glyphOrbit} cx="8" cy="8" r="6.1" />
    <circle className={styles.glyphCore} cx="8" cy="8" r="2.7" />
  </svg>
));

ActivityGlyph.displayName = 'ActivityGlyph';

interface OpStatusTrayProps {
  /** 当前活动：生成/思考/检索/调用工具/压缩上下文（官方 resolveOperationActivity 的等价物）。 */
  activity?: OpStatusActivity;
  runStatus?: RunStatus;
  /** 本轮 run 的开始时间（毫秒时间戳），为空或非运行态不渲染。 */
  startTime?: number;
  /** 已完成/进行中的工具步骤数；>1 才在右侧显示步数。 */
  steps?: number;
}

const OpStatusTray = memo<OpStatusTrayProps>(
  ({ activity = 'generating', runStatus, startTime, steps = 0 }) => {
    const { t } = useI18n();
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
      if (!startTime) return;
      setNow(Date.now());
      const id = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(id);
    }, [startTime]);

    const generatingPhrases = useMemo(() => parseStatusPhrases(t('chat.opStatusTray.phrases')), [t]);
    const active = runStatus === 'running' || runStatus === 'paused';
    if (!active || !startTime) return null;

    const elapsed = now - startTime;
    const rotationStep = Math.floor(elapsed / STATUS_PHRASE_ROTATION_MS);
    const randomGeneratingStatus =
      pickRotatingStatusPhrase(generatingPhrases, String(startTime), rotationStep) ??
      t('chat.opStatusTray.status.generating');
    const statusText =
      activity === 'generating'
        ? randomGeneratingStatus
        : t(`chat.opStatusTray.status.${activity}`);

    return (
      <Flexbox
        horizontal
        align="center"
        justify="space-between"
        className={styles.container}
      >
        <span className={cx(styles.metric, styles.statusMetric)}>
          <ActivityGlyph />
          <span className={styles.statusText}>
            <span className={styles.statusPhrase} key={statusText}>
              <span className={styles.shinyText}>{statusText}...</span>
            </span>
          </span>
          <span className={styles.timerValue}>{formatElapsedClockTime(elapsed)}</span>
        </span>
        {steps > 1 && (
          <Flexbox horizontal align="center" className={styles.metricGroup}>
            <span className={styles.divider} />
            <Tooltip title={`${steps} ${t('chat.opStatusTray.steps')}`}>
              <span className={styles.metric}>
                <Icon className={styles.metricIcon} icon={Footprints} size={13} />
                <span className={styles.metricValue}>{steps}</span>
              </span>
            </Tooltip>
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

OpStatusTray.displayName = 'OpStatusTray';

export default OpStatusTray;
