import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { errorMessage } from '@/api/client';
import { getFileUrl, useFile } from '@/api/hooks';
import { Container } from '@/components/layout/Page';
import { FileAdminMenu, startDownload } from '@/components/library/FileRow';
import { Breadcrumb, FileIcon, ValidityLabel } from '@/components/library/parts';
import { Button } from '@/components/ui/button';
import { EmptyState, Skeleton } from '@/components/ui/card';
import { PageLoader } from '@/components/ui/spinner';
import { useAuth } from '@/lib/auth';
import { longDay, size } from '@/lib/format';

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="shrink-0 text-base text-slate-600">{label}</dt>
      <dd className="min-w-0 text-right text-base font-medium break-words text-foreground">{children}</dd>
    </div>
  );
}

export default function FilePage() {
  const { id } = useParams<{ id: string }>();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const { data: file, isLoading, isError, error } = useFile(id);
  const preview = useQuery({
    queryKey: ['library', 'preview', id],
    queryFn: () => getFileUrl(id!, 'inline'),
    enabled: !!file?.previewable,
    staleTime: 60_000, // links stay valid for 5 minutes
    retry: false,
  });

  if (isError)
    return (
      <Container className="pt-10">
        <EmptyState
          title="We couldn't open this document"
          description={errorMessage(error)}
          action={
            <Button asChild size="lg">
              <Link to="/">Back to Home</Link>
            </Button>
          }
        />
      </Container>
    );
  if (isLoading || !file)
    return (
      <Container className="grid gap-6 pt-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Skeleton className="h-[60vh] rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </Container>
    );

  const folder = file.folderPath[file.folderPath.length - 1];
  const back = from ?? `/folders/${file.folderId}`;
  const backLabel = from?.startsWith('/search') ? 'Back to results' : from === '/' ? 'Back to Home' : `Back to ${folder?.name ?? 'folder'}`;

  const downloadButton = (
    <Button
      size="lg"
      className="h-12 w-full text-base"
      onClick={() => startDownload(file)}
      aria-label={`Download ${file.name}, ${file.type}, ${size(file.sizeBytes)}`}
    >
      <Download className="size-5" /> Download
    </Button>
  );

  return (
    <Container className="pt-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <Link to={back} className="inline-flex min-h-11 items-center gap-2 text-base font-semibold text-primary hover:underline">
          <ArrowLeft className="size-5" aria-hidden /> {backLabel}
        </Link>
        <div className="hidden sm:block [&_nav]:mb-0">
          <Breadcrumb path={file.folderPath} current={file.name} />
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Details first on phones (title + Download near the top), on the right on wide screens. */}
        <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,27,51,0.05)] sm:p-6 lg:sticky lg:top-24 lg:order-2">
          <div className="flex items-start gap-4">
            <FileIcon ext={file.ext} className="size-12 [&_svg]:size-6" />
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold leading-snug tracking-tight break-words sm:text-2xl">{file.name}</h1>
              {file.isNew && (
                <span className="mt-1.5 inline-block rounded-full bg-blue-600 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">New</span>
              )}
            </div>
            {isAdmin && <FileAdminMenu file={file} onDeleted={() => navigate(`/folders/${file.folderId}`, { replace: true })} />}
          </div>

          {file.validUntil && (
            <div className="mt-4">
              <ValidityLabel file={file} />
            </div>
          )}

          <div className="mt-5">{downloadButton}</div>

          <dl className="mt-5 divide-y divide-slate-200 border-t border-slate-200">
            <Detail label="Folder">
              {folder ? (
                <Link to={`/folders/${file.folderId}`} className="text-primary hover:underline">
                  {folder.name}
                </Link>
              ) : (
                '—'
              )}
            </Detail>
            <Detail label="Added">{longDay(file.addedAt)}</Detail>
            {file.updatedAt && longDay(file.updatedAt) !== longDay(file.addedAt) && <Detail label="Last updated">{longDay(file.updatedAt)}</Detail>}
            <Detail label="Type">{file.type}</Detail>
            <Detail label="Size">{size(file.sizeBytes)}</Detail>
            {isAdmin && file.uploadedByName && <Detail label="Added by">{file.uploadedByName}</Detail>}
          </dl>
        </aside>

        <section
          aria-label="Preview"
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,27,51,0.05)] lg:order-1"
        >
          {file.previewable ? (
            preview.isLoading ? (
              <PageLoader label="Opening the document…" />
            ) : preview.isError || !preview.data ? (
              <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                <FileIcon ext={file.ext} className="size-16 [&_svg]:size-8" />
                <p className="max-w-md text-lg text-slate-700">This file can't be shown right now. Download it to open it.</p>
              </div>
            ) : file.ext === 'pdf' ? (
              <iframe src={preview.data.url} title={file.name} className="h-[78vh] min-h-[28rem] w-full border-0 bg-white" />
            ) : (
              <div className="flex justify-center bg-slate-100 p-4 sm:p-8">
                <img src={preview.data.url} alt={file.name} className="max-h-[75vh] max-w-full rounded-lg object-contain shadow-sm" />
              </div>
            )
          ) : (
            <div className="flex flex-col items-center gap-4 bg-slate-50 px-6 py-20 text-center">
              <FileIcon ext={file.ext} className="size-20 rounded-2xl [&_svg]:size-10" />
              <div>
                <p className="text-lg font-semibold text-foreground">This {file.type.toLowerCase()} can't be shown in the browser.</p>
                <p className="mt-1 text-base text-slate-600">Download it to open it on your computer.</p>
              </div>
              <div className="w-full max-w-xs">{downloadButton}</div>
            </div>
          )}
        </section>
      </div>
    </Container>
  );
}
