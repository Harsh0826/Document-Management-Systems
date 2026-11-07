import { AlertTriangle, CheckCircle2, Clock, FileImage, FileSpreadsheet, FileText, FileType2, RefreshCw, XCircle, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/card';
import type { DocumentStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

export const STATUS_META: Record<DocumentStatus, { label: string; tone: 'amber' | 'green' | 'red' | 'slate' | 'orange'; icon: LucideIcon; color: string }> = {
  pending_review: { label: 'Pending Review', tone: 'amber', icon: Clock, color: '#f59e0b' },
  approved: { label: 'Approved', tone: 'green', icon: CheckCircle2, color: '#10b981' },
  rejected: { label: 'Rejected', tone: 'red', icon: XCircle, color: '#ef4444' },
  expired: { label: 'Expired', tone: 'slate', icon: AlertTriangle, color: '#64748b' },
  renewal_required: { label: 'Renewal Required', tone: 'orange', icon: RefreshCw, color: '#f97316' },
};

export const STATUS_OPTIONS = (Object.keys(STATUS_META) as DocumentStatus[]).map((s) => ({ value: s, label: STATUS_META[s].label }));

export function StatusBadge({ status, className }: { status: DocumentStatus; className?: string }) {
  const m = STATUS_META[status];
  const Icon = m.icon;
  return (
    <Badge tone={m.tone} className={className}>
      <Icon className="size-3" />
      {m.label}
    </Badge>
  );
}

const FILE_META: Record<string, { icon: LucideIcon; cls: string; label: string }> = {
  pdf: { icon: FileText, cls: 'bg-red-50 text-red-600', label: 'PDF' },
  doc: { icon: FileType2, cls: 'bg-blue-50 text-blue-600', label: 'DOC' },
  docx: { icon: FileType2, cls: 'bg-blue-50 text-blue-600', label: 'DOCX' },
  xls: { icon: FileSpreadsheet, cls: 'bg-emerald-50 text-emerald-600', label: 'XLS' },
  xlsx: { icon: FileSpreadsheet, cls: 'bg-emerald-50 text-emerald-600', label: 'XLSX' },
  jpg: { icon: FileImage, cls: 'bg-violet-50 text-violet-600', label: 'JPG' },
  jpeg: { icon: FileImage, cls: 'bg-violet-50 text-violet-600', label: 'JPEG' },
  png: { icon: FileImage, cls: 'bg-violet-50 text-violet-600', label: 'PNG' },
};

export function FileIcon({ ext, className }: { ext?: string | null; className?: string }) {
  const m = FILE_META[ext ?? ''] ?? { icon: FileText, cls: 'bg-slate-100 text-slate-500', label: '' };
  const Icon = m.icon;
  return (
    <span className={cn('inline-flex size-9 shrink-0 items-center justify-center rounded-lg', m.cls, className)}>
      <Icon className="size-[18px]" />
    </span>
  );
}

export const FILE_TYPE_OPTIONS = [
  { value: 'pdf', label: 'PDF' },
  { value: 'doc', label: 'DOC' },
  { value: 'docx', label: 'DOCX' },
  { value: 'jpg', label: 'JPG / JPEG' },
  { value: 'png', label: 'PNG' },
  { value: 'xls', label: 'XLS' },
  { value: 'xlsx', label: 'XLSX' },
];

export const ACCEPTED_EXTS = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'xls', 'xlsx'];
export const ACCEPT_ATTR = ACCEPTED_EXTS.map((e) => `.${e}`).join(',');
export const MAX_UPLOAD_MB = 25;

/** Text + colour for an expiry date relative to today. */
export function ExpiryText({ date, days, status }: { date: string | null; days: number | null; status?: DocumentStatus }) {
  if (!date) return <span className="text-muted-foreground">—</span>;
  const d = new Date(`${date}T00:00:00`);
  const label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  let tone = 'text-foreground';
  let hint = '';
  if (days !== null) {
    if (days < 0 || status === 'expired') {
      tone = 'text-red-600 font-medium';
      hint = days < 0 ? `Expired ${Math.abs(days)}d ago` : 'Expired';
    } else if (days <= 30) {
      tone = 'text-orange-600 font-medium';
      hint = days === 0 ? 'Expires today' : `In ${days}d`;
    } else if (days <= 60) {
      tone = 'text-amber-600';
      hint = `In ${days}d`;
    } else if (days <= 90) {
      tone = 'text-yellow-700';
      hint = `In ${days}d`;
    }
  }
  return (
    <div className="leading-tight">
      <div className={cn('whitespace-nowrap', tone)}>{label}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
