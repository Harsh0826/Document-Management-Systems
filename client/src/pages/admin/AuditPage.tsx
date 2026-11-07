import { ScrollText, Search } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuditActions, useAuditLogs, useClients } from '@/api/hooks';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/form-controls';
import { Pagination, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { fmtDateTime } from '@/lib/utils';

const toneFor = (action: string) =>
  action.includes('failed') || action.includes('rejected') || action.includes('deleted') || action.includes('reuse') || action.includes('deactivated')
    ? 'red'
    : action.startsWith('auth.')
      ? 'slate'
      : action.includes('reviewed') || action.includes('created') || action.includes('uploaded')
        ? 'green'
        : action.includes('downloaded') || action.includes('previewed') || action.includes('viewed')
          ? 'blue'
          : 'amber';

export default function AuditPage() {
  const [f, setF] = useState<Record<string, string | number | undefined>>({ page: 1, pageSize: 50 });
  const { data, isLoading } = useAuditLogs(f);
  const { data: actions } = useAuditActions();
  const { data: clients } = useClients(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const set = (patch: Record<string, string | undefined>) => setF({ ...f, ...patch, page: 1 });

  return (
    <>
      <PageHeader title="Audit log" description="Immutable record of sign-ins, document access and every change." />
      <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_220px_200px_150px_150px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search actor email, action or details…" onChange={(e) => set({ q: e.target.value || undefined })} />
        </div>
        <NativeSelect onChange={(e) => set({ action: e.target.value || undefined })} aria-label="Action">
          <option value="">All actions</option>
          {actions?.map((a) => <option key={a} value={a}>{a}</option>)}
        </NativeSelect>
        <NativeSelect onChange={(e) => set({ clientId: e.target.value || undefined })} aria-label="Client">
          <option value="">All clients</option>
          {clients?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
        <Input type="date" aria-label="From" onChange={(e) => set({ from: e.target.value || undefined })} />
        <Input type="date" aria-label="To" onChange={(e) => set({ to: e.target.value || undefined })} />
      </div>
      <Card className="overflow-hidden">
        {!isLoading && !data?.items.length ? (
          <EmptyState icon={<ScrollText />} title="No matching events" />
        ) : (
          <Table>
            <THead><tr><TH>Time</TH><TH>Actor</TH><TH>Action</TH><TH>Target</TH><TH>Client</TH><TH>IP</TH></tr></THead>
            <TBody>
              {data?.items.map((a) => (
                <Fragment key={a.id}>
                  <TR className="cursor-pointer" onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
                    <TD className="whitespace-nowrap text-muted-foreground">{fmtDateTime(a.createdAt)}</TD>
                    <TD><div className="font-medium">{a.actorName ?? a.actorEmail ?? 'System'}</div>{a.actorName && <div className="text-xs text-muted-foreground">{a.actorEmail}</div>}</TD>
                    <TD><Badge tone={toneFor(a.action)} className="font-mono">{a.action}</Badge></TD>
                    <TD className="text-muted-foreground">
                      {a.entityType === 'document' && a.entityId && a.action !== 'document.deleted' ? (
                        <Link onClick={(e) => e.stopPropagation()} to={`/documents/${a.entityId}`} className="text-primary hover:underline">{a.documentTitle ?? (a.metadata.title as string) ?? 'Document'}</Link>
                      ) : (
                        <span>{a.entityType ?? '—'}{typeof a.metadata.title === 'string' ? `: ${a.metadata.title}` : typeof a.metadata.name === 'string' ? `: ${a.metadata.name}` : ''}</span>
                      )}
                    </TD>
                    <TD className="text-muted-foreground">{a.clientName ?? '—'}</TD>
                    <TD className="font-mono text-xs text-muted-foreground">{a.ip ?? '—'}</TD>
                  </TR>
                  {expanded === a.id && (
                    <tr className="bg-muted/40">
                      <td colSpan={6} className="px-4 py-3">
                        <pre className="scroll-thin max-h-60 overflow-auto rounded-md bg-navy p-3 text-xs text-slate-100">{JSON.stringify({ entityId: a.entityId, userAgent: a.userAgent, ...a.metadata }, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </TBody>
          </Table>
        )}
        {data && data.total > 0 && <Pagination page={Number(f.page)} pageSize={50} total={data.total} onPage={(page) => setF({ ...f, page })} />}
      </Card>
    </>
  );
}
