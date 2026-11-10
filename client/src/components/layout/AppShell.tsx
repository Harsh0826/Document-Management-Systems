import { AlertTriangle, CalendarClock, ChevronDown, FileStack, KeyRound, LogOut, PanelLeft, Search, X } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useExpiryCounts } from '@/api/hooks';
import { useSidebarPref } from '@/components/library/prefs';
import { QuickSearch } from '@/components/library/QuickSearch';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/overlays';
import { useAuth } from '@/lib/auth';
import { APP_NAME, cn } from '@/lib/utils';
import { FolderSidebar } from './FolderSidebar';

/** Pages that belong to the library: they get the folder sidebar, and Home stays highlighted. */
const LIBRARY = /^\/($|folders|files|search|add|deleted)/;
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

function NavItem({
  to,
  label,
  active,
  icon,
  count,
  tone,
  shortLabel,
}: {
  to: string;
  label: string;
  active: boolean;
  icon?: ReactNode;
  count?: number;
  tone?: 'red' | 'amber';
  /** Medium screens show only the icon and count; wide screens add the label. */
  shortLabel?: boolean;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      aria-label={count !== undefined ? `${label}: ${count.toLocaleString()}` : undefined}
      title={shortLabel ? label : undefined}
      className={cn(
        'relative inline-flex h-16 items-center gap-1.5 px-2.5 text-base font-semibold whitespace-nowrap transition-colors xl:px-3',
        active
          ? 'text-primary after:absolute after:inset-x-2.5 after:bottom-0 after:h-[3px] after:rounded-t after:bg-primary'
          : 'text-slate-600 hover:text-foreground',
      )}
    >
      {icon}
      <span className={cn(shortLabel && 'hidden lg:inline')}>{label}</span>
      {!!count && (
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums',
            tone === 'red' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900',
          )}
        >
          {compact.format(count)}
        </span>
      )}
    </Link>
  );
}

function AccountMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full pl-1 pr-2 text-base font-medium hover:bg-slate-100"
        aria-label="Your account"
      >
        <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{initials}</span>
        <span className="hidden xl:inline">{user.firstName}</span>
        <ChevronDown className="size-4 text-slate-500" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuLabel>
          <span className="block text-base font-semibold text-foreground">
            {user.firstName} {user.lastName}
          </span>
          <span className="block font-normal">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-11 text-base" onSelect={() => navigate('/account')}>
          <KeyRound /> My account
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-11 text-base"
          onSelect={async () => {
            await logout();
            navigate('/login', { replace: true });
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Phones and tablets: shortcuts and the folder tree slide in from the left. */
function FolderDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-navy/40 backdrop-blur-[2px]" />
        <D.Content className="fixed inset-y-0 left-0 z-50 flex w-[min(22rem,88vw)] flex-col bg-white shadow-2xl focus:outline-none">
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 px-4">
            <D.Title className="text-lg font-bold">Browse</D.Title>
            <D.Description className="sr-only">Shortcuts and every folder in the library</D.Description>
            <D.Close className="flex size-10 cursor-pointer items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100" aria-label="Close">
              <X className="size-5" />
            </D.Close>
          </div>
          <div className="min-h-0 flex-1">
            <FolderSidebar onNavigate={close} />
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function AppShell() {
  const { isAdmin } = useAuth();
  const { pathname, search } = useLocation();
  const onHome = pathname === '/';
  const library = LIBRARY.test(pathname);
  const [sidebar, setSidebar] = useSidebarPref();
  const [drawer, setDrawer] = useState(false);
  const { data: expiry } = useExpiryCounts();
  const validity = pathname === '/search' ? new URLSearchParams(search).get('validity') : null;
  const expiryPage = validity === 'expired' || validity === 'soon';

  useEffect(() => setDrawer(false), [pathname, search]);
  // Wide screens: show or hide the sidebar. Smaller screens: open the drawer.
  const toggleFolders = () => {
    if (window.matchMedia('(min-width: 1024px)').matches) setSidebar(!sidebar);
    else setDrawer(true);
  };

  return (
    <div className="flex min-h-full flex-col bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:shadow"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex h-16 items-center gap-1 px-3 sm:gap-2 sm:px-5">
          {library && (
            <button
              type="button"
              onClick={toggleFolders}
              aria-label="Folders"
              title="Show or hide folders"
              className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-foreground"
            >
              <PanelLeft className="size-5" />
            </button>
          )}
          <Link to="/" className="mr-1 flex shrink-0 items-center gap-2.5 sm:mr-3" aria-label={`${APP_NAME} home`}>
            <span className="flex size-9 items-center justify-center rounded-lg bg-navy text-white shadow-sm">
              <FileStack className="size-5" aria-hidden />
            </span>
            <span className="hidden text-lg font-bold tracking-tight text-navy xl:inline">{APP_NAME}</span>
          </Link>
          <nav aria-label="Main" className="flex min-w-0 items-center">
            <NavItem to="/" label="Home" active={library && !expiryPage} />
            <span className="hidden md:contents">
              <NavItem
                to="/search?validity=expired&sort=expiry"
                label="Expired"
                icon={<AlertTriangle className="size-4 text-red-600" aria-hidden />}
                count={expiry?.expired}
                tone="red"
                active={validity === 'expired'}
                shortLabel
              />
              <NavItem
                to="/search?validity=soon&sort=expiry"
                label="Expiring soon"
                icon={<CalendarClock className="size-4 text-amber-600" aria-hidden />}
                count={expiry?.soon}
                tone="amber"
                active={validity === 'soon'}
                shortLabel
              />
            </span>
            {isAdmin && <NavItem to="/people" label="People" active={pathname === '/people'} />}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {!onHome && pathname !== '/search' && <QuickSearch shortcut className="hidden w-56 md:block lg:w-64 xl:w-80" />}
            {!onHome && (
              <Link
                to="/search"
                className="flex size-11 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 md:hidden"
                aria-label="Search"
              >
                <Search className="size-5" />
              </Link>
            )}
            <AccountMenu />
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {library && sidebar && (
          <aside aria-label="Folders" className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-72 shrink-0 border-r border-slate-200 bg-white lg:block">
            <FolderSidebar showQuickLinks={false} />
          </aside>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <main id="main" className="flex-1 pb-16">
            <Outlet />
          </main>
          <footer className="border-t border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-5 text-base text-slate-600 sm:px-6">
              <span>{APP_NAME}</span>
              <span>Need help? Contact your administrator.</span>
            </div>
          </footer>
        </div>
      </div>
      {library && <FolderDrawer open={drawer} onOpenChange={setDrawer} />}
    </div>
  );
}
