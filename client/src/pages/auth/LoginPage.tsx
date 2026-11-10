import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Eye, EyeOff, FileStack, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { apiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth';
import { APP_NAME } from '@/lib/utils';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email address.').email('Enter your full email address.'),
  password: z.string().min(1, 'Enter your password.'),
});
type Values = z.infer<typeof schema>;

const friendly = (code: string, message: string) =>
  code === 'invalid_credentials' ? "That email and password don't match. Try again or ask your administrator for help." : message;

/** One sign-in page for everyone; the account decides what each person can do. */
export default function LoginPage() {
  const { login, verifyMfa } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema) });

  const goNext = () => {
    const from = (location.state as { from?: string } | null)?.from;
    const safe = from && from.startsWith('/') && !from.startsWith('//') && !from.startsWith('/login');
    navigate(safe ? from : '/', { replace: true });
  };

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      const r = await login(v.email, v.password);
      if (r.mfaRequired) setMfaToken(r.mfaToken);
      else goNext();
    } catch (err) {
      const a = apiError(err);
      setError(friendly(a.code, a.message));
    }
  });

  const onVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim().length < 6) return setError('Enter the 6-digit code from your phone.');
    setError(null);
    setVerifying(true);
    try {
      await verifyMfa(mfaToken!, code.trim());
      goNext();
    } catch (err) {
      const a = apiError(err);
      if (a.code === 'mfa_expired') {
        setMfaToken(null);
        setCode('');
      }
      setError(a.code === 'mfa_invalid' && /not valid/.test(a.message) ? "That code didn't work. Check your phone and try again." : a.message);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-navy text-white">
            <FileStack className="size-7" aria-hidden />
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight">Sign in to {APP_NAME}</h1>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          {error && (
            <div className="mb-5 flex gap-3 rounded-lg border border-red-200 bg-red-50 p-3.5 text-base text-red-800" role="alert">
              <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden />
              {error}
            </div>
          )}

          {mfaToken ? (
            <form onSubmit={onVerify} className="space-y-5" noValidate>
              <div className="flex items-start gap-3 rounded-lg bg-accent p-3.5 text-base text-accent-foreground">
                <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
                <span>Enter the 6-digit code from the authenticator app on your phone, or one of your recovery codes.</span>
              </div>
              <Field label="Code" htmlFor="code">
                <Input
                  id="code"
                  autoFocus
                  autoComplete="one-time-code"
                  maxLength={20}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="h-12 text-center font-mono text-xl tracking-[0.25em]"
                />
              </Field>
              <Button type="submit" size="lg" className="h-12 w-full text-base" loading={verifying}>
                Sign in
              </Button>
              <button
                type="button"
                className="min-h-11 w-full text-base text-primary hover:underline"
                onClick={() => (setMfaToken(null), setCode(''), setError(null))}
              >
                Start again
              </button>
            </form>
          ) : (
            <form onSubmit={onSubmit} className="space-y-5" noValidate>
              <Field label="Email" error={formState.errors.email?.message} htmlFor="email">
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  autoFocus
                  className="h-12 text-base"
                  aria-invalid={!!formState.errors.email}
                  {...register('email')}
                />
              </Field>
              <Field label="Password" error={formState.errors.password?.message} htmlFor="password">
                <div className="relative">
                  <Input
                    id="password"
                    type={show ? 'text' : 'password'}
                    autoComplete="current-password"
                    className="h-12 pr-24 text-base"
                    aria-invalid={!!formState.errors.password}
                    {...register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    className="absolute right-1.5 top-1/2 inline-flex min-h-9 -translate-y-1/2 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-slate-600 hover:bg-muted hover:text-foreground"
                  >
                    {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                    {show ? 'Hide' : 'Show'}
                  </button>
                </div>
              </Field>
              <Button type="submit" size="lg" className="h-12 w-full text-base" loading={formState.isSubmitting}>
                Sign in
              </Button>
              <div className="text-center">
                <button type="button" onClick={() => setForgot((f) => !f)} className="min-h-11 text-base text-primary hover:underline" aria-expanded={forgot}>
                  Forgot your password?
                </button>
                {forgot && <p className="text-base text-slate-600">Ask your administrator for a reset link.</p>}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
