import { Check, Download, Eye, MoreHorizontal } from 'lucide-react';
import { useState, type MouseEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { errorMessage } from '@/api/client';
import { downloadFile } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/overlays';
import { useAuth } from '@/lib/auth';
import { day, size } from '@/lib/format';
import type { LibraryFile } from '@/lib/types';
import { cn } from '@/lib/utils';
import { DeleteFileDialog, MoveFileDialog, RenameFileDialog, ReplaceFileDialog } from './FileDialogs';
import { FileIcon, ValidityLabel } from './parts';

export async function startDownload(f: Pick<LibraryFile, 'id'>) {
  try {
    await downloadFile(f.id);
    toast.success('Your download has started.');
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

type Dialog = 'rename' | 'move' | 'replace' | 'delete' | null;

/** Admin-only "⋯" menu: Rename · Move · Replace with a newer copy · Delete. */
export function FileAdminMenu({ file, onDeleted }: { file: LibraryFile; onDeleted?: () => void }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-10 text-slate-500" aria-label={`More options for ${file.name}`}>
            <MoreHorizontal className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem className="min-h-10 text-base" onSelect={() => setDialog('rename')}>
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-10 text-base" onSelect={() => setDialog('move')}>
            Move
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-10 text-base" onSelect={() => setDialog('replace')}>
            Replace with a newer copy
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive className="min-h-10 text-base" onSelect={() => setDialog('delete')}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === 'rename' && <RenameFileDialog file={file} onClose={close} />}
      {dialog === 'move' && <MoveFileDialog file={file} onClose={close} />}
      {dialog === 'replace' && <ReplaceFileDialog file={file} onClose={close} />}
      {dialog === 'delete' && <DeleteFileDialog file={file} onClose={close} onDeleted={onDeleted} />}
    </>
  );
}

/** Selection for administrators: a tick box on each file. Shift-click ticks a whole range. */
export interface Selection {
  isSelected: (id: string) => boolean;
  toggle: (id: string, e: MouseEvent) => void;
}

function SelectBox({ file, selection, className }: { file: LibraryFile; selection: Selection; className?: string }) {
  const on = selection.isSelected(file.id);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={`Select ${file.name}`}
      onClick={(e) => selection.toggle(file.id, e)}
      className={cn(
        'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-2 transition-colors',
        on ? 'border-primary bg-primary text-white' : 'border-slate-300 bg-white hover:border-primary',
        className,
      )}
    >
      {on && <Check className="size-4" strokeWidth={3} />}
    </button>
  );
}

/** Columns shared by the heading row and every file row on wide screens (fixed widths keep them aligned). */
const gridFor = (admin: boolean, selectable: boolean) =>
  cn(
    '@4xl:grid @4xl:items-center @4xl:gap-4',
    selectable
      ? '@4xl:grid-cols-[1.5rem_minmax(0,1fr)_7.5rem_8rem_5rem_17rem]'
      : admin
        ? '@4xl:grid-cols-[minmax(0,1fr)_7.5rem_8rem_5rem_17rem]'
        : '@4xl:grid-cols-[minmax(0,1fr)_7.5rem_8rem_5rem_14.5rem]',
  );

function FolderTrail({ file }: { file: LibraryFile }) {
  if (!file.folderPath.length) return null;
  return (
    <Link
      to={`/folders/${file.folderId}`}
      className="mt-0.5 block truncate text-sm font-medium text-slate-600 hover:text-primary hover:underline"
      title={file.folderPath.map((p) => p.name).join(' › ')}
    >
      {file.folderPath.map((p) => p.name).join(' › ')}
    </Link>
  );
}

function Actions({ file, from, compact }: { file: LibraryFile; from: string; compact?: boolean }) {
  const { isAdmin } = useAuth();
  return (
    <>
      <Button asChild variant="outline" className={cn('h-10 flex-1 px-4 text-base', !compact && '@4xl:flex-none')} aria-label={`View ${file.name}`}>
        <Link to={`/files/${file.id}`} state={{ from }}>
          <Eye className="size-4" /> View
        </Link>
      </Button>
      <Button
        className={cn(
          'h-10 flex-1 bg-blue-50 px-4 text-base text-blue-700 shadow-none ring-1 ring-inset ring-blue-200 hover:bg-primary hover:text-white',
          !compact && '@4xl:flex-none',
        )}
        onClick={() => startDownload(file)}
        aria-label={`Download ${file.name}, ${file.type}, ${size(file.sizeBytes)}`}
      >
        <Download className="size-4" /> {compact ? <span className="sr-only sm:not-sr-only">Download</span> : 'Download'}
      </Button>
      {isAdmin && <FileAdminMenu file={file} />}
    </>
  );
}

/** One file. Wide screens: a table row. Phones: a stacked card. View/Download are always in the same place. */
export function FileRow({ file, showFolder, selection }: { file: LibraryFile; showFolder?: boolean; selection?: Selection }) {
  const { isAdmin } = useAuth();
  const location = useLocation();
  const from = location.pathname + location.search;
  const on = selection?.isSelected(file.id);
  return (
    <li className={cn('group px-4 py-4 transition-colors sm:px-5', on ? 'bg-blue-50/70' : 'hover:bg-slate-50', gridFor(isAdmin, !!selection))}>
      {selection && <SelectBox file={file} selection={selection} className="hidden @4xl:flex" />}
      <div className="flex min-w-0 items-start gap-3.5">
        {selection && <SelectBox file={file} selection={selection} className="mt-2 @4xl:hidden" />}
        <FileIcon ext={file.ext} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/files/${file.id}`}
              state={{ from }}
              className="text-base font-semibold leading-snug break-words text-foreground hover:text-primary hover:underline sm:text-lg"
            >
              {file.name}
            </Link>
            {file.isNew && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">New</span>}
          </div>
          {showFolder && <FolderTrail file={file} />}
          {/* Details shown inline on phones; in columns on wide screens. */}
          <div className="mt-0.5 text-sm text-slate-600 @4xl:hidden">
            Added {day(file.addedAt)} · {file.type} · {size(file.sizeBytes)}
          </div>
          {file.validUntil && (
            <div className="mt-1.5">
              <ValidityLabel file={file} compact />
            </div>
          )}
        </div>
      </div>
      <div className="hidden text-base text-slate-700 @4xl:block">{day(file.addedAt)}</div>
      <div className="hidden text-base text-slate-700 @4xl:block">{file.type}</div>
      <div className="hidden text-base text-slate-700 @4xl:block">{size(file.sizeBytes)}</div>
      <div className="mt-3 flex items-center gap-2 @4xl:mt-0 @4xl:justify-end">
        <Actions file={file} from={from} />
      </div>
    </li>
  );
}

/** A tidy list of files with column headings on wide screens. */
export function FileList({
  files,
  showFolder,
  selection,
  selectAll,
}: {
  files: LibraryFile[];
  showFolder?: boolean;
  selection?: Selection;
  /** Heading tick box: select or clear every file shown. */
  selectAll?: { checked: boolean | 'mixed'; onToggle: () => void };
}) {
  const { isAdmin } = useAuth();
  return (
    <div className="@container overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,27,51,0.05)]">
      <div className={cn('hidden border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-sm font-semibold text-slate-600', gridFor(isAdmin, !!selection))}>
        {selection && selectAll && (
          <button
            type="button"
            role="checkbox"
            aria-checked={selectAll.checked}
            aria-label="Select all files shown"
            onClick={selectAll.onToggle}
            className={cn(
              'flex size-6 cursor-pointer items-center justify-center rounded-md border-2',
              selectAll.checked ? 'border-primary bg-primary text-white' : 'border-slate-300 bg-white hover:border-primary',
            )}
          >
            {selectAll.checked === true && <Check className="size-4" strokeWidth={3} />}
            {selectAll.checked === 'mixed' && <span className="h-0.5 w-3 rounded bg-white" />}
          </button>
        )}
        <span aria-hidden>Name</span>
        <span aria-hidden>Date added</span>
        <span aria-hidden>Type</span>
        <span aria-hidden>Size</span>
        <span />
      </div>
      <ul className="divide-y divide-slate-200">
        {files.map((f) => (
          <FileRow key={f.id} file={f} showFolder={showFolder} selection={selection} />
        ))}
      </ul>
    </div>
  );
}

/** Grid of document cards: easier to scan by type at a glance. */
export function FileGrid({ files, showFolder, selection }: { files: LibraryFile[]; showFolder?: boolean; selection?: Selection }) {
  const location = useLocation();
  const from = location.pathname + location.search;
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {files.map((file) => {
        const on = selection?.isSelected(file.id);
        return (
          <li
            key={file.id}
            className={cn(
              'flex flex-col rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(15,27,51,0.05)] transition-all',
              on ? 'border-primary ring-2 ring-primary/30' : 'border-slate-200 hover:border-primary/40 hover:shadow-md',
            )}
          >
            <div className="flex items-start gap-3">
              <FileIcon ext={file.ext} className="size-12 [&_svg]:size-6" />
              <div className="min-w-0 flex-1">
                <Link
                  to={`/files/${file.id}`}
                  state={{ from }}
                  className="line-clamp-2 text-base font-semibold leading-snug break-words text-foreground hover:text-primary hover:underline"
                  title={file.name}
                >
                  {file.name}
                </Link>
                <div className="mt-0.5 text-sm text-slate-600">
                  {file.type} · {size(file.sizeBytes)}
                </div>
              </div>
              {selection && <SelectBox file={file} selection={selection} />}
            </div>
            {showFolder && <FolderTrail file={file} />}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <span>Added {day(file.addedAt)}</span>
              {file.isNew && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">New</span>}
            </div>
            {file.validUntil && (
              <div className="mt-2">
                <ValidityLabel file={file} compact />
              </div>
            )}
            <div className="mt-auto flex items-center gap-2 pt-4">
              <Actions file={file} from={from} compact />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
