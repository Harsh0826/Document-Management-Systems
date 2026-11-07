import { AlertTriangle, CalendarClock, CalendarRange, RefreshCw } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useDashboard, useDocuments, type DocumentFilters } from '@/api/hooks';
import { DocumentTable } from '@/components/documents/DocumentTable';
import { Card, EmptyState, PageHeader } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { Pagination } from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import { cn, todayIso } from '@/lib/utils';

const TABS = [
  { value: 'expired', label: 'Expired', icon: AlertTriangle },
  { value: 'renewal', label: 'Renewal required', icon: RefreshCw },
  { value: '30', label: 'Within 30 days', icon: CalendarClock },
  { value: '60', label: 'Within 60 days', icon: CalendarClock },
  { value: '90', label: 'Within 90 days', icon: CalendarRange },
] as const;

function filtersFor(tab: string): DocumentFilters {
  switch (tab) {
    case 'expired':
      return { status: ['expired'], sort: 'expiryDate', order: 'asc' };
    case 'renewal':
      return { status: ['renewal_required'], sort: 'expiryDate', order: 'asc' };
    default:
      return { expiryFrom: todayIso(), expiringWithin: Number(tab), status: ['approved', 'pending_review', 'renewal_required'], sort: 'expiryDate', order: 'asc' };
  }
}

export default function CertificatesPage() {
  const { isEmployee } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'expired';
  const page = Number(params.get('page') ?? 1);
  const { data: dash } = useDashboard();
  const { data, isLoading } = useDocuments({ ...filtersFor(tab), page, pageSize: 20 });
  const t = dash?.totals;
  const counts: Record<string, number | undefined> = { expired: t?.expired, renewal: t?.renewalRequired, '30': t?.expiring30, '60': t?.expiring60, '90': t?.expiring90 };

  return (
    <>
      <PageHeader
        title="Certificate expiry tracking"
        description={isEmployee ? 'Keep your certificates current. Upload renewals before they expire.' : 'Certificates that have expired or are approaching expiration. Reminders are sent automatically at 90, 60 and 30 days.'}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {TABS.map((x) => (
          <button
            key={x.value}
            onClick={() => setParams({ tab: x.value })}
            className={cn(
              'cursor-pointer rounded-xl border bg-card p-4 text-left shadow-xs transition-all hover:border-primary/30',
              tab === x.value && 'border-primary ring-2 ring-primary/20',
            )}
          >
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <x.icon className={cn('size-4', x.value === 'expired' ? 'text-red-500' : x.value === 'renewal' || x.value === '30' ? 'text-orange-500' : 'text-amber-500')} />
              {x.label}
            </div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{counts[x.value] ?? '—'}</div>
          </button>
        ))}
      </div>
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className="mb-4 hidden md:inline-flex">
          {TABS.map((x) => (
            <TabsTrigger key={x.value} value={x.value}>{x.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Card className="overflow-hidden">
        <DocumentTable
          items={data?.items}
          loading={isLoading}
          columns={isEmployee ? ['category', 'expiryDate', 'status'] : ['employee', 'client', 'category', 'expiryDate', 'status']}
          empty={<EmptyState icon={<CalendarClock />} title="Nothing here" description={tab === 'expired' ? 'No expired certificates.' : 'No certificates in this window.'} />}
        />
        {data && data.total > 20 && <Pagination page={page} pageSize={20} total={data.total} onPage={(p) => setParams({ tab, page: String(p) })} />}
      </Card>
    </>
  );
}
