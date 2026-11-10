import { FolderSearch, SearchX, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFindFolders, useFolder } from '@/api/hooks';
import { Container } from '@/components/layout/Page';
import { DocumentBrowser } from '@/components/library/DocumentBrowser';
import { FolderRows } from '@/components/library/parts';
import { QuickSearch } from '@/components/library/QuickSearch';
import { Button } from '@/components/ui/button';

const TITLES: Record<string, string> = {
  expired: 'Expired documents',
  soon: 'Documents expiring in the next 30 days',
  valid: 'Documents valid for more than 30 days',
  none: 'Documents with no expiry date',
};

/**
 * Search across the whole library, or browse every document with filters (for example everything
 * that expires this month). `in` limits it to one folder and its sub-folders.
 */
export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q')?.trim() ?? '';
  const scopeId = params.get('in') ?? undefined;
  const { data: scope } = useFolder(scopeId);
  const { data: folders } = useFindFolders(scopeId ? '' : q);
  const validity = params.get('validity') ?? '';
  const title = q ? `Results for "${q}"` : (TITLES[validity] ?? (params.get('added') ? 'Recently added documents' : 'All documents'));

  return (
    <>
      <div className="relative z-10 border-b border-slate-200 bg-white">
        <Container className="py-6 sm:py-8">
          <h1 className="mb-4 text-2xl font-bold tracking-tight break-words sm:text-3xl">{title}</h1>
          <div className="max-w-3xl">
            <QuickSearch tone="page" initial={q} autoFocus={!q && !validity} shortcut />
          </div>
          {scope && (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-base text-slate-700">
              Only in
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 py-1 pl-3 pr-1 font-medium text-primary ring-1 ring-inset ring-blue-200">
                {[...scope.parents.map((p) => p.name), scope.name].join(' › ')}
                <button
                  type="button"
                  onClick={() =>
                    setParams((cur) => {
                      const n = new URLSearchParams(cur);
                      n.delete('in');
                      return n;
                    })
                  }
                  className="flex size-7 cursor-pointer items-center justify-center rounded-full hover:bg-blue-100"
                  aria-label="Search everywhere instead"
                >
                  <X className="size-4" />
                </button>
              </span>
            </p>
          )}
        </Container>
      </div>

      <Container className="space-y-8 pt-8">
        {!!folders?.length && q && (
          <section aria-labelledby="folder-results">
            <h2 id="folder-results" className="mb-3 flex items-center gap-2 text-lg font-bold">
              <FolderSearch className="size-5 text-slate-500" aria-hidden /> Folders matching "{q}"
            </h2>
            <FolderRows folders={folders.slice(0, 6)} showWhere />
            {folders.length > 6 && <p className="mt-2 text-sm text-slate-600">And {folders.length - 6} more. Type more of the name to narrow it down.</p>}
          </section>
        )}

        <DocumentBrowser
          key={scopeId ?? 'all'}
          folder={scope ? { id: scope.id, name: scope.name, hasSubfolders: true, deep: true } : undefined}
          showFolder
          heading={(total) =>
            total ? (
              <h2 className="mb-3 text-lg font-bold">
                Documents <span className="font-normal text-slate-600">· {total}</span>
              </h2>
            ) : null
          }
          empty={
            <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-slate-300 bg-white px-6 py-14 text-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <SearchX className="size-7" aria-hidden />
              </span>
              <p className="text-lg font-semibold">There are no documents yet.</p>
              <Button asChild size="lg" variant="outline" className="h-11 text-base">
                <Link to="/">Back to Home</Link>
              </Button>
            </div>
          }
        />
      </Container>
    </>
  );
}
