import { Archive, ArchiveRestore, ClipboardCheck, Download, Eye, FolderInput, MoreHorizontal, Pencil, RefreshCw, SquareArrowOutUpRight, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { errorMessage } from '@/api/client';
import { downloadDocument, useArchiveDocument, useDeleteDocument } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/overlays';
import type { DocumentItem } from '@/lib/types';
import { EditDocumentDialog, MoveDialog, PreviewDialog, ReplaceDialog, ReviewDialog } from './dialogs';

type Modal = 'preview' | 'review' | 'edit' | 'move' | 'replace' | 'delete' | 'archive' | null;

/** Row-level action menu; every action is also enforced server-side. */
export function DocumentActions({ doc, onDeleted, variant = 'menu' }: { doc: DocumentItem; onDeleted?: () => void; variant?: 'menu' | 'buttons' }) {
  const [modal, setModal] = useState<Modal>(null);
  const navigate = useNavigate();
  const archive = useArchiveDocument();
  const del = useDeleteDocument();
  const close = (o: boolean) => !o && setModal(null);
  const canPreview = doc.can.download && ['pdf', 'jpg', 'jpeg', 'png'].includes(doc.file?.ext ?? '');

  const download = () => downloadDocument(doc.id).catch((e) => toast.error(errorMessage(e)));

  const dialogs = (
    <>
      {modal === 'preview' && <PreviewDialog doc={doc} open onOpenChange={close} />}
      {modal === 'review' && <ReviewDialog doc={doc} open onOpenChange={close} />}
      {modal === 'edit' && <EditDocumentDialog doc={doc} open onOpenChange={close} />}
      {modal === 'move' && <MoveDialog docs={[doc]} open onOpenChange={close} />}
      {modal === 'replace' && <ReplaceDialog doc={doc} open onOpenChange={close} />}
      <ConfirmDialog
        open={modal === 'archive'}
        onOpenChange={close}
        title={doc.isArchived ? 'Restore document?' : 'Archive document?'}
        description={doc.isArchived ? 'The document will appear in lists and dashboards again.' : 'Archived documents are hidden from lists, dashboards and expiry tracking, but kept for records.'}
        confirmLabel={doc.isArchived ? 'Restore' : 'Archive'}
        loading={archive.isPending}
        onConfirm={() =>
          archive.mutate(
            { id: doc.id, archived: !doc.isArchived },
            { onSuccess: () => (toast.success(doc.isArchived ? 'Document restored' : 'Document archived'), setModal(null)), onError: (e) => toast.error(errorMessage(e)) },
          )
        }
      />
      <ConfirmDialog
        open={modal === 'delete'}
        onOpenChange={close}
        tone="destructive"
        title="Delete this document permanently?"
        description={`“${doc.title}” and all of its versions will be removed from storage. The audit trail is kept. This cannot be undone.`}
        confirmLabel="Delete document"
        loading={del.isPending}
        onConfirm={() =>
          del.mutate(doc.id, {
            onSuccess: () => {
              toast.success('Document deleted');
              setModal(null);
              onDeleted?.();
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </>
  );

  if (variant === 'buttons') {
    return (
      <div className="flex flex-wrap gap-2">
        {canPreview && (
          <Button variant="outline" onClick={() => setModal('preview')}>
            <Eye /> Preview
          </Button>
        )}
        {doc.can.download && (
          <Button variant="outline" onClick={download}>
            <Download /> Download
          </Button>
        )}
        {doc.can.review && !doc.isArchived && (
          <Button onClick={() => setModal('review')}>
            <ClipboardCheck /> Review
          </Button>
        )}
        {doc.can.replace && !doc.isArchived && (
          <Button variant={doc.status === 'expired' || doc.status === 'renewal_required' || doc.status === 'rejected' ? 'default' : 'outline'} onClick={() => setModal('replace')}>
            <RefreshCw /> {doc.status === 'expired' || doc.status === 'renewal_required' ? 'Upload renewal' : 'Replace'}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="More actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {doc.can.edit && <DropdownMenuItem onSelect={() => setModal('edit')}><Pencil /> Edit details</DropdownMenuItem>}
            {doc.can.move && <DropdownMenuItem onSelect={() => setModal('move')}><FolderInput /> Move to folder</DropdownMenuItem>}
            {doc.can.archive && <DropdownMenuItem onSelect={() => setModal('archive')}>{doc.isArchived ? <><ArchiveRestore /> Restore</> : <><Archive /> Archive</>}</DropdownMenuItem>}
            {doc.can.delete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={() => setModal('delete')}><Trash2 /> Delete</DropdownMenuItem>
              </>
            )}
            {!doc.can.edit && !doc.can.move && !doc.can.archive && !doc.can.delete && <DropdownMenuItem disabled>No other actions available</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
        {dialogs}
      </div>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${doc.title}`} onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={() => navigate(`/documents/${doc.id}`)}><SquareArrowOutUpRight /> Open details</DropdownMenuItem>
          {canPreview && <DropdownMenuItem onSelect={() => setModal('preview')}><Eye /> Preview</DropdownMenuItem>}
          {doc.can.download && <DropdownMenuItem onSelect={download}><Download /> Download</DropdownMenuItem>}
          {(doc.can.review || doc.can.edit || doc.can.move || doc.can.replace) && <DropdownMenuSeparator />}
          {doc.can.review && !doc.isArchived && <DropdownMenuItem onSelect={() => setModal('review')}><ClipboardCheck /> Review…</DropdownMenuItem>}
          {doc.can.edit && <DropdownMenuItem onSelect={() => setModal('edit')}><Pencil /> Rename / edit</DropdownMenuItem>}
          {doc.can.move && <DropdownMenuItem onSelect={() => setModal('move')}><FolderInput /> Move to folder</DropdownMenuItem>}
          {doc.can.replace && !doc.isArchived && <DropdownMenuItem onSelect={() => setModal('replace')}><RefreshCw /> Replace / renew</DropdownMenuItem>}
          {doc.can.archive && <DropdownMenuItem onSelect={() => setModal('archive')}>{doc.isArchived ? <><ArchiveRestore /> Restore</> : <><Archive /> Archive</>}</DropdownMenuItem>}
          {doc.can.delete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => setModal('delete')}><Trash2 /> Delete</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialogs}
    </>
  );
}
