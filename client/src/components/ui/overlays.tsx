import { AlertDialog as AD, Dialog as D, DropdownMenu as DM } from 'radix-ui';
import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

// ------------------------------------------------------------------ Dialog
export const Dialog = D.Root;

export function DialogContent({
  className,
  children,
  title,
  description,
  size = 'md',
  ...props
}: ComponentProps<typeof D.Content> & { title: ReactNode; description?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' | 'full' }) {
  const sizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', full: 'max-w-6xl' };
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-navy/40 backdrop-blur-[2px] data-[state=open]:animate-in" />
      <D.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-card shadow-2xl data-[state=open]:animate-slide-up focus:outline-none',
          sizes[size],
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
          <div className="min-w-0">
            <D.Title className="text-base font-semibold">{title}</D.Title>
            {description ? (
              <D.Description className="mt-1 text-sm text-muted-foreground">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{String(title)}</D.Description>
            )}
          </div>
          <D.Close className="-mr-2 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </D.Content>
    </D.Portal>
  );
}

export function DialogFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('-mx-6 -mb-5 mt-6 flex flex-wrap justify-end gap-2 border-t bg-muted/40 px-6 py-3.5 rounded-b-xl', className)}>{children}</div>;
}

// ------------------------------------------------------------------ Confirm dialog
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'default',
  loading,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: 'default' | 'destructive';
  loading?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <AD.Root open={open} onOpenChange={onOpenChange}>
      <AD.Portal>
        <AD.Overlay className="fixed inset-0 z-50 bg-navy/40 backdrop-blur-[2px] data-[state=open]:animate-in" />
        <AD.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 shadow-2xl data-[state=open]:animate-slide-up">
          <AD.Title className="text-base font-semibold">{title}</AD.Title>
          {description && <AD.Description className="mt-2 text-sm text-muted-foreground">{description}</AD.Description>}
          {children}
          <div className="mt-6 flex justify-end gap-2">
            <AD.Cancel asChild>
              <Button variant="outline" disabled={loading}>
                Cancel
              </Button>
            </AD.Cancel>
            <Button variant={tone === 'destructive' ? 'destructive' : 'default'} loading={loading} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </AD.Content>
      </AD.Portal>
    </AD.Root>
  );
}

// ------------------------------------------------------------------ Dropdown menu
export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;

export function DropdownMenuContent({ className, align = 'end', ...props }: ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        collisionPadding={8}
        sideOffset={6}
        className={cn('z-50 min-w-48 overflow-hidden rounded-lg border bg-card p-1 shadow-lg data-[state=open]:animate-in', className)}
        {...props}
      />
    </DM.Portal>
  );
}

export function DropdownMenuItem({ className, destructive, ...props }: ComponentProps<typeof DM.Item> & { destructive?: boolean }) {
  return (
    <DM.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted-foreground',
        destructive && 'text-destructive data-[highlighted]:bg-red-50 [&_svg]:text-destructive',
        className,
      )}
      {...props}
    />
  );
}

export const DropdownMenuSeparator = () => <DM.Separator className="-mx-1 my-1 h-px bg-border" />;
export const DropdownMenuLabel = ({ children }: { children: ReactNode }) => (
  <DM.Label className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground">{children}</DM.Label>
);
