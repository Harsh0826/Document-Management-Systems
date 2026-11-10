import { AlertTriangle, CalendarClock, ChevronRight, Files, Folder, FolderPlus, Home, Pin, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useExpiryCounts, useFile, useFindFolders, useFolder, useFolders, usePins } from '@/api/hooks';
import { NewFolderDialog } from '@/components/library/FolderDialogs';
import { folderTone } from '@/components/library/parts';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/lib/auth';
import type { LibraryFolder } from '@/lib/types';
import { cn } from '@/lib/utils';

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const SHOW_FIRST = 100;

/** Where the person is: the open folder, or the folder of the open document, with its parents. */
function useCurrentTrail() {
  const { pathname } = useLocation();
  const folderId = /^\/folders\/([^/]+)/.exec(pathname)?.[1];
  const fileId = /^\/files\/([^/]+)/.exec(pathname)?.[1];
  // Same queries the pages use, so nothing extra is loaded.
  const { data: folder } = useFolder(folderId);
  const { data: file } = useFile(fileId);
  const trail = folderId ? (folder?.id === folderId ? folder.path.map((p) => p.id) : []) : (file?.folderPath.map((p) => p.id) ?? []);
  return { activeId: folderId ?? file?.folderId, trail };
}

interface TreeCtx {
  activeId?: string;
  expanded: Set<string>;
  toggle: (id: string) => void;
  onNavigate?: () => void;
}

function TreeLevel({ parent, level, ctx }: { parent: string | null; level: number; ctx: TreeCtx }) {
  const { data, isLoading, isError } = useFolders(parent);
  const [all, setAll] = useState(false);
  const pad = { paddingLeft: 8 + level * 16 };
  if (isLoading)
    return (
      <div className="flex items-center gap-2 py-1.5 text-sm text-slate-500" style={pad}>
        <Spinner className="size-3.5" /> Loading…
      </div>
    );
  if (isError)
    return (
      <div className="py-1.5 text-sm text-red-700" style={pad}>
        Couldn't load these folders.
      </div>
    );
  const list = data ?? [];
  // Keep the open folder visible even when it's beyond the first hundred.
  const shown = all ? list : list.filter((f, i) => i < SHOW_FIRST || ctx.expanded.has(f.id) || f.id === ctx.activeId);
  return (
    <ul role={level === 0 ? 'tree' : 'group'} aria-label={level === 0 ? 'Folders' : undefined}>
      {shown.map((f) => (
        <TreeNode key={f.id} f={f} level={level} ctx={ctx} />
      ))}
      {shown.length < list.length && (
        <li style={pad}>
          <button type="button" onClick={() => setAll(true)} className="min-h-8 cursor-pointer px-2 text-sm font-medium text-primary hover:underline">
            Show all {list.length.toLocaleString()} folders
          </button>
        </li>
      )}
    </ul>
  );
}

/** `shortcut`: a pinned folder; it never opens in place (the tree below shows where it lives). */
function TreeNode({ f, level, ctx, shortcut }: { f: LibraryFolder; level: number; ctx: TreeCtx; shortcut?: boolean }) {
  const canOpen = !shortcut && f.folderCount > 0;
  const open = canOpen && ctx.expanded.has(f.id);
  const active = f.id === ctx.activeId;
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active && !shortcut) row.current?.scrollIntoView({ block: 'nearest' });
  }, [active, shortcut]);
  return (
    <li role="treeitem" aria-expanded={canOpen ? open : undefined} aria-selected={active}>
      <div
        ref={row}
        className={cn('group flex items-center rounded-lg pr-2', active ? 'bg-blue-50 text-primary' : 'text-slate-700 hover:bg-slate-100')}
        style={{ paddingLeft: 4 + level * 16 }}
      >
        {canOpen ? (
          <button
            type="button"
            onClick={() => ctx.toggle(f.id)}
            aria-label={`${open ? 'Close' : 'Open'} ${f.name}`}
            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded text-slate-400 hover:bg-white hover:text-foreground"
          >
            <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
          </button>
        ) : (
          <span className="size-7 shrink-0" aria-hidden />
        )}
        <Link
          to={`/folders/${f.id}`}
          onClick={ctx.onNavigate}
          aria-current={active ? 'page' : undefined}
          title={`${f.name} · ${f.fileCount.toLocaleString()} file${f.fileCount === 1 ? '' : 's'}`}
          className="flex min-h-9 min-w-0 flex-1 items-center gap-2 py-1 text-[15px]"
        >
          <Folder className={cn('size-4 shrink-0', folderTone(f.name).split(' ')[1])} fill="currentColor" fillOpacity={0.2} aria-hidden />
          <span className={cn('min-w-0 flex-1 truncate', active && 'font-semibold')}>{f.name}</span>
          {f.fileCount > 0 && <span className="shrink-0 text-xs tabular-nums text-slate-500">{compact.format(f.fileCount)}</span>}
        </Link>
      </div>
      {open && <TreeLevel parent={f.id} level={level + 1} ctx={ctx} />}
    </li>
  );
}

function QuickLink({
  to,
  icon,
  label,
  count,
  tone,
  active,
  onNavigate,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  count?: number;
  tone?: 'red' | 'amber';
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-[15px] font-medium',
        active ? 'bg-blue-50 text-primary' : 'text-slate-700 hover:bg-slate-100',
      )}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {!!count && (
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-bold tabular-nums',
            tone === 'red' ? 'bg-red-100 text-red-800' : tone === 'amber' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700',
          )}
        >
          {compact.format(count)}
        </span>
      )}
    </Link>
  );
}

/**
 * The whole folder structure as an expandable tree. Each level loads only when opened, so it works
 * with any number of folders, and it opens itself to wherever you are.
 */
export function FolderSidebar({ onNavigate, showQuickLinks = true }: { onNavigate?: () => void; showQuickLinks?: boolean }) {
  const { isAdmin } = useAuth();
  const location = useLocation();
  const { activeId, trail } = useCurrentTrail();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [newFolder, setNewFolder] = useState(false);
  const { data: pins } = usePins();
  const { data: expiry } = useExpiryCounts();
  const found = useFindFolders(term);

  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  // Open the tree down to the current folder.
  const trailKey = trail.join('/');
  useEffect(() => {
    if (!trailKey) return;
    setExpanded((cur) => {
      const next = new Set(cur);
      for (const id of trailKey.split('/')) next.add(id);
      return next.size === cur.size ? cur : next;
    });
  }, [trailKey]);

  const ctx = useMemo<TreeCtx>(
    () => ({
      activeId,
      expanded,
      onNavigate,
      toggle: (id) =>
        setExpanded((cur) => {
          const next = new Set(cur);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
    }),
    [activeId, expanded, onNavigate],
  );

  const params = new URLSearchParams(location.search);
  const onSearch = location.pathname === '/search';
  const validity = onSearch ? params.get('validity') : null;

  return (
    <div className="flex h-full flex-col">
      {showQuickLinks && (
        <nav aria-label="Shortcuts" className="space-y-0.5 border-b border-slate-200 p-3">
          <QuickLink to="/" icon={<Home className="size-4" />} label="Home" active={location.pathname === '/'} onNavigate={onNavigate} />
          <QuickLink
            to="/search"
            icon={<Files className="size-4" />}
            label="All documents"
            active={onSearch && !validity && !params.get('q')}
            onNavigate={onNavigate}
          />
          <QuickLink
            to="/search?validity=expired&sort=expiry"
            icon={<AlertTriangle className="size-4 text-red-600" />}
            label="Expired"
            count={expiry?.expired}
            tone="red"
            active={validity === 'expired'}
            onNavigate={onNavigate}
          />
          <QuickLink
            to="/search?validity=soon&sort=expiry"
            icon={<CalendarClock className="size-4 text-amber-600" />}
            label="Expiring soon"
            count={expiry?.soon}
            tone="amber"
            active={validity === 'soon'}
            onNavigate={onNavigate}
          />
          {isAdmin && (
            <QuickLink
              to="/deleted"
              icon={<Trash2 className="size-4" />}
              label="Recently deleted"
              active={location.pathname === '/deleted'}
              onNavigate={onNavigate}
            />
          )}
        </nav>
      )}

      <div className="flex items-center gap-2 px-3 pb-2 pt-4">
        <h2 className="flex-1 px-1 text-sm font-bold uppercase tracking-wide text-slate-500">Folders</h2>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setNewFolder(true)}
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-primary"
            aria-label="New top-level folder"
            title="New folder"
          >
            <FolderPlus className="size-4" />
          </button>
        )}
      </div>
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-500" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQ('')}
            placeholder="Find a folder…"
            aria-label="Find a folder"
            className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-8 text-[15px] placeholder:text-slate-500 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/20"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ('')}
              className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-slate-500 hover:text-foreground"
              aria-label="Clear"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {term ? (
          <ul aria-label="Matching folders" className="space-y-0.5">
            {found.isLoading && (
              <li className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500">
                <Spinner className="size-3.5" /> Looking…
              </li>
            )}
            {found.data?.length === 0 && <li className="px-3 py-2 text-sm text-slate-600">No folder called "{term}".</li>}
            {found.data?.map((f) => (
              <li key={f.id}>
                <Link
                  to={`/folders/${f.id}`}
                  onClick={() => (setQ(''), onNavigate?.())}
                  className={cn('block rounded-lg px-3 py-1.5 hover:bg-slate-100', f.id === activeId && 'bg-blue-50 text-primary')}
                >
                  <span className="block truncate text-[15px] font-medium">{f.name}</span>
                  {f.parents.length > 0 && <span className="block truncate text-xs text-slate-500">in {f.parents.map((p) => p.name).join(' › ')}</span>}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <>
            {!!pins?.length && (
              <div className="mb-3">
                <h3 className="flex items-center gap-1.5 px-3 pb-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                  <Pin className="size-3" aria-hidden /> Pinned
                </h3>
                <ul>
                  {pins.map((f) => (
                    <TreeNode key={`pin-${f.id}`} f={f} level={0} ctx={ctx} shortcut />
                  ))}
                </ul>
              </div>
            )}
            <TreeLevel parent={null} level={0} ctx={ctx} />
          </>
        )}
      </div>
      {newFolder && <NewFolderDialog onClose={() => setNewFolder(false)} />}
    </div>
  );
}
