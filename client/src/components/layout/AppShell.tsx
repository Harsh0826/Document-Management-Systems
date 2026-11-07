import {
  Bell,
  Building2,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  FolderTree,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  Search,
  Shapes,
  ShieldCheck,
  Upload,
  User,
  Users,
  UsersRound,
  FileStack,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useDashboard } from '@/api/hooks';
import { Avatar } from '@/components/ui/card';
import { Input } from '@/components/ui/form-controls';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/overlays';
import { useAuth } from '@/lib/auth';
import type { Permission } from '@/lib/types';
import { APP_NAME, cn } from '@/lib/utils';
import { NotificationBell } from './NotificationBell';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  show: boolean;
  badge?: number;
}

function useNav(): { section: string; items: NavItem[] }[] {
  const { user, can, isEmployee, isAdmin } = useAuth();
  const { data } = useDashboard();
  const p = (k: Permission) => can(k);
  if (!user) return [];
  return [
    {
      section: 'Workspace',
      items: [
        { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, show: true },
        { to: '/documents', label: isEmployee ? 'My Documents' : 'Documents', icon: FileStack, show: true },
        { to: '/upload', label: 'Upload', icon: Upload, show: isEmployee || p('documents.upload') },
        { to: '/explorer', label: 'Folders', icon: FolderTree, show: true },
      ],
    },
    {
      section: 'Compliance',
      items: [
        { to: '/reviews', label: 'Review Queue', icon: ClipboardCheck, show: p('documents.review'), badge: data?.totals.pending },
        { to: '/certificates', label: 'Expiry Tracking', icon: CalendarClock, show: true, badge: isEmployee ? (data?.totals.expired ?? 0) + (data?.totals.renewalRequired ?? 0) || undefined : undefined },
        { to: '/requests', label: isEmployee ? 'My Requests' : 'Document Requests', icon: ClipboardList, show: true, badge: isEmployee ? data?.totals.openRequests || undefined : undefined },
      ],
    },
    {
      section: 'Administration',
      items: [
        { to: '/employees', label: 'Employees', icon: UsersRound, show: !isEmployee },
        { to: '/users', label: 'Users & Access', icon: Users, show: p('users.manage') },
        { to: '/clients', label: 'Clients', icon: Building2, show: p('clients.manage') },
        { to: '/categories', label: 'Categories', icon: Shapes, show: p('clients.manage') },
        { to: '/audit', label: 'Audit Log', icon: ScrollText, show: p('audit.view') || isAdmin },
      ],
    },
  ]
    .map((s) => ({ ...s, items: s.items.filter((i) => i.show) }))
    .filter((s) => s.items.length);
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const nav = useNav();
  const { user } = useAuth();
  return (
    <div className="flex h-full flex-col bg-navy text-slate-300">
      <Link to="/dashboard" onClick={onNavigate} className="flex h-16 shrink-0 items-center gap-2.5 px-5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-white shadow-lg shadow-primary/30">
          <ShieldCheck className="size-[18px]" />
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-white">{APP_NAME}</span>
      </Link>
      <nav className="scroll-thin flex-1 space-y-6 overflow-y-auto px-3 py-4" aria-label="Main">
        {nav.map((s) => (
          <div key={s.section}>
            <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{s.section}</div>
            <ul className="space-y-0.5">
              {s.items.map((i) => (
                <li key={i.to}>
                  <NavLink
                    to={i.to}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        isActive ? 'bg-white/10 text-white shadow-inner' : 'hover:bg-white/5 hover:text-white',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <i.icon className={cn('size-[18px] shrink-0', isActive ? 'text-blue-400' : 'text-slate-400 group-hover:text-slate-200')} />
                        <span className="flex-1 truncate">{i.label}</span>
                        {!!i.badge && <span className="rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">{i.badge}</span>}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 p-4 text-xs text-slate-500">
        Signed in as <span className="font-medium capitalize text-slate-300">{user?.role}</span>
      </div>
    </div>
  );
}

function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(`/documents?q=${encodeURIComponent(q.trim())}`);
  };
  return (
    <form onSubmit={submit} role="search" className="relative hidden w-full max-w-md md:block">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents, file names, employees…" className="h-9 bg-muted/60 pl-9" aria-label="Search documents" />
    </form>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  const name = `${user.firstName} ${user.lastName}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex cursor-pointer items-center gap-2.5 rounded-lg p-1 pr-2 transition-colors hover:bg-muted">
        <Avatar name={name} />
        <div className="hidden text-left leading-tight sm:block">
          <div className="text-sm font-medium">{name}</div>
          <div className="text-xs capitalize text-muted-foreground">{user.role}</div>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/profile')}>
          <User /> Profile & password
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/notifications')}>
          <Bell /> Notifications
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          destructive
          onSelect={async () => {
            const portal = user.role === 'employee' ? 'employee' : 'admin';
            await logout();
            navigate(`/login/${portal}`, { replace: true });
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 lg:block">
        <div className="fixed inset-y-0 left-0 w-64">
          <Sidebar />
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-navy/50 animate-in" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 shadow-2xl animate-slide-up">
            <button className="absolute right-3 top-4 z-10 rounded-md p-1.5 text-slate-300 hover:bg-white/10" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b bg-card/85 px-4 backdrop-blur-md sm:px-6">
          <button className="rounded-md p-2 text-muted-foreground hover:bg-muted lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-1.5">
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 animate-in">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
