import { AlertTriangle, Bell, CheckCheck, CheckCircle2, ClipboardList, FileUp, MessageSquare, RefreshCw, UserPlus, XCircle, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMarkRead, useNotifications } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays';
import type { NotificationItem } from '@/lib/types';
import { cn, fmtAgo } from '@/lib/utils';

export const NOTIFICATION_ICON: Record<string, { icon: LucideIcon; cls: string }> = {
  document_uploaded: { icon: FileUp, cls: 'bg-blue-50 text-blue-600' },
  document_approved: { icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-600' },
  document_rejected: { icon: XCircle, cls: 'bg-red-50 text-red-600' },
  renewal_required: { icon: RefreshCw, cls: 'bg-orange-50 text-orange-600' },
  certificate_expiring: { icon: AlertTriangle, cls: 'bg-amber-50 text-amber-600' },
  certificate_expired: { icon: AlertTriangle, cls: 'bg-red-50 text-red-600' },
  document_requested: { icon: ClipboardList, cls: 'bg-violet-50 text-violet-600' },
  comment_added: { icon: MessageSquare, cls: 'bg-sky-50 text-sky-600' },
  account: { icon: UserPlus, cls: 'bg-slate-100 text-slate-600' },
};

export function NotificationRow({ n, onClick }: { n: NotificationItem; onClick: () => void }) {
  const meta = NOTIFICATION_ICON[n.type] ?? NOTIFICATION_ICON.account;
  return (
    <button onClick={onClick} className={cn('flex w-full cursor-pointer gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60', !n.isRead && 'bg-accent/40')}>
      <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', meta.cls)}>
        <meta.icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{n.title}</span>
          {!n.isRead && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{n.message}</span>
        <span className="mt-1 block text-xs text-muted-foreground/80">{fmtAgo(n.createdAt)}</span>
      </span>
    </button>
  );
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data } = useNotifications({ pageSize: 8 });
  const mark = useMarkRead();
  const navigate = useNavigate();
  const unread = data?.unread ?? 0;

  const openItem = (n: NotificationItem) => {
    if (!n.isRead) mark.mutate(n.id);
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="relative cursor-pointer rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}>
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-card">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-[min(24rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="font-semibold">Notifications</div>
          <Button variant="ghost" size="sm" disabled={!unread} onClick={() => mark.mutate('all')}>
            <CheckCheck /> Mark all read
          </Button>
        </div>
        <div className="scroll-thin max-h-[26rem] divide-y overflow-y-auto">
          {data?.items.length ? data.items.map((n) => <NotificationRow key={n.id} n={n} onClick={() => openItem(n)} />) : <EmptyState icon={<Bell />} title="You're all caught up" description="New activity on your documents will appear here." className="py-10" />}
        </div>
        <div className="border-t p-2">
          <Button variant="ghost" className="w-full" asChild onClick={() => setOpen(false)}>
            <Link to="/notifications">View all notifications</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
