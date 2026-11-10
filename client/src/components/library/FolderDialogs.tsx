import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { apiError } from '@/api/client';
import { useCreateFolder, useDeleteFolder, useUpdateFolder } from '@/api/hooks';
import type { FolderCrumb } from '@/lib/types';
import { FolderPicker, type PickedFolder } from './FolderPicker';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form-controls';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from '@/components/ui/overlays';

function NameDialog({
  title,
  initial = '',
  submitLabel,
  loading,
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: string;
  submitLabel: string;
  loading: boolean;
  onSubmit: (name: string, setErr: (e: string) => void) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErr('Enter a folder name.');
    onSubmit(name.trim(), setErr);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={title} size="sm">
        <form onSubmit={submit}>
          <Field label="Folder name" error={err ?? undefined}>
            <Input
              autoFocus
              value={name}
              onChange={(e) => (setName(e.target.value), setErr(null))}
              maxLength={120}
              placeholder="For example: Licences"
              className="h-11 text-base"
              aria-invalid={!!err}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" size="lg" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="lg" loading={loading}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewFolderDialog({ parentId, parentName, onClose }: { parentId?: string; parentName?: string; onClose: () => void }) {
  const create = useCreateFolder();
  return (
    <NameDialog
      title={parentName ? `New folder in ${parentName}` : 'New folder'}
      submitLabel="Create folder"
      loading={create.isPending}
      onClose={onClose}
      onSubmit={(name, setErr) =>
        create.mutate(
          { name, parentId: parentId ?? null },
          { onSuccess: () => (toast.success(`Folder "${name}" created.`), onClose()), onError: (e) => setErr(apiError(e).message) },
        )
      }
    />
  );
}

export function RenameFolderDialog({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const rename = useUpdateFolder();
  return (
    <NameDialog
      title="Rename folder"
      initial={name}
      submitLabel="Save name"
      loading={rename.isPending}
      onClose={onClose}
      onSubmit={(n, setErr) =>
        rename.mutate({ id, name: n }, { onSuccess: () => (toast.success('Name saved.'), onClose()), onError: (e) => setErr(apiError(e).message) })
      }
    />
  );
}

export function DeleteFolderDialog({ id, name, parentId, onClose }: { id: string; name: string; parentId: string | null; onClose: () => void }) {
  const del = useDeleteFolder();
  const navigate = useNavigate();
  const [blocked, setBlocked] = useState<string | null>(null);
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      tone="destructive"
      title={blocked ? "This folder isn't empty" : `Delete the folder "${name}"?`}
      description={blocked ?? 'The folder is empty, so nothing else will be deleted.'}
      confirmLabel={blocked ? 'OK' : 'Delete folder'}
      loading={del.isPending}
      onConfirm={() => {
        if (blocked) return onClose();
        del.mutate(id, {
          onSuccess: () => {
            toast.success(`Folder "${name}" deleted.`);
            onClose();
            navigate(parentId ? `/folders/${parentId}` : '/', { replace: true });
          },
          onError: (e) => setBlocked(apiError(e).message),
        });
      }}
    />
  );
}

/** Move a folder, with everything in it, somewhere else (or to the top level). */
export function MoveFolderDialog({
  id,
  name,
  parents,
  levels,
  onClose,
}: {
  id: string;
  name: string;
  parents: FolderCrumb[];
  /** How many levels of folders this one holds, itself included (1–3). */
  levels: number;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<PickedFolder | undefined>();
  const [err, setErr] = useState<string | null>(null);
  const update = useUpdateFolder();
  const currentParent = parents.at(-1)?.id ?? null;
  const submit = () =>
    target &&
    update.mutate(
      { id, parentId: target.id },
      {
        onSuccess: () => (toast.success(`"${name}" moved to ${target.id ? target.label : 'the top level'}.`), onClose()),
        onError: (e) => setErr(apiError(e).message),
      },
    );
  const unchanged = target !== undefined && target.id === currentParent;
  return (
    <Dialog open onOpenChange={(o) => !o && !update.isPending && onClose()}>
      <DialogContent title={`Move the folder "${name}"`} description="Everything inside it moves too. Links people saved keep working." size="md">
        {levels === 3 && !currentParent ? (
          <p className="rounded-xl bg-amber-50 p-4 text-base text-amber-950 ring-1 ring-inset ring-amber-200">
            "{name}" already holds the 3 levels of folders the library allows, so it has to stay at the top level. To reorganise it, open it and move some of
            the folders inside it instead.
          </p>
        ) : (
          <FolderPicker
            value={target?.id}
            onChange={(t) => (setTarget(t), setErr(null))}
            disabledId={id}
            disabledLabel="(this folder)"
            maxDepth={3 - levels}
            allowTop={!!currentParent}
            startIn={levels === 3 ? [] : parents}
          />
        )}
        {levels > 1 && !(levels === 3 && !currentParent) && (
          <p className="mt-2 text-sm text-slate-600">
            This folder has folders inside it, so it can only go {levels === 3 ? 'at the top level' : 'at the top level or one level down'} (folders go at most
            3 levels deep).
          </p>
        )}
        {err && (
          <p role="alert" className="mt-2 text-base font-medium text-red-700">
            {err}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" size="lg" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button size="lg" disabled={!target || unchanged} loading={update.isPending} onClick={submit}>
            {unchanged ? 'Already there' : 'Move folder'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
