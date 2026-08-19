import { ThemeProvider } from '@lobehub/ui';
import type { PrimaryColors } from '@lobehub/ui';
import { CopilotKit } from '@copilotkit/react-core/v2';
import { createStaticStyles } from 'antd-style';
import { type ReactNode, useEffect, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';

import { getChatServiceMode } from '@/api/core/serviceMode';
import { runtimeConfig } from '@/api/runtimeConfig';
import { agentDockCatalog } from '@/features/chat/a2ui/catalog';
import { I18nProvider } from '@/i18n';
import { useUiStore } from '@/stores/uiStore';

const styles = createStaticStyles(({ css }) => ({
  app: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
    min-height: 100dvh;
    max-height: 100dvh;
    overflow: hidden;
  `,
}));

// @lobehub/ui 运行时支持 'primary'（neutral 主色），但其类型定义遗漏了该项。
const LOBE_NEUTRAL_PRIMARY = 'primary' as unknown as PrimaryColors;

const getSystemDark = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

const useResolvedAppearance = (): 'light' | 'dark' => {
  const themeMode = useUiStore((s) => s.themeMode);
  const [systemDark, setSystemDark] = useState(getSystemDark);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  if (themeMode === 'system') return systemDark ? 'dark' : 'light';
  return themeMode;
};

export default function Providers({ children }: { children: ReactNode }) {
  const appearance = useResolvedAppearance();
  const chatMode = getChatServiceMode();
  const copilotEnabled = chatMode === 'http';

  const app = (
    <ThemeProvider
      className={styles.app}
      appearance={appearance}
      // LobeHub 的默认主色是 neutral 'primary'（暗色 #eeeeee / 亮色 #222222），
      // 与官方市场页一致；FAB 选择器等 UI/UX 不受影响。
      customTheme={{ neutralColor: 'slate', primaryColor: LOBE_NEUTRAL_PRIMARY }}
      theme={{ cssVar: { key: 'agentdock-vars' } }}
    >
      <BrowserRouter>{children}</BrowserRouter>
    </ThemeProvider>
  );

  return (
    <I18nProvider>
      {copilotEnabled ? (
        <CopilotKit
          a2ui={{ catalog: agentDockCatalog }}
          credentials="include"
          onError={(event) => {
            console.error('[CopilotKit]', event.error);
          }}
          runtimeUrl={runtimeConfig.copilotRuntimeUrl}
          useSingleEndpoint
        >
          {app}
        </CopilotKit>
      ) : (
        app
      )}
    </I18nProvider>
  );
}
