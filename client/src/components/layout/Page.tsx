import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Centred content column used by every page. */
export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8', className)}>{children}</div>;
}

/** Light band at the top of a page: breadcrumb, optional icon, title, short meta line and actions. */
export function PageHead({
  crumbs,
  icon,
  title,
  meta,
  actions,
}: {
  crumbs?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="border-b bg-card">
      <Container className="py-6 sm:py-8">
        {crumbs}
        <div className="flex flex-wrap items-center gap-4">
          {icon}
          <div className="min-w-0 flex-1 basis-64">
            <h1 className="text-2xl font-bold tracking-tight break-words sm:text-3xl">{title}</h1>
            {meta && <div className="mt-1 text-base text-slate-600">{meta}</div>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </Container>
    </div>
  );
}

/** Section title with an optional count and right-hand action. */
export function SectionTitle({ title, count, action, id }: { title: string; count?: number; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 id={id} className="flex items-center gap-2.5 text-xl font-bold text-foreground">
        {title}
        {count !== undefined && <span className="rounded-full bg-slate-200/70 px-2.5 py-0.5 text-sm font-semibold text-slate-700">{count}</span>}
      </h2>
      {action}
    </div>
  );
}
