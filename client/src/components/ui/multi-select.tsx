import { Check, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './overlays';
import { cn } from '@/lib/utils';

export function MultiSelect({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  className?: string;
}) {
  const summary = value.length === 0 ? `All` : value.length === 1 ? (options.find((o) => o.value === value[0])?.label ?? '1 selected') : `${value.length} selected`;
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          'flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-md border bg-card px-3 text-left text-sm shadow-xs hover:bg-muted/40',
          value.length > 0 && 'border-primary/40 bg-accent/40',
          className,
        )}
        aria-label={label}
      >
        <span className="truncate">
          <span className="text-muted-foreground">{label}: </span>
          {summary}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1">
        <div className="scroll-thin max-h-72 overflow-y-auto">
          {options.map((o) => {
            const on = value.includes(o.value);
            return (
              <button key={o.value} type="button" onClick={() => toggle(o.value)} className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted">
                <span className={cn('flex size-4 items-center justify-center rounded border', on ? 'border-primary bg-primary text-white' : 'border-slate-300')}>{on && <Check className="size-3" strokeWidth={3} />}</span>
                <span className="truncate">{o.label}</span>
              </button>
            );
          })}
        </div>
        {value.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="mt-1 w-full cursor-pointer rounded-md border-t px-2.5 py-1.5 text-left text-xs font-medium text-primary hover:bg-muted">
            Clear selection
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
