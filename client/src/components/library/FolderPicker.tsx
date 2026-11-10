import { Check, ChevronRight, Folder, Home, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFindFolders, useFolders } from '@/api/hooks';
import { Spinner } from '@/components/ui/spinner';
import type { FolderCrumb, LibraryFolder } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Full path text for a folder, e.g. "Licences › 2025". */
export const folderLabel = (f: Pick<LibraryFolder, 'name' | 'parents'>) => [...f.parents.map((p) => p.name), f.name].join(' › ');

export interface PickedFolder {
  /** null = the top level (only offered with `allowTop`). */
  id: string | null;
  label: string;
}

/**
 * Choose a folder in a library of any size: open folders one level at a time (only that level is
 * loaded), or type part of a name to find it anywhere.
 *
 * - `disabledId`: a folder that can't be chosen (and isn't opened), e.g. the current folder or, when
 *   moving a folder, the folder itself, so nothing inside it can be chosen either.
 * - `maxDepth`: deepest level that can be chosen (moving a folder that has sub-folders).
 * - `allowTop`: offer "Top level" as a choice (moving a folder).
 */
export function FolderPicker({
  value,
  onChange,
  disabledId,
  disabledLabel = '(current folder)',
  maxDepth = 3,
  allowTop,
  startIn,
}: {
  value?: string | null;
  onChange: (f: PickedFolder) => void;
  disabledId?: string;
  disabledLabel?: string;
  maxDepth?: number;
  allowTop?: boolean;
  /** Open the picker at this place (e.g. where the item is now). */
  startIn?: FolderCrumb[];
}) {
  const [trail, setTrail] = useState<FolderCrumb[]>(startIn ?? []);
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const here = trail.at(-1)?.id ?? null;
  const level = useFolders(here, !term);
  const found = useFindFolders(term);
  const searching = !!term;
  const list = searching ? found.data : level.data;
  const loading = searching ? found.isLoading : level.isLoading;

  const blocked = (f: LibraryFolder) => f.id === disabledId || f.parents.some((p) => p.id === disabledId);
  const tooDeep = (f: LibraryFolder) => f.depth > maxDepth;

  const open = (f: LibraryFolder) => {
    setTrail([...f.parents, { id: f.id, name: f.name }]);
    setQ('');
    setTerm('');
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-300 bg-white">
      <div className="border-b border-slate-200 bg-slate-50 p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type to find a folder…"
            aria-label="Find a folder by name"
            className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-10 text-base placeholder:text-slate-500 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/20"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ('')}
              className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-slate-500 hover:text-foreground"
              aria-label="Clear"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        {!searching && (
          <nav aria-label="Folder location" className="mt-2 flex flex-wrap items-center gap-0.5 px-1 text-sm">
            <button
              type="button"
              onClick={() => setTrail([])}
              className={cn(
                'inline-flex min-h-8 cursor-pointer items-center gap-1 rounded px-1.5 font-medium hover:bg-white hover:text-primary',
                !trail.length && 'text-foreground',
              )}
            >
              <Home className="size-3.5" aria-hidden /> All folders
            </button>
            {trail.map((c, i) => (
              <span key={c.id} className="inline-flex items-center gap-0.5">
                <ChevronRight className="size-3.5 text-slate-400" aria-hidden />
                <button
                  type="button"
                  onClick={() => setTrail(trail.slice(0, i + 1))}
                  className="min-h-8 cursor-pointer rounded px-1.5 font-medium hover:bg-white hover:text-primary"
                >
                  {c.name}
                </button>
              </span>
            ))}
          </nav>
        )}
      </div>

      <ul role="listbox" aria-label="Choose a folder" className="scroll-thin max-h-80 overflow-y-auto p-1">
        {allowTop && !searching && !trail.length && (
          <Option
            selected={value === null}
            onSelect={() => onChange({ id: null, label: 'Top level' })}
            icon={<Home className="size-5 shrink-0 text-slate-500" />}
          >
            <span className="font-medium">Top level</span>
            <span className="block text-sm text-slate-500">Show it on Home, next to the other main folders</span>
          </Option>
        )}
        {loading && (
          <li className="flex items-center gap-2 px-3 py-4 text-base text-slate-600">
            <Spinner className="size-4" /> Loading folders…
          </li>
        )}
        {!loading && list?.length === 0 && (
          <li className="px-3 py-4 text-base text-slate-600">{searching ? `No folder called "${term}".` : 'No folders inside this one.'}</li>
        )}
        {list?.map((f) => {
          const isBlocked = blocked(f);
          const disabled = isBlocked || tooDeep(f);
          const canOpen = !isBlocked && f.folderCount > 0 && f.depth < maxDepth;
          return (
            <Option
              key={f.id}
              selected={f.id === value}
              disabled={disabled}
              onSelect={() => onChange({ id: f.id, label: folderLabel(f) })}
              onOpen={canOpen ? () => open(f) : undefined}
              openLabel={`Open ${f.name}`}
              icon={<Folder className={cn('size-5 shrink-0', f.id === value ? 'text-white' : 'fill-amber-100 text-amber-500')} />}
            >
              <span className="block truncate font-medium">{f.name}</span>
              <span className={cn('block truncate text-sm', f.id === value ? 'text-white/80' : 'text-slate-500')}>
                {isBlocked && f.id === disabledId
                  ? disabledLabel
                  : searching && f.parents.length
                    ? `in ${f.parents.map((p) => p.name).join(' › ')}`
                    : [
                        `${f.fileCount.toLocaleString()} file${f.fileCount === 1 ? '' : 's'}`,
                        f.folderCount ? `${f.folderCount} folder${f.folderCount === 1 ? '' : 's'}` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
              </span>
            </Option>
          );
        })}
        {searching && list?.length === 30 && (
          <li className="px-3 py-2 text-sm text-slate-500">Showing the first 30 matches. Type more of the name to narrow it down.</li>
        )}
      </ul>
    </div>
  );
}

function Option({
  selected,
  disabled,
  onSelect,
  onOpen,
  openLabel,
  icon,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  onOpen?: () => void;
  openLabel?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className={cn('flex items-stretch gap-1 rounded-md', selected ? 'bg-primary text-white' : 'hover:bg-muted', disabled && 'opacity-50')}>
      <button
        type="button"
        role="option"
        aria-selected={selected}
        disabled={disabled}
        onClick={onSelect}
        onDoubleClick={onOpen}
        className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-3 py-1.5 text-left text-base disabled:cursor-not-allowed"
      >
        {icon}
        <span className="min-w-0 flex-1">{children}</span>
        {selected && <Check className="size-5 shrink-0" aria-hidden />}
      </button>
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          aria-label={openLabel}
          title="Open this folder"
          className={cn(
            'flex w-11 shrink-0 cursor-pointer items-center justify-center rounded-md border-l',
            selected ? 'border-white/30 hover:bg-white/15' : 'border-slate-200 text-slate-500 hover:bg-white hover:text-primary',
          )}
        >
          <ChevronRight className="size-5" />
        </button>
      )}
    </li>
  );
}
