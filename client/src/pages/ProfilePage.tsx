import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, UserRound } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { api, applyFieldErrors, errorMessage } from '@/api/client';
import { useMe } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form-controls';
import { PageLoader } from '@/components/ui/spinner';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtDateTime } from '@/lib/utils';
import { PasswordChecklist, passwordSchema } from './auth/AcceptInvitePage';

const profileSchema = z.object({
  firstName: z.string().trim().min(1, 'Required').max(100),
  lastName: z.string().trim().min(1, 'Required').max(100),
  phone: z.string().trim().max(40).optional(),
  jobTitle: z.string().trim().max(100).optional(),
});

const pwdSchema = z
  .object({ currentPassword: z.string().min(1, 'Required'), newPassword: passwordSchema, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export default function ProfilePage() {
  const { user, reload } = useAuth();
  const { data, isLoading, refetch } = useMe();
  const profile = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    values: data ? { firstName: user!.firstName, lastName: user!.lastName, phone: data.profile.phone ?? '', jobTitle: data.profile.jobTitle ?? '' } : undefined,
  });
  const pwd = useForm<z.infer<typeof pwdSchema>>({ resolver: zodResolver(pwdSchema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });

  if (isLoading || !user || !data) return <PageLoader />;
  const p = data.profile;

  const saveProfile = profile.handleSubmit(async (v) => {
    try {
      await api.patch('/auth/profile', v);
      await Promise.all([reload(), refetch()]);
      toast.success('Profile updated');
    } catch (e) {
      if (!applyFieldErrors(e, profile.setError)) toast.error(errorMessage(e));
    }
  });

  const changePassword = pwd.handleSubmit(async (v) => {
    try {
      await api.post('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword });
      pwd.reset();
      toast.success('Password changed. Other devices have been signed out.');
    } catch (e) {
      if (!applyFieldErrors(e, pwd.setError)) toast.error(errorMessage(e));
    }
  });

  return (
    <>
      <PageHeader title="Profile & security" description="Manage your personal details and password." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="h-fit p-6 text-center">
          <Avatar name={`${user.firstName} ${user.lastName}`} className="mx-auto size-20 text-2xl" />
          <h2 className="mt-4 text-lg font-semibold">{user.firstName} {user.lastName}</h2>
          <p className="text-sm text-muted-foreground">{user.email}</p>
          <Badge tone="navy" className="mt-3 capitalize">{user.role}</Badge>
          <dl className="mt-6 space-y-2 border-t pt-4 text-left text-sm">
            {p.clientName && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Company</dt><dd className="font-medium">{p.clientName}</dd></div>}
            {p.employeeNumber && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Employee no.</dt><dd className="font-medium">{p.employeeNumber}</dd></div>}
            {p.department && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Department</dt><dd className="font-medium">{p.department}</dd></div>}
            {p.hireDate && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Hire date</dt><dd className="font-medium">{fmtDate(p.hireDate)}</dd></div>}
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Member since</dt><dd className="font-medium">{fmtDate(p.createdAt)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Last sign-in</dt><dd className="font-medium">{fmtDateTime(p.lastLoginAt)}</dd></div>
          </dl>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><UserRound className="size-4" /> Personal details</span>} />
            <form onSubmit={saveProfile} className="grid gap-4 p-5 sm:grid-cols-2" noValidate>
              <Field label="First name" required error={profile.formState.errors.firstName?.message}>
                <Input {...profile.register('firstName')} />
              </Field>
              <Field label="Last name" required error={profile.formState.errors.lastName?.message}>
                <Input {...profile.register('lastName')} />
              </Field>
              <Field label="Phone">
                <Input type="tel" {...profile.register('phone')} />
              </Field>
              <Field label="Job title">
                <Input {...profile.register('jobTitle')} />
              </Field>
              <Field label="Email" hint="Contact an administrator to change your email." className="sm:col-span-2">
                <Input value={user.email} disabled />
              </Field>
              <div className="sm:col-span-2">
                <Button type="submit" loading={profile.formState.isSubmitting}>Save changes</Button>
              </div>
            </form>
          </Card>
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><KeyRound className="size-4" /> Change password</span>} description="Changing your password signs you out on other devices." />
            <form onSubmit={changePassword} className="grid gap-4 p-5 sm:grid-cols-2" noValidate>
              <Field label="Current password" required error={pwd.formState.errors.currentPassword?.message} className="sm:col-span-2">
                <Input type="password" autoComplete="current-password" {...pwd.register('currentPassword')} />
              </Field>
              <Field label="New password" required error={pwd.formState.errors.newPassword?.message}>
                <Input type="password" autoComplete="new-password" {...pwd.register('newPassword')} />
              </Field>
              <Field label="Confirm new password" required error={pwd.formState.errors.confirm?.message}>
                <Input type="password" autoComplete="new-password" {...pwd.register('confirm')} />
              </Field>
              <div className="sm:col-span-2">
                <PasswordChecklist value={pwd.watch('newPassword')} />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" loading={pwd.formState.isSubmitting}>Update password</Button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
