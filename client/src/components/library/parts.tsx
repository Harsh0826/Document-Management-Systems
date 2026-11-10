import { AlertTriangle, CalendarCheck, ChevronRight, FileImage, FileSpreadsheet, FileText, FileType2, Folder, LayoutGrid, List, Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { validity } from '@/lib/format';
import type { FolderCrumb, LibraryFile, LibraryFolder } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useViewMode } from './prefs';

// ---------------------------------------------------------------- file type icon
const ICONS: Record<string, { icon: typeof FileText; cls: string }> = {
  pdf: { icon: FileText, cls: 'bg-red-50 text-red-600 ring-red-100' },
  doc: { icon: FileType2, cls: 'bg-blue-50 text-blue-600 ring-blue-100' },
  docx: { icon: FileType2, cls: 'bg-blue-50 text-blue-600 ring-blue-100' },
  xls: { icon: FileSpreadsheet, cls: 'bg-emerald-50 text-emerald-600 ring-emerald-100' },
  xlsx: { icon: FileSpreadsheet, cls: 'bg-emerald-50 text-emerald-600 ring-emerald-100' },
  jpg: { icon: FileImage, cls: 'bg-violet-50 text-violet-600 ring-violet-100' },
  jpeg: { icon: FileImage, cls: 'bg-violet-50 text-violet-600 ring-violet-100' },
  png: { icon: FileImage, cls: 'bg-violet-50 text-violet-600 ring-violet-100' },
};

export function FileIcon({ ext, className }: { ext: string; className?: string }) {
  const m = ICONS[ext] ?? { icon: FileText, cls: 'bg-slate-100 text-slate-600 ring-slate-200' };
  return (
    <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', m.cls, className)} aria-hidden>
      <m.icon className="size-5" />
    </span>
  );
}

// ---------------------------------------------------------------- folders
/** Each folder gets a stable colour from its name, so people learn to recognise their folders. */
const TONES = [
  'bg-blue-50 text-blue-600',
  'bg-violet-50 text-violet-600',
  'bg-emerald-50 text-emerald-600',
  'bg-amber-50 text-amber-600',
  'bg-rose-50 text-rose-600',
  'bg-cyan-50 text-cyan-700',
  'bg-indigo-50 text-indigo-600',
  'bg-orange-50 text-orange-600',
];
export const folderTone = (name: string) => TONES[[...name.toLowerCase()].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % TONES.length];

export function FolderIcon({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-xl', folderTone(name), size === 'lg' ? 'size-14' : 'size-12')} aria-hidden>
      <Folder className={size === 'lg' ? 'size-7' : 'size-6'} fill="currentColor" fillOpacity={0.15} strokeWidth={2} />
    </span>
  );
}

const counts = (f: LibraryFolder) => {
  const parts = [f.fileCount === 1 ? '1 file' : `${f.fileCount.toLocaleString()} files`];
  if (f.folderCount) parts.push(f.folderCount === 1 ? '1 folder' : `${f.folderCount.toLocaleString()} folders`);
  return parts.join(' · ');
};

export function FolderCard({ f, showWhere }: { f: LibraryFolder; showWhere?: boolean }) {
  return (
    <Link
      to={`/folders/${f.id}`}
      className="group flex h-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,27,51,0.05)] transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:border-primary"
    >
      <FolderIcon name={f.name} />
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-semibold leading-snug break-words text-foreground">{f.name}</span>
        {showWhere && f.parents.length > 0 && <span className="block truncate text-sm text-slate-500">in {f.parents.map((p) => p.name).join(' › ')}</span>}
        <span className="text-base text-slate-600">{counts(f)}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden />
    </Link>
  );
}

export function FolderGrid({ folders, showWhere }: { folders: LibraryFolder[]; showWhere?: boolean }) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {folders.map((f) => (
        <li key={f.id}>
          <FolderCard f={f} showWhere={showWhere} />
        </li>
      ))}
    </ul>
  );
}

/** Compact folder rows: many more folders fit on screen than in the grid. */
export function FolderRows({ folders, showWhere }: { folders: LibraryFolder[]; showWhere?: boolean }) {
  return (
    <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,27,51,0.05)]">
      {folders.map((f) => (
        <li key={f.id}>
          <Link to={`/folders/${f.id}`} className="group flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-slate-50 sm:px-5">
            <span className="scale-75">
              <FolderIcon name={f.name} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-semibold text-foreground group-hover:text-primary">{f.name}</span>
              {showWhere && f.parents.length > 0 && (
                <span className="block truncate text-sm text-slate-500">in {f.parents.map((p) => p.name).join(' › ')}</span>
              )}
            </span>
            <span className="hidden shrink-0 text-base text-slate-600 sm:block">{counts(f)}</span>
            <ChevronRight className="size-5 shrink-0 text-slate-400 group-hover:text-primary" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ViewToggle({ mode, onChange, label }: { mode: 'list' | 'grid'; onChange: (m: 'list' | 'grid') => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full border border-slate-300 bg-white p-0.5">
      {(
        [
          ['list', List, 'List'],
          ['grid', LayoutGrid, 'Grid'],
        ] as const
      ).map(([m, Icon, text]) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => onChange(m)}
          title={`${text} view`}
          className={cn(
            'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors',
            mode === m ? 'bg-navy text-white' : 'text-slate-600 hover:text-foreground',
          )}
        >
          <Icon className="size-4" aria-hidden />
          <span className="hidden sm:inline">{text}</span>
        </button>
      ))}
    </div>
  );
}

const FIRST = 12;

/**
 * Folders at one level, at any number: grid or list, sort by name or size, a filter once there are
 * more than a screenful, and the first dozen shown until you ask for all.
 */
export function FolderSection({
  id,
  title,
  folders,
  action,
  showWhere,
  sortable = true,
}: {
  id: string;
  title: string;
  folders: LibraryFolder[];
  action?: ReactNode;
  showWhere?: boolean;
  sortable?: boolean;
}) {
  const [view, setView] = useViewMode('folders');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<'name' | 'files'>('name');
  const [all, setAll] = useState(false);
  const term = filter.trim().toLowerCase();
  const shown = useMemo(() => {
    const list = term ? folders.filter((f) => f.name.toLowerCase().includes(term)) : folders;
    return sort === 'files' ? [...list].sort((a, b) => b.fileCount - a.fileCount) : list;
  }, [folders, term, sort]);
  const many = folders.length > FIRST;
  const visible = all || term ? shown : shown.slice(0, FIRST);

  return (
    <section aria-labelledby={id}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 id={id} className="flex items-center gap-2.5 text-xl font-bold text-foreground">
          {title}
          <span className="rounded-full bg-slate-200/70 px-2.5 py-0.5 text-sm font-semibold text-slate-700">{folders.length.toLocaleString()}</span>
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {many && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" aria-hidden />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter folders…"
                aria-label={`Filter ${title.toLowerCase()} by name`}
                className="h-10 w-48 rounded-full border border-slate-300 bg-white pl-9 pr-3 text-base placeholder:text-slate-500 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/20 sm:w-56"
              />
            </div>
          )}
          {many && sortable && (
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as 'name' | 'files')}
              aria-label="Sort folders"
              className="h-10 cursor-pointer rounded-full border border-slate-300 bg-white px-3 text-base text-slate-700"
            >
              <option value="name">Name A–Z</option>
              <option value="files">Most files</option>
            </select>
          )}
          {folders.length > 3 && <ViewToggle mode={view} onChange={setView} label="Show folders as" />}
          {action}
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-base text-slate-600">No folder here is called "{filter.trim()}".</p>
      ) : view === 'list' ? (
        <FolderRows folders={visible} showWhere={showWhere} />
      ) : (
        <FolderGrid folders={visible} showWhere={showWhere} />
      )}
      {many && !term && (
        <div className="mt-3">
          <button type="button" onClick={() => setAll(!all)} className="min-h-10 cursor-pointer text-base font-medium text-primary hover:underline">
            {all ? 'Show fewer folders' : `Show all ${folders.length.toLocaleString()} folders`}
          </button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- breadcrumb
export function Breadcrumb({ path, current }: { path: FolderCrumb[]; current?: string }) {
  const items = current ? [...path, { id: '', name: current }] : path;
  return (
    <nav aria-label="You are here" className="mb-3 text-base">
      <ol className="flex flex-wrap items-center gap-1 text-slate-600">
        <li>
          <Link to="/" className="rounded px-0.5 py-1 font-medium hover:text-primary hover:underline">
            Home
          </Link>
        </li>
        {items.map((p, i) => (
          <li key={p.id || p.name} className="inline-flex items-center gap-1">
            <ChevronRight className="size-4 text-slate-400" aria-hidden />
            {i === items.length - 1 ? (
              <span aria-current="page" className="font-medium text-foreground">
                {p.name}
              </span>
            ) : (
              <Link to={`/folders/${p.id}`} className="rounded px-0.5 py-1 font-medium hover:text-primary hover:underline">
                {p.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------- licence validity
export function ValidityLabel({ file, compact }: { file: Pick<LibraryFile, 'validUntil' | 'daysLeft'>; compact?: boolean }) {
  const v = validity(file.validUntil, file.daysLeft);
  if (!v) return null;
  const Icon = v.tone === 'ok' ? CalendarCheck : AlertTriangle;
  // In lists, the short form fits on one line: "Expires in 22 days".
  const d = file.daysLeft ?? 0;
  const text = compact && v.tone === 'soon' ? (d === 0 ? 'Expires today' : `Expires in ${d} day${d === 1 ? '' : 's'}`) : v.text;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-medium ring-1 ring-inset',
        compact ? 'rounded-full px-2.5 py-0.5 text-sm whitespace-nowrap' : 'rounded-lg px-3 py-1.5 text-base',
        v.tone === 'expired'
          ? 'bg-red-50 text-red-800 ring-red-200'
          : v.tone === 'soon'
            ? 'bg-amber-50 text-amber-900 ring-amber-200'
            : 'bg-emerald-50 text-emerald-800 ring-emerald-200',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {text}
    </span>
  );
}
