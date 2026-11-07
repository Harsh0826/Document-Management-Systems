import { BellRing, CalendarClock, FileCheck2, Lock, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { APP_NAME } from '@/lib/utils';

const FEATURES = [
  { icon: Lock, title: 'Private, encrypted storage', text: 'Documents live in a private bucket and are only reachable through short-lived signed links.' },
  { icon: FileCheck2, title: 'Review & approval workflow', text: 'Every certificate is reviewed, approved or returned with feedback.' },
  { icon: CalendarClock, title: 'Expiry tracking', text: 'Automatic 90/60/30-day reminders before a certificate lapses.' },
  { icon: BellRing, title: 'Full audit trail', text: 'Every view, download and change is recorded.' },
];

export function AuthLayout({ children, eyebrow }: { children: ReactNode; eyebrow?: string }) {
  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_minmax(0,1fr)]">
      <div className="relative hidden overflow-hidden bg-navy p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -right-32 -top-32 size-[28rem] rounded-full bg-primary/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -left-20 size-[26rem] rounded-full bg-blue-400/10 blur-3xl" />
        <div className="relative flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary shadow-lg shadow-primary/40">
            <ShieldCheck className="size-5" />
          </span>
          <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
        </div>
        <div className="relative mt-auto max-w-lg">
          {eyebrow && <div className="mb-3 text-sm font-medium uppercase tracking-wider text-blue-300">{eyebrow}</div>}
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">Employee documents and certificates, organised and compliant.</h1>
          <ul className="mt-10 space-y-5">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                  <f.icon className="size-5 text-blue-300" />
                </span>
                <div>
                  <div className="font-medium">{f.title}</div>
                  <div className="text-sm text-slate-400">{f.text}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="relative mt-12 text-xs text-slate-500">© {new Date().getFullYear()} {APP_NAME}. Confidential — authorised users only.</div>
      </div>
      <div className="flex items-center justify-center bg-background px-4 py-12 sm:px-8">
        <div className="w-full max-w-md animate-slide-up">{children}</div>
      </div>
    </div>
  );
}
