import { CheckCircle2, CircleAlert, FileWarning, Info, Trash2, UploadCloud } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { apiError } from '@/api/client';
import { uploadDocument, useCategories, useClients, useEmployees, useInvalidateDocuments } from '@/api/hooks';
import { validateFile } from '@/components/documents/dialogs';
import { ACCEPT_ATTR, FileIcon, MAX_UPLOAD_MB } from '@/components/documents/status';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, PageHeader, Progress } from '@/components/ui/card';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth';
import { cn, fmtBytes } from '@/lib/utils';

interface Item {
  key: string;
  file: File;
  title: string;
  description: string;
  categoryId: string;
  issueDate: string;
  expiryDate: string;
  status: 'ready' | 'uploading' | 'done' | 'error';
  progress: number;
  error?: string;
  fieldErrors?: Record<string, string>;
  documentId?: string;
}

const titleFromName = (n: string) =>
  n
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 200) || 'Untitled document';

const CONCURRENCY = 3;

export default function UploadPage() {
  const { isEmployee } = useAuth();
  const [params] = useSearchParams();
  const { data: categories } = useCategories();
  const { data: clients } = useClients();
  const [clientId, setClientId] = useState('');
  const { data: employees } = useEmployees({ clientId: clientId || undefined }, !isEmployee);
  const [employeeId, setEmployeeId] = useState(params.get('employeeId') ?? '');
  const [defaultCategory, setDefaultCategory] = useState(params.get('categoryId') ?? '');
  const requestId = params.get('requestId') ?? undefined;
  const [items, setItems] = useState<Item[]>([]);
  const [rejected, setRejected] = useState<{ name: string; reason: string }[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const invalidate = useInvalidateDocuments();
  const catById = useMemo(() => new Map((categories ?? []).map((c) => [c.id, c])), [categories]);

  const addFiles = (files: FileList | File[]) => {
    const ok: Item[] = [];
    const bad: { name: string; reason: string }[] = [];
    for (const f of Array.from(files)) {
      const err = validateFile(f);
      if (err) bad.push({ name: f.name, reason: err });
      else
        ok.push({
          key: `${f.name}-${f.size}-${f.lastModified}-${Math.random()}`,
          file: f,
          title: params.get('title') && items.length + ok.length === 0 ? params.get('title')! : titleFromName(f.name),
          description: '',
          categoryId: defaultCategory,
          issueDate: '',
          expiryDate: '',
          status: 'ready',
          progress: 0,
        });
    }
    setItems((cur) => [...cur, ...ok]);
    setRejected(bad);
    if (bad.length) toast.error(`${bad.length} file${bad.length > 1 ? 's were' : ' was'} not added`);
  };

  const update = (key: string, patch: Partial<Item>) => setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const remove = (key: string) => setItems((cur) => cur.filter((i) => i.key !== key));

  const validate = (i: Item): Record<string, string> | null => {
    const e: Record<string, string> = {};
    if (!i.title.trim()) e.title = 'Title is required';
    const cat = catById.get(i.categoryId);
    if (cat?.requiresExpiry && !i.expiryDate) e.expiryDate = `${cat.name} require an expiration date`;
    if (i.issueDate && i.expiryDate && i.expiryDate < i.issueDate) e.expiryDate = 'Must be after the issue date';
    return Object.keys(e).length ? e : null;
  };

  const uploadAll = async () => {
    if (!isEmployee && !employeeId) return toast.error('Select the employee these documents belong to');
    const pending = items.filter((i) => i.status === 'ready' || i.status === 'error');
    let invalid = 0;
    for (const i of pending) {
      const e = validate(i);
      update(i.key, { fieldErrors: e ?? undefined });
      if (e) invalid++;
    }
    if (invalid) return toast.error('Please fix the highlighted fields');

    setBusy(true);
    let ok = 0;
    let failed = 0;
    const queue = [...pending];
    let first = true;
    const worker = async () => {
      while (queue.length) {
        const i = queue.shift()!;
        update(i.key, { status: 'uploading', progress: 0, error: undefined });
        try {
          const doc = await uploadDocument(
            {
              file: i.file,
              title: i.title.trim(),
              description: i.description.trim() || undefined,
              categoryId: i.categoryId || undefined,
              employeeId: isEmployee ? undefined : employeeId,
              issueDate: i.issueDate || undefined,
              expiryDate: i.expiryDate || undefined,
              requestId: first ? requestId : undefined,
            },
            (p) => update(i.key, { progress: p }),
          );
          first = false;
          ok++;
          update(i.key, { status: 'done', progress: 100, documentId: doc.id });
        } catch (err) {
          failed++;
          const e = apiError(err);
          update(i.key, { status: 'error', error: e.message, fieldErrors: e.details?.fields });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    setBusy(false);
    await invalidate();
    if (ok) toast.success(`${ok} document${ok > 1 ? 's' : ''} uploaded and sent for review`);
    if (failed) toast.error(`${failed} upload${failed > 1 ? 's' : ''} failed — see details below`);
  };

  const readyCount = items.filter((i) => i.status === 'ready' || i.status === 'error').length;
  const doneCount = items.filter((i) => i.status === 'done').length;

  return (
    <>
      <PageHeader title="Upload documents" description="Drag and drop one or more files. Each document is reviewed before it is approved." />

      {requestId && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900">
          <Info className="mt-0.5 size-4 shrink-0" />
          <div>
            You are responding to a document request{params.get('title') ? `: “${params.get('title')}”` : ''}. The first uploaded file will fulfil it.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              addFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label="Choose files to upload"
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-card px-6 py-12 text-center transition-all',
              over ? 'scale-[1.01] border-primary bg-accent' : 'border-slate-300 hover:border-primary/60 hover:bg-muted/40',
            )}
          >
            <input ref={inputRef} type="file" multiple accept={ACCEPT_ATTR} className="sr-only" onChange={(e) => (e.target.files && addFiles(e.target.files), (e.target.value = ''))} />
            <span className="flex size-14 items-center justify-center rounded-2xl bg-accent text-primary">
              <UploadCloud className="size-7" />
            </span>
            <div className="mt-4 text-base font-semibold">Drop files here or click to browse</div>
            <div className="mt-1 text-sm text-muted-foreground">PDF, DOC, DOCX, JPG, JPEG, PNG, XLS, XLSX · up to {MAX_UPLOAD_MB} MB each</div>
          </div>

          {rejected.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <div className="flex items-center gap-2 font-medium">
                <FileWarning className="size-4" /> Some files were not added
              </div>
              <ul className="mt-2 space-y-0.5">
                {rejected.map((r) => (
                  <li key={r.name}>
                    <span className="font-medium">{r.name}</span> — {r.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {items.map((i) => {
            const cat = catById.get(i.categoryId);
            const locked = i.status === 'uploading' || i.status === 'done';
            return (
              <Card key={i.key} className={cn('overflow-hidden animate-slide-up', i.status === 'error' && 'border-red-300', i.status === 'done' && 'border-emerald-300')}>
                <div className="flex items-center gap-3 border-b bg-muted/30 px-4 py-3">
                  <FileIcon ext={i.file.name.split('.').pop()} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{i.file.name}</div>
                    <div className="text-xs text-muted-foreground">{fmtBytes(i.file.size)}</div>
                  </div>
                  {i.status === 'done' ? (
                    <Link to={`/documents/${i.documentId}`} className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:underline">
                      <CheckCircle2 className="size-4" /> Uploaded
                    </Link>
                  ) : i.status === 'uploading' ? (
                    <span className="text-sm tabular-nums text-muted-foreground">{i.progress}%</span>
                  ) : (
                    <Button variant="ghost" size="icon-sm" onClick={() => remove(i.key)} aria-label={`Remove ${i.file.name}`} disabled={busy}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
                {i.status === 'uploading' && <Progress value={i.progress} className="rounded-none" />}
                {i.status === 'error' && (
                  <div className="flex items-center gap-2 border-b bg-red-50 px-4 py-2 text-sm text-red-700">
                    <CircleAlert className="size-4" /> {i.error}
                  </div>
                )}
                {i.status !== 'done' && (
                  <div className="grid gap-4 p-4 sm:grid-cols-2">
                    <Field label="Document title" required error={i.fieldErrors?.title} className="sm:col-span-2">
                      <Input value={i.title} disabled={locked} onChange={(e) => update(i.key, { title: e.target.value })} aria-invalid={!!i.fieldErrors?.title} maxLength={200} />
                    </Field>
                    <Field label="Category" error={i.fieldErrors?.categoryId}>
                      <NativeSelect value={i.categoryId} disabled={locked} onChange={(e) => update(i.key, { categoryId: e.target.value })}>
                        <option value="">Uncategorized</option>
                        {categories?.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Issue date">
                        <Input type="date" value={i.issueDate} disabled={locked} onChange={(e) => update(i.key, { issueDate: e.target.value })} />
                      </Field>
                      <Field label="Expiration" required={cat?.requiresExpiry} error={i.fieldErrors?.expiryDate}>
                        <Input type="date" value={i.expiryDate} disabled={locked} onChange={(e) => update(i.key, { expiryDate: e.target.value })} aria-invalid={!!i.fieldErrors?.expiryDate} />
                      </Field>
                    </div>
                    <Field label="Description" className="sm:col-span-2">
                      <Textarea value={i.description} disabled={locked} onChange={(e) => update(i.key, { description: e.target.value })} rows={2} placeholder="Optional — e.g. certificate number or issuing body" maxLength={2000} />
                    </Field>
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        <div className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <Card>
            <CardHeader title="Upload settings" />
            <div className="space-y-4 p-5">
              {!isEmployee && (
                <>
                  {(clients?.length ?? 0) > 1 && (
                    <Field label="Client">
                      <NativeSelect value={clientId} onChange={(e) => (setClientId(e.target.value), setEmployeeId(''))}>
                        <option value="">All clients</option>
                        {clients?.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                  )}
                  <Field label="Employee" required hint="Documents will be filed in this employee's folder.">
                    <NativeSelect value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} disabled={busy}>
                      <option value="">Select employee…</option>
                      {employees?.items.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.firstName} {e.lastName} — {e.clientName}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                </>
              )}
              <Field label="Default category" hint="Applied to files you add next.">
                <NativeSelect value={defaultCategory} onChange={(e) => setDefaultCategory(e.target.value)}>
                  <option value="">Uncategorized</option>
                  {categories?.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </NativeSelect>
              </Field>
              <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                {items.length === 0 ? 'No files added yet.' : `${items.length} file${items.length > 1 ? 's' : ''} · ${doneCount} uploaded · ${readyCount} waiting`}
              </div>
              <Button className="w-full" size="lg" disabled={!readyCount} loading={busy} onClick={uploadAll}>
                <UploadCloud /> Upload {readyCount > 0 ? readyCount : ''} file{readyCount === 1 ? '' : 's'}
              </Button>
              {doneCount > 0 && !busy && (
                <Button variant="outline" className="w-full" onClick={() => setItems((cur) => cur.filter((i) => i.status !== 'done'))}>
                  Clear uploaded
                </Button>
              )}
            </div>
          </Card>
          <p className="px-1 text-xs text-muted-foreground">Files are scanned for type and size, stored privately and encrypted at rest. Only authorised reviewers can access them.</p>
        </div>
      </div>
    </>
  );
}
