// Adapted from: src/routes/(main)/memory/_layout + Sidebar/Header/Nav (LobeHub canary)
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import {
  BrainCircuit,
  Bubbles,
  CalendarClock,
  HeartPulse,
  Lightbulb,
  Signature,
} from 'lucide-react';
import { memo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import NavItem from '@/components/shell/NavItem';
import { useI18n } from '@/i18n';

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  container: css`
    display: flex;
    height: 100%;
    overflow: hidden;
  `,
  sidebar: css`
    width: 224px;
    flex: none;
    border-inline-end: 1px solid ${token.colorBorderSecondary};
    padding: 12px 8px;
    overflow-y: auto;
  `,
  main: css`
    flex: 1;
    min-width: 0;
  `,
}));

export type MemoryTabKey = 'activities' | 'contexts' | 'experiences' | 'home' | 'identities' | 'preferences';

const ITEMS: Array<{ icon: typeof BrainCircuit; key: MemoryTabKey; labelKey: string; path: string }> = [
  { icon: BrainCircuit, key: 'home', labelKey: 'memory.tab.home', path: '/memory' },
  { icon: Signature, key: 'identities', labelKey: 'memory.tab.identities', path: '/memory/identities' },
  { icon: Bubbles, key: 'contexts', labelKey: 'memory.tab.contexts', path: '/memory/contexts' },
  { icon: HeartPulse, key: 'preferences', labelKey: 'memory.tab.preferences', path: '/memory/preferences' },
  { icon: Lightbulb, key: 'experiences', labelKey: 'memory.tab.experiences', path: '/memory/experiences' },
  { icon: CalendarClock, key: 'activities', labelKey: 'memory.tab.activities', path: '/memory/activities' },
];

const MemoryLayout = memo(() => {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const tab: MemoryTabKey =
    (location.pathname.split('/memory/')[1] as MemoryTabKey | undefined) ?? 'home';

  return (
    <Flexbox className={styles.container}>
      <Flexbox className={styles.sidebar} gap={2}>
        {ITEMS.map((item) => (
          <NavItem
            active={tab === item.key}
            icon={item.icon}
            key={item.key}
            onClick={() => navigate(item.path)}
            title={t(item.labelKey)}
          />
        ))}
      </Flexbox>
      <Flexbox className={styles.main}>
        <Outlet />
      </Flexbox>
    </Flexbox>
  );
});

MemoryLayout.displayName = 'MemoryLayout';

export default MemoryLayout;
