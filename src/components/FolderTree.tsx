import {
  Archive,
  ChevronDown,
  ChevronRight,
  FileEdit,
  Folder,
  FolderOpen,
  Inbox,
  MailCheck,
  Search,
  Send,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { FolderKind, FolderNode } from '../types/mail';

interface FolderTreeProps {
  folders: FolderNode[];
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string) => void;
}

function getFolderIcon(kind: FolderKind, isSelected: boolean) {
  switch (kind) {
    case 'inbox':
      return Inbox;
    case 'sent':
      return Send;
    case 'trash':
      return Trash2;
    case 'drafts':
      return FileEdit;
    case 'archive':
      return Archive;
    case 'junk':
      return ShieldAlert;
    case 'imported':
      return MailCheck;
    default:
      return isSelected ? FolderOpen : Folder;
  }
}

function filterTree(nodes: FolderNode[], query: string): FolderNode[] {
  if (!query) return nodes;
  const q = query.toLowerCase();
  const out: FolderNode[] = [];
  for (const node of nodes) {
    const filteredChildren = filterTree(node.children, query);
    if (node.name.toLowerCase().includes(q) || filteredChildren.length > 0) {
      out.push({
        ...node,
        children: filteredChildren,
      });
    }
  }
  return out;
}

export function FolderTree({ folders, selectedFolderId, onSelectFolder }: FolderTreeProps) {
  const [filterText, setFilterText] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const visibleFolders = useMemo(() => filterTree(folders, filterText.trim()), [folders, filterText]);

  const toggleExpand = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNode = (node: FolderNode, depth: number) => {
    const hasChildren = node.children.length > 0;
    const isExpanded = filterText.trim().length > 0 || !collapsed.has(node.id);
    const isSelected = node.id === selectedFolderId;
    const Icon = getFolderIcon(node.kind, isSelected);

    return (
      <div key={node.id}>
        <div
          className="group flex items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors"
          style={{
            paddingLeft: `${depth * 14 + 6}px`,
            backgroundColor: isSelected ? 'var(--pb-bg-selected)' : 'transparent',
            color: isSelected ? 'var(--pb-text-primary)' : 'var(--pb-text-secondary)',
          }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(node.id);
              }}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded hover:opacity-75"
              aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
          ) : (
            <span className="h-4 w-4 shrink-0" />
          )}

          <button
            type="button"
            onClick={() => onSelectFolder(node.id)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <Icon
              className="h-3.5 w-3.5 shrink-0"
              style={{ color: isSelected ? 'var(--pb-accent)' : 'var(--pb-text-muted)' }}
            />
            <span className={`truncate ${isSelected ? 'font-semibold' : 'font-medium'}`}>
              {node.name}
            </span>
          </button>

          <div className="flex shrink-0 items-center gap-1 text-[11px]">
            {node.unreadCount > 0 && (
              <span
                className="rounded-full px-1.5 py-0.25 font-semibold text-white"
                style={{ backgroundColor: 'var(--pb-accent)' }}
                title={`${node.unreadCount} unread`}
              >
                {node.unreadCount}
              </span>
            )}
            {node.totalCount > 0 && (
              <span className="tabular-nums" style={{ color: 'var(--pb-text-muted)' }}>
                {node.totalCount.toLocaleString()}
              </span>
            )}
          </div>
        </div>

        {hasChildren && isExpanded && (
          <div className="mt-0.5 space-y-0.5">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside
      className="no-print workspace-pane flex h-full w-64 shrink-0 flex-col border-r"
      style={{
        backgroundColor: 'var(--pb-bg-surface)',
        borderColor: 'var(--pb-border)',
      }}
      aria-label="Mail folders"
    >
      <div className="border-b p-2.5" style={{ borderColor: 'var(--pb-border)' }}>
        <div
          className="flex items-center gap-1.5 rounded-md border px-2 py-1"
          style={{
            borderColor: 'var(--pb-border)',
            backgroundColor: 'var(--pb-bg-muted)',
          }}
        >
          <Search className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--pb-text-muted)' }} />
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && filterText) {
                setFilterText('');
              }
            }}
            placeholder="Filter folders…"
            aria-label="Filter folders"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-slate-400"
          />
          {filterText && (
            <button
              type="button"
              onClick={() => setFilterText('')}
              aria-label="Clear folder filter"
              className="rounded p-0.5 hover:opacity-75"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {visibleFolders.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs" style={{ color: 'var(--pb-text-muted)' }}>
            No matching folders
          </p>
        ) : (
          visibleFolders.map((node) => renderNode(node, 0))
        )}
      </nav>
    </aside>
  );
}
