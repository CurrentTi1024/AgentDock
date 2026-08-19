// Adapted from: src/features/Settings/Layout (LobeHub canary)
import { Block, Flexbox, Icon, Select, Text } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Bell, Clock3, Info, Monitor, Palette } from 'lucide-react';
import { memo, useState } from 'react';

import NavHeader from '@/components/shell/NavHeader';
import {
  getChatServiceMode,
  getServiceMode,
  setChatServiceMode,
  setServiceMode,
} from '@/api/core/serviceMode';
import { memoryService } from '@/api/memory/memoryService';
import { useI18n } from '@/i18n';
import { LOCALE_NAMES, SUPPORTED_LOCALES } from '@/i18n/locales';
import { useUiStore, type ThemeMode } from '@/stores/uiStore';
import NavItem from '@/components/shell/NavItem';

type SettingsTabKey = 'general' | 'appearance' | 'memory' | 'about';

const TABS: Array<{ icon: typeof Bell; key: SettingsTabKey; labelKey: string }> = [
  { icon: Bell, key: 'general', labelKey: 'settings.tab.general' },
  { icon: Palette, key: 'appearance', labelKey: 'settings.tab.appearance' },
  { icon: Monitor, key: 'memory', labelKey: 'settings.tab.memory' },
  { icon: Info, key: 'about', labelKey: 'settings.tab.about' },
];

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  container: css`
    display: flex;
    height: 100%;
    overflow: hidden;
  `,
  sidebar: css`
    width: 200px;
    flex: none;
    border-inline-end: 1px solid ${token.colorBorderSecondary};
    padding: 12px 8px;
    overflow-y: auto;
  `,
  main: css`
    flex: 1;
    min-width: 0;
    overflow-y: auto;
  `,
}));

const SettingsPage = memo(() => {
  const { t } = useI18n();
  const [tab, setTab] = useState<SettingsTabKey>('general');

  return (
    <Flexbox className={styles.container}>
      <Flexbox className={styles.sidebar} gap={2}>
        {TABS.map((item) => (
          <NavItem
            active={tab === item.key}
            icon={item.icon}
            key={item.key}
            onClick={() => setTab(item.key)}
            title={t(item.labelKey)}
          />
        ))}
      </Flexbox>
      <Flexbox className={styles.main}>
        {tab === 'general' && <GeneralSettings />}
        {tab === 'appearance' && <AppearanceSettings />}
        {tab === 'memory' && <MemorySettings />}
        {tab === 'about' && <AboutSettings />}
      </Flexbox>
    </Flexbox>
  );
});

SettingsPage.displayName = 'SettingsPage';

function SettingRow({ children, description, label }: { children: React.ReactNode; description: string; label: string }) {
  return (
    <Flexbox
      horizontal
      align="center"
      gap={16}
      padding={17}
      style={{ borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}` }}
    >
      <Flexbox flex={1}>
        <Text weight={500}>{label}</Text>
        <Text type="secondary">{description}</Text>
      </Flexbox>
      {children}
    </Flexbox>
  );
}

const GeneralSettings = memo(() => {
  const { locale, setLocale, t } = useI18n();
  const [devPreview, setDevPreview] = useState(getServiceMode() === 'mock');
  const [chatDevPreview, setChatDevPreview] = useState(getChatServiceMode() === 'mock');

  return (
    <Flexbox gap={24} padding={32} style={{ maxWidth: 720 }}>
      <Flexbox gap={5}>
        <Text as="h1" fontSize={24} weight={600}>
          {t('settings.tab.general')}
        </Text>
        <Text type="secondary">{t('workspace.settings.desc')}</Text>
      </Flexbox>
      <Block gap={0} variant="outlined">
        <SettingRow description={LOCALE_NAMES[locale]} label={t('workspace.settings.language')}>
          <Select
            onChange={(value) => setLocale(value as (typeof SUPPORTED_LOCALES)[number])}
            options={SUPPORTED_LOCALES.map((code) => ({ label: LOCALE_NAMES[code], value: code }))}
            value={locale}
          />
        </SettingRow>
        <SettingRow description={t('workspace.settings.mockDesc')} label={t('workspace.settings.mock')}>
          <Switch
            checked={devPreview}
            onChange={(checked) => {
              setDevPreview(checked);
              setServiceMode(checked ? 'mock' : 'http');
            }}
          />
        </SettingRow>
        <SettingRow description={t('workspace.settings.chatMockDesc')} label={t('workspace.settings.chatMock')}>
          <Switch
            checked={chatDevPreview}
            onChange={(checked) => {
              setChatDevPreview(checked);
              setChatServiceMode(checked ? 'mock' : 'http');
            }}
          />
        </SettingRow>
      </Block>
    </Flexbox>
  );
});

const THEME_MODE_OPTIONS: ThemeMode[] = ['system', 'light', 'dark'];

const AppearanceSettings = memo(() => {
  const { t } = useI18n();
  const { showReasoning, themeMode, setThemeMode, toggleShowReasoning } = useUiStore();
  return (
    <Flexbox gap={24} padding={32} style={{ maxWidth: 720 }}>
      <Flexbox gap={5}>
        <Text as="h1" fontSize={24} weight={600}>
          {t('settings.tab.appearance')}
        </Text>
        <Text type="secondary">{t('workspace.settings.themeModeDesc')}</Text>
      </Flexbox>
      <Block gap={0} variant="outlined">
        <SettingRow description={t('workspace.settings.themeModeDesc')} label={t('workspace.settings.themeMode')}>
          <Select
            onChange={(value) => setThemeMode(value as ThemeMode)}
            options={THEME_MODE_OPTIONS.map((mode) => ({
              label: t(`workspace.settings.themeMode.${mode}`),
              value: mode,
            }))}
            value={themeMode}
          />
        </SettingRow>
        <SettingRow description={t('workspace.settings.reasoningDesc')} label={t('workspace.settings.reasoning')}>
          <Switch checked={showReasoning} onChange={toggleShowReasoning} />
        </SettingRow>
      </Block>
    </Flexbox>
  );
});

const MemorySettings = memo(() => {
  const { t } = useI18n();
  const [autoInject, setAutoInject] = useState(true);
  useState(() => {
    void memoryService.getMemorySettings().then((settings) => setAutoInject(settings.autoInject));
  });
  return (
    <Flexbox gap={24} padding={32} style={{ maxWidth: 720 }}>
      <Flexbox gap={5}>
        <Text as="h1" fontSize={24} weight={600}>
          {t('settings.tab.memory')}
        </Text>
        <Text type="secondary">{t('workspace.memory.autoInjectDesc')}</Text>
      </Flexbox>
      <Block gap={0} variant="outlined">
        <SettingRow description={t('workspace.memory.autoInjectDesc')} label={t('workspace.memory.autoInject')}>
          <Switch
            checked={autoInject}
            onChange={(checked) => {
              setAutoInject(checked);
              void memoryService.updateMemorySettings({ autoInject: checked });
            }}
          />
        </SettingRow>
      </Block>
    </Flexbox>
  );
});

const AboutSettings = memo(() => {
  const { t } = useI18n();
  return (
    <Flexbox gap={24} padding={32} style={{ maxWidth: 720 }}>
      <Flexbox gap={5}>
        <Text as="h1" fontSize={24} weight={600}>
          {t('settings.tab.about')}
        </Text>
        <Text type="secondary">{t('settings.about.desc')}</Text>
      </Flexbox>
      <Block gap={0} variant="outlined">
        <SettingRow description="agentdock-web 0.1.0" label="AgentDock">
          <Icon icon={Info} />
        </SettingRow>
        <SettingRow description={t('workspace.settings.sessionHistoryDesc')} label={t('workspace.settings.sessionHistory')}>
          <Icon icon={Clock3} />
        </SettingRow>
      </Block>
    </Flexbox>
  );
});

export default SettingsPage;
