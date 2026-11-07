import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, ClipboardList, Clock, FileStack, RefreshCw, Upload, Users, XCircle, type LucideIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useDashboard } from '@/api/hooks';
import { ExpiryText, FileIcon, STATUS_META, StatusBadge } from '@/components/documents/status';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, EmptyState, PageHeader, Skeleton } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';
import type { Dashboard, DocumentItem, DocumentStatus } from '@/lib/types';
import { cn, fmtAgo, titleCase } from '@/lib/utils';

const BAR = '#2563eb';

function StatCard({ label, value, icon: Icon, tone, to, hint }: { label: string; value: number | undefined; icon: LucideIcon; tone: string; to?: string; hint?: string }) {
  const body = (
    <Card className={cn('group h-full p-5 transition-all', to && 'hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md')}>
      <div className="flex items-start justify-between">
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        <span className={cn('flex size-9 items-center justify-center rounded-lg', tone)}>
          <Icon className="size-[18px]" />
        </span>
      </div>
      <div className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">{value ?? <Skeleton className="h-8 w-16" />}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

function MonthTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-sm shadow-lg">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{payload[0].value} uploads</div>
    </div>
  );
}

function UploadsChart({ data }: { data: Dashboard['uploadsByMonth'] }) {
  const rows = data.map((d) => ({ ...d, label: new Date(`${d.month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }) }));
  const total = rows.reduce((a, r) => a + r.uploads, 0);
  return (
    <Card className="h-full">
      <CardHeader title="Uploads per month" description={`${total} file${total === 1 ? '' : 's'} uploaded in the last 6 months (incl. new versions)`} />
      <div className="h-64 px-2 pt-4 pb-2" role="img" aria-label={`Uploads per month: ${rows.map((r) => `${r.label} ${r.uploads}`).join(', ')}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 16, left: -12, bottom: 0 }} barCategoryGap="32%">
            <CartesianGrid vertical={false} stroke="#e8edf3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#64748b' }} width={40} />
            <Tooltip content={<MonthTooltip />} cursor={{ fill: 'rgba(37,99,235,0.06)' }} />
            <Bar dataKey="uploads" fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={44} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function StatusBreakdown({ t }: { t: Dashboard['totals'] }) {
  const navigate = useNavigate();
  const rows: { status: DocumentStatus; n: number }[] = [
    { status: 'pending_review', n: t.pending },
    { status: 'approved', n: t.approved },
    { status: 'renewal_required', n: t.renewalRequired },
    { status: 'rejected', n: t.rejected },
    { status: 'expired', n: t.expired },
  ];
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <Card className="h-full">
      <CardHeader title="Documents by status" description={`${t.documents} active documents`} />
      <ul className="space-y-1 p-3">
        {rows.map((r) => {
          const m = STATUS_META[r.status];
          return (
            <li key={r.status}>
              <button onClick={() => navigate(`/documents?status=${r.status}`)} className="group w-full cursor-pointer rounded-lg px-2 py-2 text-left hover:bg-muted/60" title={`${m.label}: ${r.n}`}>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-foreground">
                    <m.icon className="size-4" style={{ color: m.color }} />
                    {m.label}
                  </span>
                  <span className="font-semibold tabular-nums">{r.n}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${(r.n / max) * 100}%`, background: m.color }} />
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function CategoryBars({ data }: { data: Dashboard['byCategory'] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <Card className="h-full">
      <CardHeader title="Documents by category" />
      {data.length === 0 ? (
        <EmptyState title="No documents yet" className="py-10" />
      ) : (
        <ul className="space-y-3 p-5">
          {data.map((d) => (
            <li key={d.name} title={`${d.name}: ${d.count}`}>
              <div className="flex justify-between text-sm">
                <span className="truncate">{d.name}</span>
                <span className="font-semibold tabular-nums">{d.count}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full" style={{ width: `${(d.count / max) * 100}%`, background: BAR }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DocList({ title, items, empty, action, kind }: { title: string; items: DocumentItem[]; empty: string; action?: React.ReactNode; kind: 'recent' | 'pending' | 'expiry' }) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader title={title} action={action} />
      {items.length === 0 ? (
        <EmptyState title={empty} className="flex-1 py-10" />
      ) : (
        <ul className="divide-y">
          {items.map((d) => (
            <li key={d.id}>
              <Link to={`/documents/${d.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/50">
                <FileIcon ext={d.file?.ext} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{d.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {d.employeeName} · {kind === 'pending' ? `waiting ${fmtAgo(d.uploadedAt).replace(' ago', '')}` : fmtAgo(d.uploadedAt)}
                  </div>
                </div>
                {kind === 'expiry' ? <ExpiryText date={d.expiryDate} days={d.daysToExpiry} status={d.status} /> : <StatusBadge status={d.status} />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const ACTIVITY_LABEL: Record<string, string> = {
  'document.uploaded': 'uploaded',
  'document.version_uploaded': 'uploaded a new version of',
  'document.reviewed': 'reviewed',
  'document.updated': 'updated',
  'document.moved': 'moved',
  'document.archived': 'archived',
  'document.unarchived': 'restored',
  'document.deleted': 'deleted',
  'document.downloaded': 'downloaded',
  'document.previewed': 'previewed',
  'document.commented': 'commented on',
  'document.expired': 'marked expired:',
  'document.renewal_required': 'flagged for renewal:',
  'request.created': 'requested a document',
  'user.created': 'created a user',
  'client.created': 'created a client',
  'folder.created': 'created a folder',
};

function Activity({ items }: { items: Dashboard['recentActivity'] }) {
  return (
    <Card className="h-full">
      <CardHeader title="Recent activity" />
      {items.length === 0 ? (
        <EmptyState title="No activity yet" className="py-10" />
      ) : (
        <ol className="space-y-4 p-5">
          {items.map((a) => {
            const decision = a.action === 'document.reviewed' ? (a.metadata?.decision as string | undefined) : undefined;
            const verb = decision ? (decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : 'requested renewal of') : (ACTIVITY_LABEL[a.action] ?? titleCase(a.action.replace('.', ' ')));
            const subject = a.documentTitle ?? (a.metadata?.title as string | undefined) ?? (a.metadata?.name as string | undefined);
            return (
              <li key={a.id} className="flex gap-3 text-sm">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary/60" />
                <div className="min-w-0">
                  <p className="leading-snug">
                    <span className="font-medium">{a.actorName}</span> <span className="text-muted-foreground">{verb}</span>{' '}
                    {subject && (a.entityType === 'document' && a.entityId && a.action !== 'document.deleted' ? <Link className="font-medium hover:underline" to={`/documents/${a.entityId}`}>{subject}</Link> : <span className="font-medium">{subject}</span>)}
                  </p>
                  <span className="text-xs text-muted-foreground">{fmtAgo(a.createdAt)}</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

export default function DashboardPage() {
  const { user, isEmployee, can } = useAuth();
  const { data, isLoading } = useDashboard();
  const t = data?.totals;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageHeader
        title={`${greeting}, ${user?.firstName}`}
        description={isEmployee ? 'Here is the status of your documents and certificates.' : 'Overview of document compliance across your clients.'}
        actions={
          <>
            {(isEmployee || can('documents.upload')) && (
              <Button asChild>
                <Link to="/upload"><Upload /> Upload</Link>
              </Button>
            )}
            {can('documents.review') && (
              <Button asChild variant="outline">
                <Link to="/reviews">Review queue <ArrowRight /></Link>
              </Button>
            )}
          </>
        }
      />

      {isEmployee && t && (t.expired > 0 || t.renewalRequired > 0 || t.rejected > 0 || t.openRequests > 0) && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
          <AlertTriangle className="size-5 shrink-0" />
          <div className="flex-1">
            <span className="font-semibold">Action needed: </span>
            {[
              t.expired && `${t.expired} expired`,
              t.renewalRequired && `${t.renewalRequired} need renewal`,
              t.rejected && `${t.rejected} rejected`,
              t.openRequests && `${t.openRequests} requested document${t.openRequests > 1 ? 's' : ''}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
          <Button size="sm" variant="outline" asChild>
            <Link to={t.openRequests ? '/requests' : '/certificates'}>Resolve now</Link>
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {!isEmployee && <StatCard label="Total employees" value={t?.employees} icon={Users} tone="bg-navy/5 text-navy" to="/employees" />}
        <StatCard label={isEmployee ? 'My documents' : 'Total documents'} value={t?.documents} icon={FileStack} tone="bg-blue-50 text-blue-600" to="/documents" />
        <StatCard label="Pending review" value={t?.pending} icon={Clock} tone="bg-amber-50 text-amber-600" to={can('documents.review') ? '/reviews' : '/documents?status=pending_review'} />
        <StatCard label="Approved" value={t?.approved} icon={CheckCircle2} tone="bg-emerald-50 text-emerald-600" to="/documents?status=approved" />
        {isEmployee && <StatCard label="Open requests" value={t?.openRequests} icon={ClipboardList} tone="bg-violet-50 text-violet-600" to="/requests" />}
        <StatCard label="Rejected" value={t?.rejected} icon={XCircle} tone="bg-red-50 text-red-600" to="/documents?status=rejected" />
        <StatCard label="Expired certificates" value={t?.expired} icon={AlertTriangle} tone="bg-slate-100 text-slate-600" to="/certificates?tab=expired" />
        <StatCard label="Expiring in 30 days" value={t?.expiring30} icon={CalendarClock} tone="bg-orange-50 text-orange-600" to="/certificates?tab=30" hint={t ? `${t.expiring60} in 60 days · ${t.expiring90} in 90 days` : undefined} />
        <StatCard label="Renewal required" value={t?.renewalRequired} icon={RefreshCw} tone="bg-orange-50 text-orange-600" to="/documents?status=renewal_required" />
        {!isEmployee && <StatCard label="Open requests" value={t?.openRequests} icon={ClipboardList} tone="bg-violet-50 text-violet-600" to="/requests" hint={t?.overdueRequests ? `${t.overdueRequests} overdue` : undefined} />}
      </div>

      {isLoading || !data ? (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Skeleton className="h-80 lg:col-span-2" />
          <Skeleton className="h-80" />
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <UploadsChart data={data.uploadsByMonth} />
            </div>
            <StatusBreakdown t={data.totals} />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
            {can('documents.review') ? (
              <DocList title="Pending approvals" items={data.pendingApprovals} empty="Nothing waiting for review" kind="pending" action={<Link to="/reviews" className="text-sm font-medium text-primary hover:underline">View all</Link>} />
            ) : (
              <DocList title="Recent uploads" items={data.recentUploads} empty="No uploads yet" kind="recent" action={<Link to="/documents" className="text-sm font-medium text-primary hover:underline">View all</Link>} />
            )}
            <DocList title="Expiring soon" items={data.expiringSoon} empty="No certificates expire in the next 90 days" kind="expiry" action={<Link to="/certificates" className="text-sm font-medium text-primary hover:underline">Tracker</Link>} />
            <Activity items={data.recentActivity} />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {can('documents.review') && <DocList title="Recent uploads" items={data.recentUploads} empty="No uploads yet" kind="recent" />}
            <CategoryBars data={data.byCategory} />
          </div>
        </>
      )}
    </>
  );
}
