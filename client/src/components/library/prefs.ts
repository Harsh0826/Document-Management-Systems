import { useCallback, useState } from 'react';

/**
 * Small per-browser preferences. Nothing sensitive is kept:
 * - list or grid: remembered on this computer (a display choice, no document data);
 * - recent searches: only for this browser tab (search words can name documents, so they are gone when
 *   the tab is closed, which matters on shared computers).
 */
type Store = 'local' | 'session';
const storage = (s: Store) => (s === 'local' ? window.localStorage : window.sessionStorage);

function read<T>(store: Store, key: string, fallback: T): T {
  try {
    const v = storage(store).getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(store: Store, key: string, value: unknown) {
  try {
    storage(store).setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or storage full: the preference just isn't remembered */
  }
}

export type ViewMode = 'list' | 'grid';

/** List or grid, remembered separately for documents and folders. */
export function useViewMode(kind: 'files' | 'folders', fallback: ViewMode = kind === 'files' ? 'list' : 'grid') {
  const key = `dms.view.${kind}`;
  const [mode, setMode] = useState<ViewMode>(() => {
    const v = read<string>('local', key, fallback);
    return v === 'list' || v === 'grid' ? v : fallback;
  });
  const set = useCallback(
    (m: ViewMode) => {
      setMode(m);
      write('local', key, m);
    },
    [key],
  );
  return [mode, set] as const;
}

const RECENT_KEY = 'dms.recentSearches';
export const recentSearches = (): string[] => {
  const v = read<unknown>('session', RECENT_KEY, []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 5) : [];
};
export function rememberSearch(q: string) {
  const t = q.trim();
  if (!t) return;
  write('session', RECENT_KEY, [t, ...recentSearches().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 5));
}
export const forgetSearches = () => write('session', RECENT_KEY, []);

/** Whether the folder sidebar is shown on wide screens (remembered on this computer). */
export function useSidebarPref() {
  const [open, setOpen] = useState<boolean>(() => read<boolean>('local', 'dms.sidebar', true) !== false);
  const set = useCallback((v: boolean) => {
    setOpen(v);
    write('local', 'dms.sidebar', v);
  }, []);
  return [open, set] as const;
}
