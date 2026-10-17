import { api } from './lib/appwrite';
import type { ListResult } from './lib/types';
import { useLoad, type Loaded } from './ui';

export const PAGE_SIZE = 25;

export interface ListQuery {
  list: string;
  filters?: Record<string, string | boolean>;
  search?: string;
  offset?: number;
}

/** Loads one page of a registered admin list. Reloads when the query changes. */
export function useList<T>(q: ListQuery): Loaded<ListResult<T>> {
  const key = JSON.stringify(q);
  return useLoad(
    () =>
      api.call<ListResult<T>>('/admin/list', {
        list: q.list,
        filters: q.filters ?? {},
        search: q.search ?? '',
        limit: PAGE_SIZE,
        offset: q.offset ?? 0,
      }),
    [key],
  );
}
