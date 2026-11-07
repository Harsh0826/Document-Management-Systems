import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, ArrowLeft, Briefcase, Eye, EyeOff, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { apiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth';
import { AuthLayout } from './AuthLayout';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email').email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});
type Values = z.infer<typeof schema>;

export default function LoginPage() {
  const { portal } = useParams<{ portal: 'admin' | 'employee' }>();
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const [show, setShow] = useState(false);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema) });

  if (portal !== 'admin' && portal !== 'employee') return <Navigate to="/login" replace />;
  const isAdmin = portal === 'admin';
  const Icon = isAdmin ? Briefcase : UserRound;

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await login(v.email, v.password, portal);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/dashboard', { replace: true });
    } catch (err) {
      setError(apiError(err));
    }
  });

  return (
    <AuthLayout eyebrow={isAdmin ? 'Admin & Staff Portal' : 'Employee Portal'}>
      <Link to="/login" className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All portals
      </Link>
      <div className="flex items-center gap-3">
        <span className={`flex size-11 items-center justify-center rounded-xl ${isAdmin ? 'bg-navy text-white' : 'bg-blue-50 text-primary'}`}>
          <Icon className="size-5" />
        </span>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{isAdmin ? 'Admin & Staff sign in' : 'Employee sign in'}</h2>
          <p className="text-sm text-muted-foreground">{isAdmin ? 'For administrators and internal staff.' : 'Access and upload your documents.'}</p>
        </div>
      </div>

      {error && (
        <div className="mt-6 flex gap-3 rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-800" role="alert">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div>
            {error.message}
            {error.code === 'wrong_portal' && (
              <div className="mt-1">
                <Link className="font-medium underline" to={`/login/${isAdmin ? 'employee' : 'admin'}`}>
                  Go to the {isAdmin ? 'Employee' : 'Admin & Staff'} portal
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
        <Field label="Email address" error={formState.errors.email?.message} htmlFor="email">
          <Input id="email" type="email" autoComplete="username" autoFocus placeholder="you@company.com" aria-invalid={!!formState.errors.email} {...register('email')} />
        </Field>
        <Field label="Password" error={formState.errors.password?.message} htmlFor="password">
          <div className="relative">
            <Input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••••" className="pr-10" aria-invalid={!!formState.errors.password} {...register('password')} />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>
        <Button type="submit" size="lg" variant={isAdmin ? 'navy' : 'default'} className="w-full" loading={formState.isSubmitting}>
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-xs text-muted-foreground">Forgot your password? Contact your administrator to receive a new access link.</p>
    </AuthLayout>
  );
}
