import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronDown, Cloud, CloudUpload, HardDrive, KeyRound, Loader2, RefreshCw, ServerCog, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, apiError, errorMessage } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Container, PageHead } from '@/components/layout/Page';
import { Badge, Card, CardHeader, Progress } from '@/components/ui/card';
import { Field, Input, NativeSelect } from '@/components/ui/form-controls';
import { PageLoader } from '@/components/ui/spinner';
import { cn, fmtBytes, fmtDateTime } from '@/lib/utils';

interface StorageInfo {
  activeDriver: 'local' | 's3';
  switchedAt: string | null;
  s3: { bucket: string; region: string; kmsKeyId: string | null; usesSavedKeys: boolean; accessKeyHint: string | null } | null;
  library: { files: number; bytes: number };
  job: {
    id: string;
    status: 'running' | 'completed' | 'needs_attention' | 'failed';
    total: number;
    done: number;
    switched: boolean;
    error: string | null;
    counts: Record<string, number> | null;
    problems: { filename: string; documentId: string; outcome: string }[];
  } | null;
}

const REGIONS: [string, string][] = [
  ['us-east-1', 'US East (N. Virginia)'],
  ['us-east-2', 'US East (Ohio)'],
  ['us-west-1', 'US West (N. California)'],
  ['us-west-2', 'US West (Oregon)'],
  ['ca-central-1', 'Canada (Central)'],
  ['eu-west-1', 'Europe (Ireland)'],
  ['eu-west-2', 'Europe (London)'],
  ['eu-central-1', 'Europe (Frankfurt)'],
  ['eu-north-1', 'Europe (Stockholm)'],
  ['ap-south-1', 'Asia Pacific (Mumbai)'],
  ['ap-southeast-1', 'Asia Pacific (Singapore)'],
  ['ap-southeast-2', 'Asia Pacific (Sydney)'],
  ['ap-northeast-1', 'Asia Pacific (Tokyo)'],
  ['me-central-1', 'Middle East (UAE)'],
  ['sa-east-1', 'South America (São Paulo)'],
];

const PROBLEM_TEXT: Record<string, string> = {
  missing_source: 'The file is missing from this server. Re-upload the document.',
  checksum_mismatch: 'The file on this server is damaged. Restore it from a backup or re-upload it.',
  failed: 'The copy did not finish (network or permission issue). Try again.',
};

function Step({ n, title, state, children }: { n: number; title: string; state: 'done' | 'current' | 'upcoming'; children?: React.ReactNode }) {
  return (
    <Card className={cn('overflow-hidden transition-opacity', state === 'upcoming' && 'opacity-60')}>
      <div className="flex items-center gap-3 border-b px-5 py-4">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
            state === 'done' ? 'bg-emerald-100 text-emerald-700' : state === 'current' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500',
          )}
        >
          {state === 'done' ? <CheckCircle2 className="size-5" /> : n}
        </span>
        <h3 className="font-semibold">{title}</h3>
      </div>
      {state !== 'upcoming' && children && <div className="p-5">{children}</div>}
    </Card>
  );
}

function ConnectForm({ info, onSaved }: { info: StorageInfo; onSaved: (connected: boolean) => void }) {
  const [bucket, setBucket] = useState(info.s3?.bucket ?? '');
  const [region, setRegion] = useState(info.s3?.region ?? 'us-east-1');
  const [auth, setAuth] = useState<'role' | 'keys'>(info.s3?.usesSavedKeys ? 'keys' : 'role');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secret, setSecret] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { bucket, region };
      if (auth === 'role') body.clearKeys = true;
      else if (accessKeyId || secret) Object.assign(body, { accessKeyId, secretAccessKey: secret });
      await api.put('/admin/storage/s3', body);
      return (await api.post<{ ok: boolean; message?: string }>('/admin/storage/test')).data;
    },
    onSuccess: (r) => {
      setResult(r);
      setSecret('');
      qc.invalidateQueries({ queryKey: ['storage'] });
      onSaved(r.ok);
    },
    onError: (e) => {
      const a = apiError(e);
      if (a.details?.fields) setErrors(a.details.fields);
      else toast.error(a.message);
    },
  });

  const needKeys = auth === 'keys' && !info.s3?.usesSavedKeys;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setErrors({});
        setResult(null);
        if (!bucket.trim()) return setErrors({ bucket: 'Enter the bucket name' });
        if (needKeys && (!accessKeyId || !secret)) return setErrors({ accessKeyId: 'Enter the access key ID and secret key' });
        save.mutate();
      }}
      className="space-y-5"
      noValidate
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bucket name" error={errors.bucket} hint="In the AWS console: S3 → Buckets. Example: acme-documents">
          <Input value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="acme-documents" autoCapitalize="none" spellCheck={false} />
        </Field>
        <Field label="Region" error={errors.region} hint="Shown next to the bucket in the AWS console">
          <NativeSelect value={region} onChange={(e) => setRegion(e.target.value)}>
            {REGIONS.map(([code, name]) => (
              <option key={code} value={code}>
                {name} — {code}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">How should this app sign in to AWS?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ['role', ServerCog, "Use the server's AWS role", 'Recommended. Your IT contact sets this up once; no keys are stored here.'],
              ['keys', KeyRound, 'Use an access key', 'Paste an access key created for this app in AWS (IAM). Stored encrypted.'],
            ] as const
          ).map(([value, Icon, title, text]) => (
            <label
              key={value}
              className={cn(
                'flex cursor-pointer gap-3 rounded-lg border-2 p-3 text-sm transition-colors',
                auth === value ? 'border-primary bg-accent' : 'hover:bg-muted',
              )}
            >
              <input type="radio" name="auth" value={value} checked={auth === value} onChange={() => setAuth(value)} className="sr-only" />
              <Icon className="mt-0.5 size-5 shrink-0 text-primary" />
              <span>
                <span className="block font-medium">{title}</span>
                <span className="text-xs text-muted-foreground">{text}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {auth === 'keys' && (
        <div className="grid gap-4 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2">
          {info.s3?.usesSavedKeys && <p className="text-sm text-muted-foreground sm:col-span-2">Saved key {info.s3.accessKeyHint}. Leave blank to keep it.</p>}
          <Field label="Access key ID" error={errors.accessKeyId}>
            <Input
              value={accessKeyId}
              onChange={(e) => setAccessKeyId(e.target.value.trim())}
              placeholder="AKIA…"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </Field>
          <Field label="Secret access key" error={errors.secretAccessKey}>
            <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" className="font-mono" />
          </Field>
        </div>
      )}

      {result && (
        <div
          className={cn(
            'flex items-start gap-3 rounded-lg border p-3.5 text-sm',
            result.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900',
          )}
          role="status"
        >
          {result.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
          <span>{result.ok ? 'Connected. The app can save and read files in this bucket.' : result.message}</span>
        </div>
      )}

      <Button type="submit" loading={save.isPending}>
        Save & test connection
      </Button>
    </form>
  );
}

export default function StoragePage() {
  const qc = useQueryClient();
  const { data: info, isLoading } = useQuery({
    queryKey: ['storage'],
    queryFn: async () => (await api.get<StorageInfo>('/admin/storage')).data,
    refetchInterval: (q) => (q.state.data?.job?.status === 'running' ? 1000 : false),
  });
  const [connected, setConnected] = useState(false);
  const [editing, setEditing] = useState(false);
  const move = useMutation({
    mutationFn: async () => (await api.post('/admin/storage/move')).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['storage'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const job = info?.job;
  useEffect(() => {
    if (job?.status === 'completed' && job.switched) toast.success('All files are now stored in Amazon S3');
  }, [job?.status, job?.switched]);

  if (isLoading || !info) return <PageLoader />;

  const onS3 = info.activeDriver === 's3';
  const running = job?.status === 'running';
  const canMove = !!info.s3 && (connected || !!job);
  const pct = job && job.total ? Math.round((job.done / job.total) * 100) : 0;

  return (
    <>
      <PageHead title="File storage" meta="Where your documents are kept. Moving them takes a few clicks and documents stay available the whole time." />
      <Container className="max-w-4xl pt-8">
        <Card className="mb-6 flex flex-wrap items-center gap-4 p-5">
          <span className={cn('flex size-12 items-center justify-center rounded-xl', onS3 ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-600')}>
            {onS3 ? <Cloud className="size-6" /> : <HardDrive className="size-6" />}
          </span>
          <div className="min-w-0 flex-1 basis-48">
            <div className="text-sm text-muted-foreground">Documents are currently stored</div>
            <div className="text-lg font-semibold">{onS3 ? `in Amazon S3 — ${info.s3?.bucket} (${info.s3?.region})` : 'on this server'}</div>
            <div className="text-sm text-muted-foreground">
              {info.library.files} file{info.library.files === 1 ? '' : 's'} · {fmtBytes(info.library.bytes)}
              {onS3 && info.switchedAt && ` · moved ${fmtDateTime(info.switchedAt)}`}
            </div>
          </div>
          <div className="w-full sm:w-auto">
            {onS3 ? (
              <Badge tone="green">
                <CheckCircle2 className="size-3" /> Encrypted cloud storage
              </Badge>
            ) : (
              <Badge tone="amber">
                <AlertTriangle className="size-3" /> Recommended: move to S3
              </Badge>
            )}
          </div>
        </Card>

        {onS3 ? (
          <Card>
            <CardHeader
              title="Connection details"
              description="Change these only if the bucket or access key changes."
              action={
                <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)}>
                  {editing ? 'Close' : 'Edit'} <ChevronDown className={cn('transition-transform', editing && 'rotate-180')} />
                </Button>
              }
            />
            {editing && (
              <div className="p-5">
                <ConnectForm info={info} onSaved={() => undefined} />
              </div>
            )}
          </Card>
        ) : (
          <div className="space-y-4">
            <Step n={1} title="Connect your Amazon S3 bucket" state={canMove ? 'done' : 'current'}>
              <ConnectForm info={info} onSaved={setConnected} />
            </Step>

            <Step n={2} title="Move your files" state={!canMove ? 'upcoming' : 'current'}>
              {running ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Loader2 className="size-4 animate-spin text-primary" /> Copying and checking files… {job!.done} of {job!.total}
                  </div>
                  <Progress value={pct} className="h-2.5" />
                  <p className="text-xs text-muted-foreground">You can leave this page; the move continues in the background.</p>
                </div>
              ) : job?.status === 'needs_attention' || job?.status === 'failed' ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <div>
                      <div className="font-medium">
                        {job.status === 'failed'
                          ? 'The move stopped.'
                          : `${job.problems.length} file${job.problems.length === 1 ? '' : 's'} could not be moved.`}{' '}
                        Nothing was switched — documents are still served from this server.
                      </div>
                      {job.error && <div className="mt-1">{job.error}</div>}
                    </div>
                  </div>
                  {job.problems.length > 0 && (
                    <ul className="divide-y rounded-lg border text-sm">
                      {job.problems.map((p) => (
                        <li key={`${p.documentId}-${p.filename}`} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                          <a href={`/files/${p.documentId}`} className="font-medium text-primary hover:underline">
                            {p.filename}
                          </a>
                          <span className="text-muted-foreground">{PROBLEM_TEXT[p.outcome] ?? p.outcome}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Button onClick={() => move.mutate()} loading={move.isPending}>
                    <RefreshCw /> Try again
                  </Button>
                  <p className="text-xs text-muted-foreground">Files already copied are skipped, so trying again is quick and safe.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    {info.library.files} file{info.library.files === 1 ? '' : 's'} ({fmtBytes(info.library.bytes)}) will be copied to <b>{info.s3?.bucket}</b>.
                    Each file is checked after copying. When every file is safely in S3, the app switches over automatically.
                  </p>
                  <Button size="lg" onClick={() => move.mutate()} loading={move.isPending} disabled={!canMove}>
                    <CloudUpload /> Move files to Amazon S3
                  </Button>
                </div>
              )}
            </Step>

            <Step n={3} title="Done — new uploads go to S3 automatically" state="upcoming" />
          </div>
        )}
      </Container>
    </>
  );
}
