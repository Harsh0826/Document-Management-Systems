import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DocumentFilters } from '@/api/hooks';

const ARRAY_KEYS = new Set(['categoryId', 'fileType', 'status']);
const NUMBER_KEYS = new Set(['page', 'pageSize', 'expiringWithin']);
const BOOL_KEYS = new Set(['includeSubfolders']);

/** Keeps document filters in the URL so searches are shareable and survive reloads. */
export function useUrlFilters(defaults: DocumentFilters = {}) {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<DocumentFilters>(() => {
    const f: Record<string, unknown> = { page: 1, pageSize: 20, ...defaults };
    params.forEach((v, k) => {
      if (ARRAY_KEYS.has(k)) f[k] = v.split(',').filter(Boolean);
      else if (NUMBER_KEYS.has(k)) f[k] = Number(v) || undefined;
      else if (BOOL_KEYS.has(k)) f[k] = v === 'true';
      else f[k] = v;
    });
    return f as DocumentFilters;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const setFilters = useCallback(
    (next: DocumentFilters) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(next)) {
        if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
        if (k === 'page' && v === 1) continue;
        if (k === 'pageSize' && v === 20) continue;
        if (k === 'archived' && v === 'exclude') continue;
        if ((defaults as Record<string, unknown>)[k] === v) continue;
        p.set(k, Array.isArray(v) ? v.join(',') : String(v));
      }
      setParams(p, { replace: true });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setParams],
  );

  return [filters, setFilters] as const;
}
