import { CheckCircle2, CircleAlert, UploadCloud, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiError } from '@/api/client';
import { uploadLibraryFile, useFolder } from '@/api/hooks';
import { checkFile, ValidUntilField } from '@/components/library/FileDialogs';
import { folderLabel, FolderPicker } from '@/components/library/FolderPicker';
import { Container, PageHead } from '@/components/layout/Page';
import { Breadcrumb, FileIcon } from '@/components/library/parts';
import { Button } from '@/components/ui/button';
import { Card, Progress } from '@/components/ui/card';
import { Input } from '@/components/ui/form-controls';
import { useQueryClient } from '@tanstack/react-query';
import { size } from '@/lib/format';
import { nameFromFilename } from '@/lib/smart-fill';
import { cn } from '@/lib/utils';

interface Item {
  key: string;
  file: File;
  name: string;
  validUntil: string;
  status: 'ready' | 'uploading' | 'done' | 'error';
  progress: number;
  error?: string;
}

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png';

/** A numbered step card, so the order of the page is obvious. */
function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,27,51,0.05)] sm:p-6" aria-label={`Step ${n}: ${title}`}>
      <h2 className="mb-4 flex items-center gap-3 text-lg font-bold">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full text-base font-bold',
            done ? 'bg-emerald-600 text-white' : 'bg-primary/10 text-primary',
          )}
          aria-hidden
        >
          {done ? <CheckCircle2 className="size-5" /> : n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function AddFilesPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [folderId, setFolderId] = useState(params.get('folder') ?? '');
  const [picked, setPicked] = useState('');
  // Opened from a folder ("Add files to this folder"): look up its full name once.
  const { data: start } = useFolder(params.get('folder') ?? undefined);
  const [items, setItems] = useState<Item[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needFolder, setNeedFolder] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderPath = picked || (start && start.id === folderId ? folderLabel(start) : '');
  const isLicences = /licen[cs]e/i.test(folderPath);

  const add = (files: FileList | File[]) => {
    const ok: Item[] = [];
    const bad: string[] = [];
    for (const f of Array.from(files)) {
      const err = checkFile(f);
      if (err) bad.push(err);
      else ok.push({ key: `${f.name}-${f.size}-${Math.random()}`, file: f, name: nameFromFilename(f.name), validUntil: '', status: 'ready', progress: 0 });
    }
    setItems((cur) => [...cur.filter((i) => i.status !== 'done'), ...ok]);
    setProblems(bad);
  };
  const update = (key: string, patch: Partial<Item>) => setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const pending = items.filter((i) => i.status === 'ready' || i.status === 'error');
  const done = items.filter((i) => i.status === 'done');

  const upload = async () => {
    if (!folderId) {
      setNeedFolder(true);
      return;
    }
    setBusy(true);
    for (const i of pending) {
      if (!i.name.trim()) {
        update(i.key, { status: 'error', error: 'Enter a name.' });
        continue;
      }
      update(i.key, { status: 'uploading', progress: 0, error: undefined });
      try {
        await uploadLibraryFile({ file: i.file, folderId, name: i.name.trim(), validUntil: i.validUntil || undefined }, (p) => update(i.key, { progress: p }));
        update(i.key, { status: 'done', progress: 100 });
      } catch (e) {
        update(i.key, { status: 'error', error: apiError(e).message });
      }
    }
    setBusy(false);
    qc.invalidateQueries({ queryKey: ['library'] });
  };

  const allDone = done.length > 0 && pending.length === 0 && !busy;

  return (
    <>
      <PageHead
        crumbs={<Breadcrumb path={[]} current="Add files" />}
        icon={
          <span className="flex size-14 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden>
            <UploadCloud className="size-7" />
          </span>
        }
        title="Add files"
        meta="Choose a folder, pick your files, check the names. That's it."
      />
      <Container className="max-w-3xl pt-8">
        {allDone ? (
          <Card className="rounded-2xl border-emerald-300 bg-emerald-50 p-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 size-7 shrink-0 text-emerald-700" aria-hidden />
              <div>
                <p className="text-lg font-semibold text-emerald-900" role="status">
                  {done.length} file{done.length === 1 ? '' : 's'} added to {folderPath}.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="lg" className="h-11 text-base" onClick={() => navigate(`/folders/${folderId}`)}>
                    Go to folder
                  </Button>
                  <Button size="lg" variant="outline" className="h-11 text-base" onClick={() => setItems([])}>
                    Add more files
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        ) : (
          <div className="space-y-5">
            <Step n={1} title="Choose a folder" done={!!folderId && !needFolder}>
              {folderId && !needFolder ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-4 text-base ring-1 ring-inset ring-slate-200">
                  <span className="font-semibold">{folderPath || '…'}</span>
                  <Button variant="outline" className="h-11 text-base" onClick={() => setFolderId('')} disabled={busy}>
                    Change folder
                  </Button>
                </div>
              ) : (
                <>
                  <FolderPicker value={folderId} onChange={(f) => f.id && (setFolderId(f.id), setPicked(f.label), setNeedFolder(false))} />
                  {needFolder && (
                    <p role="alert" className="mt-2 text-base font-medium text-red-700">
                      Choose a folder for these files.
                    </p>
                  )}
                </>
              )}
            </Step>

            <Step n={2} title="Choose the files" done={items.length > 0}>
              <div
                onDragOver={(e) => (e.preventDefault(), setOver(true))}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => (e.preventDefault(), setOver(false), add(e.dataTransfer.files))}
                className={cn(
                  'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
                  over ? 'border-primary bg-blue-50' : 'border-slate-300 bg-slate-50',
                )}
              >
                <span className="flex size-14 items-center justify-center rounded-full bg-white text-primary shadow-sm ring-1 ring-slate-200" aria-hidden>
                  <UploadCloud className="size-7" />
                </span>
                <p className="text-lg">Drag files here, or</p>
                <Button size="lg" className="h-11 text-base" onClick={() => inputRef.current?.click()} disabled={busy}>
                  Choose files
                </Button>
                <p className="text-base text-slate-600">PDF, Word, Excel or pictures · up to 25 MB each</p>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept={ACCEPT}
                  className="sr-only"
                  onChange={(e) => (e.target.files && add(e.target.files), (e.target.value = ''))}
                />
              </div>
              {problems.length > 0 && (
                <ul role="alert" className="mt-3 space-y-1 rounded-lg border border-red-200 bg-red-50 p-3 text-base text-red-800">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </Step>

            {items.length > 0 && (
              <Step n={3} title="Check the names">
                <ul className="space-y-3">
                  {items.map((i) => (
                    <li key={i.key}>
                      <Card className={cn('rounded-xl p-4 shadow-none', i.status === 'error' && 'border-red-300', i.status === 'done' && 'border-emerald-300')}>
                        <div className="flex items-start gap-3">
                          <FileIcon ext={i.file.name.split('.').pop()?.toLowerCase() ?? ''} />
                          <div className="min-w-0 flex-1 space-y-3">
                            <div className="text-base text-slate-600">
                              {i.file.name} · {size(i.file.size)}
                            </div>
                            <label className="block">
                              <span className="mb-1 block text-base font-medium">Name</span>
                              <Input
                                value={i.name}
                                disabled={i.status === 'uploading' || i.status === 'done'}
                                onChange={(e) => update(i.key, { name: e.target.value, status: i.status === 'error' ? 'ready' : i.status })}
                                maxLength={200}
                                className="h-11 text-base"
                              />
                            </label>
                            {isLicences && i.status !== 'done' && <ValidUntilField value={i.validUntil} onChange={(v) => update(i.key, { validUntil: v })} />}
                            {i.status === 'uploading' && <Progress value={i.progress} />}
                            {i.status === 'done' && (
                              <p className="flex items-center gap-1.5 text-base font-medium text-emerald-700">
                                <CheckCircle2 className="size-5" /> Added
                              </p>
                            )}
                            {i.status === 'error' && (
                              <p role="alert" className="flex items-center gap-1.5 text-base font-medium text-red-700">
                                <CircleAlert className="size-5" /> {i.error}
                              </p>
                            )}
                          </div>
                          {i.status !== 'uploading' && i.status !== 'done' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-11"
                              onClick={() => setItems((cur) => cur.filter((x) => x.key !== i.key))}
                              aria-label={`Remove ${i.file.name}`}
                            >
                              <X className="size-5" />
                            </Button>
                          )}
                        </div>
                      </Card>
                    </li>
                  ))}
                </ul>
              </Step>
            )}

            <div className="sticky bottom-0 -mx-4 flex justify-end border-t border-slate-200 bg-background/95 px-4 py-4 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0">
              <Button size="lg" className="h-12 px-8 text-base" disabled={!pending.length} loading={busy} onClick={upload}>
                <UploadCloud className="size-5" /> Add {pending.length || ''} file{pending.length === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        )}
      </Container>
    </>
  );
}
