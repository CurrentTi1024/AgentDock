import { Avatar, Block, Button, Flexbox, Icon, Input, Select, Tag, Text, TextArea } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CheckCircle2Icon, ChevronLeftIcon, GitBranchIcon, PackagePlusIcon, ShieldCheckIcon } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { skillMarketService } from '@/services/market/skillMarketService';

const styles = createStaticStyles(({ css, cssVar }) => ({
  page: css`overflow-y: auto; height: 100%;`,
  root: css`width: 100%; max-width: 980px; margin-inline: auto; padding: 32px 32px 80px;`,
  steps: css`display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;`,
  step: css`padding: 12px; border-block-end: 2px solid ${cssVar.colorBorderSecondary}; color: ${cssVar.colorTextSecondary};`,
  stepActive: css`border-color: ${cssVar.colorPrimary}; color: ${cssVar.colorText}; font-weight: 600;`,
  two: css`display: grid; grid-template-columns: 1fr 1fr; gap: 16px;`,
}));

function Field({ children, label, hint }: { children: React.ReactNode; hint?: string; label: string }) {
  return <Flexbox gap={7}><Text weight="bold">{label}</Text>{children}{hint && <Text fontSize={12} type="secondary">{hint}</Text>}</Flexbox>;
}

export default function SkillCreatePage() {
  const navigate = useNavigate();
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [fabs, setFabs] = useState(['F15B']);
  const toggleFab = (fab: string) => setFabs((current) => current.includes(fab) ? current.filter((item) => item !== fab) : [...current, fab]);
  const publish = async () => { setPublishing(true); try { await skillMarketService.createAndPublishSkill({ name: '飞行日志摘要', icon: '🛫', description: '从飞行日志中提取关键指标和异常', summary: '供飞行测试报告使用。', categoryId: 'analysis', locale: 'zh-CN', license: 'Internal', version: '1.0.0', fabs, repository: { url: 'https://git.company.example/ai/skills/flight-log-summary', branch: 'main', path: '/' }, changelogMarkdown: '- 首次发布' }); setPublished(true); } finally { setPublishing(false); } };

  return <div className={styles.page}><Flexbox className={styles.root} gap={28}>
    <Flexbox horizontal align="center" gap={14}><Button icon={ChevronLeftIcon} onClick={() => navigate('/market/skill')}>返回 Skill 市场</Button><Flexbox><Text as="h1" fontSize={26} weight="bold">创建并发布 Skill</Text><Text type="secondary">从公司 Git 仓库导入，校验通过后立即发布到 Agent Registry。</Text></Flexbox></Flexbox>
    <div className={styles.steps}>{['1  基本信息', '2  仓库与版本', '3  校验并发布'].map((step, index) => <div className={`${styles.step} ${index === 0 ? styles.stepActive : ''}`} key={step}>{step}</div>)}</div>
    {published ? <Block gap={18} padding={32} variant="outlined"><Flexbox align="center" gap={12}><Avatar avatar={<Icon color={cssVar.colorSuccess} icon={CheckCircle2Icon} />} size={56} /><Text as="h2" fontSize={22} weight="bold">Skill 已创建并发布</Text><Text type="secondary">flight-log-summary · v1.0.0 · {fabs.join(' / ')}</Text><Button type="primary" onClick={() => navigate('/market/skill/document-summary')}>查看详情页</Button></Flexbox></Block> : <>
      <Block gap={20} padding={22} variant="outlined">
        <Flexbox horizontal align="center" gap={10}><Icon icon={PackagePlusIcon} /><Text as="h2" fontSize={18} weight="bold">基本信息</Text></Flexbox>
        <div className={styles.two}><Field label="名称"><Input defaultValue="飞行日志摘要" /></Field><Field label="图标"><Input defaultValue="🛫" /></Field></div>
        <Field label="描述"><TextArea autoSize={{ minRows: 2 }} defaultValue="从飞行日志中提取关键指标和异常" /></Field>
        <div className={styles.two}><Field label="分类"><Select defaultValue="analysis" options={[{ label: '数据分析', value: 'analysis' }, { label: '文档', value: 'documents' }]} /></Field><Field label="标签"><Input defaultValue="飞行, 日志, 摘要" /></Field></div>
      </Block>
      <Block gap={20} padding={22} variant="outlined">
        <Flexbox horizontal align="center" gap={10}><Icon icon={GitBranchIcon} /><Text as="h2" fontSize={18} weight="bold">仓库与版本</Text></Flexbox>
        <Field label="Git 仓库地址" hint="只支持公司可访问仓库；不会在浏览器保存仓库凭据。"><Input defaultValue="https://git.company.example/ai/skills/flight-log-summary" /></Field>
        <div className={styles.two}><Field label="分支"><Input defaultValue="main" /></Field><Field label="Skill 路径"><Input defaultValue="/" /></Field></div>
        <div className={styles.two}><Field label="版本"><Input defaultValue="1.0.0" /></Field><Field label="许可证"><Select defaultValue="Internal" options={[{ label: 'Internal', value: 'Internal' }]} /></Field></div>
        <Field label="适用 FAB"><Flexbox horizontal gap={8}>{['F15B', 'F18B', 'F35A'].map((fab) => <Button key={fab} type={fabs.includes(fab) ? 'primary' : 'default'} onClick={() => toggleFab(fab)}>{fab}</Button>)}</Flexbox></Field>
        <Field label="变更记录"><TextArea autoSize={{ minRows: 3 }} defaultValue="- 首次发布\n- 增加飞行日志异常提取模板" /></Field>
      </Block>
      <Block horizontal align="center" gap={14} padding={18} variant="outlined"><Icon color={cssVar.colorSuccess} icon={ShieldCheckIcon} size={24} /><Flexbox flex={1}><Text weight="bold">发布前安全校验</Text><Text type="secondary">后端将校验 SemVer、仓库可访问性、Skill 清单、资源路径和 FAB 合法性。</Text></Flexbox><Flexbox horizontal gap={6}>{fabs.map((fab) => <Tag key={fab}>{fab}</Tag>)}</Flexbox></Block>
      <Flexbox horizontal justify="flex-end" gap={10}><Button onClick={() => navigate('/market/skill')}>取消</Button><Button disabled={!fabs.length} loading={publishing} type="primary" onClick={publish}>校验并发布</Button></Flexbox>
    </>}
  </Flexbox></div>;
}
