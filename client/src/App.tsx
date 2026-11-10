import { ShieldAlert } from 'lucide-react';
import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { EmptyState } from './components/ui/card';
import { PageLoader } from './components/ui/spinner';
import { useAuth } from './lib/auth';

const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const AcceptInvitePage = lazy(() => import('./pages/auth/AcceptInvitePage'));
const MfaRequiredPage = lazy(() => import('./pages/auth/MfaRequiredPage'));
const HomePage = lazy(() => import('./pages/HomePage'));
const FolderPage = lazy(() => import('./pages/FolderPage'));
const FilePage = lazy(() => import('./pages/FilePage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const AddFilesPage = lazy(() => import('./pages/AddFilesPage'));
const PeoplePage = lazy(() => import('./pages/PeoplePage'));
const DeletedPage = lazy(() => import('./pages/DeletedPage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));
const StoragePage = lazy(() => import('./pages/admin/StoragePage'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <PageLoader label="Loading…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  // The server refuses data access until two-step sign-in is set up; show the setup screen instead.
  if (user.mfaSetupRequired) return <MfaRequiredPage />;
  return <>{children}</>;
}

/** Screen guard for administrators (the server enforces this on every request too). */
function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <EmptyState icon={<ShieldAlert />} title="You don't have access to this." description="Ask your administrator if you need it." />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <PageLoader />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route
          path="/login"
          element={
            <PublicOnly>
              <LoginPage />
            </PublicOnly>
          }
        />
        <Route path="/login/*" element={<Navigate to="/login" replace />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />

        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route path="/" element={<HomePage />} />
          <Route path="/folders/:id" element={<FolderPage />} />
          <Route path="/files/:id" element={<FilePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route
            path="/add"
            element={
              <AdminOnly>
                <AddFilesPage />
              </AdminOnly>
            }
          />
          <Route
            path="/people"
            element={
              <AdminOnly>
                <PeoplePage />
              </AdminOnly>
            }
          />
          <Route
            path="/deleted"
            element={
              <AdminOnly>
                <DeletedPage />
              </AdminOnly>
            }
          />
          {/* One-time IT setup; intentionally not in the menu. */}
          <Route
            path="/settings/storage"
            element={
              <AdminOnly>
                <StoragePage />
              </AdminOnly>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
