import { Avatar, Block, Button, Flexbox, Icon, Input, Select, Tag, Text, TextArea } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CheckCircle2Icon, ChevronLeftIcon, GitBranchIcon, PackagePlusIcon, ShieldCheckIcon } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { skillMarketService } from '@/api/market/skillMarketService';
import { useI18n } from '@/i18n';

const styles = createStaticStyles(({ css, cssVar: token }) => ({
  page: css`
    overflow-y: auto;
    height: 100%;
  `,
  root: css`
    width: 100%;
    max-width: 980px;
    margin-inline: auto;
    padding: 32px 32px 80px;
  `,
  steps: css`
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  `,
  step: css`
    padding: 12px;
    border-block-end: 2px solid ${token.colorBorderSecondary};
    color: ${token.colorTextSecondary};
  `,
  stepActive: css`
    border-color: ${token.colorPrimary};
    color: ${token.colorText};
    font-weight: 600;
  `,
  two: css`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  `,
}));

function Field({ children, hint, label }: { children: React.ReactNode; hint?: string; label: string }) {
  return (
    <Flexbox gap={7}>
      <Text weight={500}>{label}</Text>
      {children}
      {hint && (
        <Text fontSize={12} type="secondary">
          {hint}
        </Text>
      )}
    </Flexbox>
  );
}

export default function CreateSkillPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<{ detailUrl: string; fabs: string[]; version: string }>();
  const [error, setError] = useState<string>();
  const [form, setForm] = useState({
    branch: 'main',
    categoryId: 'analysis',
    changelog: t('skillCreate.sampleChangelog'),
    description: t('skillCreate.sampleDescription'),
    fabs: ['F15B'] as string[],
    icon: '🛫',
    license: 'Internal',
    name: t('skillCreate.sampleName'),
    path: '/',
    repositoryUrl: 'https://git.company.example/ai/skills/flight-log-summary',
    summary: t('skillCreate.sampleSummary'),
    tags: t('skillCreate.sampleTags'),
    version: '1.0.0',
  });
  const setField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const toggleFab = (fab: string) =>
    setField('fabs', form.fabs.includes(fab) ? form.fabs.filter((item) => item !== fab) : [...form.fabs, fab]);

  const publish = async () => {
    setPublishing(true);
    setError(undefined);
    try {
      const result = await skillMarketService.createAndPublishSkill({
        categoryId: form.categoryId,
        changelogMarkdown: form.changelog,
        description: form.description,
        fabs: form.fabs,
        icon: form.icon,
        license: form.license,
        locale: 'zh-CN',
        name: form.name,
        repository: { branch: form.branch, path: form.path, url: form.repositoryUrl },
        summary: form.summary,
        version: form.version,
      });
      setPublished({ detailUrl: result.detailUrl, fabs: result.fabs, version: result.version });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className={styles.page}>
      <Flexbox className={styles.root} gap={28}>
        <Flexbox horizontal align="center" gap={14}>
          <Button icon={ChevronLeftIcon} onClick={() => navigate('/market/skill')}>
            {t('skillCreate.back')}
          </Button>
          <Flexbox>
            <Text as="h1" fontSize={26} weight={600}>
              {t('skillCreate.title')}
            </Text>
            <Text type="secondary">{t('skillCreate.subtitle')}</Text>
          </Flexbox>
        </Flexbox>
        <div className={styles.steps}>
          {[t('skillCreate.step1'), t('skillCreate.step2'), t('skillCreate.step3')].map((step, index) => (
            <div className={`${styles.step} ${index === 0 ? styles.stepActive : ''}`} key={step}>
              {step}
            </div>
          ))}
        </div>
        {published ? (
          <Block gap={18} padding={32} variant="outlined">
            <Flexbox align="center" gap={12}>
              <Avatar avatar={<Icon color={cssVar.colorSuccess} icon={CheckCircle2Icon} />} size={56} />
              <Text as="h2" fontSize={22} weight={600}>
                {t('skillCreate.published')}
              </Text>
              <Text type="secondary">
                {form.name} · v{published.version} · {published.fabs.join(' / ')}
              </Text>
              <Button type="primary" onClick={() => navigate(published.detailUrl)}>
                {t('skillCreate.viewDetail')}
              </Button>
            </Flexbox>
          </Block>
        ) : (
          <>
            <Block gap={20} padding={22} variant="outlined">
              <Flexbox horizontal align="center" gap={10}>
                <Icon icon={PackagePlusIcon} />
                <Text as="h2" fontSize={18} weight={600}>
                  {t('skillCreate.basicInfo')}
                </Text>
              </Flexbox>
              <div className={styles.two}>
                <Field label={t('skillCreate.name')}>
                  <Input value={form.name} onChange={(event) => setField('name', event.target.value)} />
                </Field>
                <Field label={t('skillCreate.icon')}>
                  <Input value={form.icon} onChange={(event) => setField('icon', event.target.value)} />
                </Field>
              </div>
              <Field label={t('skillCreate.description')}>
                <TextArea autoSize={{ minRows: 2 }} value={form.description} onChange={(event) => setField('description', event.target.value)} />
              </Field>
              <div className={styles.two}>
                <Field label={t('skillCreate.category')}>
                  <Select
                    options={[
                      { label: t('skillCreate.categoryAnalysis'), value: 'analysis' },
                      { label: t('skillCreate.categoryDocuments'), value: 'documents' },
                    ]}
                    value={form.categoryId}
                    onChange={(value) => setField('categoryId', String(value))}
                  />
                </Field>
                <Field label={t('skillCreate.tags')}>
                  <Input value={form.tags} onChange={(event) => setField('tags', event.target.value)} />
                </Field>
              </div>
            </Block>
            <Block gap={20} padding={22} variant="outlined">
              <Flexbox horizontal align="center" gap={10}>
                <Icon icon={GitBranchIcon} />
                <Text as="h2" fontSize={18} weight={600}>
                  {t('skillCreate.repoVersion')}
                </Text>
              </Flexbox>
              <Field label={t('skillCreate.repoUrl')} hint={t('skillCreate.repoHint')}>
                <Input value={form.repositoryUrl} onChange={(event) => setField('repositoryUrl', event.target.value)} />
              </Field>
              <div className={styles.two}>
                <Field label={t('skillCreate.branch')}>
                  <Input value={form.branch} onChange={(event) => setField('branch', event.target.value)} />
                </Field>
                <Field label={t('skillCreate.skillPath')}>
                  <Input value={form.path} onChange={(event) => setField('path', event.target.value)} />
                </Field>
              </div>
              <div className={styles.two}>
                <Field label={t('skillCreate.version')}>
                  <Input value={form.version} onChange={(event) => setField('version', event.target.value)} />
                </Field>
                <Field label={t('skillCreate.license')}>
                  <Select
                    options={[{ label: 'Internal', value: 'Internal' }]}
                    value={form.license}
                    onChange={(value) => setField('license', String(value))}
                  />
                </Field>
              </div>
              <Field label={t('skillCreate.fabs')}>
                <Flexbox horizontal gap={8}>
                  {['F15B', 'F18B', 'F35A'].map((fab) => (
                    <Button
                      key={fab}
                      type={form.fabs.includes(fab) ? 'primary' : 'default'}
                      onClick={() => toggleFab(fab)}
                    >
                      {fab}
                    </Button>
                  ))}
                </Flexbox>
              </Field>
              <Field label={t('skillCreate.changelog')}>
                <TextArea autoSize={{ minRows: 3 }} value={form.changelog} onChange={(event) => setField('changelog', event.target.value)} />
              </Field>
            </Block>
            <Block horizontal align="center" gap={14} padding={18} variant="outlined">
              <Icon color={cssVar.colorSuccess} icon={ShieldCheckIcon} size={24} />
              <Flexbox flex={1}>
                <Text weight={500}>{t('skillCreate.security')}</Text>
                <Text type="secondary">{t('skillCreate.securityHint')}</Text>
              </Flexbox>
              <Flexbox horizontal gap={6}>
                {form.fabs.map((fab) => (
                  <Tag key={fab}>{fab}</Tag>
                ))}
              </Flexbox>
            </Block>
            {error && <Text type="danger">{error}</Text>}
            <Flexbox horizontal justify="flex-end" gap={10}>
              <Button onClick={() => navigate('/market/skill')}>{t('skillCreate.cancel')}</Button>
              <Button disabled={!form.fabs.length || !form.name.trim()} loading={publishing} type="primary" onClick={() => void publish()}>
                {t('skillCreate.publish')}
              </Button>
            </Flexbox>
          </>
        )}
      </Flexbox>
    </div>
  );
}
