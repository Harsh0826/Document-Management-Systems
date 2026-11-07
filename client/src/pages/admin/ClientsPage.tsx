import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, FileStack, Pencil, Plus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { applyFieldErrors, errorMessage } from '@/api/client';
import { useClients, useSaveClient } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/card';
import { Field, Input, Switch } from '@/components/ui/form-controls';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlays';
import type { Client } from '@/lib/types';

const schema = z.object({
  name: z.string().trim().min(1, 'Required').max(200),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/, '2–20 letters, digits or dashes'),
  industry: z.string().max(100).optional(),
  contactEmail: z.union([z.string().email('Invalid email'), z.literal('')]).optional(),
  isActive: z.boolean().optional(),
});

function ClientDialog({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const save = useSaveClient();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  useEffect(() => {
    form.reset(client ? { name: client.name, code: client.code, industry: client.industry ?? '', contactEmail: client.contactEmail ?? '', isActive: client.isActive } : { name: '', code: '', industry: '', contactEmail: '', isActive: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);
  const onSubmit = form.handleSubmit((v) =>
    save.mutate(
      { id: client?.id, ...v, industry: v.industry || null, contactEmail: v.contactEmail || null },
      { onSuccess: () => (toast.success(client ? 'Client updated' : 'Client created with its root folder'), onClose()), onError: (e) => !applyFieldErrors(e, form.setError) && toast.error(errorMessage(e)) },
    ),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={client ? 'Edit client' : 'New client'} size="md">
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
          <Field label="Company name" required error={form.formState.errors.name?.message} className="sm:col-span-2"><Input {...form.register('name')} /></Field>
          <Field label="Code" required hint="Short unique code, e.g. ACME" error={form.formState.errors.code?.message}><Input className="uppercase" {...form.register('code')} /></Field>
          <Field label="Industry"><Input {...form.register('industry')} /></Field>
          <Field label="Contact email" error={form.formState.errors.contactEmail?.message} className="sm:col-span-2"><Input type="email" {...form.register('contactEmail')} /></Field>
          {client && (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Switch checked={form.watch('isActive')} onCheckedChange={(c) => form.setValue('isActive', c)} /> Active
            </label>
          )}
          <div className="sm:col-span-2">
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" loading={save.isPending}>{client ? 'Save' : 'Create client'}</Button>
            </DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ClientsPage() {
  const { data, isLoading } = useClients(true);
  const [editing, setEditing] = useState<Client | null | 'new'>(null);
  return (
    <>
      <PageHeader title="Clients" description="Companies whose employee documents you manage. Each client's data is isolated." actions={<Button onClick={() => setEditing('new')}><Plus /> New client</Button>} />
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-44" />)}</div>
      ) : !data?.length ? (
        <Card><EmptyState icon={<Building2 />} title="No clients yet" description="Create your first client to start adding employees." action={<Button onClick={() => setEditing('new')}><Plus /> New client</Button>} /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((c) => (
            <Card key={c.id} className="p-5 transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-navy text-white"><Building2 className="size-5" /></span>
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{c.name}</div>
                    <div className="text-xs text-muted-foreground"><span className="font-mono">{c.code}</span>{c.industry && ` · ${c.industry}`}</div>
                  </div>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`}><Pencil /></Button>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                <Link to={`/employees`} className="rounded-lg bg-muted/60 p-2 hover:bg-muted"><Users className="mx-auto size-4 text-muted-foreground" /><div className="mt-1 font-semibold tabular-nums">{c.employeeCount}</div><div className="text-[11px] text-muted-foreground">Employees</div></Link>
                <Link to={`/documents?clientId=${c.id}`} className="rounded-lg bg-muted/60 p-2 hover:bg-muted"><FileStack className="mx-auto size-4 text-muted-foreground" /><div className="mt-1 font-semibold tabular-nums">{c.documentCount}</div><div className="text-[11px] text-muted-foreground">Documents</div></Link>
                <Link to={`/documents?clientId=${c.id}&status=pending_review`} className="rounded-lg bg-muted/60 p-2 hover:bg-muted"><div className="mx-auto size-4" /><div className="mt-1 font-semibold tabular-nums text-amber-600">{c.pendingCount}</div><div className="text-[11px] text-muted-foreground">Pending</div></Link>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                <span>{c.staffCount} staff assigned</span>
                {!c.isActive && <Badge>Inactive</Badge>}
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && <ClientDialog client={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
