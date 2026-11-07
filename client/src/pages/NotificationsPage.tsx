import { Bell, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMarkRead, useNotifications } from '@/api/hooks';
import { NotificationRow } from '@/components/layout/NotificationBell';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, PageHeader } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { Pagination } from '@/components/ui/table';

export default function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const { data } = useNotifications({ unreadOnly, page, pageSize: 25 });
  const mark = useMarkRead();
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Approvals, rejections, expiry reminders and requests."
        actions={
          <Button variant="outline" disabled={!data?.unread} onClick={() => mark.mutate('all')}>
            <CheckCheck /> Mark all as read
          </Button>
        }
      />
      <Tabs value={unreadOnly ? 'unread' : 'all'} onValueChange={(v) => (setUnreadOnly(v === 'unread'), setPage(1))}>
        <TabsList className="mb-4">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unread">Unread {data?.unread ? `(${data.unread})` : ''}</TabsTrigger>
        </TabsList>
      </Tabs>
      <Card className="overflow-hidden">
        {data?.items.length ? (
          <div className="divide-y">
            {data.items.map((n) => (
              <NotificationRow
                key={n.id}
                n={n}
                onClick={() => {
                  if (!n.isRead) mark.mutate(n.id);
                  if (n.link) navigate(n.link);
                }}
              />
            ))}
          </div>
        ) : (
          <EmptyState icon={<Bell />} title={unreadOnly ? 'No unread notifications' : 'No notifications yet'} />
        )}
        {data && data.total > 25 && <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />}
      </Card>
    </>
  );
}
