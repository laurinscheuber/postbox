import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Calendar,
  Download,
  FileSearch,
  Folder,
  FolderTree as FolderTreeIcon,
  Layers,
  Loader2,
  Paperclip,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MessageSortOrder, MessageSummary, SearchFilter } from '../types/mail';
import { formatShortDate } from '../utils/formatters';

export interface ListScanProgress {
  mode: 'folder' | 'search';
  scannedFolders: number;
  totalFolders: number;
  scannedMessages: number;
  totalMessages: number;
}

interface MessageListProps {
  folderName: string;
  messages: MessageSummary[];
  selectedMessageId: string | null;
  filter: SearchFilter;
  sortOrder: MessageSortOrder;
  sortAnnouncement: string;
  isLoading: boolean;
  scanProgress: ListScanProgress | null;
  isExportingZip: boolean;
  onSelectMessage: (messageId: string) => void;
  onFilterChange: (next: Partial<SearchFilter>) => void;
  onToggleSortOrder: () => void;
  onCancelScan: () => void;
  onExportFolderZip: () => void;
}

export function MessageList({
  folderName,
  messages,
  selectedMessageId,
  filter,
  sortOrder,
  sortAnnouncement,
  isLoading,
  scanProgress,
  isExportingZip,
  onSelectMessage,
  onFilterChange,
  onToggleSortOrder,
  onCancelScan,
  onExportFolderZip,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [showFilters, setShowFilters] = useState(false);

  const isGlobalScope = filter.scope === 'archive';
  const rowHeight = isGlobalScope ? 104 : 84;

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  // Re-measure when switching between folder and global scope (which shows folder badge)
  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, virtualizer]);

  // Global & list keyboard navigation: Up/Down moves selection, Esc clears search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTextInput =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;

      if (e.key === 'Escape') {
        if (
          filter.query ||
          filter.dateFrom ||
          filter.dateTo ||
          filter.hasAttachmentsOnly ||
          filter.searchBodies ||
          filter.scope === 'archive'
        ) {
          onFilterChange({
            query: '',
            dateFrom: '',
            dateTo: '',
            hasAttachmentsOnly: false,
            searchBodies: false,
            scope: 'folder',
          });
          searchInputRef.current?.blur();
        }
        return;
      }

      if (isTextInput) return;
      if (messages.length === 0) return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const currentIdx = messages.findIndex((m) => m.id === selectedMessageId);
        let nextIdx = 0;
        if (e.key === 'ArrowDown') {
          nextIdx = currentIdx === -1 ? 0 : Math.min(messages.length - 1, currentIdx + 1);
        } else {
          nextIdx = currentIdx <= 0 ? 0 : currentIdx - 1;
        }
        const nextMsg = messages[nextIdx];
        if (nextMsg) {
          onSelectMessage(nextMsg.id);
          virtualizer.scrollToIndex(nextIdx, { align: 'auto' });
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [messages, selectedMessageId, filter, onSelectMessage, onFilterChange, virtualizer]);

  const hasActiveFilter =
    Boolean(filter.query) ||
    Boolean(filter.dateFrom) ||
    Boolean(filter.dateTo) ||
    filter.hasAttachmentsOnly ||
    filter.scope === 'archive';

  const progressPercent =
    scanProgress && scanProgress.totalMessages > 0
      ? Math.min(100, Math.round((scanProgress.scannedMessages / scanProgress.totalMessages) * 100))
      : null;

  return (
    <section
      className="no-print workspace-pane flex h-full w-88 shrink-0 flex-col border-r lg:w-[26rem]"
      style={{
        backgroundColor: 'var(--pb-bg-surface)',
        borderColor: 'var(--pb-border)',
      }}
      aria-label="Message list"
    >
      <div className="space-y-2 border-b p-3" style={{ borderColor: 'var(--pb-border)' }}>
        <p role="status" className="visually-hidden">
          {sortAnnouncement}
        </p>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">
              {isGlobalScope ? 'Entire Archive Search' : folderName}
            </h2>
            <p className="text-[11px]" style={{ color: 'var(--pb-text-muted)' }}>
              {messages.length.toLocaleString()} {messages.length === 1 ? 'message' : 'messages'}
              {hasActiveFilter ? ' (filtered)' : ''}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                onToggleSortOrder();
                scrollRef.current?.scrollTo({ top: 0 });
              }}
              aria-pressed={sortOrder === 'asc'}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors hover:opacity-80"
              style={{
                borderColor: sortOrder === 'asc' ? 'var(--pb-accent)' : 'var(--pb-border)',
                backgroundColor: sortOrder === 'asc' ? 'var(--pb-bg-selected)' : 'var(--pb-bg-muted)',
                color: sortOrder === 'asc' ? 'var(--pb-accent)' : 'var(--pb-text-secondary)',
              }}
              title="Toggle chronological sort order (undated items always appear at the bottom)"
            >
              {sortOrder === 'desc' ? (
                <>
                  <ArrowDownWideNarrow className="h-3 w-3" />
                  <span>Newest first</span>
                </>
              ) : (
                <>
                  <ArrowUpNarrowWide className="h-3 w-3" />
                  <span>Oldest first</span>
                </>
              )}
            </button>

            <button
              type="button"
              disabled={messages.length === 0 || isExportingZip}
              onClick={onExportFolderZip}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors hover:opacity-80 disabled:opacity-45"
              style={{
                borderColor: 'var(--pb-border)',
                backgroundColor: 'var(--pb-bg-muted)',
              }}
              title="Export all messages in the selected folder as .eml files inside a ZIP archive"
            >
              {isExportingZip ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              <span>ZIP</span>
            </button>
          </div>
        </div>

        {/* Search bar + quick scope toggle */}
        <div className="flex items-center gap-1.5">
          <div
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border px-2.5 py-1.5"
            style={{
              borderColor: 'var(--pb-border)',
              backgroundColor: 'var(--pb-bg-muted)',
            }}
          >
            <Search className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--pb-text-muted)' }} />
            <input
              ref={searchInputRef}
              type="text"
              value={filter.query}
              onChange={(e) => onFilterChange({ query: e.target.value })}
              placeholder={
                filter.searchBodies
                  ? 'Search headers & email bodies…'
                  : 'Search sender, subject, recipient, date…'
              }
              aria-label="Search messages"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-slate-400"
            />
            {filter.query && (
              <button
                type="button"
                onClick={() => onFilterChange({ query: '' })}
                aria-label="Clear search query"
                className="rounded p-0.5 hover:opacity-75"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => onFilterChange({ hasAttachmentsOnly: !filter.hasAttachmentsOnly })}
            aria-pressed={filter.hasAttachmentsOnly}
            title="Filter: Has attachments"
            className="inline-flex items-center justify-center rounded-md border p-1.5 transition-colors"
            style={{
              borderColor: filter.hasAttachmentsOnly ? 'var(--pb-accent)' : 'var(--pb-border)',
              backgroundColor: filter.hasAttachmentsOnly
                ? 'var(--pb-bg-selected)'
                : 'var(--pb-bg-muted)',
              color: filter.hasAttachmentsOnly ? 'var(--pb-accent)' : 'var(--pb-text-secondary)',
            }}
          >
            <Paperclip className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            title="Toggle date range filters"
            className="inline-flex items-center justify-center rounded-md border p-1.5 transition-colors"
            style={{
              borderColor:
                showFilters || filter.dateFrom || filter.dateTo
                  ? 'var(--pb-accent)'
                  : 'var(--pb-border)',
              backgroundColor:
                showFilters || filter.dateFrom || filter.dateTo
                  ? 'var(--pb-bg-selected)'
                  : 'var(--pb-bg-muted)',
              color:
                showFilters || filter.dateFrom || filter.dateTo
                  ? 'var(--pb-accent)'
                  : 'var(--pb-text-secondary)',
            }}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Scope & Streaming Body Search Controls */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
          <div
            className="inline-flex rounded-md border p-0.5"
            style={{
              borderColor: 'var(--pb-border)',
              backgroundColor: 'var(--pb-bg-muted)',
            }}
            role="group"
            aria-label="Search scope"
          >
            <button
              type="button"
              onClick={() => onFilterChange({ scope: 'folder' })}
              aria-pressed={filter.scope === 'folder'}
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium transition-colors"
              style={{
                backgroundColor:
                  filter.scope === 'folder' ? 'var(--pb-bg-surface)' : 'transparent',
                color:
                  filter.scope === 'folder'
                    ? 'var(--pb-text-primary)'
                    : 'var(--pb-text-muted)',
              }}
            >
              <FolderTreeIcon className="h-3 w-3" />
              <span>Current Folder</span>
            </button>
            <button
              type="button"
              onClick={() => onFilterChange({ scope: 'archive' })}
              aria-pressed={filter.scope === 'archive'}
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium transition-colors"
              style={{
                backgroundColor:
                  filter.scope === 'archive' ? 'var(--pb-bg-surface)' : 'transparent',
                color:
                  filter.scope === 'archive'
                    ? 'var(--pb-text-primary)'
                    : 'var(--pb-text-muted)',
              }}
            >
              <Layers className="h-3 w-3" />
              <span>All Folders</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => onFilterChange({ searchBodies: !filter.searchBodies })}
            aria-pressed={filter.searchBodies}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium transition-colors"
            style={{
              borderColor: filter.searchBodies ? 'var(--pb-accent)' : 'var(--pb-border)',
              backgroundColor: filter.searchBodies
                ? 'var(--pb-bg-selected)'
                : 'var(--pb-bg-muted)',
              color: filter.searchBodies ? 'var(--pb-accent)' : 'var(--pb-text-secondary)',
            }}
            title="Stream message bodies inside the Web Worker without retaining them in RAM"
          >
            <FileSearch className="h-3 w-3" />
            <span>Search inside email bodies</span>
          </button>
        </div>

        {showFilters && (
          <div
            className="grid grid-cols-2 gap-2 rounded-md border p-2 text-[11px]"
            style={{
              borderColor: 'var(--pb-border)',
              backgroundColor: 'var(--pb-bg-muted)',
            }}
          >
            <label className="flex flex-col gap-1">
              <span className="flex items-center gap-1" style={{ color: 'var(--pb-text-muted)' }}>
                <Calendar className="h-3 w-3" /> From
              </span>
              <input
                type="date"
                value={filter.dateFrom}
                onChange={(e) => onFilterChange({ dateFrom: e.target.value })}
                className="rounded border bg-transparent px-1.5 py-1 text-xs outline-none"
                style={{ borderColor: 'var(--pb-border)' }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="flex items-center gap-1" style={{ color: 'var(--pb-text-muted)' }}>
                <Calendar className="h-3 w-3" /> To
              </span>
              <input
                type="date"
                value={filter.dateTo}
                onChange={(e) => onFilterChange({ dateTo: e.target.value })}
                className="rounded border bg-transparent px-1.5 py-1 text-xs outline-none"
                style={{ borderColor: 'var(--pb-border)' }}
              />
            </label>
          </div>
        )}

        {/* Live Progressive Loading / Streaming Search Indicator + Cancel */}
        {scanProgress && (
          <div
            className="space-y-1.5 rounded-md border p-2 text-[11px]"
            style={{
              borderColor: 'var(--pb-border)',
              backgroundColor: 'var(--pb-bg-selected)',
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" style={{ color: 'var(--pb-accent)' }} />
                <span className="truncate font-medium">
                  {scanProgress.mode === 'folder'
                    ? `Loading headers: ${scanProgress.scannedMessages.toLocaleString()}${
                        scanProgress.totalMessages > 0
                          ? ` / ${scanProgress.totalMessages.toLocaleString()}`
                          : ''
                      }`
                    : scanProgress.totalFolders > 1
                      ? `Scanned ${scanProgress.scannedFolders} / ${scanProgress.totalFolders} folders · ${scanProgress.scannedMessages.toLocaleString()} msgs`
                      : `Scanning ${scanProgress.scannedMessages.toLocaleString()}${
                          scanProgress.totalMessages > 0
                            ? ` / ${scanProgress.totalMessages.toLocaleString()}`
                            : ''
                        } messages`}
                </span>
              </div>
              <button
                type="button"
                onClick={onCancelScan}
                className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold hover:opacity-80"
                style={{
                  borderColor: 'var(--pb-border)',
                  backgroundColor: 'var(--pb-bg-surface)',
                }}
              >
                Cancel
              </button>
            </div>
            {progressPercent !== null && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                <div
                  className="h-full transition-all duration-150"
                  style={{
                    width: `${progressPercent}%`,
                    backgroundColor: 'var(--pb-accent)',
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div ref={scrollRef} className="relative flex-1 overflow-y-auto" role="listbox" aria-label="Messages">
        {isLoading && messages.length === 0 ? (
          <div className="flex h-40 items-center justify-center gap-2 text-xs" style={{ color: 'var(--pb-text-muted)' }}>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Streaming headers…</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="px-6 py-12 text-center text-xs" style={{ color: 'var(--pb-text-muted)' }}>
            {hasActiveFilter
              ? 'No messages match the current search filter.'
              : 'This folder does not contain any messages.'}
          </div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const msg = messages[row.index];
              const isSelected = msg.id === selectedMessageId;
              return (
                <button
                  key={msg.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => onSelectMessage(msg.id)}
                  className="absolute top-0 left-0 flex w-full flex-col justify-center gap-0.5 border-b px-3.5 py-2 text-left transition-colors"
                  style={{
                    height: `${rowHeight}px`,
                    transform: `translateY(${row.start}px)`,
                    borderColor: 'var(--pb-border)',
                    backgroundColor: isSelected ? 'var(--pb-bg-selected)' : 'transparent',
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {!msg.isRead && (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: 'var(--pb-accent)' }}
                          title="Unread"
                        />
                      )}
                      <span
                        className={`truncate text-xs ${
                          !msg.isRead || isSelected ? 'font-semibold' : 'font-medium'
                        }`}
                        style={{ color: 'var(--pb-text-primary)' }}
                      >
                        {msg.senderName || msg.senderAddress || 'Unknown Sender'}
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5 text-[11px]" style={{ color: 'var(--pb-text-muted)' }}>
                      {msg.hasAttachments && <Paperclip className="h-3 w-3" />}
                      <span className="tabular-nums">{formatShortDate(msg.date)}</span>
                    </div>
                  </div>

                  <div
                    className={`truncate text-xs ${!msg.isRead ? 'font-semibold' : 'font-medium'}`}
                    style={{ color: 'var(--pb-text-primary)' }}
                  >
                    {msg.subject || '(No Subject)'}
                  </div>

                  <div className="truncate text-[11px]" style={{ color: 'var(--pb-text-secondary)' }}>
                    {msg.snippet || (msg.toSummary ? `To: ${msg.toSummary}` : '\u00A0')}
                  </div>

                  {isGlobalScope && (
                    <div className="mt-0.5 flex items-center">
                      <span
                        className="inline-flex max-w-full items-center gap-1 truncate rounded px-1.5 py-0.25 text-[10px] font-medium"
                        style={{
                          backgroundColor: 'var(--pb-bg-muted)',
                          color: 'var(--pb-text-muted)',
                        }}
                        title={msg.folderPath}
                      >
                        <Folder className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate">{msg.folderPath}</span>
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
