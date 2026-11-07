import { Filter, Search, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useCategories, useClients, useEmployees, useUsers, type DocumentFilters } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect } from '@/components/ui/form-controls';
import { MultiSelect } from '@/components/ui/multi-select';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { FILE_TYPE_OPTIONS, STATUS_OPTIONS } from './status';

const FILTER_KEYS: (keyof DocumentFilters)[] = ['clientId', 'employeeId', 'categoryId', 'fileType', 'status', 'uploadedBy', 'uploadedFrom', 'uploadedTo', 'expiryFrom', 'expiryTo', 'expiringWithin', 'archived'];

export function activeFilterCount(f: DocumentFilters) {
  return FILTER_KEYS.filter((k) => {
    const v = f[k];
    if (k === 'archived') return v && v !== 'exclude';
    return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== '';
  }).length;
}

export function DocumentFiltersBar({ value, onChange, hide = [] }: { value: DocumentFilters; onChange: (f: DocumentFilters) => void; hide?: (keyof DocumentFilters)[] }) {
  const { isEmployee, isAdmin, user, can } = useAuth();
  const [q, setQ] = useState(value.q ?? '');
  const [open, setOpen] = useState(activeFilterCount(value) > 0);
  const { data: categories } = useCategories();
  const { data: clients } = useClients();
  const { data: employees } = useEmployees({ clientId: value.clientId }, !isEmployee);
  const { data: users } = useUsers({ pageSize: 100, status: 'active' }, can('users.manage'));
  const set = (patch: Partial<DocumentFilters>) => onChange({ ...value, ...patch, page: 1 });
  const show = (k: keyof DocumentFilters) => !hide.includes(k);
  const count = activeFilterCount(value);

  useEffect(() => setQ(value.q ?? ''), [value.q]);

  // Instant results while typing (debounced); the button submits immediately.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((value.q ?? '') !== q.trim()) set({ q: q.trim() || undefined });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    set({ q: q.trim() || undefined });
  };

  const clearAll = () => {
    setQ('');
    onChange({ page: 1, pageSize: value.pageSize, sort: value.sort, order: value.order, folderId: value.folderId, includeSubfolders: value.includeSubfolders });
  };

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="flex flex-wrap gap-2" role="search">
        <div className="relative min-w-0 flex-1 basis-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={isEmployee ? 'Search by title, file name or certificate type…' : 'Search by file name, title, employee or certificate type…'}
            className="h-10 pl-9 pr-9"
            aria-label="Search documents"
          />
          {q && (
            <button type="button" onClick={() => (setQ(''), set({ q: undefined }))} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Clear search">
              <X className="size-4" />
            </button>
          )}
        </div>
        <Button type="submit" className="h-10">
          <Search /> Search
        </Button>
        <Button type="button" variant="outline" className={cn('h-10', count > 0 && 'border-primary/40 text-primary')} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Filter /> Filters
          {count > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-white">{count}</span>}
        </Button>
        {(count > 0 || value.q) && (
          <Button type="button" variant="ghost" className="h-10" onClick={clearAll}>
            <X /> Clear all
          </Button>
        )}
      </form>

      {open && (
        <div className="grid gap-3 rounded-xl border bg-card p-4 shadow-xs animate-in sm:grid-cols-2 lg:grid-cols-4">
          {show('clientId') && !isEmployee && (clients?.length ?? 0) > 1 && (
            <Field label="Client / company">
              <NativeSelect value={value.clientId ?? ''} onChange={(e) => set({ clientId: e.target.value || undefined, employeeId: undefined })}>
                <option value="">All clients</option>
                {clients?.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </NativeSelect>
            </Field>
          )}
          {show('employeeId') && !isEmployee && (
            <Field label="Employee">
              <NativeSelect value={value.employeeId ?? ''} onChange={(e) => set({ employeeId: e.target.value || undefined })}>
                <option value="">All employees</option>
                {employees?.items.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.firstName} {e.lastName}
                    {e.employeeNumber ? ` (${e.employeeNumber})` : ''}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          {show('categoryId') && (
            <Field label="Category">
              <MultiSelect label="Category" options={(categories ?? []).map((c) => ({ value: c.id, label: c.name }))} value={value.categoryId ?? []} onChange={(v) => set({ categoryId: v })} />
            </Field>
          )}
          {show('status') && (
            <Field label="Approval status">
              <MultiSelect label="Status" options={STATUS_OPTIONS} value={value.status ?? []} onChange={(v) => set({ status: v })} />
            </Field>
          )}
          {show('fileType') && (
            <Field label="File type">
              <MultiSelect label="Type" options={FILE_TYPE_OPTIONS} value={value.fileType ?? []} onChange={(v) => set({ fileType: v })} />
            </Field>
          )}
          {show('uploadedBy') && (
            <Field label="Uploaded by">
              <NativeSelect value={value.uploadedBy ?? ''} onChange={(e) => set({ uploadedBy: e.target.value || undefined })}>
                <option value="">Anyone</option>
                <option value={user?.id}>Me</option>
                {isAdmin &&
                  users?.items
                    .filter((u) => u.id !== user?.id)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.firstName} {u.lastName} ({u.role})
                      </option>
                    ))}
              </NativeSelect>
            </Field>
          )}
          {show('uploadedFrom') && (
            <Field label="Uploaded between">
              <div className="flex items-center gap-1.5">
                <Input type="date" value={value.uploadedFrom ?? ''} onChange={(e) => set({ uploadedFrom: e.target.value || undefined })} aria-label="Uploaded from" />
                <span className="text-muted-foreground">–</span>
                <Input type="date" value={value.uploadedTo ?? ''} onChange={(e) => set({ uploadedTo: e.target.value || undefined })} aria-label="Uploaded to" />
              </div>
            </Field>
          )}
          {show('expiryFrom') && (
            <Field label="Expires between">
              <div className="flex items-center gap-1.5">
                <Input type="date" value={value.expiryFrom ?? ''} onChange={(e) => set({ expiryFrom: e.target.value || undefined })} aria-label="Expires from" />
                <span className="text-muted-foreground">–</span>
                <Input type="date" value={value.expiryTo ?? ''} onChange={(e) => set({ expiryTo: e.target.value || undefined })} aria-label="Expires to" />
              </div>
            </Field>
          )}
          {show('expiringWithin') && (
            <Field label="Expiring within">
              <NativeSelect value={value.expiringWithin ?? ''} onChange={(e) => set({ expiringWithin: e.target.value ? Number(e.target.value) : undefined })}>
                <option value="">Any time</option>
                <option value="30">30 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
              </NativeSelect>
            </Field>
          )}
          {show('archived') && (
            <Field label="Archived">
              <NativeSelect value={value.archived ?? 'exclude'} onChange={(e) => set({ archived: e.target.value as DocumentFilters['archived'] })}>
                <option value="exclude">Hide archived</option>
                <option value="include">Include archived</option>
                <option value="only">Only archived</option>
              </NativeSelect>
            </Field>
          )}
        </div>
      )}
    </div>
  );
}
