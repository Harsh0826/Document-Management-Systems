import { format, parseISO } from 'date-fns';

const toDate = (v: string) => (v.length === 10 ? parseISO(v) : new Date(v));

/** "3 Mar 2025" — always written out, never 2025-03-03. */
export const day = (v?: string | null) => (v ? format(toDate(v), 'd MMM yyyy') : '');
/** "3 March 2025" for headings and screen readers. */
export const longDay = (v?: string | null) => (v ? format(toDate(v), 'd MMMM yyyy') : '');

export function size(bytes?: number | null) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export type Validity = { tone: 'ok' | 'soon' | 'expired'; text: string } | null;

/** Plain-language licence validity: "Valid until 2 Mar 2026" / "Expires in 12 days" / "Expired on 1 Feb 2025". */
export function validity(validUntil: string | null, daysLeft: number | null): Validity {
  if (!validUntil) return null;
  if (daysLeft !== null && daysLeft < 0) return { tone: 'expired', text: `Expired on ${day(validUntil)}` };
  if (daysLeft !== null && daysLeft <= 30)
    return { tone: 'soon', text: `Valid until ${day(validUntil)} · expires ${daysLeft === 0 ? 'today' : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}` };
  return { tone: 'ok', text: `Valid until ${day(validUntil)}` };
}
