import { FolderInput, FolderOpen, FolderPlus, MoreHorizontal, Pencil, Pin, PinOff, Search, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { errorMessage } from '@/api/client';
import { useFolder, usePinFolder } from '@/api/hooks';
import { Container, PageHead } from '@/components/layout/Page';
import { DocumentBrowser } from '@/components/library/DocumentBrowser';
import { DeleteFolderDialog, MoveFolderDialog, NewFolderDialog, RenameFolderDialog } from '@/components/library/FolderDialogs';
import { Breadcrumb, FolderIcon, FolderSection } from '@/components/library/parts';
import { Button } from '@/components/ui/button';
import { EmptyState, Skeleton } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/overlays';
import { useAuth } from '@/lib/auth';
import type { FolderDetail } from '@/lib/types';

const MAX_DEPTH = 3;

/** How many levels of folders this one holds, itself included. */
const levelsOf = (f: FolderDetail) => (f.subfolders.some((s) => s.folderCount > 0) ? 3 : f.subfolders.length ? 2 : 1);

export default function FolderPage() {
  const { id } = useParams<{ id: string }>();
  const { isAdmin } = useAuth();
  const [dialog, setDialog] = useState<'new' | 'rename' | 'move' | 'delete' | null>(null);
  const { data: folder, isLoading, isError, error } = useFolder(id);
  const pin = usePinFolder();

  if (isError)
    return (
      <Container className="pt-10">
        <EmptyState
          title="We couldn't open this folder"
          description={errorMessage(error)}
          action={
            <Button asChild size="lg">
              <Link to="/">Back to Home</Link>
            </Button>
          }
        />
      </Container>
    );
  if (isLoading || !folder)
    return (
      <Container className="space-y-4 pt-8">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </Container>
    );

  const meta = [folder.fileCount === 1 ? '1 file' : `${folder.fileCount.toLocaleString()} files`];
  if (folder.folderCount) meta.push(folder.folderCount === 1 ? '1 folder' : `${folder.folderCount.toLocaleString()} folders`);
  const togglePin = () =>
    pin.mutate(
      { id: folder.id, pinned: !folder.pinned },
      {
        onSuccess: () => toast.success(folder.pinned ? 'Removed from your pinned folders.' : 'Pinned. You will find it at the top of Home.'),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <>
      <PageHead
        crumbs={<Breadcrumb path={folder.path.slice(0, -1)} current={folder.name} />}
        icon={<FolderIcon name={folder.name} size="lg" />}
        title={folder.name}
        meta={meta.join(' · ')}
        actions={
          <>
            <Button
              variant="outline"
              className="h-11 text-base"
              onClick={togglePin}
              aria-pressed={folder.pinned}
              title={folder.pinned ? 'Remove from the top of your Home page' : 'Keep this folder at the top of your Home page'}
            >
              {folder.pinned ? <PinOff className="size-5" /> : <Pin className="size-5" />} {folder.pinned ? 'Unpin' : 'Pin to Home'}
            </Button>
            {isAdmin && (
              <>
                <Button asChild size="lg" className="h-11 text-base">
                  <Link to={`/add?folder=${folder.id}`}>
                    <Upload className="size-5" /> Add files
                  </Link>
                </Button>
                {folder.depth < MAX_DEPTH && (
                  <Button variant="outline" className="h-11 text-base" onClick={() => setDialog('new')}>
                    <FolderPlus className="size-5" /> New folder
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="size-11" aria-label="More folder options">
                      <MoreHorizontal className="size-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem className="min-h-10 text-base" onSelect={() => setDialog('rename')}>
                      <Pencil /> Rename folder
                    </DropdownMenuItem>
                    <DropdownMenuItem className="min-h-10 text-base" onSelect={() => setDialog('move')}>
                      <FolderInput /> Move folder
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive className="min-h-10 text-base" onSelect={() => setDialog('delete')}>
                      <Trash2 /> Delete folder
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </>
        }
      />

      <Container className="space-y-10 pt-8">
        {folder.subfolders.length > 0 && <FolderSection key={`${folder.id}-folders`} id="subfolders" title="Folders" folders={folder.subfolders} />}

        <DocumentBrowser
          key={`${folder.id}-documents`}
          folder={{ id: folder.id, name: folder.name, hasSubfolders: folder.folderCount > 0 }}
          searchPlaceholder={folder.folderCount ? `Search in ${folder.name} and its folders…` : `Search in ${folder.name}…`}
          heading={() => (
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="flex items-center gap-2.5 text-xl font-bold">
                Documents
                <span className="rounded-full bg-slate-200/70 px-2.5 py-0.5 text-sm font-semibold text-slate-700">{folder.ownFileCount.toLocaleString()}</span>
              </h2>
              <Link to="/search" className="inline-flex items-center gap-1.5 text-base font-medium text-primary hover:underline">
                <Search className="size-4" aria-hidden /> Search the whole library
              </Link>
            </div>
          )}
          empty={
            <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white">
              <EmptyState
                icon={<FolderOpen />}
                title={folder.subfolders.length ? 'No documents directly in this folder.' : 'This folder is empty.'}
                description={
                  isAdmin ? 'Add files to get started.' : folder.subfolders.length ? 'Open one of the folders above, or tick "Include sub-folders".' : undefined
                }
                action={
                  isAdmin ? (
                    <Button asChild size="lg" className="h-11 text-base">
                      <Link to={`/add?folder=${folder.id}`}>
                        <Upload className="size-5" /> Add files
                      </Link>
                    </Button>
                  ) : undefined
                }
              />
            </div>
          }
        />
      </Container>

      {dialog === 'new' && <NewFolderDialog parentId={folder.id} parentName={folder.name} onClose={() => setDialog(null)} />}
      {dialog === 'rename' && <RenameFolderDialog id={folder.id} name={folder.name} onClose={() => setDialog(null)} />}
      {dialog === 'move' && (
        <MoveFolderDialog id={folder.id} name={folder.name} parents={folder.parents} levels={levelsOf(folder)} onClose={() => setDialog(null)} />
      )}
      {dialog === 'delete' && <DeleteFolderDialog id={folder.id} name={folder.name} parentId={folder.parentId} onClose={() => setDialog(null)} />}
    </>
  );
}
