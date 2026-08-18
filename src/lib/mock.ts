export const mockDelay = async (signal?: AbortSignal, milliseconds = 120) => new Promise<void>((resolve, reject) => {
  const timer = window.setTimeout(resolve, milliseconds);
  signal?.addEventListener('abort', () => { window.clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});
export const page = <T>(items: T[], currentPage = 1, pageSize = 20) => ({ currentPage, hasNextPage: currentPage * pageSize < items.length, items: items.slice((currentPage - 1) * pageSize, currentPage * pageSize), pageSize, totalCount: items.length, totalPages: Math.max(1, Math.ceil(items.length / pageSize)) });
import { isAgentMarketItem, type MarketItem } from '@/types';

export const filterMarketItems = <T extends MarketItem>(
  items: T[],
  input: { categoryId?: null | string; fab: string; keyword?: null | string; mode: 'all' | 'permissioned' },
  categoryNames: Record<string, string>,
): T[] => {
  const keyword = input.keyword?.toLowerCase();
  const matchesBase = (item: MarketItem) =>
    (!keyword || `${itemName(item)}${item.description}`.toLowerCase().includes(keyword)) &&
    (!input.categoryId || input.categoryId === 'all' || item.category === categoryNames[input.categoryId]);
  const matchesFab = (item: MarketItem) =>
    isAgentMarketItem(item)
      ? item.fabPermission.fab === input.fab
      : item.versions.some((version) => version.fab === input.fab);
  const applyMode = (item: MarketItem): MarketItem => {
    if (isAgentMarketItem(item)) {
      return { ...item, fabPermission: { ...item.fabPermission } };
    }
    const fabVersions = item.versions.filter((version) => version.fab === input.fab);
    return {
      ...item,
      versions: input.mode === 'permissioned' ? fabVersions.filter((version) => version.callPermission) : fabVersions,
    };
  };
  return items
    .filter((item) => matchesBase(item) && matchesFab(item))
    .map((item) => applyMode(item))
    .filter((item) =>
      isAgentMarketItem(item)
        ? input.mode === 'all' || item.fabPermission.callPermission
        : item.versions.length > 0,
    ) as T[];
};

const itemName = (item: MarketItem) => (isAgentMarketItem(item) ? item.agentFullName : item.name);
