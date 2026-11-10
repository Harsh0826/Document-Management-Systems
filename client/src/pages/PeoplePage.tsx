import { MoreHorizontal, UserPlus, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { apiError, errorMessage } from '@/api/client';
import { useAddPerson, usePeople, usePersonAction, useSetAdmin } from '@/api/hooks';
import { Container, PageHead } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Badge, Skeleton } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form-controls';
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { InviteShare } from '@/components/users/InviteShare';
import { useAuth } from '@/lib/auth';
import type { Person } from '@/lib/types';
import { cn } from '@/lib/utils';

type Share = { url: string; hours: number; firstName: string; email: string; kind: 'invite' | 'reset' };

function AddPersonDialog({ onClose }: { onClose: () => void }) {
  const add = useAddPerson();
  const [f, setF] = useState({ firstName: '', lastName: '', email: '', isAdmin: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [share, setShare] = useState<Share | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!f.firstName.trim()) errs.firstName = 'Enter a first name.';
    if (!f.lastName.trim()) errs.lastName = 'Enter a last name.';
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) errs.email = 'Enter a full email address.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    add.mutate(
      { ...f, email: f.email.trim() },
      {
        onSuccess: (r) => setShare({ url: r.inviteUrl, hours: r.expiresInHours, firstName: r.person.firstName, email: r.person.email, kind: 'invite' }),
        onError: (err) => {
          const a = apiError(err);
          setErrors(a.details?.fields ? { email: a.message } : { form: a.message });
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={share ? `Send ${share.firstName} their invitation` : 'Add a person'} size="md">
        {share ? (
          <>
            <InviteShare url={share.url} hours={share.hours} firstName={share.firstName} email={share.email} />
            <DialogFooter>
              <Button size="lg" onClick={onClose}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name" error={errors.firstName}>
                <Input autoFocus value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} className="h-11 text-base" />
              </Field>
              <Field label="Last name" error={errors.lastName}>
                <Input value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} className="h-11 text-base" />
              </Field>
            </div>
            <Field label="Email" error={errors.email}>
              <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className="h-11 text-base" />
            </Field>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Can manage documents?</legend>
              <div className="grid grid-cols-2 gap-2">
                {[
                  [false, 'No', 'Can view and download'],
                  [true, 'Yes', 'Can also add, move and delete'],
                ].map(([v, title, text]) => (
                  <label
                    key={String(v)}
                    className={cn(
                      'flex min-h-14 cursor-pointer flex-col rounded-lg border-2 p-3 text-base',
                      f.isAdmin === v ? 'border-primary bg-accent' : 'hover:bg-muted',
                    )}
                  >
                    <input type="radio" name="isAdmin" className="sr-only" checked={f.isAdmin === v} onChange={() => setF({ ...f, isAdmin: v as boolean })} />
                    <span className="font-semibold">{title as string}</span>
                    <span className="text-sm text-slate-600">{text as string}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {errors.form && (
              <p role="alert" className="text-base font-medium text-red-700">
                {errors.form}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" size="lg" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="lg" loading={add.isPending}>
                Add person
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

type Confirm = { person: Person; action: 'remove' | 'restore' | 'reset-two-step' | 'make-admin' | 'make-employee' } | null;

export default function PeoplePage() {
  const { user } = useAuth();
  const { data, isLoading } = usePeople();
  const action = usePersonAction();
  const setAdmin = useSetAdmin();
  const [adding, setAdding] = useState(false);
  const [share, setShare] = useState<Share | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const reset = (p: Person) =>
    action.mutate(
      { id: p.id, action: 'reset-password' },
      { onSuccess: (r) => setShare({ ...r, firstName: p.firstName, email: p.email }), onError: (e) => toast.error(errorMessage(e)) },
    );

  const copy: Record<NonNullable<Confirm>['action'], { title: (n: string) => string; text: string; label: string; done: string; danger?: boolean }> = {
    remove: {
      title: (n) => `Remove access for ${n}?`,
      text: 'They will be signed out straight away and can no longer see any documents.',
      label: 'Remove access',
      done: 'Access removed.',
      danger: true,
    },
    restore: {
      title: (n) => `Give ${n} access again?`,
      text: 'They will be able to sign in and see documents again.',
      label: 'Give access again',
      done: 'Access given back.',
    },
    'reset-two-step': {
      title: (n) => `Reset two-step sign-in for ${n}?`,
      text: 'Use this when they have lost their phone. They will set it up again at their next sign-in.',
      label: 'Reset',
      done: 'Two-step sign-in reset.',
    },
    'make-admin': {
      title: (n) => `Let ${n} manage documents?`,
      text: 'They will be able to add, rename, move and delete files and folders, and manage people.',
      label: 'Yes, let them',
      done: 'They can now manage documents.',
    },
    'make-employee': {
      title: (n) => `Stop ${n} managing documents?`,
      text: 'They will still be able to view and download documents.',
      label: 'Yes, stop',
      done: 'They can now only view and download.',
    },
  };

  const run = () => {
    if (!confirm) return;
    const { person: p, action: a } = confirm;
    const done = () => (toast.success(copy[a].done), setConfirm(null));
    const fail = (e: unknown) => (toast.error(errorMessage(e)), setConfirm(null));
    if (a === 'make-admin' || a === 'make-employee') setAdmin.mutate({ id: p.id, isAdmin: a === 'make-admin' }, { onSuccess: done, onError: fail });
    else
      action.mutate(
        { id: p.id, action: a },
        {
          onSuccess: (r) => {
            done();
            if (a === 'restore' && r.inviteUrl) setShare({ url: r.inviteUrl, hours: r.expiresInHours, firstName: p.firstName, email: p.email, kind: 'invite' });
          },
          onError: fail,
        },
      );
  };

  return (
    <>
      <PageHead
        icon={
          <span className="flex size-14 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden>
            <Users className="size-7" />
          </span>
        }
        title="People"
        meta="Everyone here can view and download documents. Admins can also manage them."
        actions={
          <Button size="lg" className="h-11 text-base" onClick={() => setAdding(true)}>
            <UserPlus className="size-5" /> Add a person
          </Button>
        }
      />
      <Container className="pt-8">
        {isLoading ? (
          <Skeleton className="h-48 rounded-2xl" />
        ) : (
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,27,51,0.05)]">
            {data?.map((p) => {
              const name = `${p.firstName} ${p.lastName}`;
              const me = p.id === user?.id;
              return (
                <li key={p.id} className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 sm:px-5', p.status === 'deactivated' && 'bg-slate-50')}>
                  <span
                    className={cn(
                      'flex size-11 shrink-0 items-center justify-center rounded-full text-base font-bold',
                      p.status === 'deactivated' ? 'bg-slate-200 text-slate-500' : p.isAdmin ? 'bg-navy text-white' : 'bg-primary/10 text-primary',
                    )}
                    aria-hidden
                  >
                    {(p.firstName[0] ?? '').toUpperCase()}
                    {(p.lastName[0] ?? '').toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                      {name} {me && <span className="text-base font-normal text-slate-600">(you)</span>}
                    </div>
                    <div className="text-base text-slate-600 break-all">{p.email}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {p.status === 'deactivated' ? <Badge>No access</Badge> : p.isAdmin ? <Badge tone="navy">Admin</Badge> : <Badge tone="blue">Employee</Badge>}
                    {p.status === 'invited' && <Badge tone="amber">Invitation not accepted yet</Badge>}
                  </div>
                  {!me && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-11" aria-label={`Options for ${name}`}>
                          <MoreHorizontal className="size-5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {p.status === 'deactivated' ? (
                          <DropdownMenuItem className="min-h-10 text-base" onSelect={() => setConfirm({ person: p, action: 'restore' })}>
                            Give access again
                          </DropdownMenuItem>
                        ) : (
                          <>
                            <DropdownMenuItem className="min-h-10 text-base" onSelect={() => reset(p)}>
                              {p.status === 'invited' ? 'Send a new invitation' : 'Send password reset link'}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="min-h-10 text-base"
                              onSelect={() => setConfirm({ person: p, action: p.isAdmin ? 'make-employee' : 'make-admin' })}
                            >
                              {p.isAdmin ? 'Stop managing documents' : 'Let them manage documents'}
                            </DropdownMenuItem>
                            {p.twoStepOn && (
                              <DropdownMenuItem className="min-h-10 text-base" onSelect={() => setConfirm({ person: p, action: 'reset-two-step' })}>
                                Reset two-step sign-in
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem destructive className="min-h-10 text-base" onSelect={() => setConfirm({ person: p, action: 'remove' })}>
                              Remove access
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Container>

      {adding && <AddPersonDialog onClose={() => setAdding(false)} />}
      <Dialog open={!!share} onOpenChange={(o) => !o && setShare(null)}>
        <DialogContent title={share?.kind === 'reset' ? `Password reset for ${share?.firstName}` : `Invitation for ${share?.firstName}`} size="md">
          {share && <InviteShare url={share.url} hours={share.hours} firstName={share.firstName} email={share.email} kind={share.kind} />}
          <DialogFooter>
            <Button size="lg" onClick={() => setShare(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        tone={confirm && copy[confirm.action].danger ? 'destructive' : 'default'}
        title={confirm ? copy[confirm.action].title(`${confirm.person.firstName} ${confirm.person.lastName}`) : ''}
        description={confirm ? copy[confirm.action].text : ''}
        confirmLabel={confirm ? copy[confirm.action].label : ''}
        loading={action.isPending || setAdmin.isPending}
        onConfirm={run}
      />
    </>
  );
}
