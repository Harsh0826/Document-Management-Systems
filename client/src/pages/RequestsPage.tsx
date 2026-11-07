import { zodResolver } from '@hookform/resolvers/zod';
import { ClipboardList, Plus, Upload } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { applyFieldErrors, errorMessage } from '@/api/client';
import { useCancelRequest, useCategories, useCreateRequest, useEmployees, useRequests } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/card';
import { Checkbox, Field, Input, NativeSelect, Textarea } from '@/components/ui/form-controls';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, Tabs, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { Pagination, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import type { DocumentRequest } from '@/lib/types';
import { fmtDate, todayIso } from '@/lib/utils';

const schema = z.object({
  title: z.string().trim().min(1, 'Required').max(200),
  categoryId: z.string().optional(),
  instructions: z.string().max(2000).optional(),
  dueDate: z.string().optional().refine((v) => !v || v >= todayIso(), 'Due date cannot be in the past'),
});

export function NewRequestDialog({ open, onOpenChange, preselected = [] }: { open: boolean; onOpenChange: (o: boolean) => void; preselected?: string[] }) {
  const { data: categories } = useCategories();
  const { data: employees } = useEmployees({}, open);
  const [selected, setSelected] = useState<Set<string>>(new Set(preselected));
  const [q, setQ] = useState('');
  const create = useCreateRequest();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { title: '', categoryId: '', instructions: '', dueDate: '' } });
  const list = (employees?.items ?? []).filter((e) => `${e.firstName} ${e.lastName} ${e.clientName}`.toLowerCase().includes(q.toLowerCase()));

  const onSubmit = form.handleSubmit((v) => {
    if (!selected.size) return toast.error('Select at least one employee');
    create.mutate(
      { employeeIds: [...selected], title: v.title, categoryId: v.categoryId || null, instructions: v.instructions || undefined, dueDate: v.dueDate || undefined },
      {
        onSuccess: (r) => {
          toast.success(`Request sent to ${r.length} employee${r.length > 1 ? 's' : ''}`);
          onOpenChange(false);
          form.reset();
          setSelected(new Set());
        },
        onError: (e) => !applyFieldErrors(e, form.setError) && toast.error(errorMessage(e)),
      },
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Request a document" description="Employees are notified and the request appears on their dashboard." size="lg">
        <form onSubmit={onSubmit} className="grid gap-5 md:grid-cols-2" noValidate>
          <div className="space-y-4">
            <Field label="What is needed?" required error={form.formState.errors.title?.message}>
              <Input placeholder="e.g. Updated First Aid certificate" {...form.register('title')} />
            </Field>
            <Field label="Category" hint="Uploads in this category automatically fulfil the request.">
              <NativeSelect {...form.register('categoryId')}>
                <option value="">Any</option>
                {categories?.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Due date" error={form.formState.errors.dueDate?.message}>
              <Input type="date" min={todayIso()} {...form.register('dueDate')} />
            </Field>
            <Field label="Instructions">
              <Textarea rows={3} placeholder="Optional details for the employee" {...form.register('instructions')} />
            </Field>
          </div>
          <div className="flex min-h-0 flex-col">
            <Field label={`Employees (${selected.size} selected)`} required>
              <Input placeholder="Filter employees…" value={q} onChange={(e) => setQ(e.target.value)} />
            </Field>
            <div className="scroll-thin mt-2 max-h-72 flex-1 overflow-y-auto rounded-lg border">
              {list.map((e) => (
                <label key={e.id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-0 hover:bg-muted/50">
                  <Checkbox
                    checked={selected.has(e.id)}
                    onCheckedChange={() => {
                      const n = new Set(selected);
                      if (n.has(e.id)) n.delete(e.id);
                      else n.add(e.id);
                      setSelected(n);
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{e.firstName} {e.lastName}</span>
                    <span className="block truncate text-xs text-muted-foreground">{e.clientName}</span>
                  </span>
                </label>
              ))}
              {!list.length && <p className="p-4 text-sm text-muted-foreground">No employees found.</p>}
            </div>
          </div>
          <div className="md:col-span-2">
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" loading={create.isPending}>Send request</Button>
            </DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_TONE = { open: 'amber', fulfilled: 'green', cancelled: 'slate' } as const;

export default function RequestsPage() {
  const { isEmployee, can } = useAuth();
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useRequests({ status: status === 'all' ? undefined : status, page, pageSize: 20 });
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<DocumentRequest | null>(null);
  const cancel = useCancelRequest();

  return (
    <>
      <PageHeader
        title={isEmployee ? 'My document requests' : 'Document requests'}
        description={isEmployee ? 'Documents your organisation has asked you to provide.' : 'Ask employees for missing documents and track what is outstanding.'}
        actions={can('requests.manage') && <Button onClick={() => setCreating(true)}><Plus /> New request</Button>}
      />
      <Tabs value={status} onValueChange={(v) => (setStatus(v), setPage(1))}>
        <TabsList className="mb-4">
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="fulfilled">Fulfilled</TabsTrigger>
          <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>
      <Card className="overflow-hidden">
        {!isLoading && !data?.items.length ? (
          <EmptyState icon={<ClipboardList />} title={status === 'open' ? 'No open requests' : 'No requests'} description={isEmployee ? 'You are all set.' : 'Requests you send will appear here.'} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Request</TH>
                {!isEmployee && <TH>Employee</TH>}
                <TH>Category</TH>
                <TH>Due</TH>
                <TH>Status</TH>
                <TH>Requested by</TH>
                <TH className="text-right">Action</TH>
              </tr>
            </THead>
            <TBody>
              {data?.items.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <div className="font-medium">{r.title}</div>
                    {r.instructions && <div className="max-w-md truncate text-xs text-muted-foreground">{r.instructions}</div>}
                  </TD>
                  {!isEmployee && (
                    <TD>
                      <div className="font-medium">{r.employeeName}</div>
                      <div className="text-xs text-muted-foreground">{r.clientName}</div>
                    </TD>
                  )}
                  <TD className="text-muted-foreground">{r.categoryName ?? 'Any'}</TD>
                  <TD>
                    {r.dueDate ? (
                      <span className={r.status === 'open' && (r.daysUntilDue ?? 0) < 0 ? 'font-medium text-red-600' : ''}>
                        {fmtDate(r.dueDate)}
                        {r.status === 'open' && (r.daysUntilDue ?? 0) < 0 && <span className="block text-xs">Overdue</span>}
                      </span>
                    ) : (
                      '—'
                    )}
                  </TD>
                  <TD>
                    <Badge tone={STATUS_TONE[r.status]}>{r.status[0].toUpperCase() + r.status.slice(1)}</Badge>
                  </TD>
                  <TD className="text-muted-foreground">
                    {r.requestedByName ?? '—'}
                    <div className="text-xs">{fmtDate(r.createdAt)}</div>
                  </TD>
                  <TD className="text-right">
                    {r.status === 'open' && isEmployee && (
                      <Button size="sm" asChild>
                        <Link to={`/upload?requestId=${r.id}&title=${encodeURIComponent(r.title)}${r.categoryId ? `&categoryId=${r.categoryId}` : ''}`}>
                          <Upload /> Upload
                        </Link>
                      </Button>
                    )}
                    {r.status === 'open' && can('requests.manage') && (
                      <Button size="sm" variant="ghost" onClick={() => setCancelling(r)}>Cancel</Button>
                    )}
                    {r.status === 'fulfilled' && r.fulfilledDocumentId && (
                      <Button size="sm" variant="link" asChild>
                        <Link to={`/documents/${r.fulfilledDocumentId}`}>View document</Link>
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {data && data.total > 20 && <Pagination page={page} pageSize={20} total={data.total} onPage={setPage} />}
      </Card>
      {creating && <NewRequestDialog open onOpenChange={setCreating} />}
      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancel this request?"
        description={cancelling ? `“${cancelling.title}” for ${cancelling.employeeName} will be closed.` : ''}
        confirmLabel="Cancel request"
        tone="destructive"
        loading={cancel.isPending}
        onConfirm={() => cancelling && cancel.mutate(cancelling.id, { onSuccess: () => (toast.success('Request cancelled'), setCancelling(null)), onError: (e) => toast.error(errorMessage(e)) })}
      />
    </>
  );
}
