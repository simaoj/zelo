'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HistoryQuery } from '@zelo/contracts';
import { DataError, type ZeloDataSource } from './ports';
import { useZelo } from './ZeloProvider';
import { useOptionalSession } from './session';

/** Cursor-paged history list (desc). Reloads from the first page when data changes. */
export function usePagedHistory<T>(
  key: string,
  lister: (ds: ZeloDataSource, q: HistoryQuery) => Promise<{ items: T[]; nextCursor: string | null }>,
  pageSize = 20,
) {
  const { data: ds } = useZelo();
  const session = useOptionalSession();
  const expire = session?.expire;
  const listerRef = useRef(lister);
  useEffect(() => {
    listerRef.current = lister;
  });
  const [state, setState] = useState<{ items: T[]; cursor: string | null; loading: boolean; error: unknown; loaded: boolean }>({
    items: [],
    cursor: null,
    loading: true,
    error: null,
    loaded: false,
  });
  const seq = useRef(0);
  const pagesLoaded = useRef(1);

  /** (Re)loads from the first page, keeping as many pages as were visible so the list doesn't jump. */
  const load = useCallback(async () => {
    const my = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      let items: T[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < pagesLoaded.current; i++) {
        const page = await listerRef.current(ds, { limit: pageSize, ...(cursor ? { cursor } : {}) });
        items = items.concat(page.items);
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      if (my === seq.current) setState({ items, cursor, loading: false, error: null, loaded: true });
    } catch (error) {
      if (error instanceof DataError && error.status === 401) expire?.();
      if (my === seq.current) setState((s) => ({ ...s, loading: false, error }));
    }
  }, [ds, pageSize, expire]);

  const loadMore = useCallback(async () => {
    const cursor = state.cursor;
    if (!cursor) return;
    const my = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const page = await listerRef.current(ds, { limit: pageSize, cursor });
      pagesLoaded.current += 1;
      if (my === seq.current) setState((s) => ({ items: s.items.concat(page.items), cursor: page.nextCursor, loading: false, error: null, loaded: true }));
    } catch (error) {
      if (my === seq.current) setState((s) => ({ ...s, loading: false, error }));
    }
  }, [ds, pageSize, state.cursor]);

  useEffect(() => {
    pagesLoaded.current = 1;
    void load();
    return ds.subscribe(() => void load());
  }, [ds, key, load]);

  return {
    items: state.items,
    hasMore: !!state.cursor,
    loading: state.loading,
    loaded: state.loaded,
    error: state.error,
    loadMore,
    reload: () => void load(),
  };
}
