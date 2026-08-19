export const mockDelay = async (signal?: AbortSignal, milliseconds = 120) => new Promise<void>((resolve, reject) => {
  const timer = window.setTimeout(resolve, milliseconds);
  signal?.addEventListener('abort', () => { window.clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});
export const page = <T>(items: T[], currentPage = 1, pageSize = 20) => ({ currentPage, hasNextPage: currentPage * pageSize < items.length, items: items.slice((currentPage - 1) * pageSize, currentPage * pageSize), pageSize, totalCount: items.length, totalPages: Math.max(1, Math.ceil(items.length / pageSize)) });
import { isAgentMarketItem, type MarketItem } from '@/types';

const sortValue = (item: MarketItem, sortBy: string): number | string => {
  switch (sortBy) {
    case 'updatedAt':
      return new Date(item.updatedAt).getTime();
    case 'createdAt':
      return new Date(item.createTimeAt).getTime();
    case 'mostUsage':
    case 'installCount':
      return (item as MarketItem & { installCount?: number }).installCount ?? 0;
    case 'haveSkills':
      return (item as MarketItem & { skillCount?: number }).skillCount ?? 0;
    case 'stars':
      return (item as MarketItem & { stars?: number }).stars ?? 0;
    case 'ratingCount':
      return (item as MarketItem & { ratingCount?: number }).ratingCount ?? 0;
    case 'name':
      return isAgentMarketItem(item) ? item.agentFullName : item.name;
    case 'isFeatured':
      return item.isFeatured ? 1 : 0;
    case 'isValidated':
      return item.isValidated ? 1 : 0;
    default:
      return 0;
  }
};

/**
 * Applies the market sortBy/sortOrder contract to a filtered item list.
 * 'recommended' keeps the server/mock order (featured first, then newest).
 */
export const sortMarketItems = <T extends MarketItem>(items: T[], sortBy: string, sortOrder: 'asc' | 'desc'): T[] => {
  if (!sortBy || sortBy === 'recommended') {
    return [...items].sort((a, b) => {
      const fa = a.isFeatured ? 1 : 0;
      const fb = b.isFeatured ? 1 : 0;
      if (fa !== fb) return fb - fa;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }
  const dir = sortOrder === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const va = sortValue(a, sortBy);
    const vb = sortValue(b, sortBy);
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return cmp * dir;
  });
};

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
