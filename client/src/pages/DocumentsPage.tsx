import { FolderInput, Upload, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDocuments } from '@/api/hooks';
import { DocumentFiltersBar } from '@/components/documents/DocumentFilters';
import { DocumentTable } from '@/components/documents/DocumentTable';
import { MoveDialog } from '@/components/documents/dialogs';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/form-controls';
import { Pagination } from '@/components/ui/table';
import { useUrlFilters } from '@/hooks/useUrlFilters';
import { useAuth } from '@/lib/auth';

export default function DocumentsPage() {
  const { isEmployee, can } = useAuth();
  const [filters, setFilters] = useUrlFilters();
  const { data, isLoading, isFetching } = useDocuments(filters);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const selectedDocs = useMemo(() => data?.items.filter((d) => selected.has(d.id)) ?? [], [data, selected]);

  const onSort = (field: string) => {
    const order = filters.sort === field && filters.order === 'asc' ? 'desc' : 'asc';
    setFilters({ ...filters, sort: field, order, page: 1 });
  };

  return (
    <>
      <PageHeader
        title={isEmployee ? 'My Documents' : 'Documents'}
        description={isEmployee ? 'Everything you have submitted, with its review status.' : 'Search, filter and manage every document you have access to.'}
        actions={
          (isEmployee || can('documents.upload')) && (
            <Button asChild>
              <Link to="/upload">
                <Upload /> Upload documents
              </Link>
            </Button>
          )
        }
      />
      <DocumentFiltersBar value={filters} onChange={setFilters} />

      {selected.size > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-accent px-4 py-2.5 text-sm animate-in">
          <span className="font-medium text-accent-foreground">{selected.size} selected</span>
          {selectedDocs.length > 0 && selectedDocs.every((d) => d.can.move) && (
            <Button size="sm" variant="outline" onClick={() => setMoving(true)}>
              <FolderInput /> Move to folder
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            <X /> Clear selection
          </Button>
        </div>
      )}

      <Card className="mt-4 overflow-hidden">
        <div className={isFetching && !isLoading ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
          <DocumentTable
            items={data?.items}
            loading={isLoading}
            columns={isEmployee ? ['category', 'fileType', 'uploadedAt', 'expiryDate', 'status'] : undefined}
            sort={filters.sort}
            order={filters.order}
            onSort={onSort}
            selected={isEmployee ? undefined : selected}
            onSelectedChange={isEmployee ? undefined : setSelected}
          />
        </div>
        {data && data.total > 0 && (
          <Pagination page={filters.page ?? 1} pageSize={filters.pageSize ?? 20} total={data.total} onPage={(page) => setFilters({ ...filters, page })}>
            <NativeSelect className="w-28" value={filters.pageSize ?? 20} onChange={(e) => setFilters({ ...filters, pageSize: Number(e.target.value), page: 1 })} aria-label="Rows per page">
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>{n} / page</option>
              ))}
            </NativeSelect>
          </Pagination>
        )}
      </Card>
      {moving && <MoveDialog docs={selectedDocs} open onOpenChange={setMoving} onMoved={() => setSelected(new Set())} />}
    </>
  );
}
