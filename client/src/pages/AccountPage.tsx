import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { api, applyFieldErrors, errorMessage } from '@/api/client';
import { Container, PageHead } from '@/components/layout/Page';
import { SecurityCard } from '@/components/security/SecurityCard';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth';
import { PasswordChecklist, passwordSchema } from './auth/AcceptInvitePage';

const schema = z
  .object({ currentPassword: z.string().min(1, 'Enter your current password.'), newPassword: passwordSchema, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: "The two new passwords don't match." });

export default function AccountPage() {
  const { user, isAdmin } = useAuth();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const err = form.formState.errors;

  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword });
      form.reset();
      toast.success('Password changed.');
    } catch (e) {
      if (!applyFieldErrors(e, form.setError)) toast.error(errorMessage(e));
    }
  });

  return (
    <>
      <PageHead
        icon={
          <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary" aria-hidden>
            {(user?.firstName[0] ?? '').toUpperCase()}
            {(user?.lastName[0] ?? '').toUpperCase()}
          </span>
        }
        title={`${user?.firstName ?? ''} ${user?.lastName ?? ''}`}
        meta={user?.email}
      />
      <Container className="max-w-3xl space-y-6 pt-8">
        <Card className="overflow-hidden rounded-2xl">
          <CardHeader title="Change my password" />
          <form onSubmit={submit} className="space-y-4 p-5" noValidate>
            <Field label="Current password" error={err.currentPassword?.message}>
              <Input type="password" autoComplete="current-password" className="h-11 text-base" {...form.register('currentPassword')} />
            </Field>
            <Field label="New password" error={err.newPassword?.message}>
              <Input type="password" autoComplete="new-password" className="h-11 text-base" {...form.register('newPassword')} />
            </Field>
            <PasswordChecklist value={form.watch('newPassword')} />
            <Field label="New password again" error={err.confirm?.message}>
              <Input type="password" autoComplete="new-password" className="h-11 text-base" {...form.register('confirm')} />
            </Field>
            <Button type="submit" size="lg" className="h-11 text-base" loading={form.formState.isSubmitting}>
              Change password
            </Button>
          </form>
        </Card>
        {isAdmin && <SecurityCard />}
      </Container>
    </>
  );
}
