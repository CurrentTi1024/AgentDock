export const mockDelay = async (signal?: AbortSignal, milliseconds = 120) => new Promise<void>((resolve, reject) => {
  const timer = window.setTimeout(resolve, milliseconds);
  signal?.addEventListener('abort', () => { window.clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});
export const page = <T>(items: T[], currentPage = 1, pageSize = 20) => ({ currentPage, hasNextPage: currentPage * pageSize < items.length, items: items.slice((currentPage - 1) * pageSize, currentPage * pageSize), pageSize, totalCount: items.length, totalPages: Math.max(1, Math.ceil(items.length / pageSize)) });
export const filterMarketItems = <T extends { category: string; description: string; name: string; versions: Array<{ callPermission: boolean }> }>(items: T[], input: { categoryId?: null | string; keyword?: null | string; mode: 'all' | 'permissioned' }, categoryNames: Record<string, string>) => {
  const keyword = input.keyword?.toLowerCase();
  return items
    .filter((item) => (!keyword || `${item.name}${item.description}`.toLowerCase().includes(keyword)) && (!input.categoryId || input.categoryId === 'all' || item.category === categoryNames[input.categoryId]))
    .map((item) => input.mode === 'permissioned' ? { ...item, versions: item.versions.filter((version) => version.callPermission) } : structuredClone(item))
    .filter((item) => item.versions.length > 0) as T[];
};
