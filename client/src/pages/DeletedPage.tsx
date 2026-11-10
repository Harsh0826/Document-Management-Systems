import { RotateCcw, Trash2 } from 'lucide-react';
import { Container, PageHead } from '@/components/layout/Page';
import { toast } from 'sonner';
import { errorMessage } from '@/api/client';
import { useDeleted, useRestoreFile } from '@/api/hooks';
import { Breadcrumb, FileIcon } from '@/components/library/parts';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/card';
import { day } from '@/lib/format';

export default function DeletedPage() {
  const { data, isLoading } = useDeleted();
  const restore = useRestoreFile();
  return (
    <>
      <PageHead
        crumbs={<Breadcrumb path={[]} current="Recently deleted" />}
        icon={
          <span className="flex size-14 items-center justify-center rounded-xl bg-slate-100 text-slate-600" aria-hidden>
            <Trash2 className="size-7" />
          </span>
        }
        title="Recently deleted"
        meta="Deleted files stay here for 30 days. After that they are removed for good."
      />
      <Container className="pt-8">
        {isLoading ? (
          <Skeleton className="h-40 rounded-2xl" />
        ) : !data?.length ? (
          <Card className="rounded-2xl border-2 border-dashed p-8 text-center text-base text-slate-600 shadow-none">Nothing has been deleted recently.</Card>
        ) : (
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,27,51,0.05)]">
            {data.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:px-5">
                <FileIcon ext={f.ext} />
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-semibold break-words">{f.name}</div>
                  <div className="text-base text-slate-600">
                    Was in {f.folderPath.map((p) => p.name).join(' › ')} · removed for good on {day(f.removedForGoodAt)}
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="h-11 text-base"
                  loading={restore.isPending && restore.variables === f.id}
                  onClick={() =>
                    restore.mutate(f.id, {
                      onSuccess: () => toast.success(`"${f.name}" restored.`),
                      onError: (e) => toast.error(errorMessage(e)),
                    })
                  }
                >
                  <RotateCcw className="size-5" /> Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Container>
    </>
  );
}
