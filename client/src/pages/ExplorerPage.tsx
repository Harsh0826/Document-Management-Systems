import { ChevronRight, Folder as FolderIcon, FolderPlus, FolderTree as FolderTreeIcon, Pencil, Tag, Trash2, Upload, UserRound } from 'lucide-react';
import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { apiError, errorMessage } from '@/api/client';
import { useCreateFolder, useDeleteFolder, useDocuments, useFolder, useFolders, useMoveDocuments, useUpdateFolder } from '@/api/hooks';
import { DocumentTable } from '@/components/documents/DocumentTable';
import { DND_MIME, FolderTree } from '@/components/folders/FolderTree';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/card';
import { Field, Input, Switch } from '@/components/ui/form-controls';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from '@/components/ui/overlays';
import { Pagination } from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import type { Folder } from '@/lib/types';
import { cn } from '@/lib/utils';

function NameDialog({ open, onOpenChange, title, initial, onSubmit, loading }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; initial?: string; onSubmit: (name: string) => Promise<unknown>; loading: boolean }) {
  const [name, setName] = useState(initial ?? '');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName(initial ?? '');
      setErr(null);
    }
  }, [open, initial]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setErr('Enter a folder name');
    if (/[\\/]/.test(n)) return setErr('Folder names cannot contain slashes');
    try {
      await onSubmit(n);
      onOpenChange(false);
    } catch (e2) {
      const a = apiError(e2);
      setErr(a.details?.fields?.name ?? a.message);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} size="sm">
        <form onSubmit={submit}>
          <Field label="Folder name" error={err ?? undefined}>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. 2024 Renewals" aria-invalid={!!err} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={loading}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const KIND_ICON = { client_root: FolderTreeIcon, employee_root: UserRound, category: Tag, custom: FolderIcon };

export default function ExplorerPage() {
  const { can, isEmployee } = useAuth();
  const [params, setParams] = useSearchParams();
  const folderId = params.get('folder') ?? undefined;
  const { data: folders, isLoading: foldersLoading } = useFolders();
  const { data: folder } = useFolder(folderId);
  const [includeSub, setIncludeSub] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const docs = useDocuments({ folderId, includeSubfolders: includeSub, page, pageSize: 25 }, !!folderId);
  const createFolder = useCreateFolder();
  const updateFolder = useUpdateFolder();
  const deleteFolder = useDeleteFolder();
  const move = useMoveDocuments();
  const [dialog, setDialog] = useState<'create' | 'rename' | 'delete' | null>(null);
  const [deleteInfo, setDeleteInfo] = useState<{ documents: number; folders: number } | null>(null);
  const [dragOverCard, setDragOverCard] = useState<string | null>(null);
  const canManage = can('folders.manage');

  // Default to the first root folder.
  useEffect(() => {
    if (!folderId && folders?.length) {
      const root = folders.find((f) => f.kind === 'client_root') ?? folders.find((f) => !folders.some((p) => p.id === f.parentId));
      if (root) setParams({ folder: root.id }, { replace: true });
    }
  }, [folderId, folders, setParams]);
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [folderId, includeSub]);

  const select = (f: Folder) => setParams({ folder: f.id });
  const byId = useMemo(() => new Map((folders ?? []).map((f) => [f.id, f])), [folders]);

  const dropOn = (target: Folder, ids: string[]) => {
    if (target.id === folderId && !includeSub) return;
    move.mutate(
      { documentIds: ids, folderId: target.id },
      {
        onSuccess: (r) => {
          toast.success(`Moved ${r.moved} document${r.moved === 1 ? '' : 's'} to “${target.name}”`);
          setSelected(new Set());
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  const cardDrop = (f: Folder) => ({
    onDragOver: (e: DragEvent) => {
      if (e.dataTransfer.types.includes(DND_MIME)) {
        e.preventDefault();
        setDragOverCard(f.id);
      }
    },
    onDragLeave: () => setDragOverCard(null),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragOverCard(null);
      dropOn(f, JSON.parse(e.dataTransfer.getData(DND_MIME) || '[]'));
    },
  });

  const startDelete = () => {
    if (!folder) return;
    setDeleteInfo({ documents: folder.documentCount, folders: folder.childCount });
    setDialog('delete');
  };

  const Icon = folder ? KIND_ICON[folder.kind] : FolderIcon;

  return (
    <>
      <PageHeader
        title="Folders"
        description={isEmployee ? 'Your documents organised by category.' : 'Browse client, employee and category folders. Drag documents onto a folder to move them.'}
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="h-fit xl:sticky xl:top-24">
          <div className="border-b px-4 py-3 text-sm font-semibold">Folder hierarchy</div>
          <div className="scroll-thin max-h-72 overflow-y-auto p-2 xl:max-h-[70vh]">
            {foldersLoading ? (
              <div className="space-y-2 p-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-6" />)}</div>
            ) : folders?.length ? (
              <FolderTree folders={folders} selectedId={folderId} onSelect={select} onDropDocuments={can('documents.edit') ? dropOn : undefined} />
            ) : (
              <EmptyState title="No folders" description="Folders appear when clients and employees are created." className="py-8" />
            )}
          </div>
        </Card>

        <div className="min-w-0 space-y-4">
          {folder && (
            <>
              <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                {folder.path.map((p, i) => (
                  <span key={p.id} className="inline-flex items-center gap-1">
                    {i > 0 && <ChevronRight className="size-3.5" />}
                    {i === folder.path.length - 1 ? (
                      <span className="font-medium text-foreground">{p.name}</span>
                    ) : (
                      <button className="cursor-pointer rounded px-1 hover:bg-muted hover:text-foreground" onClick={() => setParams({ folder: p.id })}>
                        {p.name}
                      </button>
                    )}
                  </span>
                ))}
              </nav>
              <Card className="flex flex-wrap items-center gap-4 p-5">
                <span className="flex size-12 items-center justify-center rounded-xl bg-accent text-primary">
                  <Icon className="size-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-lg font-semibold">{folder.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {folder.documentCount} document{folder.documentCount === 1 ? '' : 's'} · {folder.childCount} subfolder{folder.childCount === 1 ? '' : 's'}
                    {folder.isSystem && ' · system folder'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(isEmployee || can('documents.upload')) && folder.employeeId && (
                    <Button variant="outline" asChild>
                      <Link to={`/upload?employeeId=${folder.employeeId}${folder.categoryId ? `&categoryId=${folder.categoryId}` : ''}`}>
                        <Upload /> Upload here
                      </Link>
                    </Button>
                  )}
                  {canManage && (
                    <>
                      <Button variant="outline" onClick={() => setDialog('create')}>
                        <FolderPlus /> New subfolder
                      </Button>
                      {!folder.isSystem && (
                        <>
                          <Button variant="outline" size="icon" onClick={() => setDialog('rename')} aria-label="Rename folder">
                            <Pencil />
                          </Button>
                          <Button variant="outline" size="icon" onClick={startDelete} aria-label="Delete folder" className="text-destructive hover:text-destructive">
                            <Trash2 />
                          </Button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </Card>

              {folder.children.length > 0 && (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                  {folder.children.map((c) => {
                    const CIcon = KIND_ICON[c.kind];
                    return (
                      <button
                        key={c.id}
                        onClick={() => select(c)}
                        {...(can('documents.edit') ? cardDrop(c) : {})}
                        className={cn('flex cursor-pointer items-center gap-3 rounded-xl border bg-card p-3.5 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md', dragOverCard === c.id && 'border-primary bg-accent ring-2 ring-primary/40')}
                      >
                        <CIcon className={cn('size-8 shrink-0 rounded-lg p-1.5', c.kind === 'category' ? 'bg-violet-50 text-violet-500' : c.kind === 'employee_root' ? 'bg-blue-50 text-primary' : 'bg-amber-50 text-amber-500')} />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{c.name}</div>
                          <div className="text-xs text-muted-foreground">{c.documentCount} docs{c.childCount ? ` · ${c.childCount} folders` : ''}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
                  <div className="text-sm font-semibold">Documents</div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                    <Switch checked={includeSub} onCheckedChange={setIncludeSub} /> Include subfolders
                  </label>
                </div>
                <DocumentTable
                  items={docs.data?.items}
                  loading={docs.isLoading}
                  columns={isEmployee ? ['category', 'uploadedAt', 'expiryDate', 'status'] : ['employee', 'category', 'uploadedAt', 'expiryDate', 'status']}
                  draggable={can('documents.edit')}
                  selected={isEmployee ? undefined : selected}
                  onSelectedChange={isEmployee ? undefined : setSelected}
                  empty={<EmptyState icon={<FolderIcon />} title="This folder is empty" description={can('documents.edit') ? 'Drag documents here from another folder, or upload new ones.' : undefined} />}
                />
                {docs.data && docs.data.total > 25 && <Pagination page={page} pageSize={25} total={docs.data.total} onPage={setPage} />}
              </Card>
              {can('documents.edit') && (docs.data?.items.length ?? 0) > 0 && <p className="text-xs text-muted-foreground">Tip: select several rows, then drag any of them onto a folder in the tree to move them together.</p>}
            </>
          )}
        </div>
      </div>

      {folder && (
        <>
          <NameDialog
            open={dialog === 'create'}
            onOpenChange={(o) => !o && setDialog(null)}
            title={`New folder in “${folder.name}”`}
            loading={createFolder.isPending}
            onSubmit={async (name) => {
              const f = await createFolder.mutateAsync({ name, parentId: folder.id });
              toast.success(`Folder “${f.name}” created`);
            }}
          />
          <NameDialog
            open={dialog === 'rename'}
            onOpenChange={(o) => !o && setDialog(null)}
            title="Rename folder"
            initial={folder.name}
            loading={updateFolder.isPending}
            onSubmit={async (name) => {
              await updateFolder.mutateAsync({ id: folder.id, name });
              toast.success('Folder renamed');
            }}
          />
          <ConfirmDialog
            open={dialog === 'delete'}
            onOpenChange={(o) => !o && setDialog(null)}
            tone="destructive"
            title={`Delete “${folder.name}”?`}
            description={
              deleteInfo && (deleteInfo.documents > 0 || deleteInfo.folders > 0)
                ? `This folder contains ${deleteInfo.documents} document(s) and ${deleteInfo.folders} subfolder(s). They will be moved to “${byId.get(folder.parentId ?? '')?.name ?? 'the parent folder'}” before the folder is deleted. No documents are deleted.`
                : 'This empty folder will be removed. Any archived documents inside are moved to the parent folder.'
            }
            confirmLabel={deleteInfo && (deleteInfo.documents > 0 || deleteInfo.folders > 0) ? 'Move contents & delete' : 'Delete folder'}
            loading={deleteFolder.isPending}
            onConfirm={async () => {
              try {
                const r = await deleteFolder.mutateAsync({ id: folder.id, moveContents: true });
                toast.success(r.movedDocuments || r.movedFolders ? `Folder deleted — contents moved to the parent folder` : 'Folder deleted');
                setDialog(null);
                setParams({ folder: r.parentId });
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
          />
        </>
      )}
    </>
  );
}
