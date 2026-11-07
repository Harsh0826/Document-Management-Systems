import { FileSearch, GripVertical } from 'lucide-react';
import type { DragEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Skeleton, EmptyState } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/form-controls';
import { SortableTH, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import type { DocumentItem } from '@/lib/types';
import { cn, fmtDate } from '@/lib/utils';
import { DND_MIME } from '../folders/FolderTree';
import { DocumentActions } from './DocumentActions';
import { ExpiryText, FileIcon, StatusBadge } from './status';

export type Column = 'employee' | 'client' | 'category' | 'fileType' | 'uploadedAt' | 'expiryDate' | 'uploadedBy' | 'status';

export function DocumentTable({
  items,
  loading,
  columns = ['employee', 'category', 'fileType', 'uploadedAt', 'expiryDate', 'uploadedBy', 'status'],
  sort,
  order,
  onSort,
  selected,
  onSelectedChange,
  draggable,
  empty,
}: {
  items: DocumentItem[] | undefined;
  loading?: boolean;
  columns?: Column[];
  sort?: string;
  order?: 'asc' | 'desc';
  onSort?: (field: string) => void;
  selected?: Set<string>;
  onSelectedChange?: (s: Set<string>) => void;
  draggable?: boolean;
  empty?: ReactNode;
}) {
  const navigate = useNavigate();
  const has = (c: Column) => columns.includes(c);
  const selectable = !!selected && !!onSelectedChange;
  const allSelected = !!items?.length && items.every((d) => selected?.has(d.id));
  const someSelected = !!items?.some((d) => selected?.has(d.id));

  const toggleAll = () => {
    if (!onSelectedChange || !items) return;
    const next = new Set(selected);
    if (allSelected) items.forEach((d) => next.delete(d.id));
    else items.forEach((d) => next.add(d.id));
    onSelectedChange(next);
  };
  const toggle = (id: string) => {
    if (!onSelectedChange) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  };

  const onDragStart = (e: DragEvent, d: DocumentItem) => {
    const ids = selected?.has(d.id) ? [...selected] : [d.id];
    e.dataTransfer.setData(DND_MIME, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
    const ghost = document.createElement('div');
    ghost.textContent = ids.length > 1 ? `${ids.length} documents` : d.title;
    ghost.className = 'fixed -top-10 rounded-md bg-navy px-3 py-1.5 text-sm text-white shadow-lg';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 10, 10);
    setTimeout(() => ghost.remove(), 0);
  };

  const sortTh = (label: string, field: string, className?: string) =>
    onSort ? <SortableTH label={label} field={field} sort={sort} order={order} onSort={onSort} className={className} /> : <TH className={className}>{label}</TH>;

  return (
    <Table>
      <THead>
        <tr>
          {selectable && (
            <TH className="w-10 pr-0">
              <Checkbox checked={allSelected ? true : someSelected ? 'indeterminate' : false} onCheckedChange={toggleAll} aria-label="Select all" />
            </TH>
          )}
          {sortTh('Document', 'title', 'min-w-64')}
          {has('employee') && sortTh('Employee', 'employee')}
          {has('client') && sortTh('Client', 'client')}
          {has('category') && sortTh('Category', 'category')}
          {has('fileType') && sortTh('Type', 'fileType')}
          {has('uploadedAt') && sortTh('Uploaded', 'uploadedAt')}
          {has('expiryDate') && sortTh('Expires', 'expiryDate')}
          {has('uploadedBy') && <TH>Uploaded by</TH>}
          {has('status') && sortTh('Status', 'status')}
          <TH className="w-12 text-right">
            <span className="sr-only">Actions</span>
          </TH>
        </tr>
      </THead>
      <TBody>
        {loading && !items
          ? Array.from({ length: 6 }).map((_, i) => (
              <TR key={i}>
                <TD colSpan={columns.length + 3}>
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-9 rounded-lg" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-1/3" />
                      <Skeleton className="h-3 w-1/5" />
                    </div>
                  </div>
                </TD>
              </TR>
            ))
          : items?.map((d) => (
              <TR
                key={d.id}
                data-selected={selected?.has(d.id)}
                draggable={draggable && d.can.move}
                onDragStart={(e) => onDragStart(e, d)}
                className={cn('cursor-pointer', d.isArchived && 'opacity-60')}
                onClick={() => navigate(`/documents/${d.id}`)}
              >
                {selectable && (
                  <TD className="w-10 pr-0" onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={selected!.has(d.id)} onCheckedChange={() => toggle(d.id)} aria-label={`Select ${d.title}`} />
                  </TD>
                )}
                <TD>
                  <div className="flex items-center gap-3">
                    {draggable && d.can.move && <GripVertical className="-ml-2 size-4 shrink-0 cursor-grab text-slate-300" aria-hidden />}
                    <FileIcon ext={d.file?.ext} />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">{d.title}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {d.file?.filename}
                        {d.file && d.file.versionNumber > 1 && <span className="ml-1.5 rounded bg-slate-100 px-1 py-px text-[10px] font-medium text-slate-600">v{d.file.versionNumber}</span>}
                        {d.isArchived && <span className="ml-1.5 rounded bg-slate-200 px-1 py-px text-[10px] font-medium text-slate-700">Archived</span>}
                      </div>
                    </div>
                  </div>
                </TD>
                {has('employee') && (
                  <TD>
                    <div className="whitespace-nowrap font-medium">{d.employeeName}</div>
                    {d.employeeNumber && <div className="text-xs text-muted-foreground">{d.employeeNumber}</div>}
                  </TD>
                )}
                {has('client') && <TD className="whitespace-nowrap">{d.clientName}</TD>}
                {has('category') && <TD className="whitespace-nowrap text-muted-foreground">{d.categoryName ?? 'Uncategorized'}</TD>}
                {has('fileType') && <TD className="text-xs font-semibold uppercase text-muted-foreground">{d.file?.ext}</TD>}
                {has('uploadedAt') && <TD className="whitespace-nowrap text-muted-foreground">{fmtDate(d.uploadedAt)}</TD>}
                {has('expiryDate') && (
                  <TD>
                    <ExpiryText date={d.expiryDate} days={d.daysToExpiry} status={d.status} />
                  </TD>
                )}
                {has('uploadedBy') && <TD className="whitespace-nowrap text-muted-foreground">{d.uploadedByName ?? '—'}</TD>}
                {has('status') && (
                  <TD>
                    <StatusBadge status={d.status} />
                  </TD>
                )}
                <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                  <DocumentActions doc={d} />
                </TD>
              </TR>
            ))}
        {!loading && items?.length === 0 && (
          <tr>
            <td colSpan={columns.length + 3}>{empty ?? <EmptyState icon={<FileSearch />} title="No documents found" description="Try adjusting your search or filters." />}</td>
          </tr>
        )}
      </TBody>
    </Table>
  );
}
