import { Building2, ChevronRight, Folder as FolderIcon, FolderOpen, Tag, UserRound } from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';
import type { Folder } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface TreeNode extends Folder {
  children: TreeNode[];
}

export function buildTree(folders: Folder[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  folders.forEach((f) => map.set(f.id, { ...f, children: [] }));
  const roots: TreeNode[] = [];
  map.forEach((n) => {
    const parent = n.parentId ? map.get(n.parentId) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n); // includes employee roots when the client root is not visible (employees)
  });
  const sort = (a: TreeNode, b: TreeNode) => {
    const rank = (k: string) => (k === 'category' ? 0 : k === 'employee_root' ? 1 : 2);
    return rank(a.kind) - rank(b.kind) || a.name.localeCompare(b.name);
  };
  const walk = (ns: TreeNode[]) => {
    ns.sort(sort);
    ns.forEach((n) => walk(n.children));
  };
  walk(roots);
  return roots;
}

/** Total documents in a folder and all its descendants. */
export function subtreeCount(n: TreeNode): number {
  return n.documentCount + n.children.reduce((a, c) => a + subtreeCount(c), 0);
}

export const DND_MIME = 'application/x-dms-documents';

function iconFor(n: TreeNode, open: boolean) {
  if (n.kind === 'client_root') return Building2;
  if (n.kind === 'employee_root') return UserRound;
  if (n.kind === 'category') return Tag;
  return open ? FolderOpen : FolderIcon;
}

export function FolderTree({
  folders,
  selectedId,
  onSelect,
  onDropDocuments,
  defaultExpandedDepth = 1,
  disabledIds,
}: {
  folders: Folder[];
  selectedId?: string;
  onSelect: (f: Folder) => void;
  onDropDocuments?: (folder: Folder, documentIds: string[]) => void;
  defaultExpandedDepth?: number;
  disabledIds?: Set<string>;
}) {
  const tree = useMemo(() => buildTree(folders), [folders]);
  const ancestors = useMemo(() => {
    const byId = new Map(folders.map((f) => [f.id, f]));
    const s = new Set<string>();
    let cur = selectedId ? byId.get(selectedId) : undefined;
    while (cur?.parentId) {
      s.add(cur.parentId);
      cur = byId.get(cur.parentId);
    }
    return s;
  }, [folders, selectedId]);

  return (
    <ul role="tree" className="space-y-0.5 text-sm">
      {tree.map((n) => (
        <Node key={n.id} node={n} depth={0} {...{ selectedId, onSelect, onDropDocuments, defaultExpandedDepth, ancestors, disabledIds }} />
      ))}
    </ul>
  );
}

function Node({
  node,
  depth,
  selectedId,
  onSelect,
  onDropDocuments,
  defaultExpandedDepth,
  ancestors,
  disabledIds,
}: {
  node: TreeNode;
  depth: number;
  selectedId?: string;
  onSelect: (f: Folder) => void;
  onDropDocuments?: (folder: Folder, ids: string[]) => void;
  defaultExpandedDepth: number;
  ancestors: Set<string>;
  disabledIds?: Set<string>;
}) {
  const [open, setOpen] = useState(depth < defaultExpandedDepth || ancestors.has(node.id));
  const [over, setOver] = useState(false);
  const isOpen = open || ancestors.has(node.id);
  const Icon = iconFor(node, isOpen);
  const selected = node.id === selectedId;
  const disabled = disabledIds?.has(node.id);
  const count = subtreeCount(node);

  const dropHandlers = onDropDocuments
    ? {
        onDragOver: (e: DragEvent) => {
          if (e.dataTransfer.types.includes(DND_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setOver(true);
          }
        },
        onDragLeave: () => setOver(false),
        onDrop: (e: DragEvent) => {
          e.preventDefault();
          setOver(false);
          const ids = JSON.parse(e.dataTransfer.getData(DND_MIME) || '[]') as string[];
          if (ids.length) onDropDocuments(node, ids);
        },
      }
    : {};

  return (
    <li role="treeitem" aria-expanded={node.children.length ? isOpen : undefined} aria-selected={selected}>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md pr-2 transition-colors',
          selected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
          over && 'bg-primary/10 ring-2 ring-primary/50',
          disabled && 'pointer-events-none opacity-40',
        )}
        style={{ paddingLeft: depth * 14 + 4 }}
        {...dropHandlers}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn('rounded p-0.5 text-muted-foreground hover:text-foreground', !node.children.length && 'invisible')}
          aria-label={isOpen ? 'Collapse' : 'Expand'}
        >
          <ChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} />
        </button>
        <button type="button" onClick={() => onSelect(node)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5 text-left">
          <Icon className={cn('size-4 shrink-0', node.kind === 'client_root' ? 'text-navy' : node.kind === 'employee_root' ? 'text-primary' : node.kind === 'category' ? 'text-violet-500' : 'text-amber-500')} />
          <span className={cn('truncate', selected && 'font-medium')}>{node.name}</span>
        </button>
        {count > 0 && <span className="text-xs tabular-nums text-muted-foreground">{count}</span>}
      </div>
      {isOpen && node.children.length > 0 && (
        <ul role="group" className="space-y-0.5">
          {node.children.map((c) => (
            <Node key={c.id} node={c} depth={depth + 1} {...{ selectedId, onSelect, onDropDocuments, defaultExpandedDepth, ancestors, disabledIds }} />
          ))}
        </ul>
      )}
    </li>
  );
}
