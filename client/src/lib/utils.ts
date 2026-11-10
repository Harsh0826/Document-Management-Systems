import { clsx, type ClassValue } from 'clsx';
import { format, parseISO } from 'date-fns';
import { twMerge } from 'tailwind-merge';

export const APP_NAME = 'Company Documents';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const toDate = (v: string | Date) => (typeof v === 'string' ? (v.length === 10 ? parseISO(v) : new Date(v)) : v);

export const fmtDateTime = (v?: string | Date | null) => (v ? format(toDate(v), 'MMM d, yyyy · h:mm a') : '—');

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
