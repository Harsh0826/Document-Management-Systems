import { UploadCloud } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { apiError, errorMessage } from '@/api/client';
import { useBulkFiles, useDeleteFile, useReplaceFile, useUpdateFile } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form-controls';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from '@/components/ui/overlays';
import { size } from '@/lib/format';
import { addYears } from '@/lib/smart-fill';
import type { LibraryFile } from '@/lib/types';
import { cn } from '@/lib/utils';
import { FolderPicker, type PickedFolder } from './FolderPicker';

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png';
const MAX_MB = 25;

export function checkFile(f: File): string | null {
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ACCEPT.split(',').includes(`.${ext}`)) return `"${f.name}" can't be added. Use a PDF, Word, Excel or picture file.`;
  if (f.size > MAX_MB * 1024 * 1024) return `"${f.name}" is too big. Files can be up to ${MAX_MB} MB.`;
  if (f.size === 0) return `"${f.name}" is empty.`;
  return null;
}

/** "Valid until" with one-click 1/2/3/5-year shortcuts. */
export function ValidUntilField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Valid until (optional)" hint="For licences and anything else that expires.">
      <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} className="h-11 max-w-56 text-base" />
      <div className="flex flex-wrap gap-1.5 pt-1">
        {[1, 2, 3, 5].map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => onChange(addYears(y))}
            className="min-h-9 cursor-pointer rounded-full border bg-card px-3 text-sm font-medium hover:border-primary hover:text-primary"
          >
            {y} year{y > 1 ? 's' : ''} from today
          </button>
        ))}
        {value && (
          <button type="button" onClick={() => onChange('')} className="min-h-9 cursor-pointer rounded-full px-3 text-sm text-slate-600 hover:text-foreground">
            Clear
          </button>
        )}
      </div>
    </Field>
  );
}

export function RenameFileDialog({ file, onClose }: { file: LibraryFile; onClose: () => void }) {
  const [name, setName] = useState(file.name);
  const [err, setErr] = useState<string | null>(null);
  const update = useUpdateFile();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErr('Enter a name.');
    update.mutate(
      { id: file.id, name: name.trim() },
      { onSuccess: () => (toast.success('Name saved.'), onClose()), onError: (e2) => setErr(apiError(e2).message) },
    );
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Rename" size="sm">
        <form onSubmit={submit}>
          <Field label="Name" error={err ?? undefined}>
            <Input
              autoFocus
              value={name}
              onChange={(e) => (setName(e.target.value), setErr(null))}
              maxLength={200}
              className="h-11 text-base"
              aria-invalid={!!err}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" size="lg" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="lg" loading={update.isPending}>
              Save name
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MoveFileDialog({ file, onClose }: { file: LibraryFile; onClose: () => void }) {
  const [target, setTarget] = useState<PickedFolder | undefined>();
  const update = useUpdateFile();
  const submit = () =>
    target?.id &&
    update.mutate(
      { id: file.id, folderId: target.id },
      {
        onSuccess: () => (toast.success(`"${file.name}" moved to ${target.label}.`), onClose()),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Move "${file.name}"`} description="Choose where it should go." size="md">
        <FolderPicker value={target?.id} onChange={setTarget} disabledId={file.folderId} startIn={file.folderPath.slice(0, -1)} />
        <DialogFooter>
          <Button variant="outline" size="lg" onClick={onClose}>
            Cancel
          </Button>
          <Button size="lg" disabled={!target?.id} loading={update.isPending} onClick={submit}>
            {target ? `Move to ${target.label.split(' › ').at(-1)}` : 'Move here'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Move several selected files at once. Files whose name is already used there are skipped and listed. */
export function BulkMoveDialog({ ids, fromFolderId, onClose, onDone }: { ids: string[]; fromFolderId?: string; onClose: () => void; onDone: () => void }) {
  const [target, setTarget] = useState<PickedFolder | undefined>();
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[] | null>(null);
  const bulk = useBulkFiles();
  const n = ids.length;
  const submit = () =>
    target?.id &&
    bulk.mutate(
      { action: 'move', ids, folderId: target.id },
      {
        onSuccess: (r) => {
          if (r.done) toast.success(`${r.done} file${r.done === 1 ? '' : 's'} moved to ${target.label}.`);
          onDone();
          if (r.skipped.length) setSkipped(r.skipped);
          else onClose();
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  return (
    <Dialog open onOpenChange={(o) => !o && !bulk.isPending && onClose()}>
      <DialogContent
        title={skipped ? 'Some files were not moved' : `Move ${n} file${n === 1 ? '' : 's'}`}
        description={skipped ? undefined : 'Choose where they should go.'}
        size="md"
      >
        {skipped ? (
          <>
            <p className="text-base text-slate-700">These already have a file with the same name in {target?.label}. Rename them, then move them again:</p>
            <ul className="scroll-thin mt-3 max-h-60 space-y-1 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 p-3 text-base text-amber-900">
              {skipped.map((s) => (
                <li key={s.name}>{s.name}</li>
              ))}
            </ul>
            <DialogFooter>
              <Button size="lg" onClick={onClose}>
                OK
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <FolderPicker value={target?.id} onChange={setTarget} disabledId={fromFolderId} />
            <DialogFooter>
              <Button variant="outline" size="lg" onClick={onClose} disabled={bulk.isPending}>
                Cancel
              </Button>
              <Button size="lg" disabled={!target?.id} loading={bulk.isPending} onClick={submit}>
                Move {n} file{n === 1 ? '' : 's'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function BulkDeleteDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const bulk = useBulkFiles();
  const n = ids.length;
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      tone="destructive"
      title={`Delete ${n} file${n === 1 ? '' : 's'}?`}
      description="People will no longer see them. You can restore them from Recently deleted for 30 days."
      confirmLabel={`Delete ${n} file${n === 1 ? '' : 's'}`}
      loading={bulk.isPending}
      onConfirm={() =>
        bulk.mutate(
          { action: 'delete', ids },
          {
            onSuccess: (r) => {
              toast.success(`${r.done} file${r.done === 1 ? '' : 's'} deleted.`);
              onDone();
              onClose();
            },
            onError: (e) => toast.error(errorMessage(e)),
          },
        )
      }
    />
  );
}

export function ReplaceFileDialog({ file, onClose }: { file: LibraryFile; onClose: () => void }) {
  const [picked, setPicked] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [validUntil, setValidUntil] = useState(file.validUntil ?? '');
  const [over, setOver] = useState(false);
  const replace = useReplaceFile();
  const pick = (f?: File) => {
    if (!f) return;
    const e = checkFile(f);
    setErr(e);
    setPicked(e ? null : f);
  };
  const submit = () => {
    if (!picked) return setErr('Choose the newer copy first.');
    replace.mutate(
      { id: file.id, file: picked, validUntil: validUntil || null },
      { onSuccess: () => (toast.success(`"${file.name}" updated. Everyone now sees the new copy.`), onClose()), onError: (e) => setErr(errorMessage(e)) },
    );
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !replace.isPending && onClose()}>
      <DialogContent title="Replace with a newer copy" description={`"${file.name}" keeps its name and place. The old copy is kept safely.`} size="md">
        <label
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => (e.preventDefault(), setOver(false), pick(e.dataTransfer.files[0]))}
          className={cn(
            'flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-5 text-center text-base',
            over ? 'border-primary bg-accent' : 'border-slate-300 hover:border-primary',
          )}
        >
          <input type="file" accept={ACCEPT} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
          <UploadCloud className="size-8 text-primary" aria-hidden />
          {picked ? (
            <span>
              <b>{picked.name}</b> · {size(picked.size)} — click to change
            </span>
          ) : (
            <span>
              Drag the newer copy here, or <span className="font-semibold text-primary underline">choose a file</span>
            </span>
          )}
        </label>
        {err && (
          <p role="alert" className="mt-2 text-base font-medium text-red-700">
            {err}
          </p>
        )}
        <div className="mt-4">
          <ValidUntilField value={validUntil} onChange={setValidUntil} />
        </div>
        <DialogFooter>
          <Button variant="outline" size="lg" onClick={onClose} disabled={replace.isPending}>
            Cancel
          </Button>
          <Button size="lg" loading={replace.isPending} onClick={submit}>
            Replace file
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteFileDialog({ file, onClose, onDeleted }: { file: LibraryFile; onClose: () => void; onDeleted?: () => void }) {
  const del = useDeleteFile();
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      tone="destructive"
      title={`Delete "${file.name}"?`}
      description="People will no longer see it. You can restore it from Recently deleted for 30 days."
      confirmLabel="Delete"
      loading={del.isPending}
      onConfirm={() =>
        del.mutate(file.id, {
          onSuccess: () => {
            toast.success(`"${file.name}" deleted.`);
            onClose();
            onDeleted?.();
          },
          onError: (e) => toast.error(errorMessage(e)),
        })
      }
    />
  );
}
