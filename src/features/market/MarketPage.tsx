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
import OrderButton from '@/features/market/components/OrderButton';
import Pagination from '@/features/market/components/Pagination';
import SortButton, { type SortOption } from '@/features/market/components/SortButton';
import { agentMarketService } from '@/api/market/agentMarketService';
import { marketService } from '@/api/market/marketService';
import { mcpMarketService } from '@/api/market/mcpMarketService';
import { skillMarketService } from '@/api/market/skillMarketService';
import type { Category, ListMarketRequest } from '@/api/core/types';
import type { ServiceRequestOptions } from '@/api/core/types';
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

const defaultSortBy: Record<MarketKind, string> = {
  agent: 'recommended',
  mcp: 'recommended',
  skill: 'installCount',
};

const sortOptionsFor = (kind: MarketKind, t: (key: string) => string): SortOption[] => {
  const option = (key: string): SortOption => ({ key, label: t(`market.sort.${key}`) });
  switch (kind) {
    case 'agent':
      return [option('recommended'), option('updatedAt'), option('mostUsage'), option('haveSkills')];
    case 'skill':
      return [option('installCount'), option('updatedAt'), option('createdAt'), option('stars'), option('name')];
    case 'mcp':
      return [option('recommended'), option('isFeatured'), option('isValidated'), option('installCount'), option('ratingCount'), option('updatedAt'), option('createdAt')];
  }
};

const fetchList = (kind: MarketKind, input: ListMarketRequest, options?: ServiceRequestOptions) =>
  kind === 'agent'
    ? agentMarketService.getAgentsListByCategoryAndKW(input, options)
    : kind === 'skill'
      ? skillMarketService.getSkillsListByCategoryAndKW(input, options)
      : mcpMarketService.getMcpServersListByCategoryAndKW(input, options);

const fetchCategories = (kind: MarketKind, input: { fab: string; locale: string; mode: 'all' | 'permissioned' }, options?: ServiceRequestOptions) =>
  kind === 'agent'
    ? agentMarketService.getAgentCategories(input, options)
    : kind === 'skill'
      ? skillMarketService.getSkillCategories(input, options)
      : mcpMarketService.getMcpServerCategories(input, options);

export default function MarketPage({ kind }: { kind: MarketKind }) {
  const { locale, t } = useI18n();
  const navigate = useNavigate();
  const [fabs, setFabs] = useState<string[]>([]);
  const [fab, setFab] = useState('');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'all' | 'permissioned'>('all');
  const [category, setCategory] = useState('all');
  const [categories, setCategories] = useState<Category[]>([]);
  const [sortBy, setSortBy] = useState(defaultSortBy[kind]);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [items, setItems] = useState<Item[]>([]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  // FAB 选项与默认 FAB：all 渲染选项，permissioned 决定默认项
  useEffect(() => {
    const controller = new AbortController();
    setError(undefined);
    void Promise.all([
      marketService.getFabOptions({ locale, mode: 'all', type: kind }, { signal: controller.signal }),
      marketService.getFabOptions({ locale, mode: 'permissioned', type: kind }, { signal: controller.signal }),
    ]).then(([all, permissioned]) => {
      setFabs(all.fabs);
      setFab(permissioned.fabs[0] || all.fabs[0] || '');
    }).catch((reason: unknown) => {
      if ((reason as DOMException).name !== 'AbortError') setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      controller.abort();
    };
  }, [kind, locale]);

  useEffect(() => {
    if (!fab) return;
    setPage(1);
    setCategory('all');
  }, [fab, kind]);

  useEffect(() => {
    setSortBy(defaultSortBy[kind]);
    setSortOrder('desc');
  }, [kind]);

  useEffect(() => {
    if (!fab) return;
    const controller = new AbortController();
    const requestId = `${kind}:${fab}:${category}:${mode}:${page}:${query}:${sortBy}:${sortOrder}`;
    setLoading(true);
    setError(undefined);
    const request = {
      categoryId: category === 'all' ? null : category,
      fab,
      keyword: query || null,
      locale,
      mode,
      page,
      pageSize: 21,
      sortBy,
      sortOrder,
    };
    void Promise.all([
      fetchList(kind, request, { signal: controller.signal }),
      fetchCategories(kind, { fab, locale, mode }, { signal: controller.signal }),
    ]).then(([result, { categories: next }]) => {
      if (requestId !== `${kind}:${fab}:${category}:${mode}:${page}:${query}:${sortBy}:${sortOrder}`) return;
      setItems(result.items);
      setTotalCount(result.totalCount);
      setCategories(next);
    }).catch((reason: unknown) => {
      if ((reason as DOMException).name !== 'AbortError' && requestId === `${kind}:${fab}:${category}:${mode}:${page}:${query}:${sortBy}:${sortOrder}`) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    }).finally(() => {
      if (requestId === `${kind}:${fab}:${category}:${mode}:${page}:${query}:${sortBy}:${sortOrder}`) setLoading(false);
    });
    return () => controller.abort();
  }, [category, fab, kind, locale, mode, page, query, sortBy, sortOrder]);

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
        left={<SearchBar placeholder={t('market.search', { name: labels[kind] })} value={query} onChange={(event) => setQuery(event.target.value)} style={{ width: '100%' }} />}
        right={
          <Flexbox horizontal align="center" gap={8}>
            <SortButton
              options={sortOptionsFor(kind, t)}
              value={sortBy}
              onChange={(next) => {
                setSortBy(next);
                setPage(1);
              }}
            />
            <OrderButton
              order={sortOrder}
              onChange={(next) => {
                setSortOrder(next);
                setPage(1);
              }}
            />
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
            {loading && <Text type="secondary">{t('common.loading')}</Text>}
            {error && <Text type="danger">{error}</Text>}
            {!loading && !error && (
              <>
                <Grid rows={3} width="100%">
                  {items.map((item) => (
                    <MarketItem fab={fab} item={item} key={`${item.id}-${fab}`} kind={kind} />
                  ))}
                </Grid>
                <Pagination
                  currentPage={page}
                  pageSize={21}
                  totalCount={totalCount}
                  onPageChange={setPage}
                />
              </>
            )}
          </Flexbox>
        </Flexbox>
      </WideScreenContainer>
    </Flexbox>
  );
}
