import { CheckCircle2, ClipboardCheck, Eye, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { errorMessage } from '@/api/client';
import { useClients, useDocuments, useReviewDocument } from '@/api/hooks';
import { PreviewDialog, ReviewDialog } from '@/components/documents/dialogs';
import { ExpiryText, FileIcon } from '@/components/documents/status';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/form-controls';
import { Pagination } from '@/components/ui/table';
import type { DocumentItem } from '@/lib/types';
import { fmtAgo, fmtBytes } from '@/lib/utils';

export default function ReviewsPage() {
  const [clientId, setClientId] = useState('');
  const [page, setPage] = useState(1);
  const { data: clients } = useClients();
  const { data, isLoading } = useDocuments({ status: ['pending_review'], clientId: clientId || undefined, sort: 'uploadedAt', order: 'asc', page, pageSize: 15 });
  const [preview, setPreview] = useState<DocumentItem | null>(null);
  const [reviewing, setReviewing] = useState<{ doc: DocumentItem; decision: 'approved' | 'rejected' } | null>(null);
  const review = useReviewDocument();

  const quickApprove = (d: DocumentItem) =>
    review.mutate({ id: d.id, decision: 'approved' }, { onSuccess: () => toast.success(`Approved “${d.title}”`), onError: (e) => toast.error(errorMessage(e)) });

  return (
    <>
      <PageHeader
        title="Review queue"
        description="Submissions waiting for approval, oldest first."
        actions={
          (clients?.length ?? 0) > 1 && (
            <NativeSelect className="w-56" value={clientId} onChange={(e) => (setClientId(e.target.value), setPage(1))} aria-label="Filter by client">
              <option value="">All clients</option>
              {clients?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </NativeSelect>
          )
        }
      />
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : !data?.items.length ? (
          <EmptyState icon={<ClipboardCheck />} title="All caught up" description="There are no documents waiting for review." />
        ) : (
          <ul className="divide-y">
            {data.items.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/30">
                <FileIcon ext={d.file?.ext} />
                <div className="min-w-0 flex-1 basis-64">
                  <Link to={`/documents/${d.id}`} className="font-medium hover:underline">{d.title}</Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{d.employeeName}</span>
                    <span>·</span>
                    <span>{d.clientName}</span>
                    <span>·</span>
                    <span>{d.categoryName ?? 'Uncategorized'}</span>
                    <span>·</span>
                    <span>{d.file?.filename} ({fmtBytes(d.file?.sizeBytes)})</span>
                    {d.file && d.file.versionNumber > 1 && <Badge tone="blue">Resubmission v{d.file.versionNumber}</Badge>}
                  </div>
                </div>
                <div className="w-32 text-sm">
                  <div className="text-xs text-muted-foreground">Expires</div>
                  <ExpiryText date={d.expiryDate} days={d.daysToExpiry} />
                </div>
                <div className="w-28 text-sm">
                  <div className="text-xs text-muted-foreground">Waiting</div>
                  {fmtAgo(d.uploadedAt).replace(' ago', '')}
                </div>
                <div className="flex gap-2">
                  {d.can.download && ['pdf', 'jpg', 'jpeg', 'png'].includes(d.file?.ext ?? '') && (
                    <Button variant="outline" size="sm" onClick={() => setPreview(d)}>
                      <Eye /> Preview
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={() => setReviewing({ doc: d, decision: 'rejected' })}>
                    <XCircle /> Reject
                  </Button>
                  <Button variant="success" size="sm" loading={review.isPending && review.variables?.id === d.id} onClick={() => (d.daysToExpiry !== null && d.daysToExpiry < 0 ? setReviewing({ doc: d, decision: 'approved' }) : quickApprove(d))}>
                    <CheckCircle2 /> Approve
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {data && data.total > 15 && <Pagination page={page} pageSize={15} total={data.total} onPage={setPage} />}
      </Card>
      {preview && <PreviewDialog doc={preview} open onOpenChange={(o) => !o && setPreview(null)} />}
      {reviewing && <ReviewDialog doc={reviewing.doc} initial={reviewing.decision} open onOpenChange={(o) => !o && setReviewing(null)} />}
    </>
  );
}
