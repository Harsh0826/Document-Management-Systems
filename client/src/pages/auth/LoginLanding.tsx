import { ArrowRight, Briefcase, ShieldCheck, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { APP_NAME } from '@/lib/utils';
import { AuthLayout } from './AuthLayout';

const PORTALS = [
  {
    to: '/login/employee',
    icon: UserRound,
    title: 'Employee Portal',
    text: 'Upload your certificates, track approvals and renewals.',
    cls: 'bg-blue-50 text-primary',
  },
  {
    to: '/login/admin',
    icon: Briefcase,
    title: 'Admin & Staff Portal',
    text: 'Manage employees, review submissions and oversee compliance.',
    cls: 'bg-navy text-white',
  },
];

export default function LoginLanding() {
  return (
    <AuthLayout>
      <div className="mb-8 flex items-center gap-2.5 lg:hidden">
        <span className="flex size-9 items-center justify-center rounded-lg bg-navy text-white">
          <ShieldCheck className="size-5" />
        </span>
        <span className="text-lg font-semibold">{APP_NAME}</span>
      </div>
      <h2 className="text-2xl font-semibold tracking-tight">Welcome</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">Choose the portal that matches your account.</p>
      <div className="mt-8 space-y-3">
        {PORTALS.map((p) => (
          <Link
            key={p.to}
            to={p.to}
            className="group flex items-center gap-4 rounded-xl border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
          >
            <span className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${p.cls}`}>
              <p.icon className="size-6" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{p.title}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">{p.text}</span>
            </span>
            <ArrowRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
          </Link>
        ))}
      </div>
      <p className="mt-8 text-center text-xs text-muted-foreground">New here? Use the invitation link sent by your administrator to set your password.</p>
    </AuthLayout>
  );
}
