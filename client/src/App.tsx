import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { EmptyState } from './components/ui/card';
import { PageLoader } from './components/ui/spinner';
import { useAuth } from './lib/auth';
import type { Permission } from './lib/types';
import { ShieldAlert } from 'lucide-react';

const LoginLanding = lazy(() => import('./pages/auth/LoginLanding'));
const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const AcceptInvitePage = lazy(() => import('./pages/auth/AcceptInvitePage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const DocumentsPage = lazy(() => import('./pages/DocumentsPage'));
const DocumentDetailPage = lazy(() => import('./pages/DocumentDetailPage'));
const UploadPage = lazy(() => import('./pages/UploadPage'));
const ExplorerPage = lazy(() => import('./pages/ExplorerPage'));
const ReviewsPage = lazy(() => import('./pages/ReviewsPage'));
const CertificatesPage = lazy(() => import('./pages/CertificatesPage'));
const RequestsPage = lazy(() => import('./pages/RequestsPage'));
const EmployeesPage = lazy(() => import('./pages/EmployeesPage'));
const UsersPage = lazy(() => import('./pages/admin/UsersPage'));
const ClientsPage = lazy(() => import('./pages/admin/ClientsPage'));
const CategoriesPage = lazy(() => import('./pages/admin/CategoriesPage'));
const AuditPage = lazy(() => import('./pages/admin/AuditPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <PageLoader label="Restoring your session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

/** Client-side guard for UX only — the API enforces every permission server-side. */
function Guard({ perm, notEmployee, employeeOr, children }: { perm?: Permission; notEmployee?: boolean; employeeOr?: Permission; children: ReactNode }) {
  const { can, isEmployee } = useAuth();
  const allowed = (perm ? can(perm) : true) && (notEmployee ? !isEmployee : true) && (employeeOr ? isEmployee || can(employeeOr) : true);
  if (!allowed) {
    return <EmptyState icon={<ShieldAlert />} title="Access restricted" description="You don't have permission to view this page. Contact your administrator if you need access." />;
  }
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <PageLoader />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<PublicOnly><LoginLanding /></PublicOnly>} />
        <Route path="/login/:portal" element={<PublicOnly><LoginPage /></PublicOnly>} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />

        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/documents/:id" element={<DocumentDetailPage />} />
          <Route path="/upload" element={<Guard employeeOr="documents.upload"><UploadPage /></Guard>} />
          <Route path="/explorer" element={<ExplorerPage />} />
          <Route path="/reviews" element={<Guard perm="documents.review"><ReviewsPage /></Guard>} />
          <Route path="/certificates" element={<CertificatesPage />} />
          <Route path="/requests" element={<RequestsPage />} />
          <Route path="/employees" element={<Guard notEmployee><EmployeesPage /></Guard>} />
          <Route path="/users" element={<Guard perm="users.manage"><UsersPage /></Guard>} />
          <Route path="/clients" element={<Guard perm="clients.manage"><ClientsPage /></Guard>} />
          <Route path="/categories" element={<Guard perm="clients.manage"><CategoriesPage /></Guard>} />
          <Route path="/audit" element={<Guard perm="audit.view"><AuditPage /></Guard>} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
