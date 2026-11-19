import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Calendar,
  Download,
  Loader2,
  Paperclip,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MessageSummary, SearchFilter } from '../types/mail';
import { formatShortDate } from '../utils/formatters';

interface MessageListProps {
  folderName: string;
  messages: MessageSummary[];
  selectedMessageId: string | null;
  filter: SearchFilter;
  isLoading: boolean;
  isExportingZip: boolean;
  onSelectMessage: (messageId: string) => void;
  onFilterChange: (next: Partial<SearchFilter>) => void;
  onExportFolderZip: () => void;
}

export function MessageList({
  folderName,
  messages,
  selectedMessageId,
  filter,
  isLoading,
  isExportingZip,
  onSelectMessage,
  onFilterChange,
  onExportFolderZip,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [showFilters, setShowFilters] = useState(false);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 86,
    overscan: 12,
  });

  // Global & list keyboard navigation: Up/Down moves selection, Esc clears search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTextInput =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;

      if (e.key === 'Escape') {
        if (filter.query || filter.dateFrom || filter.dateTo || filter.hasAttachmentsOnly) {
          onFilterChange({
            query: '',
            dateFrom: '',
            dateTo: '',
            hasAttachmentsOnly: false,
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
    filter.hasAttachmentsOnly;

  return (
    <section
      className="no-print workspace-pane flex h-full w-88 shrink-0 flex-col border-r lg:w-96"
      style={{
        backgroundColor: 'var(--pb-bg-surface)',
        borderColor: 'var(--pb-border)',
      }}
      aria-label="Message list"
    >
      <div className="space-y-2 border-b p-3" style={{ borderColor: 'var(--pb-border)' }}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{folderName}</h2>
            <p className="text-[11px]" style={{ color: 'var(--pb-text-muted)' }}>
              {messages.length.toLocaleString()} {messages.length === 1 ? 'message' : 'messages'}
              {hasActiveFilter ? ' (filtered)' : ''}
            </p>
          </div>

          <button
            type="button"
            disabled={messages.length === 0 || isExportingZip}
            onClick={onExportFolderZip}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors hover:opacity-80 disabled:opacity-45"
            style={{
              borderColor: 'var(--pb-border)',
              backgroundColor: 'var(--pb-bg-muted)',
            }}
            title="Export all messages in this folder as .eml files inside a ZIP archive"
          >
            {isExportingZip ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            <span>ZIP</span>
          </button>
        </div>

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
              placeholder="Search sender, subject, body… (Esc)"
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
      </div>

      <div ref={scrollRef} className="relative flex-1 overflow-y-auto" role="listbox" aria-label="Messages">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center gap-2 text-xs" style={{ color: 'var(--pb-text-muted)' }}>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading folder messages…</span>
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
                  className="absolute top-0 left-0 flex w-full flex-col gap-1 border-b px-3.5 py-2.5 text-left transition-colors"
                  style={{
                    height: `${row.size}px`,
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
                    {msg.snippet || '\u00A0'}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
