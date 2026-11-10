import { Check, Copy, Download, ShieldCheck, Smartphone } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, apiError, errorMessage } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form-controls';
import { PageLoader } from '@/components/ui/spinner';
import { APP_NAME } from '@/lib/utils';

/** Shows freshly issued recovery codes once, with copy / download. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const text = `${APP_NAME} recovery codes\nEach code works once. Keep them somewhere safe.\n\n${codes.join('\n')}\n`;
  return (
    <div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        Save these recovery codes now. Each one lets you sign in once if you lose your phone. They will not be shown again.
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-muted p-4 font-mono text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setSaved(true);
          }}
        >
          {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
            a.download = `${APP_NAME.toLowerCase()}-recovery-codes.txt`;
            a.click();
            URL.revokeObjectURL(a.href);
            setSaved(true);
          }}
        >
          <Download /> Download
        </Button>
        <Button className="ml-auto" disabled={!saved} onClick={onDone}>
          I've saved them
        </Button>
      </div>
    </div>
  );
}

/** Full enrolment flow: scan QR → confirm a code → show recovery codes. */
export function MfaSetup({ onComplete }: { onComplete: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .post<{ secret: string; otpauthUrl: string }>('/auth/mfa/setup')
      .then(async ({ data }) => {
        const qr = await QRCode.toDataURL(data.otpauthUrl, { margin: 1, width: 200 });
        if (!cancelled) setSetup({ ...data, qr });
      })
      .catch((e) => toast.error(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code from your app');
    setBusy(true);
    try {
      const { data } = await api.post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code });
      setCodes(data.recoveryCodes);
    } catch (err) {
      setError(apiError(err).details?.fields?.code ?? errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (codes) return <RecoveryCodes codes={codes} onDone={onComplete} />;
  if (!setup) return <PageLoader label="Preparing secure setup…" />;

  return (
    <div className="grid gap-6 md:grid-cols-[200px_1fr]">
      <div className="flex flex-col items-center gap-2">
        <img src={setup.qr} alt="QR code for your authenticator app" className="size-[200px] rounded-lg border bg-white p-1" />
        <details className="w-full text-center text-xs text-muted-foreground">
          <summary className="cursor-pointer">Can't scan? Enter key manually</summary>
          <code className="mt-2 block break-all rounded bg-muted p-2 font-mono text-[11px] text-foreground">{setup.secret}</code>
        </details>
      </div>
      <div>
        <ol className="space-y-3 text-sm">
          <li className="flex gap-2.5">
            <Smartphone className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>Open an authenticator app (Microsoft Authenticator, Google Authenticator, 1Password, Authy…).</span>
          </li>
          <li className="flex gap-2.5">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>Scan the QR code, then enter the 6-digit code it shows.</span>
          </li>
        </ol>
        <form onSubmit={confirm} className="mt-5 space-y-3" noValidate>
          <Field label="Verification code" error={error ?? undefined}>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, ''));
                setError(null);
              }}
              className="max-w-40 text-center font-mono text-lg tracking-[0.3em]"
              autoFocus
              aria-invalid={!!error}
            />
          </Field>
          <Button type="submit" loading={busy}>
            Verify & turn on
          </Button>
        </form>
      </div>
    </div>
  );
}
