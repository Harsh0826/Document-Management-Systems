import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Copy, KeyRound, Link2, MoreHorizontal, Pencil, Plus, Search, ShieldCheck, UserCheck, UserX, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { applyFieldErrors, errorMessage } from '@/api/client';
import { useClients, useCreateUser, usePermissions, useSetClients, useSetPermissions, useUpdateUser, useUser, useUserAction, useUsers, type CreateUserInput } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, EmptyState, PageHeader } from '@/components/ui/card';
import { Checkbox, Field, Input, NativeSelect } from '@/components/ui/form-controls';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { PageLoader } from '@/components/ui/spinner';
import { Pagination, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import type { Permission, Role, UserListItem } from '@/lib/types';
import { fmtAgo, fmtDate } from '@/lib/utils';

const ROLE_TONE = { admin: 'navy', staff: 'blue', employee: 'slate' } as const;
const STATUS_TONE = { active: 'green', invited: 'amber', deactivated: 'slate' } as const;
const DEFAULT_STAFF_PERMS: Permission[] = ['documents.download', 'documents.comment'];

function InviteLink({ url, hours }: { url: string; hours: number | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-blue-900">
        <Link2 className="size-4" /> Invitation link{hours ? ` (valid ${hours} hours, single use)` : ''}
      </div>
      <div className="mt-2 flex gap-2">
        <Input readOnly value={url} className="bg-white font-mono text-xs" onFocus={(e) => e.target.select()} />
        <Button
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="mt-2 text-xs text-blue-800">Send this link to the user securely. They will set their own password.</p>
    </div>
  );
}

// ======================================================================= Create user
const createSchema = z
  .object({
    role: z.enum(['admin', 'staff', 'employee']),
    firstName: z.string().trim().min(1, 'Required').max(100),
    lastName: z.string().trim().min(1, 'Required').max(100),
    email: z.string().trim().min(1, 'Required').email('Invalid email'),
    jobTitle: z.string().max(100).optional(),
    phone: z.string().max(40).optional(),
    clientId: z.string().optional(),
    employeeNumber: z.string().max(50).optional(),
    department: z.string().max(100).optional(),
    position: z.string().max(100).optional(),
    hireDate: z.string().optional(),
  })
  .refine((v) => v.role !== 'employee' || !!v.clientId, { path: ['clientId'], message: 'Select a client' });

function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: clients } = useClients();
  const { data: perms } = usePermissions();
  const create = useCreateUser();
  const [result, setResult] = useState<{ url: string; hours: number | null; name: string } | null>(null);
  const [staffPerms, setStaffPerms] = useState<Permission[]>(DEFAULT_STAFF_PERMS);
  const [staffClients, setStaffClients] = useState<string[]>([]);
  const form = useForm<z.infer<typeof createSchema>>({ resolver: zodResolver(createSchema), defaultValues: { role: 'employee' } });
  const role = form.watch('role');
  const err = form.formState.errors;

  useEffect(() => {
    if (open) {
      form.reset({ role: 'employee' });
      setResult(null);
      setStaffPerms(DEFAULT_STAFF_PERMS);
      setStaffClients([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSubmit = form.handleSubmit((v) => {
    const body: CreateUserInput = { ...v, role: v.role as Role & CreateUserInput['role'] };
    if (v.role === 'staff') Object.assign(body, { permissions: staffPerms, clientIds: staffClients });
    if (v.role !== 'employee') for (const k of ['clientId', 'employeeNumber', 'department', 'position', 'hireDate'] as const) delete body[k];
    for (const [k, val] of Object.entries(body)) if (val === '') delete (body as unknown as Record<string, unknown>)[k];
    create.mutate(body, {
      onSuccess: (r) => {
        toast.success('User created');
        if (r.inviteUrl) setResult({ url: r.inviteUrl, hours: r.inviteExpiresInHours, name: `${r.user.firstName} ${r.user.lastName}` });
        else onOpenChange(false);
      },
      onError: (e) => !applyFieldErrors(e, form.setError) && toast.error(errorMessage(e)),
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={result ? `Invite ${result.name}` : 'Add user'} description={result ? undefined : 'The user receives an invitation link to set their own password.'} size="lg">
        {result ? (
          <>
            <InviteLink url={result.url} hours={result.hours} />
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            <div className="grid grid-cols-3 gap-2">
              {(['employee', 'staff', 'admin'] as const).map((r) => (
                <label key={r} className={`flex cursor-pointer flex-col rounded-lg border-2 p-3 text-sm transition-colors ${role === r ? 'border-primary bg-accent' : 'hover:bg-muted'}`}>
                  <input type="radio" value={r} className="sr-only" {...form.register('role')} />
                  <span className="font-semibold capitalize">{r === 'staff' ? 'Internal staff' : r === 'employee' ? 'Client employee' : 'Administrator'}</span>
                  <span className="mt-0.5 text-xs text-muted-foreground">{r === 'employee' ? 'Uploads own documents' : r === 'staff' ? 'Configurable access' : 'Full control'}</span>
                </label>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="First name" required error={err.firstName?.message}><Input {...form.register('firstName')} /></Field>
              <Field label="Last name" required error={err.lastName?.message}><Input {...form.register('lastName')} /></Field>
              <Field label="Email" required error={err.email?.message} className="sm:col-span-2"><Input type="email" {...form.register('email')} /></Field>
              <Field label="Job title"><Input {...form.register('jobTitle')} /></Field>
              <Field label="Phone"><Input {...form.register('phone')} /></Field>
            </div>
            {role === 'employee' && (
              <div className="grid gap-4 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2">
                <Field label="Client / company" required error={err.clientId?.message} className="sm:col-span-2">
                  <NativeSelect {...form.register('clientId')}>
                    <option value="">Select client…</option>
                    {clients?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </NativeSelect>
                </Field>
                <Field label="Employee number" error={err.employeeNumber?.message}><Input {...form.register('employeeNumber')} /></Field>
                <Field label="Hire date"><Input type="date" {...form.register('hireDate')} /></Field>
                <Field label="Department"><Input {...form.register('department')} /></Field>
                <Field label="Position"><Input {...form.register('position')} /></Field>
              </div>
            )}
            {role === 'staff' && (
              <div className="grid gap-4 rounded-lg border bg-muted/30 p-4 md:grid-cols-2">
                <PermissionPicker perms={perms ?? []} value={staffPerms} onChange={setStaffPerms} />
                <ClientPicker clients={clients ?? []} value={staffClients} onChange={setStaffClients} />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" loading={create.isPending}><Plus /> Create & invite</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PermissionPicker({ perms, value, onChange }: { perms: { key: Permission; description: string; grantableToStaff: boolean }[]; value: Permission[]; onChange: (v: Permission[]) => void }) {
  return (
    <div>
      <div className="mb-2 text-sm font-medium">Permissions</div>
      <div className="space-y-1">
        <label className="flex items-start gap-2.5 rounded-md p-1.5 text-sm opacity-70">
          <Checkbox checked disabled className="mt-0.5" />
          <span><span className="font-medium">View documents</span><span className="block text-xs text-muted-foreground">Always granted to staff, limited to assigned clients</span></span>
        </label>
        {perms
          .filter((p) => p.grantableToStaff)
          .map((p) => (
            <label key={p.key} className="flex cursor-pointer items-start gap-2.5 rounded-md p-1.5 text-sm hover:bg-card">
              <Checkbox className="mt-0.5" checked={value.includes(p.key)} onCheckedChange={(c) => onChange(c ? [...value, p.key] : value.filter((x) => x !== p.key))} />
              <span>
                <span className="font-medium">{p.description}</span>
                <span className="block font-mono text-[11px] text-muted-foreground">{p.key}</span>
              </span>
            </label>
          ))}
      </div>
    </div>
  );
}

function ClientPicker({ clients, value, onChange }: { clients: { id: string; name: string; code: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div>
      <div className="mb-2 text-sm font-medium">Assigned clients <span className="font-normal text-muted-foreground">({value.length})</span></div>
      <div className="scroll-thin max-h-72 space-y-1 overflow-y-auto">
        {clients.map((c) => (
          <label key={c.id} className="flex cursor-pointer items-center gap-2.5 rounded-md p-1.5 text-sm hover:bg-card">
            <Checkbox checked={value.includes(c.id)} onCheckedChange={(ch) => onChange(ch ? [...value, c.id] : value.filter((x) => x !== c.id))} />
            <span className="flex-1">{c.name}</span>
            <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
          </label>
        ))}
        {!clients.length && <p className="text-sm text-muted-foreground">No clients yet.</p>}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Staff can only see documents of the clients assigned here.</p>
    </div>
  );
}

// ======================================================================= Edit user
function EditUserDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { user: me } = useAuth();
  const { data: u, isLoading } = useUser(id);
  const { data: perms } = usePermissions();
  const { data: clients } = useClients(true);
  const update = useUpdateUser(id);
  const setPerms = useSetPermissions(id);
  const setClients = useSetClients(id);
  const [p, setP] = useState<Permission[]>([]);
  const [c, setC] = useState<string[]>([]);
  const form = useForm<Record<string, string>>();

  useEffect(() => {
    if (u) {
      setP(u.grantedPermissions);
      setC(u.assignedClients.map((x) => x.id));
      form.reset({
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        phone: u.phone ?? '',
        jobTitle: u.jobTitle ?? '',
        role: u.role,
        employeeNumber: u.employee?.employeeNumber ?? '',
        department: u.employee?.department ?? '',
        position: u.employee?.position ?? '',
        hireDate: u.employee?.hireDate ?? '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [u]);

  const save = form.handleSubmit((v) => {
    const body: Record<string, unknown> = { firstName: v.firstName, lastName: v.lastName, email: v.email, phone: v.phone || null, jobTitle: v.jobTitle || null };
    if (u?.role !== 'employee' && v.role !== u?.role) body.role = v.role;
    if (u?.employee) Object.assign(body, { employeeNumber: v.employeeNumber || null, department: v.department || null, position: v.position || null, hireDate: v.hireDate || null });
    update.mutate(body, { onSuccess: () => toast.success('User updated'), onError: (e) => !applyFieldErrors(e, form.setError) && toast.error(errorMessage(e)) });
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={u ? `${u.firstName} ${u.lastName}` : 'User'} description={u ? `${u.email} · ${u.role}` : undefined} size="lg">
        {isLoading || !u ? (
          <PageLoader />
        ) : (
          <Tabs defaultValue="profile">
            <TabsList>
              <TabsTrigger value="profile">Profile</TabsTrigger>
              {u.role === 'staff' && <TabsTrigger value="access">Permissions & clients</TabsTrigger>}
            </TabsList>
            <TabsContent value="profile">
              <form onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
                <Field label="First name" error={form.formState.errors.firstName?.message}><Input {...form.register('firstName')} /></Field>
                <Field label="Last name" error={form.formState.errors.lastName?.message}><Input {...form.register('lastName')} /></Field>
                <Field label="Email" error={form.formState.errors.email?.message} className="sm:col-span-2"><Input type="email" {...form.register('email')} /></Field>
                <Field label="Job title"><Input {...form.register('jobTitle')} /></Field>
                <Field label="Phone"><Input {...form.register('phone')} /></Field>
                {u.role !== 'employee' && (
                  <Field label="Role" hint={u.id === me?.id ? 'You cannot change your own role' : 'Switching to admin grants full access.'} className="sm:col-span-2">
                    <NativeSelect {...form.register('role')} disabled={u.id === me?.id}>
                      <option value="staff">Internal staff</option>
                      <option value="admin">Administrator</option>
                    </NativeSelect>
                  </Field>
                )}
                {u.employee && (
                  <>
                    <Field label="Client" className="sm:col-span-2"><Input value={u.employee.clientName} disabled /></Field>
                    <Field label="Employee number" error={form.formState.errors.employeeNumber?.message}><Input {...form.register('employeeNumber')} /></Field>
                    <Field label="Hire date"><Input type="date" {...form.register('hireDate')} /></Field>
                    <Field label="Department"><Input {...form.register('department')} /></Field>
                    <Field label="Position"><Input {...form.register('position')} /></Field>
                  </>
                )}
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground sm:col-span-2">
                  <span>Created {fmtDate(u.createdAt)} · last sign-in {u.lastLoginAt ? fmtAgo(u.lastLoginAt) : 'never'}</span>
                  <Button type="submit" loading={update.isPending}>Save profile</Button>
                </div>
              </form>
            </TabsContent>
            {u.role === 'staff' && (
              <TabsContent value="access">
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div>
                    <PermissionPicker perms={perms ?? []} value={p} onChange={setP} />
                    <Button className="mt-3" size="sm" loading={setPerms.isPending} onClick={() => setPerms.mutate(p, { onSuccess: () => toast.success('Permissions saved'), onError: (e) => toast.error(errorMessage(e)) })}>
                      <ShieldCheck /> Save permissions
                    </Button>
                  </div>
                  <div>
                    <ClientPicker clients={clients ?? []} value={c} onChange={setC} />
                    <Button className="mt-3" size="sm" loading={setClients.isPending} onClick={() => setClients.mutate(c, { onSuccess: () => toast.success('Client access saved'), onError: (e) => toast.error(errorMessage(e)) })}>
                      Save client access
                    </Button>
                  </div>
                </div>
              </TabsContent>
            )}
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ======================================================================= Page
export default function UsersPage() {
  const { user: me } = useAuth();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [clientId, setClientId] = useState('');
  const [page, setPage] = useState(1);
  const { data: clients } = useClients(true);
  const { data, isLoading } = useUsers({ q: q || undefined, role: role || undefined, status: status || undefined, clientId: clientId || undefined, page, pageSize: 20 });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ user: UserListItem; action: 'deactivate' | 'activate' } | null>(null);
  const [invite, setInvite] = useState<{ url: string; hours: number } | null>(null);
  const action = useUserAction();

  const reinvite = (u: UserListItem) =>
    action.mutate({ id: u.id, action: 'invite' }, { onSuccess: (r) => setInvite({ url: r.inviteUrl, hours: r.inviteExpiresInHours }), onError: (e) => toast.error(errorMessage(e)) });

  return (
    <>
      <PageHeader title="Users & access" description="Manage administrators, internal staff and client employees." actions={<Button onClick={() => setCreating(true)}><Plus /> Add user</Button>} />
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_160px_160px_200px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search name, email or employee no.…" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
        </div>
        <NativeSelect value={role} onChange={(e) => (setRole(e.target.value), setPage(1))} aria-label="Role">
          <option value="">All roles</option>
          <option value="admin">Admins</option>
          <option value="staff">Staff</option>
          <option value="employee">Employees</option>
        </NativeSelect>
        <NativeSelect value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="Status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="invited">Invited</option>
          <option value="deactivated">Deactivated</option>
        </NativeSelect>
        <NativeSelect value={clientId} onChange={(e) => (setClientId(e.target.value), setPage(1))} aria-label="Client">
          <option value="">All clients</option>
          {clients?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
      </div>
      <Card className="overflow-hidden">
        {!isLoading && !data?.items.length ? (
          <EmptyState icon={<Users />} title="No users found" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>User</TH>
                <TH>Role</TH>
                <TH>Client / access</TH>
                <TH>Status</TH>
                <TH>Last sign-in</TH>
                <TH className="w-12" />
              </tr>
            </THead>
            <TBody>
              {data?.items.map((u) => (
                <TR key={u.id} className="cursor-pointer" onClick={() => setEditing(u.id)}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <Avatar name={`${u.firstName} ${u.lastName}`} />
                      <div className="min-w-0">
                        <div className="font-medium">{u.firstName} {u.lastName} {u.id === me?.id && <span className="text-xs font-normal text-muted-foreground">(you)</span>}</div>
                        <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                      </div>
                    </div>
                  </TD>
                  <TD><Badge tone={ROLE_TONE[u.role]} className="capitalize">{u.role}</Badge></TD>
                  <TD className="text-muted-foreground">
                    {u.role === 'employee' ? (
                      <>
                        <div className="text-foreground">{u.clientName}</div>
                        <div className="text-xs">{u.documentCount} documents</div>
                      </>
                    ) : u.role === 'staff' ? (
                      `${u.assignedClientCount} client${u.assignedClientCount === 1 ? '' : 's'}`
                    ) : (
                      'All clients'
                    )}
                  </TD>
                  <TD><Badge tone={STATUS_TONE[u.status]} className="capitalize">{u.status}</Badge></TD>
                  <TD className="text-muted-foreground">{u.lastLoginAt ? fmtAgo(u.lastLoginAt) : 'Never'}</TD>
                  <TD onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${u.email}`}><MoreHorizontal /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onSelect={() => setEditing(u.id)}><Pencil /> Edit</DropdownMenuItem>
                        {u.role === 'staff' && <DropdownMenuItem onSelect={() => setEditing(u.id)}><KeyRound /> Permissions</DropdownMenuItem>}
                        {u.status === 'invited' && <DropdownMenuItem onSelect={() => reinvite(u)}><Link2 /> New invitation link</DropdownMenuItem>}
                        {u.id !== me?.id && (
                          <>
                            <DropdownMenuSeparator />
                            {u.status === 'deactivated' ? (
                              <DropdownMenuItem onSelect={() => setConfirm({ user: u, action: 'activate' })}><UserCheck /> Reactivate</DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem destructive onSelect={() => setConfirm({ user: u, action: 'deactivate' })}><UserX /> Deactivate</DropdownMenuItem>
                            )}
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {data && data.total > 20 && <Pagination page={page} pageSize={20} total={data.total} onPage={setPage} />}
      </Card>

      <CreateUserDialog open={creating} onOpenChange={setCreating} />
      {editing && <EditUserDialog id={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        tone={confirm?.action === 'deactivate' ? 'destructive' : 'default'}
        title={confirm?.action === 'deactivate' ? `Deactivate ${confirm.user.firstName} ${confirm.user.lastName}?` : `Reactivate ${confirm?.user.firstName} ${confirm?.user.lastName}?`}
        description={confirm?.action === 'deactivate' ? 'They will be signed out immediately and cannot sign in. Their documents are kept.' : 'They will be able to sign in again.'}
        confirmLabel={confirm?.action === 'deactivate' ? 'Deactivate' : 'Reactivate'}
        loading={action.isPending}
        onConfirm={() =>
          confirm &&
          action.mutate(
            { id: confirm.user.id, action: confirm.action },
            { onSuccess: () => (toast.success(confirm.action === 'deactivate' ? 'User deactivated' : 'User reactivated'), setConfirm(null)), onError: (e) => toast.error(errorMessage(e)) },
          )
        }
      />
      <Dialog open={!!invite} onOpenChange={(o) => !o && setInvite(null)}>
        <DialogContent title="New invitation link" size="md">
          {invite && <InviteLink url={invite.url} hours={invite.hours} />}
          <DialogFooter><Button onClick={() => setInvite(null)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
