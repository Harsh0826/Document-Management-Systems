import { ArrowLeft, CheckCircle2, ChevronRight, Download, Eye, History, Lock, MessageSquare, RefreshCw, Send, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { errorMessage } from '@/api/client';
import { downloadDocument, useAddComment, useDocument, useDocumentHistory } from '@/api/hooks';
import { DocumentActions } from '@/components/documents/DocumentActions';
import { PreviewDialog } from '@/components/documents/dialogs';
import { ExpiryText, FileIcon, StatusBadge } from '@/components/documents/status';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, CardHeader, EmptyState } from '@/components/ui/card';
import { Switch, Textarea } from '@/components/ui/form-controls';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { PageLoader } from '@/components/ui/spinner';
import { useAuth } from '@/lib/auth';
import { cn, fmtAgo, fmtBytes, fmtDate, fmtDateTime, titleCase } from '@/lib/utils';

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{children}</dd>
    </div>
  );
}

const DECISION_STYLE = {
  approved: { icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-600', label: 'Approved' },
  rejected: { icon: XCircle, cls: 'bg-red-50 text-red-600', label: 'Rejected' },
  renewal_required: { icon: RefreshCw, cls: 'bg-orange-50 text-orange-600', label: 'Renewal required' },
};

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isEmployee } = useAuth();
  const { data: doc, isLoading, isError, error } = useDocument(id);
  const [previewVersion, setPreviewVersion] = useState<string | null>(null);
  const [tab, setTab] = useState('versions');
  const history = useDocumentHistory(id!, tab === 'history' && !isEmployee);

  if (isLoading) return <PageLoader />;
  if (isError || !doc) return <EmptyState icon={<Lock />} title="Document unavailable" description={errorMessage(error)} action={<Button variant="outline" onClick={() => navigate('/documents')}>Back to documents</Button>} />;

  const latestRejection = doc.approvals.find((a) => a.decision !== 'approved');
  const showFeedback = (doc.status === 'rejected' || doc.status === 'renewal_required') && latestRejection;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <button onClick={() => navigate(-1)} className="mr-2 inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 hover:bg-muted hover:text-foreground">
          <ArrowLeft className="size-4" /> Back
        </button>
        {doc.folderPath.map((p, i) => (
          <span key={p.id} className="inline-flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="size-3.5" />}
            <Link to={`/explorer?folder=${p.id}`} className="hover:text-foreground hover:underline">
              {p.name}
            </Link>
          </span>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <FileIcon ext={doc.file?.ext} className="size-12 [&_svg]:size-6" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{doc.title}</h1>
              <StatusBadge status={doc.status} />
              {doc.isArchived && <Badge>Archived</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {doc.employeeName} · {doc.clientName} · {doc.categoryName ?? 'Uncategorized'}
            </p>
          </div>
        </div>
        <DocumentActions doc={doc} variant="buttons" onDeleted={() => navigate('/documents', { replace: true })} />
      </div>

      {showFeedback && (
        <div className={cn('mb-6 flex gap-3 rounded-xl border p-4', doc.status === 'rejected' ? 'border-red-200 bg-red-50 text-red-900' : 'border-orange-200 bg-orange-50 text-orange-900')}>
          {doc.status === 'rejected' ? <XCircle className="mt-0.5 size-5 shrink-0" /> : <RefreshCw className="mt-0.5 size-5 shrink-0" />}
          <div className="text-sm">
            <div className="font-semibold">{doc.status === 'rejected' ? 'This document was rejected' : 'A renewed document is required'}</div>
            <p className="mt-0.5">{latestRejection.comment}</p>
            <p className="mt-1 text-xs opacity-75">
              {latestRejection.reviewerName} · {fmtAgo(latestRejection.createdAt)}
              {doc.can.replace && ' — upload a new version to resubmit.'}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <Tabs value={tab} onValueChange={setTab}>
              <div className="border-b px-5 pt-4 pb-3">
                <TabsList>
                  <TabsTrigger value="versions">Versions ({doc.versions.length})</TabsTrigger>
                  <TabsTrigger value="reviews">Reviews ({doc.approvals.length})</TabsTrigger>
                  <TabsTrigger value="comments">Comments ({doc.comments.length})</TabsTrigger>
                  {!isEmployee && <TabsTrigger value="history"><History className="size-3.5" /> Activity</TabsTrigger>}
                </TabsList>
              </div>
              <TabsContent value="versions" className="mt-0">
                <ol className="divide-y">
                  {doc.versions.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                      <FileIcon ext={v.ext} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium">{v.filename}</span>
                          <Badge tone={v.id === doc.file?.versionId ? 'blue' : 'slate'}>v{v.versionNumber}{v.id === doc.file?.versionId && ' · current'}</Badge>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {fmtBytes(v.sizeBytes)} · uploaded {fmtDateTime(v.createdAt)} by {v.uploadedByName ?? 'unknown'}
                          {v.expiryDate && ` · expires ${fmtDate(v.expiryDate)}`}
                        </div>
                        {v.changeNote && <div className="mt-1 text-sm text-muted-foreground">“{v.changeNote}”</div>}
                      </div>
                      {doc.can.download && (
                        <div className="flex gap-1">
                          {['pdf', 'jpg', 'jpeg', 'png'].includes(v.ext) && (
                            <Button variant="ghost" size="icon-sm" onClick={() => setPreviewVersion(v.id)} aria-label={`Preview version ${v.versionNumber}`}>
                              <Eye />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon-sm" onClick={() => downloadDocument(doc.id, v.id).catch((e) => toast.error(errorMessage(e)))} aria-label={`Download version ${v.versionNumber}`}>
                            <Download />
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </TabsContent>
              <TabsContent value="reviews" className="mt-0">
                {doc.approvals.length === 0 ? (
                  <EmptyState title="Not reviewed yet" description="Review decisions will appear here." className="py-10" />
                ) : (
                  <ol className="divide-y">
                    {doc.approvals.map((a) => {
                      const s = DECISION_STYLE[a.decision];
                      return (
                        <li key={a.id} className="flex gap-3 px-5 py-4">
                          <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full', s.cls)}>
                            <s.icon className="size-4" />
                          </span>
                          <div className="min-w-0 text-sm">
                            <div>
                              <span className="font-medium">{s.label}</span> by {a.reviewerName ?? 'unknown'} {a.versionNumber && <span className="text-muted-foreground">(v{a.versionNumber})</span>}
                            </div>
                            {a.comment && <p className="mt-1 text-muted-foreground">{a.comment}</p>}
                            <div className="mt-1 text-xs text-muted-foreground">{fmtDateTime(a.createdAt)}</div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </TabsContent>
              <TabsContent value="comments" className="mt-0">
                <Comments docId={doc.id} comments={doc.comments} canComment={doc.can.comment} canInternal={doc.can.comment_internal && !isEmployee} />
              </TabsContent>
              {!isEmployee && (
                <TabsContent value="history" className="mt-0">
                  {history.isLoading ? (
                    <PageLoader />
                  ) : (
                    <ol className="divide-y text-sm">
                      {history.data?.map((h) => (
                        <li key={h.id} className="flex items-start justify-between gap-4 px-5 py-3">
                          <div>
                            <span className="font-medium">{titleCase(h.action.replace('document.', ''))}</span>
                            <span className="text-muted-foreground"> · {h.actorName ?? 'System'}</span>
                            {typeof h.metadata?.filename === 'string' && <div className="text-xs text-muted-foreground">{h.metadata.filename}</div>}
                          </div>
                          <span className="whitespace-nowrap text-xs text-muted-foreground">{fmtDateTime(h.createdAt)}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </TabsContent>
              )}
            </Tabs>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <dl className="divide-y px-5">
              <Meta label="Employee">{doc.employeeName}</Meta>
              {doc.employeeNumber && <Meta label="Employee no.">{doc.employeeNumber}</Meta>}
              <Meta label="Client">{doc.clientName}</Meta>
              <Meta label="Category">{doc.categoryName ?? 'Uncategorized'}</Meta>
              <Meta label="Folder">{doc.folderName ?? '—'}</Meta>
              <Meta label="Issue date">{fmtDate(doc.issueDate)}</Meta>
              <Meta label="Expiration">
                <ExpiryText date={doc.expiryDate} days={doc.daysToExpiry} status={doc.status} />
              </Meta>
              <Meta label="File type">{doc.file?.ext.toUpperCase()}</Meta>
              <Meta label="Size">{fmtBytes(doc.file?.sizeBytes)}</Meta>
              <Meta label="Uploaded">{fmtDateTime(doc.uploadedAt)}</Meta>
              <Meta label="Uploaded by">{doc.uploadedByName ?? '—'}</Meta>
              <Meta label="First submitted">{fmtDate(doc.createdAt)}</Meta>
            </dl>
            {doc.description && (
              <div className="border-t px-5 py-4 text-sm">
                <div className="mb-1 text-muted-foreground">Description</div>
                <p className="whitespace-pre-wrap">{doc.description}</p>
              </div>
            )}
            {doc.versions[0] && (
              <div className="border-t px-5 py-3 text-[11px] text-muted-foreground">
                SHA-256 <span className="break-all font-mono">{doc.versions[0].checksum}</span>
              </div>
            )}
          </Card>
        </div>
      </div>
      {previewVersion && <PreviewDialog doc={doc} versionId={previewVersion} open onOpenChange={(o) => !o && setPreviewVersion(null)} />}
    </>
  );
}

function Comments({ docId, comments, canComment, canInternal }: { docId: string; comments: import('@/lib/types').DocComment[]; canComment: boolean; canInternal: boolean }) {
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const add = useAddComment(docId);
  const submit = () => {
    if (!body.trim()) return;
    add.mutate(
      { body: body.trim(), isInternal: internal },
      { onSuccess: () => (setBody(''), toast.success(internal ? 'Internal note added' : 'Comment added')), onError: (e) => toast.error(errorMessage(e)) },
    );
  };
  return (
    <div>
      {comments.length === 0 ? (
        <EmptyState icon={<MessageSquare />} title="No comments yet" description="Questions and notes about this document appear here." className="py-10" />
      ) : (
        <ul className="space-y-4 px-5 py-4">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-3">
              <Avatar name={c.authorName ?? '?'} />
              <div className={cn('min-w-0 flex-1 rounded-lg px-3.5 py-2.5', c.isInternal ? 'border border-amber-200 bg-amber-50' : 'bg-muted')}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{c.authorName ?? 'Deleted user'}</span>
                  {c.authorRole && <span className="text-xs capitalize text-muted-foreground">{c.authorRole}</span>}
                  {c.isInternal && (
                    <Badge tone="amber">
                      <Lock className="size-3" /> Internal
                    </Badge>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">{fmtAgo(c.createdAt)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {canComment && (
        <div className="border-t p-4">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={internal ? 'Internal note — only staff and admins can see this' : 'Write a comment…'} rows={3} maxLength={5000} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            {canInternal ? (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Switch checked={internal} onCheckedChange={setInternal} /> Internal note (hidden from employee)
              </label>
            ) : (
              <span />
            )}
            <Button size="sm" onClick={submit} loading={add.isPending} disabled={!body.trim()}>
              <Send /> Post
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
