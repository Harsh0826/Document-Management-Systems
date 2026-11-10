import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api, apiError, errorMessage } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form-controls';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlays';
import { useAuth } from '@/lib/auth';
import { MfaSetup, RecoveryCodes } from './MfaSetup';

type Mode = 'setup' | 'codes' | 'disable' | null;

/** Password + current code, required before sensitive MFA changes. */
function ReauthDialog({ mode, onClose }: { mode: 'codes' | 'disable'; onClose: (changed: boolean) => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      if (mode === 'codes') {
        const { data } = await api.post<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { password, code });
        setCodes(data.recoveryCodes);
      } else {
        await api.post('/auth/mfa/disable', { password, code });
        toast.success('Two-factor authentication turned off');
        onClose(true);
      }
    } catch (err) {
      const a = apiError(err);
      if (a.details?.fields) setErrors(a.details.fields);
      else toast.error(a.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose(!!codes)}>
      <DialogContent title={mode === 'codes' ? 'New recovery codes' : 'Turn off two-factor authentication'} size="md">
        {codes ? (
          <RecoveryCodes codes={codes} onDone={() => onClose(true)} />
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <p className="text-sm text-muted-foreground">
              {mode === 'codes' ? 'Your existing recovery codes will stop working.' : 'Your account will be protected by password only.'} Confirm it's you:
            </p>
            <Field label="Password" error={errors.password}>
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="Authenticator code" error={errors.code}>
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={20}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="font-mono"
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onClose(false)}>
                Cancel
              </Button>
              <Button type="submit" variant={mode === 'disable' ? 'destructive' : 'default'} loading={busy}>
                {mode === 'codes' ? 'Generate new codes' : 'Turn off'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function SecurityCard() {
  const { reload } = useAuth();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>(null);
  const { data } = useQuery({
    queryKey: ['mfa-status'],
    queryFn: async () => (await api.get<{ enabled: boolean; required: boolean; recoveryCodesRemaining: number }>('/auth/mfa')).data,
  });
  const refresh = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ['mfa-status'] }), reload()]);
  };

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-4" /> Two-factor authentication
          </span>
        }
        description="Protect your account with a code from an authenticator app in addition to your password."
        action={data && (data.enabled ? <Badge tone="green">On</Badge> : <Badge tone={data.required ? 'red' : 'amber'}>Off</Badge>)}
      />
      <div className="flex flex-wrap items-center gap-3 p-5">
        {!data ? null : data.enabled ? (
          <>
            <div className="flex-1 text-sm text-muted-foreground">
              {data.recoveryCodesRemaining} recovery code{data.recoveryCodesRemaining === 1 ? '' : 's'} left.
              {data.recoveryCodesRemaining <= 3 && <span className="ml-1 font-medium text-amber-700">Generate new ones soon.</span>}
            </div>
            <Button variant="outline" onClick={() => setMode('codes')}>
              <KeyRound /> New recovery codes
            </Button>
            {!data.required && (
              <Button variant="ghost" className="text-destructive" onClick={() => setMode('disable')}>
                Turn off
              </Button>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-1 items-start gap-2 text-sm text-muted-foreground">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
              Your account is protected by a password only.
            </div>
            <Button onClick={() => setMode('setup')}>Turn on</Button>
          </>
        )}
      </div>
      {mode === 'setup' && (
        <Dialog open onOpenChange={(o) => !o && setMode(null)}>
          <DialogContent title="Set up two-factor authentication" size="lg">
            <MfaSetup
              onComplete={async () => {
                setMode(null);
                toast.success('Two-factor authentication is on');
                await refresh().catch((e) => toast.error(errorMessage(e)));
              }}
            />
          </DialogContent>
        </Dialog>
      )}
      {(mode === 'codes' || mode === 'disable') && (
        <ReauthDialog
          mode={mode}
          onClose={(changed) => {
            setMode(null);
            if (changed) void refresh();
          }}
        />
      )}
    </Card>
  );
}
