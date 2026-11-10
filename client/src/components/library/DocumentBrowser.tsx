import { ArrowDownUp, Check, ChevronDown, FolderInput, Search, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFiles } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/overlays';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/lib/auth';
import type { Added, FileQuery, FileSort, FileType, Validity } from '@/lib/types';
import { cn } from '@/lib/utils';
import { BulkDeleteDialog, BulkMoveDialog } from './FileDialogs';
import { FileGrid, FileList, type Selection } from './FileRow';
import { ViewToggle } from './parts';
import { useViewMode } from './prefs';

const TYPES: [FileType, string][] = [
  ['pdf', 'PDF'],
  ['word', 'Word'],
  ['excel', 'Excel'],
  ['picture', 'Pictures'],
];
const VALIDITY: [Validity, string][] = [
  ['expired', 'Expired'],
  ['soon', 'Expires within 30 days'],
  ['valid', 'Valid for more than 30 days'],
  ['none', 'No expiry date'],
];
const ADDED: [Added, string][] = [
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['365', 'Last 12 months'],
];
const SORTS: [FileSort, string][] = [
  ['relevance', 'Best match'],
  ['newest', 'Newest first'],
  ['oldest', 'Oldest first'],
  ['name', 'Name A–Z'],
  ['name_desc', 'Name Z–A'],
  ['expiry', 'Expiring soonest'],
  ['largest', 'Largest first'],
];

const pick = <T extends string>(v: string | null, options: [T, string][]) => options.find(([k]) => k === v)?.[0];

/** The list's state lives in the address, so Back, refresh and shared links show the same list. */
export function useFileQuery(scope?: { folder?: string; deep?: boolean }) {
  const [params, setParams] = useSearchParams();
  const q = params.get('q')?.trim() || undefined;
  const sub = params.get('sub');
  const query: FileQuery = {
    q,
    folder: scope?.folder,
    // Searching inside a folder looks in its sub-folders too, unless switched off.
    deep: scope?.folder ? (scope.deep ?? (sub === '1' || (!!q && sub !== '0'))) : undefined,
    type: pick(params.get('type'), TYPES),
    validity: pick(params.get('validity'), VALIDITY),
    added: pick(params.get('added'), ADDED),
    sort: pick(params.get('sort'), SORTS),
  };
  const set = useCallback(
    (patch: Record<string, string | undefined>) =>
      setParams(
        (cur) => {
          const next = new URLSearchParams(cur);
          for (const [k, v] of Object.entries(patch)) {
            if (v) next.set(k, v);
            else next.delete(k);
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  return { query, set };
}

function Menu<T extends string>({
  label,
  value,
  options,
  onChange,
  icon,
  anyLabel,
}: {
  label: string;
  value: T | undefined;
  options: [T, string][];
  onChange: (v: T | undefined) => void;
  icon?: ReactNode;
  /** Offer "Any" (filters); sort menus don't. */
  anyLabel?: string;
}) {
  const current = options.find(([k]) => k === value)?.[1];
  const active = anyLabel ? !!value : false;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-base font-medium whitespace-nowrap transition-colors',
          active ? 'border-primary bg-blue-50 text-primary' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:text-foreground',
        )}
      >
        {icon}
        {active || !anyLabel ? (
          <span>
            {anyLabel ? `${label}: ` : ''}
            {current ?? label}
          </span>
        ) : (
          label
        )}
        <ChevronDown className="size-4 opacity-60" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {anyLabel && (
          <DropdownMenuItem className="min-h-10 text-base" onSelect={() => onChange(undefined)}>
            <Check className={cn('size-4', value ? 'opacity-0' : '')} /> {anyLabel}
          </DropdownMenuItem>
        )}
        {options.map(([k, text]) => (
          <DropdownMenuItem key={k} className="min-h-10 text-base" onSelect={() => onChange(k)}>
            <Check className={cn('size-4', k === value ? '' : 'opacity-0')} /> {text}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Search box that updates the list as you type (after a short pause). */
function InlineSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [text, setText] = useState(value);
  const first = useRef(true);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => text.trim() !== value && onChange(text.trim()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <div className="relative min-w-0 basis-full sm:max-w-sm sm:flex-1 sm:basis-auto">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-500" aria-hidden />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onChange(text.trim())}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-10 w-full rounded-full border border-slate-300 bg-white pl-10 pr-9 text-base placeholder:text-slate-500 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/20"
      />
      {text && (
        <button
          type="button"
          onClick={() => (setText(''), onChange(''))}
          className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-slate-500 hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

/**
 * Documents in a folder or across the library, at any size: filters, sort, list or grid, the next page
 * loading as you scroll, and (for administrators) ticking files to move or delete them together.
 */
export function DocumentBrowser({
  folder,
  showFolder,
  searchPlaceholder,
  empty,
  heading,
}: {
  /** Limit to a folder. `deep`: always include its sub-folders. */
  folder?: { id: string; name: string; hasSubfolders: boolean; deep?: boolean };
  showFolder?: boolean;
  /** Show a search box in the toolbar (folder pages). */
  searchPlaceholder?: string;
  /** Shown when there is nothing at all (no words, no filters). */
  empty: ReactNode;
  heading?: (total: ReactNode) => ReactNode;
}) {
  const { isAdmin } = useAuth();
  const { query, set } = useFileQuery(folder ? { folder: folder.id, deep: folder.deep } : undefined);
  const { data, isLoading, isFetching, isFetchingNextPage, hasNextPage, fetchNextPage, isPlaceholderData } = useFiles(query);
  const [view, setView] = useViewMode('files');
  const files = useMemo(() => data?.pages.flatMap((p) => p.files) ?? [], [data]);
  const first = data?.pages[0];
  const filtered = !!(query.type || query.validity || query.added);
  const deepShown = !!query.deep && !folder?.deep;

  // ---- next page on scroll
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && !isFetchingNextPage && fetchNextPage(), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, files.length]);

  // ---- selection (administrators)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<number | null>(null);
  const [bulk, setBulk] = useState<'move' | 'delete' | null>(null);
  const key = JSON.stringify(query);
  useEffect(() => {
    setSelected(new Set());
    anchor.current = null;
  }, [key]);
  useEffect(() => {
    if (!selected.size) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !bulk && setSelected(new Set());
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected.size, bulk]);
  const selection: Selection | undefined = isAdmin
    ? {
        isSelected: (id) => selected.has(id),
        toggle: (id: string, e: MouseEvent) => {
          const i = files.findIndex((f) => f.id === id);
          setSelected((cur) => {
            const next = new Set(cur);
            const on = !cur.has(id);
            if (e.shiftKey && anchor.current !== null) {
              const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
              for (let j = a; j <= b; j++) {
                if (on) next.add(files[j].id);
                else next.delete(files[j].id);
              }
            } else if (on) next.add(id);
            else next.delete(id);
            return next;
          });
          anchor.current = i;
        },
      }
    : undefined;
  const allShown = files.length > 0 && files.every((f) => selected.has(f.id));
  const selectAll = {
    checked: allShown ? (true as const) : selected.size ? ('mixed' as const) : false,
    onToggle: () => setSelected(allShown ? new Set() : new Set(files.map((f) => f.id))),
  };

  const count = first?.total;
  const totalText =
    count === undefined ? '' : `${count.toLocaleString()}${first?.totalIsCapped ? '+' : ''} document${count === 1 && !first?.totalIsCapped ? '' : 's'}`;
  const clearFilters = () => set({ type: undefined, validity: undefined, added: undefined });
  const sorts = SORTS.filter(([k]) => k !== 'relevance' || query.q);

  return (
    <section aria-label="Documents">
      {heading?.(totalText)}

      {/* Toolbar: one row of plain choices. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {searchPlaceholder && <InlineSearch value={query.q ?? ''} onChange={(v) => set({ q: v || undefined })} placeholder={searchPlaceholder} />}
        <Menu label="Type" anyLabel="Any type" value={query.type} options={TYPES} onChange={(v) => set({ type: v })} />
        <Menu label="Expiry" anyLabel="Any" value={query.validity} options={VALIDITY} onChange={(v) => set({ validity: v })} />
        <Menu label="Added" anyLabel="Any time" value={query.added} options={ADDED} onChange={(v) => set({ added: v })} />
        {folder?.hasSubfolders && !folder.deep && (
          <button
            type="button"
            role="switch"
            aria-checked={!!query.deep}
            onClick={() => set({ sub: query.deep ? '0' : '1' })}
            className={cn(
              'inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-base font-medium whitespace-nowrap transition-colors',
              query.deep ? 'border-primary bg-blue-50 text-primary' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400',
            )}
          >
            <span
              className={cn('flex size-4 items-center justify-center rounded border', query.deep ? 'border-primary bg-primary text-white' : 'border-slate-400')}
            >
              {query.deep && <Check className="size-3" strokeWidth={3} />}
            </span>
            Include sub-folders
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Menu
            label="Sort"
            value={query.sort ?? (query.q ? 'relevance' : 'newest')}
            options={sorts}
            onChange={(v) => set({ sort: v === (query.q ? 'relevance' : 'newest') ? undefined : v })}
            icon={<ArrowDownUp className="size-4 opacity-70" aria-hidden />}
          />
          <ViewToggle mode={view} onChange={setView} label="Show documents as" />
        </div>
      </div>

      {/* What's shown, in words. */}
      {(totalText || filtered || query.q) && (
        <div className="mb-3 flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1 text-base text-slate-600" aria-live="polite">
          {!isLoading && (
            <span>
              {files.length < (count ?? 0) ? `Showing ${files.length.toLocaleString()} of ${totalText}` : totalText}
              {deepShown && folder && ` in ${folder.name} and its sub-folders`}
            </span>
          )}
          {(isFetching && !isFetchingNextPage) || isPlaceholderData ? <Spinner className="size-4" /> : null}
          {filtered && (
            <button type="button" onClick={clearFilters} className="cursor-pointer font-medium text-primary hover:underline">
              Clear filters
            </button>
          )}
          {isAdmin && files.length > 0 && view === 'grid' && (
            <button type="button" onClick={selectAll.onToggle} className="cursor-pointer font-medium text-primary hover:underline">
              {allShown ? 'Clear selection' : `Select all ${files.length.toLocaleString()} shown`}
            </button>
          )}
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : files.length === 0 ? (
        query.q || filtered ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-base text-slate-600">
            <p className="text-lg font-semibold text-foreground">No documents match.</p>
            <p className="mt-1">
              {query.q ? `Nothing found for "${query.q}"${filtered ? ' with these filters' : ''}. ` : 'Nothing matches these filters. '}
              Check the spelling, try fewer words, or clear the filters.
            </p>
            {filtered && (
              <Button variant="outline" className="mt-4 h-10 text-base" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          empty
        )
      ) : (
        <div className={cn('transition-opacity', isPlaceholderData && 'opacity-60')}>
          {view === 'grid' ? (
            <FileGrid files={files} showFolder={showFolder || deepShown} selection={selection} />
          ) : (
            <FileList files={files} showFolder={showFolder || deepShown} selection={selection} selectAll={selectAll} />
          )}
          <div ref={sentinel} />
          {hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" className="h-11 text-base" onClick={() => fetchNextPage()} loading={isFetchingNextPage}>
                Show more
              </Button>
            </div>
          )}
          {!hasNextPage && files.length > 50 && <p className="mt-4 text-center text-base text-slate-500">That's everything — {totalText}.</p>}
        </div>
      )}

      {/* Bulk actions: appear when files are ticked. */}
      {isAdmin && selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4" role="region" aria-label="Selected files">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-navy px-4 py-3 text-white shadow-2xl shadow-navy/40">
            <span className="px-1 text-base font-semibold">{selected.size.toLocaleString()} selected</span>
            <Button className="h-10 bg-white text-base text-navy hover:bg-blue-50" onClick={() => setBulk('move')}>
              <FolderInput className="size-4" /> Move
            </Button>
            <Button variant="destructive" className="h-10 text-base" onClick={() => setBulk('delete')}>
              <Trash2 className="size-4" /> Delete
            </Button>
            <Button variant="ghost" className="h-10 text-base text-white hover:bg-white/10 hover:text-white" onClick={() => setSelected(new Set())}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {bulk === 'move' && (
        <BulkMoveDialog
          ids={[...selected]}
          fromFolderId={folder && !query.deep ? folder.id : undefined}
          onClose={() => setBulk(null)}
          onDone={() => setSelected(new Set())}
        />
      )}
      {bulk === 'delete' && <BulkDeleteDialog ids={[...selected]} onClose={() => setBulk(null)} onDone={() => setSelected(new Set())} />}
    </section>
  );
}
