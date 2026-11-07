import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Check, CircleAlert, KeyRound, X } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { api, applyFieldErrors, errorMessage } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form-controls';
import { PageLoader } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { AuthLayout } from './AuthLayout';

export const PASSWORD_RULES = [
  { test: (s: string) => s.length >= 10, label: 'At least 10 characters' },
  { test: (s: string) => /[a-z]/.test(s), label: 'A lowercase letter' },
  { test: (s: string) => /[A-Z]/.test(s), label: 'An uppercase letter' },
  { test: (s: string) => /[0-9]/.test(s), label: 'A number' },
];

export const passwordSchema = z
  .string()
  .min(10, 'At least 10 characters')
  .max(128)
  .regex(/[a-z]/, 'Must contain a lowercase letter')
  .regex(/[A-Z]/, 'Must contain an uppercase letter')
  .regex(/[0-9]/, 'Must contain a number');

export function PasswordChecklist({ value }: { value: string }) {
  return (
    <ul className="grid grid-cols-2 gap-1.5 text-xs">
      {PASSWORD_RULES.map((r) => {
        const ok = r.test(value);
        return (
          <li key={r.label} className={cn('flex items-center gap-1.5', ok ? 'text-emerald-600' : 'text-muted-foreground')}>
            {ok ? <Check className="size-3.5" /> : <X className="size-3.5" />} {r.label}
          </li>
        );
      })}
    </ul>
  );
}

const schema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export default function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: async () => (await api.get<{ email: string; firstName: string; lastName: string; portal: 'admin' | 'employee' }>(`/auth/invitations/${encodeURIComponent(token)}`)).data,
    enabled: !!token,
    retry: false,
  });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });
  const pwd = form.watch('password');

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const { data } = await api.post<{ portal: 'admin' | 'employee' }>('/auth/accept-invite', { token, password: v.password });
      toast.success('Password set. You can now sign in.');
      navigate(`/login/${data.portal}`, { replace: true });
    } catch (err) {
      if (!applyFieldErrors(err, form.setError)) toast.error(errorMessage(err));
    }
  });

  return (
    <AuthLayout eyebrow="Account setup">
      {!token || invite.isError ? (
        <div className="text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-red-50 text-red-600">
            <CircleAlert className="size-6" />
          </div>
          <h2 className="mt-4 text-xl font-semibold">Invitation link not valid</h2>
          <p className="mt-2 text-sm text-muted-foreground">This link is invalid, already used, or has expired. Ask your administrator to send a new invitation.</p>
          <Button asChild variant="outline" className="mt-6">
            <Link to="/login">Go to sign in</Link>
          </Button>
        </div>
      ) : invite.isLoading ? (
        <PageLoader label="Checking your invitation…" />
      ) : (
        <>
          <span className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-primary">
            <KeyRound className="size-5" />
          </span>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight">Welcome, {invite.data?.firstName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a password for <span className="font-medium text-foreground">{invite.data?.email}</span>.
          </p>
          <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
            <Field label="New password" error={form.formState.errors.password?.message}>
              <Input type="password" autoComplete="new-password" autoFocus aria-invalid={!!form.formState.errors.password} {...form.register('password')} />
            </Field>
            <PasswordChecklist value={pwd} />
            <Field label="Confirm password" error={form.formState.errors.confirm?.message}>
              <Input type="password" autoComplete="new-password" aria-invalid={!!form.formState.errors.confirm} {...form.register('confirm')} />
            </Field>
            <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
              Set password & continue
            </Button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
