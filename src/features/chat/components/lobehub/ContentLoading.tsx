// Ported from: src/features/Conversation/Messages/components/ContentLoading (LobeHub canary)
// 正文加载占位：三点气泡动画 + 超过 2.1s 后显示耗时。数据由 props 注入。
import { Flexbox } from '@lobehub/ui';
import { memo, useEffect, useState } from 'react';

const ELAPSED_TIME_THRESHOLD = 2100;

const BubblesLoading = memo(() => (
  <Flexbox gap={3} horizontal>
    {[0, 1, 2].map((i) => (
      <span
        key={i}
        style={{
          animation: 'lobehub-bubbles 1.2s ease-in-out infinite',
          animationDelay: `${i * 0.2}s`,
          background: 'currentColor',
          borderRadius: '50%',
          height: 6,
          opacity: 0.4,
          width: 6,
        }}
      />
    ))}
    <style>{`@keyframes lobehub-bubbles { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-4px); opacity: 0.9; } }`}</style>
  </Flexbox>
));

BubblesLoading.displayName = 'BubblesLoading';

export interface ContentLoadingProps {
  /** 锚定耗时起点：从该时间戳开始累计（默认当前时间）。 */
  startTime?: number;
}

const ContentLoading = memo<ContentLoadingProps>(({ startTime }) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(() =>
    startTime ? Math.max(0, Math.floor((Date.now() - startTime) / 1000)) : 0,
  );
  useEffect(() => {
    if (!startTime) {
      setElapsedSeconds(0);
      return;
    }
    const id = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - (startTime ?? 0)) / 1000)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [startTime]);
  return (
    <Flexbox horizontal align="center" gap={8} style={{ color: 'inherit' }}>
      <BubblesLoading />
      {elapsedSeconds > 0 && elapsedSeconds * 1000 >= ELAPSED_TIME_THRESHOLD && (
        <span style={{ fontSize: 12, opacity: 0.6 }}>{elapsedSeconds}s</span>
      )}
    </Flexbox>
  );
});

ContentLoading.displayName = 'ContentLoading';

export default ContentLoading;
