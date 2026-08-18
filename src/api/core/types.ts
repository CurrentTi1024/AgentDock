export interface ApiEnvelope<T> { code: number; data: T; message: string }
export type Locale = string;
export type MarketListMode = 'all' | 'permissioned';
export interface Category { categoryId: string; categoryName: string; count: number; icon: string }
export interface PageRequest { page: number; pageSize: number }
export interface PageResult<T> { currentPage: number; hasNextPage: boolean; items: T[]; pageSize: number; totalCount: number; totalPages: number }
export interface ServiceRequestOptions { signal?: AbortSignal }
export interface ListMarketRequest extends PageRequest { categoryId?: null | string; fab: string; keyword?: null | string; locale: Locale; mode: MarketListMode; sortBy: string; sortOrder: 'asc' | 'desc' }
