// Layout adapted from LobeHub community/(list)/{agent,skill,mcp}.
import { Button, Flexbox, Grid, Icon, SearchBar, Segmented, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ChevronDown, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MarketItem from '@/components/lobehub/MarketItem';
import { agentMarketService } from '@/services/market/agentMarketService';
import { mcpMarketService } from '@/services/market/mcpMarketService';
import { skillMarketService } from '@/services/market/skillMarketService';
import type { MarketItem as Item, MarketKind } from '@/types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  category: css`cursor: pointer; border-radius: ${cssVar.borderRadius}px; padding: 8px 10px; color: ${cssVar.colorTextSecondary}; &:hover { background: ${cssVar.colorFillTertiary}; }`,
  categoryActive: css`color: ${cssVar.colorText}; background: ${cssVar.colorFillSecondary};`,
  header: css`flex: none; border-block-end: 1px solid ${cssVar.colorBorderSecondary};`,
  page: css`overflow: auto; height: 100%;`,
}));

const labels: Record<MarketKind, string> = { agent: 'Agent', skill: 'Skill', mcp: 'MCP' };

export default function MarketPage({ kind }: { kind: MarketKind }) {
  const navigate = useNavigate(); const [data, setData] = useState<Item[]>([]); const [query, setQuery] = useState(''); const [category, setCategory] = useState('全部'); const [mode, setMode] = useState('全部');
  useEffect(() => {
    const input = { mode: mode === '已授权' ? 'permissioned' as const : 'all' as const, categoryId: null, keyword: query || null, locale: 'zh-CN', sortBy: 'recommended', sortOrder: 'desc' as const, page: 1, pageSize: 50 };
    const request = kind === 'agent' ? agentMarketService.getAgentsListByCategoryAndKW(input) : kind === 'skill' ? skillMarketService.getSkillsListByCategoryAndKW(input) : mcpMarketService.getMcpServersListByCategoryAndKW(input);
    request.then((result) => setData(result.items));
  }, [kind, mode, query]);
  const categories = useMemo(() => ['全部', ...new Set(data.map((x) => x.category))], [data]);
  const filtered = data.filter((x) => (category === '全部' || x.category === category) && (mode === '全部' || x.versions.some((v) => v.callPermission)) && `${x.name}${x.description}`.toLowerCase().includes(query.toLowerCase()));
  return <Flexbox className={styles.page}>
    <Flexbox horizontal align="center" className={styles.header} height={64} justify="space-between" paddingInline={24}>
      <SearchBar placeholder={`搜索 ${labels[kind]}`} value={query} style={{ maxWidth: 480, width: '48%' }} onChange={(e) => setQuery(e.target.value)} />
      <Flexbox horizontal gap={8}><Segmented options={['全部', '已授权']} value={mode} onChange={(v) => setMode(String(v))} />{kind === 'skill' && <Button icon={Plus} type="primary" onClick={() => navigate('/market/skill/create')}>创建 Skill</Button>}</Flexbox>
    </Flexbox>
    <Flexbox gap={24} padding={24} style={{ marginInline: 'auto', maxWidth: 1320, width: '100%' }}>
      <Flexbox horizontal align="center" justify="space-between"><Flexbox><Text as="h1" fontSize={28} weight="bold">{labels[kind]} 市场</Text><Text type="secondary">发现、查看并使用公司内部 {labels[kind]}</Text></Flexbox><Button icon={ChevronDown}>推荐排序</Button></Flexbox>
      <Flexbox horizontal align="flex-start" gap={24} width="100%">
        <Flexbox gap={3} width={184} style={{ flex: 'none' }}>{categories.map((name) => <Flexbox key={name} horizontal align="center" className={`${styles.category} ${category === name ? styles.categoryActive : ''}`} justify="space-between" onClick={() => setCategory(name)}><span>{name}</span><Text fontSize={11} type="secondary">{name === '全部' ? data.length : data.filter((x) => x.category === name).length}</Text></Flexbox>)}</Flexbox>
        <Flexbox flex={1} gap={14}><Text type="secondary">共 {filtered.length} 个结果</Text><Grid rows={3} width="100%">{filtered.map((item) => <MarketItem key={item.id} item={item} kind={kind} />)}</Grid></Flexbox>
      </Flexbox>
    </Flexbox>
  </Flexbox>;
}
