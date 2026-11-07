import { clsx, type ClassValue } from 'clsx';
import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';
import { twMerge } from 'tailwind-merge';

export const APP_NAME = 'DocuVault';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const toDate = (v: string | Date) => (typeof v === 'string' ? (v.length === 10 ? parseISO(v) : new Date(v)) : v);

export const fmtDate = (v?: string | Date | null) => (v ? format(toDate(v), 'MMM d, yyyy') : '—');
export const fmtDateTime = (v?: string | Date | null) => (v ? format(toDate(v), 'MMM d, yyyy · h:mm a') : '—');
export const fmtAgo = (v?: string | Date | null) => (v ? `${formatDistanceToNowStrict(toDate(v))} ago` : '—');

export function fmtBytes(n?: number | null) {
  if (!n) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export const initials = (name?: string | null) =>
  (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Builds a query-string object without empty values. */
export function cleanParams<T extends Record<string, unknown>>(p: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = Array.isArray(v) ? v.join(',') : v;
  }
  return out as Partial<T>;
}

export const todayIso = () => new Date().toISOString().slice(0, 10);
