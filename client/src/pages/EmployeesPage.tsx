import { ClipboardList, FileStack, Search, Upload, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useClients, useEmployees } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, EmptyState, PageHeader } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/form-controls';
import { Pagination, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import { NewRequestDialog } from './RequestsPage';

export default function EmployeesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [clientId, setClientId] = useState('');
  const [page, setPage] = useState(1);
  const { data: clients } = useClients();
  const { data, isLoading } = useEmployees({ q: q || undefined, clientId: clientId || undefined, page, pageSize: 25 });
  const [requestFor, setRequestFor] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Employees" description="Client employees you have access to, with their document status." />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search by name, email or employee number…" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
        </div>
        {(clients?.length ?? 0) > 1 && (
          <NativeSelect className="w-56" value={clientId} onChange={(e) => (setClientId(e.target.value), setPage(1))}>
            <option value="">All clients</option>
            {clients?.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </NativeSelect>
        )}
      </div>
      <Card className="overflow-hidden">
        {!isLoading && !data?.items.length ? (
          <EmptyState icon={<UsersRound />} title="No employees found" description={can('users.manage') ? 'Add employees from Users & Access.' : 'No employees are assigned to your clients yet.'} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Employee</TH>
                <TH>Client</TH>
                <TH>Department</TH>
                <TH className="text-center">Documents</TH>
                <TH className="text-center">Pending</TH>
                <TH className="text-center">Expired</TH>
                <TH className="text-center">Open requests</TH>
                <TH className="text-right">Actions</TH>
              </tr>
            </THead>
            <TBody>
              {data?.items.map((e) => (
                <TR key={e.id}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <Avatar name={`${e.firstName} ${e.lastName}`} />
                      <div>
                        <div className="font-medium">{e.firstName} {e.lastName}</div>
                        <div className="text-xs text-muted-foreground">{e.employeeNumber ? `${e.employeeNumber} · ` : ''}{e.email}</div>
                      </div>
                      {e.status !== 'active' && <Badge tone={e.status === 'invited' ? 'blue' : 'slate'}>{e.status}</Badge>}
                    </div>
                  </TD>
                  <TD>{e.clientName}</TD>
                  <TD className="text-muted-foreground">{[e.department, e.position].filter(Boolean).join(' · ') || '—'}</TD>
                  <TD className="text-center tabular-nums">{e.documentCount}</TD>
                  <TD className="text-center">{e.pendingCount ? <Badge tone="amber">{e.pendingCount}</Badge> : <span className="text-muted-foreground">0</span>}</TD>
                  <TD className="text-center">{e.expiredCount ? <Badge tone="red">{e.expiredCount}</Badge> : <span className="text-muted-foreground">0</span>}</TD>
                  <TD className="text-center">{e.openRequestCount ? <Badge tone="violet">{e.openRequestCount}</Badge> : <span className="text-muted-foreground">0</span>}</TD>
                  <TD>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/documents?employeeId=${e.id}`)} title="View documents">
                        <FileStack />
                      </Button>
                      {can('documents.upload') && (
                        <Button size="sm" variant="ghost" asChild title="Upload on behalf">
                          <Link to={`/upload?employeeId=${e.id}`}><Upload /></Link>
                        </Button>
                      )}
                      {can('requests.manage') && (
                        <Button size="sm" variant="ghost" onClick={() => setRequestFor(e.id)} title="Request a document">
                          <ClipboardList />
                        </Button>
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {data && data.total > 25 && <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />}
      </Card>
      {requestFor && <NewRequestDialog open preselected={[requestFor]} onOpenChange={(o) => !o && setRequestFor(null)} />}
    </>
  );
}
