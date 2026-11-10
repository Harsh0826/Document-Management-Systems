import { AlertTriangle, ChevronRight, FolderPlus, History, Pin, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useHome } from '@/api/hooks';
import { Container, SectionTitle } from '@/components/layout/Page';
import { NewFolderDialog } from '@/components/library/FolderDialogs';
import { FileList } from '@/components/library/FileRow';
import { FolderGrid, FolderSection } from '@/components/library/parts';
import { QuickSearch } from '@/components/library/QuickSearch';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

function Empty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-2xl border-2 border-dashed border-slate-300 bg-white p-8 text-base text-slate-600 sm:flex-row sm:items-center sm:justify-between">
      <p>{children}</p>
      {action}
    </div>
  );
}

/** Administrators: licences and certificates that have expired or expire soon, one click from the list. */
function Attention({ expired, soon }: { expired: number; soon: number }) {
  if (!expired && !soon) return null;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-5 sm:flex-row sm:items-center">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <AlertTriangle className="size-5" aria-hidden />
      </span>
      <div className="flex-1 text-base text-amber-950">
        <p className="text-lg font-semibold">Needs your attention</p>
        <p>
          {[
            expired && `${expired.toLocaleString()} document${expired === 1 ? ' has' : 's have'} expired`,
            soon && `${soon.toLocaleString()} expire${soon === 1 ? 's' : ''} in the next 30 days`,
          ]
            .filter(Boolean)
            .join(' and ')}
          .
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {expired > 0 && (
          <Button asChild className="h-11 bg-amber-700 text-base text-white hover:bg-amber-800">
            <Link to="/search?validity=expired&sort=expiry">See expired</Link>
          </Button>
        )}
        {soon > 0 && (
          <Button asChild variant="outline" className="h-11 border-amber-300 bg-white text-base">
            <Link to="/search?validity=soon&sort=expiry">See expiring soon</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

export default function HomePage() {
  const { user, isAdmin } = useAuth();
  const { data, isLoading } = useHome();
  const [newFolder, setNewFolder] = useState(false);

  return (
    <>
      {/* Hero: one job — find a document. */}
      <section className="relative z-10 bg-navy text-white" aria-labelledby="find">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <div className="absolute -right-24 -top-32 size-96 rounded-full bg-primary/40 blur-3xl" />
          <div className="absolute -bottom-40 left-1/4 size-96 rounded-full bg-blue-400/15 blur-3xl" />
        </div>
        <Container className="relative py-10 sm:py-14">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-base font-medium text-blue-200">
                {greeting()}, {user?.firstName}
              </p>
              <h1 id="find" className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
                Find a document
              </h1>
            </div>
            {isAdmin && (
              <Button asChild size="lg" className="h-11 bg-white text-base text-navy shadow-sm hover:bg-blue-50">
                <Link to="/add">
                  <Upload className="size-5" /> Add files
                </Link>
              </Button>
            )}
          </div>
          <div className="mt-6 max-w-3xl">
            <QuickSearch tone="hero" shortcut autoFocus={typeof window !== 'undefined' && window.matchMedia?.('(min-width: 768px)').matches} />
          </div>
          {data && data.totals.files > 0 && (
            <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-base text-blue-100">
              <span>
                {data.totals.files.toLocaleString()} document{data.totals.files === 1 ? '' : 's'} in {data.totals.folders.toLocaleString()} folder
                {data.totals.folders === 1 ? '' : 's'}
              </span>
              <Link to="/search" className="inline-flex items-center gap-1 font-medium text-white underline-offset-4 hover:underline">
                Browse all documents <ChevronRight className="size-4" aria-hidden />
              </Link>
            </p>
          )}
        </Container>
      </section>

      <Container className="space-y-12 pt-10">
        {data?.attention && <Attention {...data.attention} />}

        {!!data?.pinned.length && (
          <section aria-labelledby="pinned">
            <SectionTitle id="pinned" title="Your pinned folders" count={data.pinned.length} />
            <FolderGrid folders={data.pinned} showWhere />
          </section>
        )}

        {!!data?.opened.length && (
          <section aria-labelledby="opened">
            <h2 id="opened" className="mb-4 flex items-center gap-2 text-xl font-bold">
              <History className="size-5 text-slate-500" aria-hidden /> Recently opened by you
            </h2>
            <FileList files={data.opened} showFolder />
          </section>
        )}

        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
        ) : data?.folders.length ? (
          <FolderSection
            id="folders"
            title="Folders"
            folders={data.folders}
            action={
              isAdmin && (
                <Button variant="outline" className="h-10 text-base" onClick={() => setNewFolder(true)}>
                  <FolderPlus className="size-5" /> New folder
                </Button>
              )
            }
          />
        ) : (
          <section aria-labelledby="folders">
            <SectionTitle id="folders" title="Folders" />
            <Empty
              action={
                isAdmin && (
                  <Button className="h-11 text-base" onClick={() => setNewFolder(true)}>
                    <FolderPlus className="size-5" /> New folder
                  </Button>
                )
              }
            >
              {isAdmin ? 'No folders yet. Create your first one, for example "Licences" or "HR Policies".' : 'There are no documents here yet.'}
            </Empty>
          </section>
        )}

        <section aria-labelledby="recent">
          <SectionTitle
            id="recent"
            title="Recently added"
            action={
              !!data?.recent.length && (
                <Link to="/search?added=30" className="text-base font-medium text-primary hover:underline">
                  See everything added this month
                </Link>
              )
            }
          />
          {isLoading ? (
            <Skeleton className="h-56 rounded-2xl" />
          ) : data?.recent.length ? (
            <FileList files={data.recent} showFolder />
          ) : (
            <Empty
              action={
                isAdmin && (
                  <Button asChild className="h-11 text-base">
                    <Link to="/add">
                      <Upload className="size-5" /> Add files
                    </Link>
                  </Button>
                )
              }
            >
              {isAdmin ? 'No documents yet. Start by adding your first files.' : 'Nothing has been added yet.'}
            </Empty>
          )}
        </section>

        {!data?.pinned.length && !isLoading && !!data?.folders.length && (
          <p className="flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-3 text-base text-blue-900 ring-1 ring-inset ring-blue-200">
            <Pin className="size-4 shrink-0" aria-hidden /> Tip: open a folder you use often and choose <b>Pin to Home</b> to keep it here.
          </p>
        )}

        {isAdmin && (
          <Link to="/deleted" className="inline-flex min-h-11 items-center gap-2 text-base font-medium text-slate-600 hover:text-primary hover:underline">
            <Trash2 className="size-4" aria-hidden /> Recently deleted
          </Link>
        )}
      </Container>

      {newFolder && <NewFolderDialog onClose={() => setNewFolder(false)} />}
    </>
  );
}
