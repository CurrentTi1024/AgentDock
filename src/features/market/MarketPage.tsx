// Layout adapted from LobeHub community/(list)/{agent,skill,mcp}；Agent/Skill/MCP 统一 FAB 前置。
import { Button, Flexbox, Grid, Icon, SearchBar, Segmented, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import NavHeader from '@/components/shell/NavHeader';
import WideScreenContainer from '@/components/shell/WideScreenContainer';
import FabSelector from '@/features/market/components/FabSelector';
import MarketItem from '@/features/market/components/MarketItem';
import Pagination from '@/features/market/components/Pagination';
import { agentMarketService } from '@/api/market/agentMarketService';
import { marketService } from '@/api/market/marketService';
import { mcpMarketService } from '@/api/market/mcpMarketService';
import { skillMarketService } from '@/api/market/skillMarketService';
import type { Category, ListMarketRequest } from '@/api/core/types';
import { useI18n } from '@/i18n';
import type { MarketItem as Item, MarketKind } from '@/types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  category: css`
    cursor: pointer;
    border-radius: ${cssVar.borderRadius}px;
    padding: 8px 10px;
    color: ${cssVar.colorTextSecondary};
    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  categoryActive: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};
  `,
  page: css`
    overflow-y: auto;
    height: 100%;
  `,
}));

const labels: Record<MarketKind, string> = { agent: 'Agent', mcp: 'MCP', skill: 'Skill' };

const fetchList = (kind: MarketKind, input: ListMarketRequest) =>
  kind === 'agent'
    ? agentMarketService.getAgentsListByCategoryAndKW(input)
    : kind === 'skill'
      ? skillMarketService.getSkillsListByCategoryAndKW(input)
      : mcpMarketService.getMcpServersListByCategoryAndKW(input);

const fetchCategories = (kind: MarketKind, input: { fab: string; locale: string; mode: 'all' | 'permissioned' }) =>
  kind === 'agent'
    ? agentMarketService.getAgentCategories(input)
    : kind === 'skill'
      ? skillMarketService.getSkillCategories(input)
      : mcpMarketService.getMcpServerCategories(input);

export default function MarketPage({ kind }: { kind: MarketKind }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [fabs, setFabs] = useState<string[]>([]);
  const [fab, setFab] = useState('');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'all' | 'permissioned'>('all');
  const [category, setCategory] = useState('all');
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);

  // FAB 选项与默认 FAB：all 渲染选项，permissioned 决定默认项
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      marketService.getFabOptions({ locale: 'zh-CN', mode: 'all', type: kind }),
      marketService.getFabOptions({ locale: 'zh-CN', mode: 'permissioned', type: kind }),
    ]).then(([all, permissioned]) => {
      if (cancelled) return;
      setFabs(all.fabs);
      setFab(permissioned.fabs[0] || all.fabs[0] || '');
    });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  useEffect(() => {
    if (!fab) return;
    setPage(1);
    setCategory('all');
  }, [fab, kind]);

  useEffect(() => {
    if (!fab) return;
    const request = {
      categoryId: category === 'all' ? null : category,
      fab,
      keyword: query || null,
      locale: 'zh-CN',
      mode,
      page,
      pageSize: 21,
      sortBy: 'recommended',
      sortOrder: 'desc' as const,
    };
    void fetchList(kind, request).then((result) => {
      setItems(result.items);
      setTotalPages(result.totalPages);
      setHasNextPage(result.hasNextPage);
    });
    void fetchCategories(kind, { fab, locale: 'zh-CN', mode }).then(({ categories: next }) => setCategories(next));
  }, [category, fab, kind, mode, page, query]);

  const categoryItems = useMemo(
    () =>
      categories.map((item) => ({
        count: item.count,
        icon: item.icon,
        id: item.categoryId,
        name: item.categoryName,
      })),
    [categories],
  );

  return (
    <Flexbox className={styles.page}>
      <NavHeader
        left={<SearchBar placeholder={t('market.search', { name: labels[kind] })} value={query} onChange={(event) => setQuery(event.target.value)} style={{ maxWidth: 480, width: '100%' }} />}
        right={
          <Flexbox horizontal align="center" gap={8}>
            <FabSelector fabs={fabs} value={fab} onChange={setFab} />
            <Segmented
              options={[
                { label: t('market.all'), value: 'all' },
                { label: t('market.authorized'), value: 'permissioned' },
              ]}
              value={mode}
              onChange={(value) => setMode(value as 'all' | 'permissioned')}
            />
            {kind === 'skill' && (
              <Button icon={Plus} type="primary" onClick={() => navigate('/market/skill/create')}>
                {t('market.createSkill')}
              </Button>
            )}
          </Flexbox>
        }
      />
      <WideScreenContainer gap={32} minWidth={1440} paddingBlock={24} width="100%">
        <Flexbox gap={4}>
          <Text as="h1" fontSize={28} weight={600}>
            {t('market.title', { name: labels[kind] })}
          </Text>
          <Text type="secondary">{t('market.subtitle', { name: labels[kind] })}</Text>
        </Flexbox>
        <Flexbox horizontal align="flex-start" gap={24} width="100%">
          <Flexbox gap={3} width={184} style={{ flex: 'none' }}>
            {categoryItems.map((item) => (
              <Flexbox
                key={item.id}
                horizontal
                align="center"
                className={`${styles.category} ${category === item.id ? styles.categoryActive : ''}`}
                justify="space-between"
                onClick={() => {
                  setCategory(item.id);
                  setPage(1);
                }}
              >
                <span>
                  {item.icon} {item.name}
                </span>
                <Text fontSize={11} type="secondary">
                  {item.count}
                </Text>
              </Flexbox>
            ))}
          </Flexbox>
          <Flexbox flex={1} gap={14}>
            <Text type="secondary">{t('market.results', { count: items.length })}</Text>
            <Grid rows={3} width="100%">
              {items.map((item) => (
                <MarketItem fab={fab} item={item} key={`${item.id}-${fab}`} kind={kind} />
              ))}
            </Grid>
            <Pagination
              currentPage={page}
              hasNextPage={hasNextPage}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          </Flexbox>
        </Flexbox>
      </WideScreenContainer>
    </Flexbox>
  );
}
