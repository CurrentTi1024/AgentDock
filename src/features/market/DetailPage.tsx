// Detail layout adapted from LobeHub community/(detail)/{agent,skill,mcp}；三类市场 FAB 前置，Version 页不分区。
import { ActionIcon, Avatar, Block, Button, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  BookOpenIcon,
  BotIcon,
  CheckCircle2Icon,
  ChevronLeft,
  DownloadIcon,
  ExternalLinkIcon,
  FileCode2Icon,
  GitBranchIcon,
  HistoryIcon,
  InfoIcon,
  LayersIcon,
  ListIcon,
  MessageSquareTextIcon,
  PackageCheckIcon,
  PlayIcon,
  ShieldCheckIcon,
  SparklesIcon,
  SquareUserIcon,
  StarIcon,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import NavHeader from '@/components/shell/NavHeader';
import WideScreenContainer from '@/components/shell/WideScreenContainer';
import MarketItem from '@/features/market/components/MarketItem';
import { useI18n } from '@/i18n';
import { agentMarketService } from '@/api/market/agentMarketService';
import { mcpMarketService } from '@/api/market/mcpMarketService';
import { skillMarketService } from '@/api/market/skillMarketService';
import type {
  AgentDetail,
  MarketDetail,
  MarketKind,
  McpFabDetail,
  SkillFabDetail,
  SkillMcpDetail,
} from '@/types';

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  body: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: 48px;
    align-items: start;
    @media (max-width: 1200px) {
      grid-template-columns: minmax(0, 1fr);
      gap: 24px;
    }
  `,
  tabsList: css`
    overflow-x: auto;
  `,
  capabilityGrid: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    @media (max-width: 680px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  code: css`
    overflow: auto;
    margin: 0;
    padding: 14px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    color: ${token.colorTextSecondary};
    background: ${token.colorFillQuaternary};
    font: 12px/1.65 ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre-wrap;
  `,
  header: css`
    padding-block: 24px 20px;
  `,
  infoRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding-block: 10px;
    border-block-end: 1px solid ${token.colorBorderSecondary};
    &:last-child {
      border-block-end: 0;
    }
  `,
  markdown: css`
    color: ${token.colorTextSecondary};
    font-size: 14px;
    line-height: 1.8;
    white-space: pre-wrap;
  `,
  sidebar: css`
    position: sticky;
    top: 16px;
    @media (max-width: 1200px) {
      position: static;
    }
  `,
  stat: css`
    min-width: 84px;
    padding: 10px 14px;
    border-inline-start: 1px solid ${token.colorBorderSecondary};
    text-align: center;
  `,
}));

const isAgentDetail = (detail: MarketDetail): detail is AgentDetail => 'versionInfo' in detail;
const isSkillDetail = (detail: MarketDetail): detail is SkillMcpDetail & { skillVersions: SkillFabDetail[] } =>
  'skillVersions' in detail;
const isMcpDetail = (detail: MarketDetail): detail is SkillMcpDetail & { mcpVersions: McpFabDetail[] } =>
  'mcpVersions' in detail;

const detailName = (detail: MarketDetail) => (isAgentDetail(detail) ? detail.agentFullName : detail.name);
const detailCallPermission = (detail: MarketDetail) =>
  isAgentDetail(detail) ? detail.versionInfo.callPermission : detail.versions[0]?.callPermission ?? false;
const detailFab = (detail: MarketDetail) =>
  isAgentDetail(detail) ? detail.versionInfo.fab : detail.versions[0]?.fab || '';
const detailVersion = (detail: MarketDetail) =>
  isAgentDetail(detail) ? detail.versionInfo.version : detail.versions[0]?.version || '-';

function SectionTitle({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <Flexbox horizontal align="center" gap={8}>
      <Text as="h2" fontSize={18} weight={600}>
        {children}
      </Text>
      {typeof count === 'number' && <Tag>{count}</Tag>}
    </Flexbox>
  );
}

function ResourceCards({ items }: { items: Array<{ description?: string; icon?: string; name: string; version?: string }> }) {
  return (
    <Flexbox gap={10}>
      {items.map((item) => (
        <Block horizontal align="center" gap={12} key={`${item.name}-${item.version || ''}`} padding={14} variant="outlined">
          <Avatar avatar={item.icon || '🧩'} background="transparent" shape="square" size={36} />
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Text ellipsis weight={500}>
              {item.name}
            </Text>
            {item.description && (
              <Text ellipsis fontSize={12} type="secondary">
                {item.description}
              </Text>
            )}
          </Flexbox>
          {item.version && <Tag>v{item.version}</Tag>}
        </Block>
      ))}
    </Flexbox>
  );
}

function InfoRows({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <>
      {rows.map(([label, value]) => (
        <div className={styles.infoRow} key={label}>
          <Text type="secondary">{label}</Text>
          <Text>{value}</Text>
        </div>
      ))}
    </>
  );
}

function Sidebar({ detail, kind }: { detail: MarketDetail; kind: MarketKind }) {
  const navigate = useNavigate();
  const { t, locale } = useI18n();
  const fab = isAgentDetail(detail) ? detail.versionInfo.fab : detail.versions[0]?.fab || '';
  const callPermission = detailCallPermission(detail);
  return (
    <Flexbox className={styles.sidebar} gap={20}>
      {kind === 'agent' && (
        <Button
          block
          disabled={!callPermission}
          icon={PlayIcon}
          size="large"
          type="primary"
          onClick={() => navigate(`/chat/session-inbox?agent=${detail.id}&fab=${fab}`)}
        >
          {t('detail.startChat')}
        </Button>
      )}
      {kind !== 'agent' && (
        <Button block icon={DownloadIcon} size="large" type="primary">
          {kind === 'skill' ? t('detail.installSkill') : t('detail.addToAgent')}
        </Button>
      )}
      <Block gap={12} padding={16} variant="outlined">
        <Text weight={500}>{t('detail.summary')}</Text>
        <Text type="secondary" style={{ lineHeight: 1.7 }}>
          {detail.summary}
        </Text>
      </Block>
      <Block gap={2} paddingInline={16} variant="outlined">
        <InfoRows
          rows={[
            [t('common.owner'), detail.ownerName],
            [t('common.category'), detail.category],
            [t('common.createdAt'), new Date(detail.createTimeAt).toLocaleDateString(locale)],
            [t('common.updatedAtLabel'), new Date(detail.updatedAt).toLocaleDateString(locale)],
            [t('common.fab'), fab],
          ]}
        />
      </Block>
      {'tags' in detail && detail.tags.length > 0 && (
        <Flexbox horizontal gap={8} wrap="wrap">
          {detail.tags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </Flexbox>
      )}
      {(detail.homepageUrl || ('repositoryUrl' in detail && detail.repositoryUrl)) && (
        <Flexbox gap={8}>
          {detail.homepageUrl && (
            <Button icon={ExternalLinkIcon} onClick={() => window.open(detail.homepageUrl, '_blank', 'noopener,noreferrer')}>
              {t('detail.homepage')}
            </Button>
          )}
          {'repositoryUrl' in detail && detail.repositoryUrl && (
            <Button icon={GitBranchIcon} onClick={() => window.open(detail.repositoryUrl, '_blank', 'noopener,noreferrer')}>
              {t('detail.sourceCode')}
            </Button>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
}

function AgentContent({ detail }: { detail: AgentDetail }) {
  const { t, locale } = useI18n();
  const tabs = [
    { icon: BookOpenIcon, key: 'overview', label: t('detail.tab.overview') },
    { icon: SquareUserIcon, key: 'system-role', label: t('detail.tab.systemRole') },
    { icon: LayersIcon, key: 'capabilities', label: t('detail.tab.capabilities') },
    { icon: HistoryIcon, key: 'version', label: t('detail.tab.version') },
    { icon: ListIcon, key: 'related', label: t('detail.tab.relatedAgent') },
  ];
  const [active, setActive] = useState('overview');
  useEffect(() => setActive('overview'), [detail.id, detail.versionInfo.fab]);

  const content = () => {
    if (active === 'overview')
      return (
        <Flexbox gap={20}>
          <Block gap={8} padding={16} variant="outlined">
            <Text weight={500}>{t('detail.summary')}</Text>
            <Text className={styles.markdown}>{detail.summary}</Text>
          </Block>
          <SectionTitle>{t('detail.examples')}</SectionTitle>
          <Block gap={0} variant="outlined" style={{ overflow: 'hidden' }}>
            {detail.examples.map((example, index) => (
              <Flexbox
                key={example.title}
                gap={12}
                padding={16}
                style={{
                  borderBlockEnd: index < detail.examples.length - 1 ? `1px solid ${cssVar.colorBorderSecondary}` : undefined,
                  background: index % 2 ? cssVar.colorFillQuaternary : undefined,
                }}
              >
                <Flexbox horizontal align="center" gap={8}>
                  <Icon icon={MessageSquareTextIcon} size={16} />
                  <Text weight={500}>{example.title}</Text>
                </Flexbox>
                <Text type="secondary">{example.userMessage}</Text>
              </Flexbox>
            ))}
          </Block>
        </Flexbox>
      );
    if (active === 'system-role')
      return (
        <Flexbox gap={20}>
          <SectionTitle>{t('detail.systemRole')}</SectionTitle>
          <Block padding={16} variant="outlined">
            <div className={styles.markdown}>{detail.systemRoleMarkdown}</div>
          </Block>
          <SectionTitle count={detail.capabilities.length}>{t('detail.tab.capabilities')}</SectionTitle>
          <ResourceCards items={detail.capabilities.map((capability) => ({ icon: '✨', name: capability }))} />
        </Flexbox>
      );
    if (active === 'capabilities')
      return (
        <Flexbox gap={24}>
          <SectionTitle count={detail.capabilities.length}>{t('detail.coreCapabilities')}</SectionTitle>
          <div className={styles.capabilityGrid}>
            {detail.capabilities.map((capability) => (
              <Block horizontal align="center" gap={10} key={capability} padding={15} variant="outlined">
                <Icon color={cssVar.colorSuccess} icon={CheckCircle2Icon} size={18} />
                <Text>{capability}</Text>
              </Block>
            ))}
          </div>
          <SectionTitle count={detail.skills.length}>{t('detail.knowledgeSkills')}</SectionTitle>
          <ResourceCards items={detail.skills} />
          <SectionTitle count={detail.mcpServers.length}>{t('detail.toolsMcp')}</SectionTitle>
          <ResourceCards items={detail.mcpServers} />
        </Flexbox>
      );
    if (active === 'version')
      return (
        <Flexbox gap={16}>
          <SectionTitle>{t('detail.tab.version')}</SectionTitle>
          <Block horizontal align="center" justify="space-between" padding={16} variant="outlined" wrap="wrap">
            <Flexbox horizontal align="center" gap={10} wrap="wrap">
              <code style={{ fontSize: 16 }}>v{detail.versionInfo.version}</code>
              <Tag color="info">{t('detail.currentActiveVersion')}</Tag>
              {detail.versionInfo.callPermission ? (
                <Tag color="success">{t('detail.callable')}</Tag>
              ) : (
                <Tag>{t('detail.viewOnly')}</Tag>
              )}
            </Flexbox>
            <Text fontSize={12} type="secondary">
              FAB {detail.versionInfo.fab}
            </Text>
          </Block>
          <Block gap={12} padding={16} variant="outlined">
            <Text weight={500}>{t('detail.versionNote')}</Text>
            <Text className={styles.markdown}>{detail.overview}</Text>
            <InfoRows
              rows={[
                [t('common.createdAt'), detail.versionInfo.createAt ? new Date(detail.versionInfo.createAt).toLocaleDateString(locale) : '-'],
                [t('common.updatedAtLabel'), detail.versionInfo.updateAt ? new Date(detail.versionInfo.updateAt).toLocaleDateString(locale) : '-'],
                [t('detail.changelog'), detail.versionInfo.changeLog || '-'],
              ]}
            />
          </Block>
        </Flexbox>
      );
    return (
      <Flexbox gap={16}>
        <SectionTitle count={detail.relatedAgents.length}>{t('detail.tab.relatedAgent')}</SectionTitle>
        <div className={styles.capabilityGrid}>
          {detail.relatedAgents.map((item) => (
            <ResourceCards
              items={[
                {
                  description: item.description,
                  icon: item.icon,
                  name: item.agentFullName,
                },
              ]}
              key={item.agentId}
            />
          ))}
        </div>
      </Flexbox>
    );
  };

  return (
    <Flexbox gap={24}>
      <Tabs
        activeKey={active}
        classNames={{ list: styles.tabsList }}
        items={tabs.map((tab) => ({ ...tab, icon: <Icon icon={tab.icon} size={16} /> }))}
        variant="square"
        onChange={(key) => setActive(String(key))}
      />
      <Flexbox gap={24} style={{ minWidth: 0 }}>
        {content()}
      </Flexbox>
    </Flexbox>
  );
}

function SkillMcpContent({ detail, kind }: { detail: SkillMcpDetail; kind: MarketKind }) {
  const { t, locale } = useI18n();
  const activeVersion = isSkillDetail(detail)
    ? detail.skillVersions[0]
    : isMcpDetail(detail)
      ? detail.mcpVersions[0]
      : undefined;
  const [active, setActive] = useState('overview');
  const fab = detail.versions[0]?.fab || '';
  useEffect(() => setActive('overview'), [detail.id, fab]);

  const commonTabs = [
    { icon: BookOpenIcon, key: 'overview', label: t('detail.tab.overview') },
    { icon: DownloadIcon, key: 'install', label: kind === 'skill' ? t('detail.tab.install') : t('detail.tab.deployment') },
    ...(kind === 'mcp' ? [{ icon: FileCode2Icon, key: 'schema', label: t('detail.tab.schema') }] : []),
    ...(kind === 'skill' ? [{ icon: StarIcon, key: 'reviews', label: t('detail.tab.reviews') }, { icon: InfoIcon, key: 'info', label: t('detail.tab.info') }] : []),
    ...(kind === 'mcp' ? [{ icon: PackageCheckIcon, key: 'security', label: t('detail.tab.security') }, { icon: ListIcon, key: 'related', label: t('detail.tab.relatedMcp') }] : []),
    { icon: BotIcon, key: 'agents', label: t('detail.tab.agents') },
    { icon: HistoryIcon, key: 'version', label: t('detail.tab.version') },
  ];

  const content = () => {
    if (!activeVersion) return <Text type="secondary">{t('common.emptyVersion')}</Text>;
    if (active === 'overview')
      return (
        <Flexbox gap={18}>
          <Block gap={12} padding={18} variant="outlined">
            <Text className={styles.markdown}>
              {'content' in activeVersion ? activeVersion.content : activeVersion.overview}
            </Text>
            <Flexbox horizontal gap={8}>
              {'connectionType' in activeVersion && <Tag>{activeVersion.connectionType}</Tag>}
              <Tag color="success">{t('detail.platformHosted')}</Tag>
              {'tools' in activeVersion && <Tag>{activeVersion.tools.length} Tools</Tag>}
            </Flexbox>
          </Block>
          {'tools' in activeVersion && (
            <>
              <SectionTitle count={activeVersion.tools.length}>{t('detail.functions')}</SectionTitle>
              <ResourceCards
                items={activeVersion.tools.map((tool) => ({ description: tool.description, icon: '🧰', name: tool.name }))}
              />
            </>
          )}
          {'related' in detail && (
            <>
              <SectionTitle count={detail.related.length}>{t('detail.relatedResources')}</SectionTitle>
              <div className={styles.capabilityGrid}>
                {detail.related.map((item) => (
                  <MarketItem fab={fab} item={item} key={item.id} kind={kind} />
                ))}
              </div>
            </>
          )}
        </Flexbox>
      );
    if (active === 'install' || active === 'deployment')
      return (
        <Flexbox gap={16}>
          <SectionTitle count={'deploymentOptions' in activeVersion ? activeVersion.deploymentOptions.length : 1}>
            {kind === 'skill' ? t('detail.installTo') : t('detail.deploymentMethods')}
          </SectionTitle>
          {'deploymentOptions' in activeVersion
            ? activeVersion.deploymentOptions.map((option) => (
                <Block horizontal align="center" gap={14} key={option.label} padding={17} variant="outlined">
                  <Icon color={option.recommended ? cssVar.colorSuccess : cssVar.colorTextSecondary} icon={GitBranchIcon} size={21} />
                  <Flexbox flex={1}>
                    <Flexbox horizontal align="center" gap={8}>
                      <Text weight={500}>{option.label}</Text>
                      {option.recommended && <Tag color="success">{t('detail.recommended')}</Tag>}
                    </Flexbox>
                    <Text type="secondary">{option.description}</Text>
                  </Flexbox>
                </Block>
              ))
            : null}
          <Block gap={12} padding={18} variant="outlined">
            <Text weight={500}>{kind === 'skill' ? t('detail.installFromRegistry') : t('detail.platformHosted')}</Text>
            <pre className={styles.code}>
              {kind === 'skill'
                ? `agentdock skill install ${detail.id} --fab ${fab}`
                : t('detail.platformManagedHint')}
            </pre>
          </Block>
        </Flexbox>
      );
    if (active === 'schema' && 'tools' in activeVersion)
      return (
        <Flexbox gap={32}>
          <SectionTitle count={activeVersion.tools.length}>Tools</SectionTitle>
          {activeVersion.tools.map((tool) => (
            <Block gap={12} key={tool.name} padding={16} variant="outlined">
              <Flexbox horizontal align="center" gap={8}>
                <Icon icon={FileCode2Icon} size={18} />
                <Text weight={500}>{tool.name}</Text>
              </Flexbox>
              <Text type="secondary">{tool.description}</Text>
              <pre className={styles.code}>{tool.schema}</pre>
            </Block>
          ))}
          <SectionTitle count={activeVersion.resources.length}>Resources</SectionTitle>
          <ResourceCards
            items={activeVersion.resources.map((resource) => ({
              description: `${resource.description} · ${resource.uri}`,
              icon: '🔗',
              name: resource.name,
            }))}
          />
          <SectionTitle count={activeVersion.prompts.length}>Prompts</SectionTitle>
          <ResourceCards
            items={activeVersion.prompts.map((prompt) => ({ description: prompt.description, icon: '💬', name: prompt.name }))}
          />
        </Flexbox>
      );
    if (active === 'reviews')
      return (
        <Flexbox gap={16}>
          <SectionTitle>{t('detail.reviews')}</SectionTitle>
          <Block horizontal align="center" gap={24} padding={20} variant="outlined">
            <Flexbox align="center">
              <Text fontSize={30} weight={600}>
                4.8
              </Text>
              <Text fontSize={12} type="secondary">
                12 {t('detail.reviewCount')}
              </Text>
            </Flexbox>
            <Flexbox horizontal gap={3}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Icon color={cssVar.colorWarning} icon={StarIcon} key={n} size={18} />
              ))}
            </Flexbox>
          </Block>
          {[t('detail.review.sample1'), t('detail.review.sample2')].map((review, index) => (
            <Block gap={8} key={index} padding={16} variant="outlined">
              <Flexbox horizontal align="center" gap={8}>
                <Avatar avatar={index ? '🧑‍💻' : '👩‍🚀'} size={28} />
                <Text weight={500}>{index ? 'Developer A' : 'Flight User'}</Text>
                <Tag>{t('detail.verifiedUser')}</Tag>
              </Flexbox>
              <Text>{review}</Text>
            </Block>
          ))}
        </Flexbox>
      );
    if (active === 'info')
      return (
        <Flexbox gap={16}>
          <SectionTitle>{t('detail.resourceInfo')}</SectionTitle>
          <Block paddingInline={16} variant="outlined">
            <InfoRows
              rows={[
                [t('common.owner'), detail.ownerName],
                [t('common.category'), detail.category],
                [t('common.repository'), 'repositoryUrl' in detail ? detail.repositoryUrl || '-' : '-'],
                [t('detail.permissions'), 'permissions' in activeVersion ? activeVersion.permissions.join('、') || '-' : '-'],
              ]}
            />
          </Block>
          <SectionTitle count={activeVersion.resources.length}>{t('detail.resources')}</SectionTitle>
          <ResourceCards
            items={activeVersion.resources.map((resource) => ({
              icon: '📄',
              name: 'path' in resource ? resource.path : resource.name,
              version: 'size' in resource ? resource.size : undefined,
            }))}
          />
        </Flexbox>
      );
    if (active === 'security')
      return (
        <Flexbox gap={16}>
          <SectionTitle>{t('detail.securityQuality')}</SectionTitle>
          <Block gap={16} padding={18} variant="outlined">
            {[
              [t('detail.security.registry'), t('detail.security.passed')],
              [t('detail.security.credentials'), t('detail.security.serverOnly')],
              [t('detail.security.access'), t('detail.security.inheritUser')],
              [t('detail.security.lastScan'), '2026-08-17'],
            ].map(([label, value]) => (
              <Flexbox horizontal align="center" justify="space-between" key={label}>
                <Flexbox horizontal align="center" gap={9}>
                  <Icon color={cssVar.colorSuccess} icon={ShieldCheckIcon} size={18} />
                  <Text>{label}</Text>
                </Flexbox>
                <Tag color="success">{value}</Tag>
              </Flexbox>
            ))}
          </Block>
        </Flexbox>
      );
    if (active === 'agents')
      return (
        <Flexbox gap={16}>
          <SectionTitle count={detail.referencingAgents?.length || 0}>{t('detail.referencingAgents')}</SectionTitle>
          <ResourceCards
            items={(detail.referencingAgents || []).map((agent) => ({
              description: `Agent v${agent.agentVersion}`,
              icon: agent.icon,
              name: agent.agentFullName || agent.name || agent.agentId,
              version: agent.fab,
            }))}
          />
        </Flexbox>
      );
    return (
      <Flexbox gap={18}>
        <SectionTitle>{t('detail.tab.version')}</SectionTitle>
        <Block horizontal align="center" justify="space-between" padding={16} variant="outlined" wrap="wrap">
          <Flexbox horizontal align="center" gap={10} wrap="wrap">
            <code style={{ fontSize: 16 }}>v{activeVersion.version}</code>
            <Tag color="info">{t('detail.currentActiveVersion')}</Tag>
            {activeVersion.callPermission ? <Tag color="success">{t('detail.callable')}</Tag> : <Tag>{t('detail.viewOnly')}</Tag>}
          </Flexbox>
          <Text fontSize={12} type="secondary">
            FAB {activeVersion.fab}
          </Text>
        </Block>
        <Block gap={12} padding={16} variant="outlined">
          <Text weight={500}>{t('detail.changelog')}</Text>
          {activeVersion.changelog.map((change) => (
            <Flexbox horizontal align="center" gap={8} key={change}>
              <Icon color={cssVar.colorSuccess} icon={CheckCircle2Icon} size={16} />
              <Text>{change}</Text>
            </Flexbox>
          ))}
        </Block>
      </Flexbox>
    );
  };

  return (
    <Flexbox gap={24}>
      <Tabs
        activeKey={active}
        classNames={{ list: styles.tabsList }}
        items={commonTabs.map((tab) => ({ ...tab, icon: <Icon icon={tab.icon} size={16} /> }))}
        variant="square"
        onChange={(key) => setActive(String(key))}
      />
      <Flexbox gap={24} style={{ minWidth: 0 }}>
        {content()}
      </Flexbox>
    </Flexbox>
  );
}

export default function DetailPage({ kind }: { kind: MarketKind }) {
  const { t, locale } = useI18n();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // 详情页只展示当前 FAB 的版本：以列表页带入的 fab 为准，不再查询/切换其他 FAB。
  const fab = searchParams.get('fab') || 'F15B';
  const [detail, setDetail] = useState<MarketDetail>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!fab || !id) return;
    const controller = new AbortController();
    const options = { signal: controller.signal };
    setLoading(true);
    setError(undefined);
    const request =
      kind === 'agent'
        ? agentMarketService.getAgentDetailById({ agentId: id, fab, locale }, options)
        : kind === 'skill'
          ? skillMarketService.getSkillDetailById({ skillId: id, fab, locale }, options)
          : mcpMarketService.getMcpServerDetailById({ mcpServerId: id, fab, locale }, options);
    void request.then(setDetail).catch((reason: unknown) => {
      if ((reason as DOMException).name !== 'AbortError') setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [fab, id, kind, locale]);

  return (
    <Flexbox height="100%" style={{ overflowY: 'auto' }}>
      <NavHeader
        left={
          <Flexbox horizontal align="center" gap={10} style={{ minWidth: 0 }}>
            <ActionIcon aria-label={t('detail.backToMarket')} icon={ChevronLeft} onClick={() => navigate(`/market/${kind}`)} />
          </Flexbox>
        }
      />
      {error ? (
        <Flexbox align="center" flex={1} justify="center">
          <Text type="danger">{error}</Text>
        </Flexbox>
      ) : !detail || loading ? (
        <Flexbox align="center" flex={1} justify="center">
          <Text type="secondary">{t('common.loading')}</Text>
        </Flexbox>
      ) : (
        <WideScreenContainer gap={16} minWidth={1440} paddingBlock={8} width="100%">
          <Flexbox className={styles.header} gap={18}>
            <Flexbox horizontal align="center" gap={18} wrap="wrap">
              <Avatar avatar={detail.icon} background="transparent" shape="square" size={68} />
              <Flexbox flex={1} gap={6} style={{ minWidth: 240 }}>
                <Flexbox horizontal align="center" gap={8} wrap="wrap">
                  <Text as="h1" fontSize={26} weight={600}>
                    {detailName(detail)}
                  </Text>
                  {detail.isValidated && (
                    <Tag color="success" icon={<Icon icon={CheckCircle2Icon} size={13} />}>
                      {t('common.verified')}
                    </Tag>
                  )}
                  <Tag color="info">{fab}</Tag>
                </Flexbox>
                <Text type="secondary">{detail.description}</Text>
                <Flexbox horizontal align="center" gap={8} wrap="wrap">
                  <Text fontSize={12} type="secondary">
                    {detail.ownerName}
                  </Text>
                  <span>·</span>
                  <Tag>{detail.category}</Tag>
                  <Text fontSize={12} type="secondary">
                    {t('common.updatedAt', { date: new Date(detail.updatedAt).toLocaleDateString(locale) })}
                  </Text>
                </Flexbox>
              </Flexbox>
              <Flexbox horizontal>
                <Flexbox className={styles.stat}>
                  <Text weight={600}>{detail.metric.split(' ')[0]}</Text>
                  <Text fontSize={11} type="secondary">
                    {t('detail.usage')}
                  </Text>
                </Flexbox>
                <Flexbox className={styles.stat}>
                  <Text weight={600}>v{detailVersion(detail)}</Text>
                  <Text fontSize={11} type="secondary">
                    {t('detail.versionLabel')}
                  </Text>
                </Flexbox>
              </Flexbox>
            </Flexbox>
          </Flexbox>
          <Flexbox className={styles.body} style={{ paddingBlockStart: 8 }}>
            <Flexbox style={{ minWidth: 0 }}>
              {isAgentDetail(detail) ? (
                <AgentContent detail={detail} />
              ) : (
                <SkillMcpContent detail={detail} kind={kind} />
              )}
            </Flexbox>
            <Sidebar detail={detail} kind={kind} />
          </Flexbox>
        </WideScreenContainer>
      )}
    </Flexbox>
  );
}
