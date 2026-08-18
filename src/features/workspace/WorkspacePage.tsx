import { Avatar, Block, Button, Flexbox, Icon, SearchBar, Segmented, Select, Tag, Text } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  Brain,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileText,
  ListTodo,
  MoreHorizontal,
  Play,
  Plus,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { agentGroupService } from '@/api/agent-group/agentGroupService';
import { documentService } from '@/api/document/documentService';
import { getServiceMode, setServiceMode } from '@/api/core/serviceMode';
import { memoryService } from '@/api/memory/memoryService';
import { createRunInput } from '@/api/runtime/agentRuntimeService';
import { scheduledTaskService } from '@/api/task/scheduledTaskService';
import { useI18n } from '@/i18n';
import { LOCALE_NAMES, SUPPORTED_LOCALES } from '@/i18n/locales';
import { useRunStore } from '@/stores/runStore';
import { useUiStore, type ThemeMode } from '@/stores/uiStore';

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  card: css`
    cursor: pointer;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorBgContainer};
    &:hover {
      border-color: ${token.colorBorder};
      box-shadow: ${token.boxShadowTertiary};
    }
  `,
  header: css`
    flex: none;
    border-block-end: 1px solid ${token.colorBorderSecondary};
  `,
  page: css`
    overflow-y: auto;
    height: 100%;
  `,
  root: css`
    width: 100%;
    max-width: 1120px;
    margin-inline: auto;
    padding: 32px 32px 80px;
  `,
  split: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 24px;
    align-items: start;
  `,
  tableRow: css`
    display: grid;
    grid-template-columns: minmax(240px, 1fr) 160px 140px 48px;
    align-items: center;
    gap: 16px;
    min-height: 62px;
    padding: 10px 16px;
    border-block-end: 1px solid ${token.colorBorderSecondary};
    &:last-child {
      border-block-end: 0;
    }
  `,
}));

type WorkspaceType = 'artifact' | 'channel' | 'documents' | 'group' | 'memory' | 'page' | 'settings' | 'tasks';

const meta: Record<WorkspaceType, [string, string]> = {
  artifact: ['workspace.artifact.title', 'workspace.artifact.desc'],
  channel: ['workspace.channel.title', 'workspace.channel.desc'],
  documents: ['workspace.documents.title', 'workspace.documents.desc'],
  group: ['workspace.group.title', 'workspace.group.desc'],
  memory: ['workspace.memory.title', 'workspace.memory.desc'],
  page: ['workspace.page.title', 'workspace.page.desc'],
  settings: ['workspace.settings.title', 'workspace.settings.desc'],
  tasks: ['workspace.tasks.title', 'workspace.tasks.desc'],
};

const monthHidden: WorkspaceType[] = ['artifact', 'channel', 'documents', 'group', 'memory', 'page', 'tasks'];

function PageTitle({ type }: { type: WorkspaceType }) {
  const { t } = useI18n();
  const [titleKey, descriptionKey] = meta[type];
  return (
    <Flexbox gap={5}>
      <Text as="h1" fontSize={28} weight={600}>
        {t(titleKey)}
      </Text>
      <Text type="secondary">{t(descriptionKey)}</Text>
    </Flexbox>
  );
}

function GroupPage() {
  const { t } = useI18n();
  const agents = [
    ['🛩️', 'FlightAnalysis_Agent-F15B', 'workspace.group.role.supervisor'],
    ['📊', 'DataCheck_Agent-F15B', 'workspace.group.role.dataCheck'],
    ['📝', 'ReportWriter_Agent-F15B', 'workspace.group.role.report'],
  ];
  const [modes, setModes] = useState<Array<{ modeId: string; name: string }>>([]);
  const [mode, setMode] = useState('supervisor');
  const { execute, respondToHitl, run, stop } = useRunStore();
  useEffect(() => {
    void agentGroupService
      .getSupportedAgentGroupOrchestrationModes({ locale: 'zh-CN' })
      .then((data) => {
        setModes(data.modes);
        setMode(data.defaultModeId);
      });
  }, []);
  const hitl = Object.values(run?.activities || {}).find(
    (activity): activity is { requestId: string } =>
      typeof activity === 'object' && activity !== null && 'requestId' in activity,
  );
  const startGroup = () =>
    void execute(
      createRunInput({
        fab: 'F15B',
        message: t('workspace.group.sampleMessage'),
        sessionId: 'session-group-flight',
        threadId: 'thread-group-flight',
        group: {
          members: [
            { agentId: 'flight-analysis', fab: 'F15B', version: '2.1.0' },
            { agentId: 'data-check', fab: 'F15B' },
            { agentId: 'report-writer', fab: 'F15B' },
          ],
          orchestrationMode: mode,
          config: { maxIterations: 6 },
        },
      }),
    );
  return (
    <>
      <PageTitle type="group" />
      <div className={styles.split}>
        <Flexbox gap={16}>
          <Block gap={16} padding={18} variant="outlined">
            <Flexbox horizontal align="center" justify="space-between">
              <Flexbox>
                <Text weight={500}>{t('workspace.group.name')}</Text>
                <Text type="secondary">{t('workspace.group.temp')}</Text>
              </Flexbox>
              <Tag color="success">{t('workspace.group.members')}</Tag>
            </Flexbox>
          </Block>
          {agents.map(([icon, name, role], index) => (
            <Flexbox horizontal align="center" gap={12} key={name}>
              <Avatar avatar={icon} shape="square" size={40} />
              <Flexbox flex={1}>
                <Text weight={500}>{name}</Text>
                <Text fontSize={12} type="secondary">
                  {t(role)}
                </Text>
              </Flexbox>
              {index === 0 && <Tag color="info">Supervisor</Tag>}
              <Button icon={MoreHorizontal} type="text" />
            </Flexbox>
          ))}
          <Button icon={Plus}>{t('workspace.group.addMember')}</Button>
          <Block gap={14} padding={18} variant="outlined">
            <Text weight={500}>{t('workspace.group.task')}</Text>
            <Text style={{ lineHeight: 1.7 }}>{t('workspace.group.taskDesc')}</Text>
            <Flexbox horizontal gap={8}>
              <Tag>maxIterations: 6</Tag>
              <Tag>{t('workspace.group.timeout')}</Tag>
              {run && <Tag color="info">{run.status}</Tag>}
            </Flexbox>
            {run?.status === 'paused' && hitl?.requestId && (
              <Block gap={10} padding={12} variant="filled">
                <Text weight={500}>{t('workspace.group.hitlTitle')}</Text>
                <Text fontSize={12} type="secondary">
                  {t('workspace.group.hitlDesc')}
                </Text>
                <Flexbox horizontal gap={8}>
                  <Button
                    size="small"
                    type="primary"
                    onClick={() =>
                      void respondToHitl({
                        requestId: hitl.requestId,
                        mode: 'toolAuthorization',
                        decision: 'approve',
                      })
                    }
                  >
                    {t('chat.hitl.approve')}
                  </Button>
                  <Button
                    size="small"
                    onClick={() =>
                      void respondToHitl({
                        requestId: hitl.requestId,
                        mode: 'toolAuthorization',
                        decision: 'reject',
                      })
                    }
                  >
                    {t('chat.hitl.reject')}
                  </Button>
                </Flexbox>
              </Block>
            )}
          </Block>
        </Flexbox>
        <Flexbox gap={16}>
          <Block gap={14} padding={18} variant="outlined">
            <Text weight={500}>{t('workspace.group.mode')}</Text>
            <Segmented
              block
              options={modes.map((item) => ({ label: item.name, value: item.modeId }))}
              value={mode}
              onChange={(value) => setMode(String(value))}
            />
            <Text fontSize={12} type="secondary">
              {t('workspace.group.modeHint')}
            </Text>
          </Block>
          {run?.status === 'running' ? (
            <Button block icon={Clock3} size="large" onClick={() => void stop()}>
              {t('workspace.group.stop')}
            </Button>
          ) : (
            <Button block icon={Play} size="large" type="primary" onClick={startGroup}>
              {t('workspace.group.start')}
            </Button>
          )}
        </Flexbox>
      </div>
    </>
  );
}

function TasksPage() {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<Awaited<ReturnType<typeof scheduledTaskService.getScheduledTasks>>>([]);
  useEffect(() => {
    void scheduledTaskService.getScheduledTasks().then(setTasks);
  }, []);
  const statusLabel: Record<string, string> = {
    completed: t('workspace.tasks.status.completed'),
    running: t('workspace.tasks.status.running'),
    scheduled: t('workspace.tasks.status.scheduled'),
  };
  return (
    <>
      <PageTitle type="tasks" />
      <Flexbox horizontal justify="space-between">
        <Segmented
          options={[
            t('workspace.tasks.filterAll'),
            t('workspace.tasks.filterRunning'),
            t('workspace.tasks.filterScheduled'),
            t('workspace.tasks.filterCompleted'),
          ]}
          defaultValue={t('workspace.tasks.filterAll')}
        />
        <Button icon={Plus} type="primary">
          {t('workspace.tasks.new')}
        </Button>
      </Flexbox>
      <Block variant="outlined" style={{ overflow: 'hidden' }}>
        {tasks.map((task) => (
          <div className={styles.tableRow} key={task.id}>
            <Flexbox horizontal align="center" gap={12}>
              <Avatar
                avatar={
                  <Icon
                    icon={task.status === 'running' ? Play : task.status === 'scheduled' ? CalendarClock : CheckCircle2}
                  />
                }
                size={38}
              />
              <Flexbox>
                <Text weight={500}>{task.title}</Text>
                <Text fontSize={12} type="secondary">
                  {task.agentName}
                </Text>
              </Flexbox>
            </Flexbox>
            <Tag color={task.status === 'running' ? 'info' : task.status === 'completed' ? 'success' : undefined}>
              {statusLabel[task.status]}
            </Tag>
            <Text type="secondary">{task.schedule}</Text>
            <Button icon={MoreHorizontal} type="text" />
          </div>
        ))}
      </Block>
    </>
  );
}

function DocumentsPage() {
  const { t } = useI18n();
  const [documents, setDocuments] = useState<Awaited<ReturnType<typeof documentService.getDocumentsListByKW>>>([]);
  useEffect(() => {
    void documentService.getDocumentsListByKW().then(setDocuments);
  }, []);
  const formatSize = (size: number) =>
    size > 1_000_000 ? `${(size / 1_000_000).toFixed(1)} MB` : `${Math.round(size / 1000)} KB`;
  return (
    <>
      <PageTitle type="documents" />
      <Flexbox horizontal justify="space-between">
        <Segmented
          options={[
            t('workspace.documents.filterRecent'),
            t('workspace.documents.filterMine'),
            t('workspace.documents.filterShared'),
          ]}
          defaultValue={t('workspace.documents.filterRecent')}
        />
        <Button icon={Plus} type="primary">
          {t('workspace.documents.new')}
        </Button>
      </Flexbox>
      <Block variant="outlined" style={{ overflow: 'hidden' }}>
        {documents.map((document) => (
          <div className={styles.tableRow} key={document.id}>
            <Flexbox horizontal align="center" gap={12}>
              <Avatar avatar={<Icon icon={FileText} />} size={38} />
              <Flexbox>
                <Text weight={500}>{document.title}</Text>
                <Text fontSize={12} type="secondary">
                  {document.mediaType.split('/').at(-1)} · {formatSize(document.size)}
                </Text>
              </Flexbox>
            </Flexbox>
            <Text type="secondary">{document.owner}</Text>
            <Text type="secondary">{new Date(document.updatedAt).toLocaleDateString('zh-CN')}</Text>
            <Button icon={MoreHorizontal} type="text" />
          </div>
        ))}
      </Block>
    </>
  );
}

function MemoryPage() {
  const { t } = useI18n();
  const [memories, setMemories] = useState<Awaited<ReturnType<typeof memoryService.getMemoryItems>>>([]);
  const [autoInject, setAutoInject] = useState(true);
  useEffect(() => {
    void Promise.all([memoryService.getMemoryItems(), memoryService.getMemorySettings()]).then(
      ([items, settings]) => {
        setMemories(items);
        setAutoInject(settings.autoInject);
      },
    );
  }, []);
  return (
    <>
      <PageTitle type="memory" />
      <Block horizontal align="center" gap={14} padding={18} variant="outlined">
        <Icon color={cssVar.colorWarning} icon={Sparkles} size={22} />
        <Flexbox flex={1}>
          <Text weight={500}>{t('workspace.memory.autoInject')}</Text>
          <Text type="secondary">{t('workspace.memory.autoInjectDesc')}</Text>
        </Flexbox>
        <Switch checked={autoInject} onChange={setAutoInject} />
      </Block>
      <Flexbox gap={10}>
        {memories.map((memory) => (
          <Block horizontal align="center" gap={14} key={memory.id} padding={16} variant="outlined">
            <Avatar avatar={<Icon icon={Brain} />} size={38} />
            <Flexbox flex={1}>
              <Flexbox horizontal gap={8}>
                <Text weight={500}>{memory.title}</Text>
                <Tag>{memory.category}</Tag>
              </Flexbox>
              <Text type="secondary">{memory.content}</Text>
            </Flexbox>
            <Text fontSize={12} type="secondary">
              {new Date(memory.updatedAt).toLocaleDateString('zh-CN')}
            </Text>
            <Button icon={MoreHorizontal} type="text" />
          </Block>
        ))}
      </Flexbox>
    </>
  );
}

const THEME_MODE_OPTIONS: ThemeMode[] = ['system', 'light', 'dark'];

function SettingRow({ description, label, children }: { children: React.ReactNode; description: string; label: string }) {
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

function SettingsPage() {
  const { locale, setLocale, t } = useI18n();
  const { showReasoning, themeMode, setThemeMode, toggleShowReasoning } = useUiStore();
  const [devPreview, setDevPreview] = useState(getServiceMode() === 'mock');

  const toggleDevPreview = (checked: boolean) => {
    setDevPreview(checked);
    setServiceMode(checked ? 'mock' : 'http');
  };

  return (
    <>
      <PageTitle type="settings" />
      <Block gap={0} variant="outlined">
        <SettingRow description={LOCALE_NAMES[locale]} label={t('workspace.settings.language')}>
          <Select
            options={SUPPORTED_LOCALES.map((code) => ({ label: LOCALE_NAMES[code], value: code }))}
            value={locale}
            onChange={(value) => setLocale(value as (typeof SUPPORTED_LOCALES)[number])}
          />
        </SettingRow>
        <SettingRow description={t('workspace.settings.themeModeDesc')} label={t('workspace.settings.themeMode')}>
          <Select
            options={THEME_MODE_OPTIONS.map((mode) => ({
              label: t(`workspace.settings.themeMode.${mode}`),
              value: mode,
            }))}
            value={themeMode}
            onChange={(value) => setThemeMode(value as ThemeMode)}
          />
        </SettingRow>
        <SettingRow description={t('workspace.settings.reasoningDesc')} label={t('workspace.settings.reasoning')}>
          <Switch checked={showReasoning} onChange={toggleShowReasoning} />
        </SettingRow>
        <SettingRow description={t('workspace.settings.mockDesc')} label={t('workspace.settings.mock')}>
          <Switch checked={devPreview} onChange={toggleDevPreview} />
        </SettingRow>
      </Block>
      <Block horizontal align="center" gap={12} padding={18} variant="outlined">
        <Icon icon={Clock3} />
        <Flexbox>
          <Text weight={500}>{t('workspace.settings.sessionHistory')}</Text>
          <Text type="secondary">{t('workspace.settings.sessionHistoryDesc')}</Text>
        </Flexbox>
      </Block>
    </>
  );
}

function MonthHiddenPlaceholder({ type }: { type: WorkspaceType }) {
  const { t } = useI18n();
  const [titleKey] = meta[type];
  return (
    <>
      <PageTitle type={type} />
      <Block gap={12} padding={32} variant="outlined">
        <Text weight={500}>{t('workspace.hidden')}</Text>
        <Text type="secondary">{t('workspace.hiddenDesc')}</Text>
      </Block>
    </>
  );
}

export default function WorkspacePage({ type }: { type: WorkspaceType }) {
  const { t } = useI18n();
  const thisMonthOnly = useUiStore((s) => s.thisMonthOnly);
  const placeholder = type === 'channel' || type === 'artifact' || type === 'page';
  return (
    <Flexbox className={styles.page}>
      <Flexbox
        horizontal
        align="center"
        className={styles.header}
        height={44}
        justify="space-between"
        paddingInline={16}
      >
        <SearchBar placeholder={t('workspace.search', { name: t(meta[type][0]) })} style={{ maxWidth: 480, width: '48%' }} />
        {!['settings', 'group', 'channel', 'artifact', 'page'].includes(type) && (
          <Button icon={Plus} type="primary">
            {t('workspace.new')}
          </Button>
        )}
      </Flexbox>
      <Flexbox className={styles.root} gap={24}>
        {placeholder || (thisMonthOnly && monthHidden.includes(type)) ? (
          <MonthHiddenPlaceholder type={type} />
        ) : (
          <>
            {type === 'group' && <GroupPage />}
            {type === 'tasks' && <TasksPage />}
            {type === 'documents' && <DocumentsPage />}
            {type === 'memory' && <MemoryPage />}
            {type === 'settings' && <SettingsPage />}
          </>
        )}
      </Flexbox>
    </Flexbox>
  );
}
