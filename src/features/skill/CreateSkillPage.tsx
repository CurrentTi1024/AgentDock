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
  const [published, setPublished] = useState(false);
  const [fabs, setFabs] = useState(['F15B']);
  const toggleFab = (fab: string) =>
    setFabs((current) => (current.includes(fab) ? current.filter((item) => item !== fab) : [...current, fab]));
  const publish = async () => {
    setPublishing(true);
    try {
      await skillMarketService.createAndPublishSkill({
        name: t('skillCreate.sampleName'),
        icon: '🛫',
        description: t('skillCreate.sampleDescription'),
        summary: t('skillCreate.sampleSummary'),
        categoryId: 'analysis',
        locale: 'zh-CN',
        license: 'Internal',
        version: '1.0.0',
        fabs,
        repository: { url: 'https://git.company.example/ai/skills/flight-log-summary', branch: 'main', path: '/' },
        changelogMarkdown: t('skillCreate.sampleChangelog'),
      });
      setPublished(true);
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
                flight-log-summary · v1.0.0 · {fabs.join(' / ')}
              </Text>
              <Button type="primary" onClick={() => navigate('/market/skill/document-summary')}>
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
                  <Input defaultValue={t('skillCreate.sampleName')} />
                </Field>
                <Field label={t('skillCreate.icon')}>
                  <Input defaultValue="🛫" />
                </Field>
              </div>
              <Field label={t('skillCreate.description')}>
                <TextArea autoSize={{ minRows: 2 }} defaultValue={t('skillCreate.sampleDescription')} />
              </Field>
              <div className={styles.two}>
                <Field label={t('skillCreate.category')}>
                  <Select
                    defaultValue="analysis"
                    options={[
                      { label: t('skillCreate.categoryAnalysis'), value: 'analysis' },
                      { label: t('skillCreate.categoryDocuments'), value: 'documents' },
                    ]}
                  />
                </Field>
                <Field label={t('skillCreate.tags')}>
                  <Input defaultValue={t('skillCreate.sampleTags')} />
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
                <Input defaultValue="https://git.company.example/ai/skills/flight-log-summary" />
              </Field>
              <div className={styles.two}>
                <Field label={t('skillCreate.branch')}>
                  <Input defaultValue="main" />
                </Field>
                <Field label={t('skillCreate.skillPath')}>
                  <Input defaultValue="/" />
                </Field>
              </div>
              <div className={styles.two}>
                <Field label={t('skillCreate.version')}>
                  <Input defaultValue="1.0.0" />
                </Field>
                <Field label={t('skillCreate.license')}>
                  <Select defaultValue="Internal" options={[{ label: 'Internal', value: 'Internal' }]} />
                </Field>
              </div>
              <Field label={t('skillCreate.fabs')}>
                <Flexbox horizontal gap={8}>
                  {['F15B', 'F18B', 'F35A'].map((fab) => (
                    <Button
                      key={fab}
                      type={fabs.includes(fab) ? 'primary' : 'default'}
                      onClick={() => toggleFab(fab)}
                    >
                      {fab}
                    </Button>
                  ))}
                </Flexbox>
              </Field>
              <Field label={t('skillCreate.changelog')}>
                <TextArea autoSize={{ minRows: 3 }} defaultValue={t('skillCreate.sampleChangelog')} />
              </Field>
            </Block>
            <Block horizontal align="center" gap={14} padding={18} variant="outlined">
              <Icon color={cssVar.colorSuccess} icon={ShieldCheckIcon} size={24} />
              <Flexbox flex={1}>
                <Text weight={500}>{t('skillCreate.security')}</Text>
                <Text type="secondary">{t('skillCreate.securityHint')}</Text>
              </Flexbox>
              <Flexbox horizontal gap={6}>
                {fabs.map((fab) => (
                  <Tag key={fab}>{fab}</Tag>
                ))}
              </Flexbox>
            </Block>
            <Flexbox horizontal justify="flex-end" gap={10}>
              <Button onClick={() => navigate('/market/skill')}>{t('skillCreate.cancel')}</Button>
              <Button disabled={!fabs.length} loading={publishing} type="primary" onClick={publish}>
                {t('skillCreate.publish')}
              </Button>
            </Flexbox>
          </>
        )}
      </Flexbox>
    </div>
  );
}
