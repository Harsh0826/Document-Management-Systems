import { Award, Pencil, Plus, Shapes, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { applyFieldErrors, errorMessage } from '@/api/client';
import { useCategories, useDeleteCategory, useSaveCategory } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/card';
import { Field, Input, Switch, Textarea } from '@/components/ui/form-controls';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from '@/components/ui/overlays';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import type { Category } from '@/lib/types';

interface FormValues {
  name: string;
  description: string;
  isCertificate: boolean;
  requiresExpiry: boolean;
  sortOrder: number;
}

function CategoryDialog({ cat, onClose }: { cat: Category | null; onClose: () => void }) {
  const save = useSaveCategory();
  const form = useForm<FormValues>();
  useEffect(() => {
    form.reset(cat ? { name: cat.name, description: cat.description ?? '', isCertificate: cat.isCertificate, requiresExpiry: cat.requiresExpiry, sortOrder: cat.sortOrder } : { name: '', description: '', isCertificate: true, requiresExpiry: false, sortOrder: 50 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat]);
  const onSubmit = form.handleSubmit((v) => {
    if (!v.name.trim()) return form.setError('name', { message: 'Required' });
    save.mutate(
      { id: cat?.id, name: v.name.trim(), description: v.description || null, isCertificate: v.isCertificate, requiresExpiry: v.requiresExpiry, sortOrder: Number(v.sortOrder) || 0 },
      { onSuccess: () => (toast.success('Category saved'), onClose()), onError: (e) => !applyFieldErrors(e, form.setError) && toast.error(errorMessage(e)) },
    );
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={cat ? 'Edit category' : 'New category'} size="md">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Name" required error={form.formState.errors.name?.message}><Input {...form.register('name')} /></Field>
          <Field label="Description"><Textarea rows={2} {...form.register('description')} /></Field>
          <Field label="Sort order"><Input type="number" min={0} max={1000} {...form.register('sortOrder')} /></Field>
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            <span><span className="font-medium">Certificate</span><span className="block text-xs text-muted-foreground">Counts as a certificate for compliance tracking</span></span>
            <Switch checked={form.watch('isCertificate')} onCheckedChange={(c) => form.setValue('isCertificate', c)} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            <span><span className="font-medium">Requires expiration date</span><span className="block text-xs text-muted-foreground">Uploads must include an expiry date</span></span>
            <Switch checked={form.watch('requiresExpiry')} onCheckedChange={(c) => form.setValue('requiresExpiry', c)} />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function CategoriesPage() {
  const { data } = useCategories();
  const del = useDeleteCategory();
  const [editing, setEditing] = useState<Category | null | 'new'>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  return (
    <>
      <PageHeader title="Document categories" description="Categories organise documents into folders and control expiry requirements." actions={<Button onClick={() => setEditing('new')}><Plus /> New category</Button>} />
      <Card className="overflow-hidden">
        {!data?.length ? (
          <EmptyState icon={<Shapes />} title="No categories" />
        ) : (
          <Table>
            <THead><tr><TH>Name</TH><TH>Type</TH><TH>Expiry</TH><TH className="text-center">Documents</TH><TH className="w-24" /></tr></THead>
            <TBody>
              {data.map((c) => (
                <TR key={c.id}>
                  <TD><div className="font-medium">{c.name}</div>{c.description && <div className="text-xs text-muted-foreground">{c.description}</div>}</TD>
                  <TD>{c.isCertificate ? <Badge tone="violet"><Award className="size-3" /> Certificate</Badge> : <Badge>Document</Badge>}</TD>
                  <TD className="text-muted-foreground">{c.requiresExpiry ? 'Required' : 'Optional'}</TD>
                  <TD className="text-center tabular-nums">{c.documentCount}</TD>
                  <TD>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`}><Pencil /></Button>
                      <Button variant="ghost" size="icon-sm" className="text-destructive" onClick={() => setDeleting(c)} aria-label={`Delete ${c.name}`}><Trash2 /></Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {editing && <CategoryDialog cat={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        tone="destructive"
        title={`Delete “${deleting?.name}”?`}
        description={deleting?.documentCount ? `This category is used by ${deleting.documentCount} document(s) and cannot be deleted until they are recategorized.` : 'This category will be removed.'}
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id, { onSuccess: () => (toast.success('Category deleted'), setDeleting(null)), onError: (e) => (toast.error(errorMessage(e)), setDeleting(null)) })}
      />
    </>
  );
}
