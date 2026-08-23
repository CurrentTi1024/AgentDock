// Adapted from: src/routes/(main)/home/_layout/Footer (LobeHub canary, slim)
import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Settings } from 'lucide-react';
import { memo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';

import NavItem from '@/components/shell/NavItem';
import { useI18n } from '@/i18n';
import { useSessionStore } from '@/stores/sessionStore';
import { useUiStore } from '@/stores/uiStore';

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  footer: css`
    flex: none;
    padding: 8px;
    border-block-start: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgLayout};
  `,
  switchRow: css`
    padding: 8px 10px;
    border-radius: ${token.borderRadius}px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const Footer = memo(() => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const [thisMonthOnly, toggleThisMonthOnly] = useUiStore(
    useShallow((s) => [s.thisMonthOnly, s.toggleThisMonthOnly]),
  );
  // 容量状态角标：warning 橙点 / critical 红点，常驻提醒（不依赖一次性 toast）。
  const storageHealth = useSessionStore((state) => state.storageUsage?.health);
  const healthColor =
    storageHealth === 'critical' ? '#ff4d4f' : storageHealth === 'warning' ? '#faad14' : undefined;

  return (
    <Flexbox className={styles.footer} gap={2}>
      <Flexbox horizontal align="center" className={styles.switchRow} justify="space-between">
        <Flexbox>
          <Text fontSize={13}>{t('monthMode')}</Text>
          <Text fontSize={11} type="secondary">
            {t('monthMode.hint')}
          </Text>
        </Flexbox>
        <Switch checked={thisMonthOnly} size="small" onChange={toggleThisMonthOnly} />
      </Flexbox>
      <NavItem
        active={isSettingsActive(location.pathname)}
        extra={
          healthColor ? (
            <span
              aria-label="storage-warning"
              style={{
                background: healthColor,
                borderRadius: '50%',
                flex: 'none',
                height: 8,
                width: 8,
              }}
            />
          ) : undefined
        }
        icon={Settings}
        title={t('nav.settings')}
        onClick={() => navigate(healthColor ? '/settings?tab=storage' : '/settings')}
      />
    </Flexbox>
  );
});

const isSettingsActive = (pathname: string) => pathname.startsWith('/settings');

Footer.displayName = 'HomeSidebarFooter';

export default Footer;
