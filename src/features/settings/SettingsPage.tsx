// Adapted from: src/features/Settings/Layout (LobeHub canary)
import { Block, Button, Flexbox, Icon, Segmented, Select, Text } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { InputNumber, Modal, Progress } from 'antd';
import { message } from 'antd';
import { Bell, Clock3, HardDrive, Info, Monitor, Palette } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import NavHeader from '@/components/shell/NavHeader';
import {
  getChatServiceMode,
  getServiceMode,
  setChatServiceMode,
  setServiceMode,
} from '@/api/core/serviceMode';
import { memoryService } from '@/api/memory/memoryService';
import { formatBytes, type CleanupCriteria, type StorageUsage } from '@/api/session/sessionStorageService';
import { useI18n } from '@/i18n';
import { LOCALE_NAMES, SUPPORTED_LOCALES } from '@/i18n/locales';
import { formatRelativeTime } from '@/lib/relativeTime';
import { useSessionStore } from '@/stores/sessionStore';
import { useUiStore, type ThemeMode } from '@/stores/uiStore';
import NavItem from '@/components/shell/NavItem';

type SettingsTabKey = 'general' | 'appearance' | 'memory' | 'storage' | 'about';

const TABS: Array<{ icon: typeof Bell; key: SettingsTabKey; labelKey: string }> = [
  { icon: Bell, key: 'general', labelKey: 'settings.tab.general' },
  { icon: Palette, key: 'appearance', labelKey: 'settings.tab.appearance' },
  { icon: Monitor, key: 'memory', labelKey: 'settings.tab.memory' },
  { icon: HardDrive, key: 'storage', labelKey: 'settings.tab.storage' },
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<SettingsTabKey>(() =>
    searchParams.get('tab') === 'storage' ? 'storage' : 'general',
  );
  const switchTab = (next: SettingsTabKey) => {
    setTab(next);
    // 支持 ?tab=storage 深链（容量提醒可直达清理页）。
    setSearchParams(next === 'general' ? {} : { tab: next }, { replace: true });
  };

  return (
    <Flexbox horizontal className={styles.container}>
      <Flexbox className={styles.sidebar} gap={2}>
        {TABS.map((item) => (
          <NavItem
            active={tab === item.key}
            icon={item.icon}
            key={item.key}
            onClick={() => switchTab(item.key)}
            title={t(item.labelKey)}
          />
        ))}
      </Flexbox>
      <Flexbox className={styles.main}>
        {tab === 'general' && <GeneralSettings />}
        {tab === 'appearance' && <AppearanceSettings />}
        {tab === 'memory' && <MemorySettings />}
        {tab === 'storage' && <StorageSettings />}
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

const HEALTH_LABEL_KEY: Record<StorageUsage['health'], string> = {
  ok: 'settings.storage.health.ok',
  warning: 'settings.storage.health.warning',
  critical: 'settings.storage.health.critical',
};
const HEALTH_COLOR: Record<StorageUsage['health'], string> = {
  ok: '#52c41a',
  warning: '#faad14',
  critical: '#ff4d4f',
};

const StorageSettings = memo(() => {
  const { locale, t } = useI18n();
  const {
    busy,
    cleanupSelection,
    exportAndDeleteCleanup,
    exportCleanup,
    previewCleanup,
    refreshStorageUsage,
    storageUsage: usage,
  } = useSessionStore();
  const [mode, setMode] = useState<'daysAgo' | 'oldestCount'>('daysAgo');
  // 允许清空后自由输入（含 0）；undefined 表示未填写，操作按钮禁用。
  const [daysAgo, setDaysAgo] = useState<number | undefined>(30);
  const [oldestCount, setOldestCount] = useState<number | undefined>(50);

  useEffect(() => {
    void refreshStorageUsage({ force: true });
  }, [refreshStorageUsage]);

  const criteria = (): CleanupCriteria | undefined => {
    if (mode === 'daysAgo') return daysAgo !== undefined && daysAgo >= 0 ? { daysAgo } : undefined;
    return oldestCount !== undefined && oldestCount >= 0 ? { oldestCount } : undefined;
  };

  const handleExportOnly = async () => {
    const active = criteria();
    if (!active) return;
    try {
      const total = await exportCleanup(active);
      if (total === 0) {
        message.info(t('settings.storage.cleanup.noSessions'));
        return;
      }
      message.success(t('settings.storage.cleanup.exported', { count: total }));
    } catch {
      message.error(t('settings.storage.error'));
    }
  };

  const handleExportAndDelete = async () => {
    const active = criteria();
    if (!active || busy) return;
    // 用当前条件刷新预览，保证确认框数量与实际删除一致（避免改数字后仍显示旧预览数）。
    await previewCleanup(active);
    const total = useSessionStore.getState().cleanupSelection?.total ?? 0;
    if (total === 0) {
      message.info(t('settings.storage.cleanup.noSessions'));
      return;
    }
    Modal.confirm({
      title: t('settings.storage.cleanup.confirmTitle', { count: total }),
      content: t('settings.storage.cleanup.confirmContent'),
      okText: t('settings.storage.cleanup.exportAndDelete'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          const result = await exportAndDeleteCleanup(active);
          message.success(
            t('settings.storage.cleanup.combined', { deleted: result.deleted, exported: result.exported }),
          );
        } catch {
          message.error(t('settings.storage.error'));
        }
      },
    });
  };

  const percent = usage ? Math.round(usage.percent * 100) : 0;
  const previewCandidates = cleanupSelection?.candidates ?? [];
  const activeCriteria = criteria();
  const cleanupSectionRef = useRef<HTMLDivElement>(null);
  return (
    <Flexbox gap={24} padding={32} style={{ maxWidth: 720 }}>
      <Flexbox gap={5}>
        <Text as="h1" fontSize={24} weight={600}>
          {t('settings.tab.storage')}
        </Text>
        <Text type="secondary">{t('settings.storage.desc')}</Text>
      </Flexbox>
      <Block gap={0} variant="outlined">
        <Flexbox gap={16} padding={20}>
          <Flexbox horizontal align="center" justify="space-between">
            <Text weight={500}>{t('settings.storage.title')}</Text>
            <Text style={{ color: usage ? HEALTH_COLOR[usage.health] : undefined }}>
              {usage
                ? `${t(HEALTH_LABEL_KEY[usage.health])} · ${formatBytes(usage.usage)} / ${formatBytes(usage.quota)}`
                : '…'}
            </Text>
          </Flexbox>
          <Progress
            percent={percent}
            strokeColor={usage ? HEALTH_COLOR[usage.health] : undefined}
          />
          {usage && (
            <Text fontSize={12} type="secondary">
              {t('settings.storage.tables', {
                checkpoints: usage.tables.checkpoints,
                messages: usage.tables.messages,
                sessions: usage.tables.sessions,
              })}
            </Text>
          )}
          {usage && usage.health !== 'ok' && (
            <Flexbox horizontal align="center" gap={8}>
              <Text style={{ color: HEALTH_COLOR[usage.health] }}>
                {t('settings.storage.warningBanner', { percent })}
              </Text>
              <Button
                size="small"
                onClick={() =>
                  cleanupSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              >
                {t('settings.storage.cleanup.title')}
              </Button>
            </Flexbox>
          )}
        </Flexbox>
      </Block>

      <div ref={cleanupSectionRef}>
        <Block gap={0} variant="outlined">
          <Flexbox gap={12} padding={20}>
          <Text weight={500}>{t('settings.storage.cleanup.title')}</Text>
          <Text fontSize={12} type="secondary">
            {t('settings.storage.cleanup.desc')}
          </Text>
          <Flexbox horizontal align="center" gap={12} wrap="wrap">
            <Segmented
              options={[
                { label: t('settings.storage.cleanup.mode.daysAgo'), value: 'daysAgo' },
                { label: t('settings.storage.cleanup.mode.oldest'), value: 'oldestCount' },
              ]}
              value={mode}
              onChange={(value) => setMode(value as 'daysAgo' | 'oldestCount')}
            />
            {mode === 'daysAgo' ? (
              <InputNumber
                max={3650}
                value={daysAgo ?? null}
                onChange={(value) => setDaysAgo(value ?? undefined)}
              />
            ) : (
              <InputNumber
                max={10000}
                value={oldestCount ?? null}
                onChange={(value) => setOldestCount(value ?? undefined)}
              />
            )}
            <Button
              disabled={busy || !activeCriteria}
              onClick={() => activeCriteria && void previewCleanup(activeCriteria)}
            >
              {t('settings.storage.cleanup.preview', { count: cleanupSelection?.total ?? 0 })}
            </Button>
          </Flexbox>
          {previewCandidates.length > 0 ? (
            <>
              <Flexbox gap={2} style={{ maxHeight: 260, overflowY: 'auto', paddingInlineEnd: 2 }}>
                {previewCandidates.map((candidate) => (
                  <Flexbox horizontal align="center" gap={10} key={candidate.session.id} paddingBlock={6}>
                    <Flexbox flex={1} style={{ minWidth: 0 }}>
                      <Text ellipsis fontSize={13}>
                        {candidate.session.title}
                      </Text>
                    </Flexbox>
                    <Text fontSize={11} type="secondary">
                      {t('settings.storage.cleanup.lastMessage', {
                        time: formatRelativeTime(candidate.lastMessageAt, locale),
                      })}
                    </Text>
                    <Text fontSize={11} type="secondary">
                      {candidate.messageCount}
                    </Text>
                  </Flexbox>
                ))}
              </Flexbox>
              {cleanupSelection && cleanupSelection.total > previewCandidates.length && (
                <Text fontSize={11} type="secondary">
                  {t('settings.storage.cleanup.more', { count: cleanupSelection.total - previewCandidates.length })}
                </Text>
              )}
            </>
          ) : (
            cleanupSelection && <Text fontSize={12} type="secondary">{t('settings.storage.cleanup.noSessions')}</Text>
          )}
          <Flexbox horizontal gap={8} justify="flex-end">
            <Button
              disabled={busy || !cleanupSelection?.total || !activeCriteria}
              onClick={() => void handleExportOnly()}
            >
              {t('settings.storage.cleanup.exportOnly')}
            </Button>
            <Button
              danger
              disabled={busy || !cleanupSelection?.total || !activeCriteria}
              onClick={() => void handleExportAndDelete()}
            >
              {t('settings.storage.cleanup.exportAndDelete')}
            </Button>
          </Flexbox>
          </Flexbox>
        </Block>
      </div>
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
