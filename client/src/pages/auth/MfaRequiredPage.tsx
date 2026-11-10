import { LogOut, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { MfaSetup } from '@/components/security/MfaSetup';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { AuthLayout } from './AuthLayout';

/** Shown instead of the app until a user whose role requires MFA has enrolled. */
export default function MfaRequiredPage() {
  const { user, reload, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <AuthLayout eyebrow="Account security">
      <span className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-primary">
        <ShieldCheck className="size-5" />
      </span>
      <h2 className="mt-4 text-2xl font-semibold tracking-tight">Set up two-factor authentication</h2>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        Your organisation requires a second sign-in step for {user?.role === 'admin' ? 'administrators' : 'your account'} because this system holds confidential
        documents.
      </p>
      <MfaSetup onComplete={() => reload().then(() => navigate('/', { replace: true }))} />
      <Button
        variant="ghost"
        className="mt-8"
        onClick={async () => {
          await logout();
          navigate('/login', { replace: true });
        }}
      >
        <LogOut /> Sign out
      </Button>
    </AuthLayout>
  );
}
