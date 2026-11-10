import { Clock, CornerDownLeft, Search, X } from 'lucide-react';
import { Fragment, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuickSearch } from '@/api/hooks';
import { Spinner } from '@/components/ui/spinner';
import { size } from '@/lib/format';
import type { LibraryFile, LibraryFolder } from '@/lib/types';
import { cn } from '@/lib/utils';
import { FileIcon, FolderIcon } from './parts';
import { forgetSearches, recentSearches, rememberSearch } from './prefs';

/** Bold the parts of `text` that match what was typed, so people see why it came up. */
export function Highlight({ text, q }: { text: string; q: string }) {
  const words = q
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${words.join('|')})`, 'ig'));
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <mark key={i} className="rounded-sm bg-amber-100 px-0.5 text-inherit">
            {p}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

type Option = { kind: 'folder'; folder: LibraryFolder } | { kind: 'file'; file: LibraryFile } | { kind: 'recent'; q: string } | { kind: 'all'; q: string };

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/**
 * The search box with suggestions as you type: matching folders and documents appear straight away,
 * arrow keys move, Enter opens, and Enter on the text shows all results. Press "/" or Ctrl+K anywhere
 * to jump to it.
 */
export function QuickSearch({
  initial = '',
  tone = 'header',
  autoFocus,
  shortcut,
  className,
}: {
  initial?: string;
  tone?: 'header' | 'hero' | 'page';
  autoFocus?: boolean;
  /** Listen for "/" and Ctrl+K (only one search box on screen should). */
  shortcut?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(initial);
  const [term, setTerm] = useState(initial.trim());
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const listId = useId();

  useEffect(() => setText(initial), [initial]);
  useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim()), 150);
    return () => clearTimeout(t);
  }, [text]);
  // Close the suggestions when moving to another page.
  useEffect(() => setOpen(false), [location.pathname, location.search]);

  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !isTyping(e.target))) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcut]);

  const live = term.length > 0 && term === text.trim();
  const { data, isFetching } = useQuickSearch(term);
  const results = live && data?.q === term ? data : undefined;

  const options: Option[] = useMemo(() => {
    if (!text.trim()) return recent.map((q) => ({ kind: 'recent' as const, q }));
    if (!results) return [{ kind: 'all', q: text.trim() }];
    return [
      ...results.folders.slice(0, 5).map((folder) => ({ kind: 'folder' as const, folder })),
      ...results.files.map((file) => ({ kind: 'file' as const, file })),
      { kind: 'all' as const, q: text.trim() },
    ];
  }, [text, results, recent]);
  useEffect(() => setActive(-1), [options.length, term]);

  const searchUrl = (q: string) => {
    // On the search page, keep the chosen filters.
    const params = location.pathname === '/search' ? new URLSearchParams(location.search) : new URLSearchParams();
    params.set('q', q);
    params.delete('sort');
    return `/search?${params.toString()}`;
  };
  const go = (o: Option) => {
    setOpen(false);
    if (o.kind === 'folder') navigate(`/folders/${o.folder.id}`);
    else if (o.kind === 'file') navigate(`/files/${o.file.id}`, { state: { from: location.pathname + location.search } });
    else {
      rememberSearch(o.q);
      setText(o.q);
      navigate(searchUrl(o.q));
    }
    if (o.kind !== 'recent' && o.kind !== 'all') rememberSearch(text);
    input.current?.blur();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (active >= 0 && options[active]) return go(options[active]);
    if (text.trim()) go({ kind: 'all', q: text.trim() });
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, -1));
    } else if (e.key === 'Escape') {
      if (open) setOpen(false);
      else input.current?.blur();
    }
  };

  const big = tone !== 'header';
  const showPanel = open && (text.trim() ? true : recent.length > 0);
  let index = -1;
  const row = (o: Option, children: ReactNode) => {
    index++;
    const i = index;
    return (
      <li
        key={o.kind === 'folder' ? o.folder.id : o.kind === 'file' ? o.file.id : `${o.kind}-${o.q}`}
        id={`${listId}-${i}`}
        role="option"
        aria-selected={active === i}
        onMouseEnter={() => setActive(i)}
        onClick={() => go(o)}
        className={cn('flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2', active === i ? 'bg-blue-50' : 'hover:bg-slate-50')}
      >
        {children}
      </li>
    );
  };

  const folders = options.filter((o) => o.kind === 'folder');
  const files = options.filter((o) => o.kind === 'file');

  return (
    <form onSubmit={submit} role="search" className={cn('relative w-full', className)}>
      <Search className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 text-slate-500', big ? 'left-4 size-5' : 'left-3 size-4')} aria-hidden />
      <input
        ref={input}
        value={text}
        onChange={(e) => (setText(e.target.value), setOpen(true))}
        onFocus={() => (setRecent(recentSearches()), setOpen(true))}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder="Search for a document or folder…"
        aria-label="Search for a document or folder"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoFocus={autoFocus}
        autoComplete="off"
        enterKeyHint="search"
        className={cn(
          'w-full text-foreground placeholder:text-slate-500 focus-visible:outline-none',
          big
            ? 'h-14 rounded-2xl border bg-white pl-12 pr-32 text-lg'
            : 'h-10 rounded-full border border-slate-200 bg-slate-50 pl-9 pr-12 text-base focus-visible:bg-white',
          tone === 'hero'
            ? 'border-transparent shadow-lg shadow-navy/20 focus-visible:ring-4 focus-visible:ring-white/40'
            : 'focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20',
          tone === 'page' && 'border-slate-300 shadow-sm',
        )}
      />
      {big ? (
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {text && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => (setText(''), input.current?.focus())}
              className="flex size-10 cursor-pointer items-center justify-center rounded-xl text-slate-500 hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-5" />
            </button>
          )}
          <button
            type="submit"
            className="h-10 cursor-pointer rounded-xl bg-primary px-5 text-base font-semibold text-white transition-colors hover:bg-primary/90"
          >
            Search
          </button>
        </div>
      ) : (
        <kbd
          className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-slate-300 bg-white px-1.5 text-xs font-medium text-slate-500 lg:block"
          aria-hidden
        >
          /
        </kbd>
      )}

      {showPanel && (
        <div
          onMouseDown={(e) => e.preventDefault()}
          className={cn(
            'absolute top-full z-50 mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white text-left text-foreground shadow-2xl shadow-navy/15',
            big ? 'inset-x-0' : 'right-0 w-[min(32rem,calc(100vw-2rem))]',
          )}
        >
          <ul id={listId} role="listbox" aria-label="Suggestions" className="scroll-thin max-h-[min(70vh,34rem)] overflow-y-auto p-2">
            {!text.trim() && (
              <>
                <li className="flex items-center justify-between px-3 pb-1 pt-1 text-sm font-semibold text-slate-500" role="presentation">
                  Recent searches
                  <button type="button" onClick={() => (forgetSearches(), setRecent([]))} className="cursor-pointer font-medium text-primary hover:underline">
                    Clear
                  </button>
                </li>
                {options.map(
                  (o) =>
                    o.kind === 'recent' &&
                    row(
                      o,
                      <>
                        <Clock className="size-4 shrink-0 text-slate-400" aria-hidden />
                        <span className="text-base">{o.q}</span>
                      </>,
                    ),
                )}
              </>
            )}
            {folders.length > 0 && (
              <li className="px-3 pb-1 pt-1 text-sm font-semibold text-slate-500" role="presentation">
                Folders
              </li>
            )}
            {folders.map(
              (o) =>
                o.kind === 'folder' &&
                row(
                  o,
                  <>
                    <span className="scale-75">
                      <FolderIcon name={o.folder.name} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-medium">
                        <Highlight text={o.folder.name} q={term} />
                      </span>
                      <span className="block truncate text-sm text-slate-500">
                        {o.folder.parents.length ? `in ${o.folder.parents.map((p) => p.name).join(' › ')} · ` : ''}
                        {o.folder.fileCount.toLocaleString()} file{o.folder.fileCount === 1 ? '' : 's'}
                      </span>
                    </span>
                  </>,
                ),
            )}
            {files.length > 0 && (
              <li className="px-3 pb-1 pt-2 text-sm font-semibold text-slate-500" role="presentation">
                Documents
              </li>
            )}
            {files.map(
              (o) =>
                o.kind === 'file' &&
                row(
                  o,
                  <>
                    <FileIcon ext={o.file.ext} className="size-9" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-medium">
                        <Highlight text={o.file.name} q={term} />
                      </span>
                      <span className="block truncate text-sm text-slate-500">
                        {o.file.folderPath.map((p) => p.name).join(' › ')} · {o.file.type} · {size(o.file.sizeBytes)}
                      </span>
                    </span>
                  </>,
                ),
            )}
            {results && !results.folders.length && !results.files.length && (
              <li className="px-3 py-3 text-base text-slate-600" role="presentation">
                Nothing found for "{term}". Check the spelling or try a shorter word.
              </li>
            )}
            {options.map(
              (o) =>
                o.kind === 'all' &&
                row(
                  o,
                  <>
                    {isFetching && !results ? <Spinner className="size-4" /> : <Search className="size-4 shrink-0 text-primary" aria-hidden />}
                    <span className="flex-1 text-base font-medium text-primary">
                      {results?.moreFiles ? 'See all results' : 'Search'} for "{o.q}"
                    </span>
                    <CornerDownLeft className="size-4 text-slate-400" aria-hidden />
                  </>,
                ),
            )}
          </ul>
          <div className="hidden border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500 sm:block">
            <b>↑ ↓</b> to move · <b>Enter</b> to open · <b>Esc</b> to close · press <b>/</b> anywhere to search
          </div>
        </div>
      )}
    </form>
  );
}
