import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Download, FileWarning, RefreshCw, UploadCloud, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { applyFieldErrors, errorMessage } from '@/api/client';
import { downloadDocument, getDocumentUrl, useCategories, useFolders, useInvalidateDocuments, useMoveDocuments, useReviewDocument, useUpdateDocument, uploadVersion } from '@/api/hooks';
import { FolderTree } from '@/components/folders/FolderTree';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/card';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/form-controls';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlays';
import { PageLoader } from '@/components/ui/spinner';
import type { DocumentItem, Folder } from '@/lib/types';
import { cn, fmtBytes } from '@/lib/utils';
import { ACCEPT_ATTR, ACCEPTED_EXTS, FileIcon, MAX_UPLOAD_MB } from './status';

type DialogProps = { doc: DocumentItem; open: boolean; onOpenChange: (o: boolean) => void };

// =====================================================================================
// Preview
// =====================================================================================
export function PreviewDialog({ doc, open, onOpenChange, versionId }: DialogProps & { versionId?: string }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['preview-url', doc.id, versionId ?? 'current'],
    queryFn: () => getDocumentUrl(doc.id, 'inline', versionId),
    enabled: open,
    staleTime: 60_000, // signed URLs are valid for 5 minutes
    gcTime: 120_000,
    retry: false,
  });
  const isImage = data?.mimeType.startsWith('image/');
  const isPdf = data?.mimeType === 'application/pdf';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="full" title={doc.title} description={`${doc.employeeName} · ${data?.filename ?? doc.file?.filename ?? ''}`} className="h-[calc(100dvh-2rem)]">
        <div className="-mx-6 -my-5 flex h-full min-h-[60vh] flex-col bg-slate-100">
          <div className="flex min-h-0 flex-1 items-center justify-center">
            {isLoading ? (
              <PageLoader label="Generating secure preview link…" />
            ) : isError ? (
              <div className="p-10 text-center text-sm text-red-700">{errorMessage(error)}</div>
            ) : isPdf ? (
              <iframe src={data!.url} title={`Preview of ${doc.title}`} className="h-full w-full border-0 bg-white" />
            ) : isImage ? (
              <img src={data!.url} alt={doc.title} className="max-h-full max-w-full object-contain p-4" />
            ) : (
              <div className="flex flex-col items-center gap-3 p-10 text-center">
                <FileIcon ext={doc.file?.ext} className="size-14" />
                <div className="font-medium">Preview isn't available for {doc.file?.ext?.toUpperCase()} files</div>
                <p className="max-w-sm text-sm text-muted-foreground">Download the file to open it in Word or Excel.</p>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 border-t bg-card px-6 py-3 text-xs text-muted-foreground">
            <span>Secure link expires {data ? new Date(data.expiresAt).toLocaleTimeString() : 'shortly'} · access is logged</span>
            {doc.can.download && (
              <Button size="sm" variant="outline" onClick={() => downloadDocument(doc.id, versionId).catch((e) => toast.error(errorMessage(e)))}>
                <Download /> Download
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================================
// Review (approve / reject / require renewal)
// =====================================================================================
const DECISIONS = [
  { value: 'approved', label: 'Approve', icon: CheckCircle2, cls: 'text-emerald-700', ring: 'border-emerald-500 bg-emerald-50' },
  { value: 'rejected', label: 'Reject', icon: XCircle, cls: 'text-red-700', ring: 'border-red-500 bg-red-50' },
  { value: 'renewal_required', label: 'Require renewal', icon: RefreshCw, cls: 'text-orange-700', ring: 'border-orange-500 bg-orange-50' },
] as const;

export function ReviewDialog({ doc, open, onOpenChange, initial = 'approved' }: DialogProps & { initial?: 'approved' | 'rejected' | 'renewal_required' }) {
  const [decision, setDecision] = useState<(typeof DECISIONS)[number]['value']>(initial);
  const [comment, setComment] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const review = useReviewDocument();
  const needsComment = decision !== 'approved';

  const submit = () => {
    if (needsComment && comment.trim().length < 3) return setErr('Please explain the reason so the employee can fix it.');
    review.mutate(
      { id: doc.id, decision, comment: comment.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(decision === 'approved' ? 'Document approved' : decision === 'rejected' ? 'Document rejected' : 'Renewal requested');
          onOpenChange(false);
          setComment('');
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Review document" description={`${doc.title} — ${doc.employeeName}`} size="md">
        <div className="grid grid-cols-3 gap-2">
          {DECISIONS.map((d) => (
            <button
              key={d.value}
              type="button"
              onClick={() => {
                setDecision(d.value);
                setErr(null);
              }}
              className={cn('flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-2 p-3 text-sm font-medium transition-colors', decision === d.value ? d.ring : 'border-border hover:bg-muted', d.cls)}
              aria-pressed={decision === d.value}
            >
              <d.icon className="size-5" />
              {d.label}
            </button>
          ))}
        </div>
        <Field label={needsComment ? 'Reason (shared with the employee)' : 'Comment (optional)'} required={needsComment} error={err ?? undefined} className="mt-5">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={needsComment ? 'e.g. The scan is blurry — please upload a clearer copy.' : 'Optional note'} maxLength={2000} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant={decision === 'approved' ? 'success' : decision === 'rejected' ? 'destructive' : 'default'} loading={review.isPending} onClick={submit}>
            Confirm {DECISIONS.find((d) => d.value === decision)?.label.toLowerCase()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================================
// Edit metadata / rename
// =====================================================================================
const editSchema = z
  .object({
    title: z.string().trim().min(1, 'Required').max(200),
    description: z.string().max(2000).optional(),
    categoryId: z.string().optional(),
    issueDate: z.string().optional(),
    expiryDate: z.string().optional(),
  })
  .refine((v) => !v.issueDate || !v.expiryDate || v.expiryDate >= v.issueDate, { path: ['expiryDate'], message: 'Must be after the issue date' });

export function EditDocumentDialog({ doc, open, onOpenChange }: DialogProps) {
  const { data: categories } = useCategories();
  const update = useUpdateDocument(doc.id);
  const form = useForm<z.infer<typeof editSchema>>({
    resolver: zodResolver(editSchema),
    values: { title: doc.title, description: doc.description ?? '', categoryId: doc.categoryId ?? '', issueDate: doc.issueDate ?? '', expiryDate: doc.expiryDate ?? '' },
  });
  const canDates = doc.can.edit_dates;

  const onSubmit = form.handleSubmit((v) => {
    const body: Record<string, unknown> = { title: v.title, description: v.description || null, categoryId: v.categoryId || null };
    if (canDates) Object.assign(body, { issueDate: v.issueDate || null, expiryDate: v.expiryDate || null });
    update.mutate(body, {
      onSuccess: () => {
        toast.success('Document updated');
        onOpenChange(false);
      },
      onError: (e) => {
        if (!applyFieldErrors(e, form.setError)) toast.error(errorMessage(e));
      },
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Edit document details" size="md">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Title" required error={form.formState.errors.title?.message}>
            <Input {...form.register('title')} aria-invalid={!!form.formState.errors.title} />
          </Field>
          <Field label="Description" error={form.formState.errors.description?.message}>
            <Textarea {...form.register('description')} rows={3} />
          </Field>
          <Field label="Category" hint="Changing the category files the document into the matching folder.">
            <NativeSelect {...form.register('categoryId')}>
              <option value="">Uncategorized</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Issue date" hint={!canDates ? 'Upload a new version to change dates' : undefined}>
              <Input type="date" disabled={!canDates} {...form.register('issueDate')} />
            </Field>
            <Field label="Expiration date" error={form.formState.errors.expiryDate?.message}>
              <Input type="date" disabled={!canDates} {...form.register('expiryDate')} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={update.isPending}>Save changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================================
// Move to folder
// =====================================================================================
export function MoveDialog({ docs, open, onOpenChange, onMoved }: { docs: DocumentItem[]; open: boolean; onOpenChange: (o: boolean) => void; onMoved?: () => void }) {
  const clientId = docs[0]?.clientId;
  const sameClient = docs.every((d) => d.clientId === clientId);
  const { data: folders, isLoading } = useFolders(clientId);
  const [target, setTarget] = useState<Folder | null>(null);
  const move = useMoveDocuments();
  const employeeIds = new Set(docs.map((d) => d.employeeId));
  // Folders that belong to a different employee cannot receive these documents.
  const disabled = useMemo(
    () => new Set((folders ?? []).filter((f) => f.employeeId && !(employeeIds.size === 1 && employeeIds.has(f.employeeId))).map((f) => f.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [folders, docs],
  );

  const submit = () =>
    target &&
    move.mutate(
      { documentIds: docs.map((d) => d.id), folderId: target.id },
      {
        onSuccess: (r) => {
          toast.success(`Moved ${r.moved} document${r.moved === 1 ? '' : 's'} to “${target.name}”`);
          onOpenChange(false);
          onMoved?.();
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Move ${docs.length === 1 ? `“${docs[0]?.title}”` : `${docs.length} documents`}`} description="Choose the destination folder." size="md">
        {!sameClient ? (
          <p className="text-sm text-red-700">Selected documents belong to different clients. Move them separately.</p>
        ) : isLoading ? (
          <PageLoader />
        ) : (
          <div className="scroll-thin max-h-[50vh] overflow-y-auto rounded-lg border p-2">
            <FolderTree folders={folders ?? []} selectedId={target?.id} onSelect={setTarget} disabledIds={disabled} defaultExpandedDepth={2} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!target || !sameClient} loading={move.isPending} onClick={submit}>
            Move here
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================================
// Replace / renew (new version)
// =====================================================================================
export function validateFile(f: File): string | null {
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ACCEPTED_EXTS.includes(ext)) return `.${ext} files are not supported`;
  if (f.size > MAX_UPLOAD_MB * 1024 * 1024) return `File is larger than ${MAX_UPLOAD_MB} MB`;
  if (f.size === 0) return 'File is empty';
  return null;
}

export function ReplaceDialog({ doc, open, onOpenChange }: DialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [issueDate, setIssueDate] = useState(doc.issueDate ?? '');
  const [expiryDate, setExpiryDate] = useState(doc.expiryDate ?? '');
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const invalidate = useInvalidateDocuments();
  const isRenewal = doc.status === 'expired' || doc.status === 'renewal_required';

  const pick = (f: File | undefined) => {
    if (!f) return;
    const e = validateFile(f);
    setFileErr(e);
    setFile(e ? null : f);
  };

  const submit = async () => {
    if (!file) return setFileErr('Choose a file to upload');
    if (issueDate && expiryDate && expiryDate < issueDate) return toast.error('Expiration date must be after the issue date');
    setProgress(0);
    try {
      await uploadVersion(doc.id, { file, issueDate: issueDate || undefined, expiryDate: expiryDate || undefined, changeNote: note || undefined }, setProgress);
      await invalidate();
      toast.success(isRenewal ? 'Renewed certificate submitted for review' : 'New version uploaded and sent for review');
      onOpenChange(false);
      setFile(null);
      setNote('');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => progress === null && onOpenChange(o)}>
      <DialogContent title={isRenewal ? 'Upload renewed certificate' : 'Replace document'} description="The previous version is kept in the version history." size="md">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            pick(e.dataTransfer.files[0]);
          }}
          className={cn('flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors', over ? 'border-primary bg-accent' : 'border-slate-300 hover:border-primary/60 hover:bg-muted/50')}
        >
          <input type="file" className="sr-only" accept={ACCEPT_ATTR} onChange={(e) => pick(e.target.files?.[0])} />
          {file ? (
            <>
              <FileIcon ext={file.name.split('.').pop()} />
              <div className="text-sm font-medium">{file.name}</div>
              <div className="text-xs text-muted-foreground">{fmtBytes(file.size)} · click to change</div>
            </>
          ) : (
            <>
              <UploadCloud className="size-8 text-primary" />
              <div className="text-sm font-medium">Drop a file or click to browse</div>
              <div className="text-xs text-muted-foreground">PDF, Word, Excel, JPG or PNG · up to {MAX_UPLOAD_MB} MB</div>
            </>
          )}
        </label>
        {fileErr && (
          <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-destructive">
            <FileWarning className="size-3.5" /> {fileErr}
          </p>
        )}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Issue date">
            <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </Field>
          <Field label="Expiration date">
            <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Note" className="mt-4">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Renewed for 2026" maxLength={1000} />
        </Field>
        {progress !== null && (
          <div className="mt-4 space-y-1.5">
            <Progress value={progress} />
            <div className="text-xs text-muted-foreground">Uploading… {progress}%</div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={progress !== null} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={progress !== null} onClick={submit}>
            Upload new version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
