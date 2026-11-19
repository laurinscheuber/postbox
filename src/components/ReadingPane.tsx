import JSZip from 'jszip';
import {
  Archive,
  ChevronDown,
  ChevronUp,
  Code2,
  Download,
  Eye,
  EyeOff,
  File,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
  Mail,
  Paperclip,
  Printer,
  Shield,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AttachmentItem, MessageDetail } from '../types/mail';
import { sanitizeExportFilename } from '../utils/emlSerializer';
import {
  formatBytes,
  formatEmailAddress,
  formatFullDate,
  triggerBlobDownload,
} from '../utils/formatters';
import { sanitizeEmailHtml } from '../utils/sanitizeEmailHtml';

type ViewTab = 'html' | 'text' | 'raw';

interface ReadingPaneProps {
  message: MessageDetail | null;
  isLoading: boolean;
  theme: 'light' | 'dark';
  onExportEml: (messageId: string) => void;
  registerObjectUrls: (urls: string[]) => void;
  revokeObjectUrls: (urls: string[]) => void;
}

function getAttachmentIcon(att: AttachmentItem) {
  const mime = att.mimeType.toLowerCase();
  const name = att.filename.toLowerCase();
  if (mime.startsWith('image/')) return FileImage;
  if (mime.includes('zip') || name.endsWith('.zip') || name.endsWith('.gz')) return Archive;
  if (mime.includes('csv') || name.endsWith('.csv') || name.endsWith('.xlsx')) {
    return FileSpreadsheet;
  }
  if (mime.includes('json') || mime.includes('xml') || mime.includes('html')) return FileCode;
  if (mime.startsWith('text/') || mime.includes('pdf')) return FileText;
  return File;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function ReadingPane({
  message,
  isLoading,
  theme,
  onExportEml,
  registerObjectUrls,
  revokeObjectUrls,
}: ReadingPaneProps) {
  const [activeTab, setActiveTab] = useState<ViewTab>('html');
  const [showRawHeaders, setShowRawHeaders] = useState(false);
  const [blockExternalImages, setBlockExternalImages] = useState(true);
  const [mapiFilter, setMapiFilter] = useState('');
  const [isZippingAtts, setIsZippingAtts] = useState(false);
  const [iframeHeight, setIframeHeight] = useState<number>(480);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setActiveTab('html');
    setShowRawHeaders(false);
    setBlockExternalImages(true);
    setMapiFilter('');
    setIframeHeight(480);
  }, [message?.id]);

  const sanitized = useMemo(() => {
    if (!message) return null;
    const htmlInput =
      message.htmlBody ||
      `<pre style="white-space:pre-wrap;font-family:inherit;margin:0;">${escapeHtml(
        message.textBody || '(Empty message body)',
      )}</pre>`;
    return sanitizeEmailHtml(htmlInput, {
      attachments: message.attachments,
      blockExternalImages,
      theme,
    });
  }, [message, blockExternalImages, theme]);

  useEffect(() => {
    if (!sanitized || sanitized.objectUrls.length === 0) return;
    registerObjectUrls(sanitized.objectUrls);
    return () => {
      revokeObjectUrls(sanitized.objectUrls);
    };
  }, [sanitized, registerObjectUrls, revokeObjectUrls]);

  const syncIframeHeight = () => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument;
      if (doc?.body) {
        const measured = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight, 360);
        setIframeHeight(measured + 24);
      }
    } catch {
      // Cross-origin safeguard fallback
    }
  };

  const handlePrint = () => {
    syncIframeHeight();
    setTimeout(() => {
      window.print();
    }, 60);
  };

  const handleDownloadAllZip = async () => {
    if (!message || message.attachments.length === 0) return;
    setIsZippingAtts(true);
    try {
      const zip = new JSZip();
      const used = new Map<string, number>();
      for (const att of message.attachments) {
        const count = used.get(att.filename) ?? 0;
        used.set(att.filename, count + 1);
        const name = count === 0 ? att.filename : `${count + 1}-${att.filename}`;
        zip.file(name, att.data);
      }
      const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
      const zipName = sanitizeExportFilename(
        `${message.subject || 'attachments'}-attachments`,
        '.zip',
      );
      triggerBlobDownload(bytes, 'application/zip', zipName);
    } finally {
      setIsZippingAtts(false);
    }
  };

  const filteredMapi = useMemo(() => {
    const props = message?.mapiProperties ?? [];
    const q = mapiFilter.trim().toLowerCase();
    if (!q) return props;
    return props.filter(
      (p) =>
        p.tag.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.value.toLowerCase().includes(q),
    );
  }, [message?.mapiProperties, mapiFilter]);

  if (isLoading) {
    return (
      <section className="workspace-pane flex flex-1 items-center justify-center">
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--pb-text-muted)' }}>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Decrypting &amp; sanitizing message locally…</span>
        </div>
      </section>
    );
  }

  if (!message) {
    return (
      <section className="no-print workspace-pane flex flex-1 flex-col items-center justify-center p-8 text-center">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-xl border"
          style={{
            borderColor: 'var(--pb-border)',
            backgroundColor: 'var(--pb-bg-surface)',
            color: 'var(--pb-text-muted)',
          }}
        >
          <Mail className="h-5 w-5" />
        </div>
        <h3 className="mt-3 text-sm font-medium">Select a message to inspect</h3>
        <p className="mt-1 max-w-sm text-xs" style={{ color: 'var(--pb-text-muted)' }}>
          Use the <code>Up</code> and <code>Down</code> arrow keys to step through messages or search by
          sender, subject, date range, and body text.
        </p>
      </section>
    );
  }

  const regularAttachments = message.attachments.filter((a) => !a.isInline || !a.contentId);
  const allDownloadableAttachments =
    regularAttachments.length > 0 ? regularAttachments : message.attachments;

  return (
    <section
      className="print-reading-pane workspace-pane flex min-w-0 flex-1 flex-col overflow-y-auto"
      style={{ backgroundColor: 'var(--pb-bg-surface)' }}
      aria-label="Reading pane"
    >
      {/* Header & Action Toolbar */}
      <div className="border-b px-6 py-4" style={{ borderColor: 'var(--pb-border)' }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className="font-mono-code rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                style={{
                  borderColor: 'var(--pb-border)',
                  backgroundColor: 'var(--pb-bg-muted)',
                  color: 'var(--pb-text-secondary)',
                }}
              >
                .{message.format}
              </span>
              <span className="text-xs" style={{ color: 'var(--pb-text-muted)' }}>
                {formatFullDate(message.date)}
              </span>
            </div>
            <h1 className="mt-1.5 text-lg font-semibold leading-snug break-words">
              {message.subject || '(No Subject)'}
            </h1>
          </div>

          <div className="no-print flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
              style={{
                borderColor: 'var(--pb-border)',
                backgroundColor: 'var(--pb-bg-muted)',
              }}
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Print / Save as PDF</span>
            </button>

            <button
              type="button"
              onClick={() => onExportEml(message.id)}
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
              style={{
                borderColor: 'var(--pb-accent)',
                backgroundColor: 'var(--pb-accent)',
              }}
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export as .eml</span>
            </button>
          </div>
        </div>

        <dl className="mt-3 grid gap-1.5 text-xs">
          <div className="flex gap-2">
            <dt className="w-12 shrink-0 font-medium" style={{ color: 'var(--pb-text-muted)' }}>
              From:
            </dt>
            <dd className="min-w-0 break-words font-medium">
              {formatEmailAddress(message.from)}
            </dd>
          </div>

          {message.to.length > 0 && (
            <div className="flex gap-2">
              <dt className="w-12 shrink-0 font-medium" style={{ color: 'var(--pb-text-muted)' }}>
                To:
              </dt>
              <dd className="min-w-0 break-words" style={{ color: 'var(--pb-text-secondary)' }}>
                {message.to.map(formatEmailAddress).join(', ')}
              </dd>
            </div>
          )}

          {message.cc.length > 0 && (
            <div className="flex gap-2">
              <dt className="w-12 shrink-0 font-medium" style={{ color: 'var(--pb-text-muted)' }}>
                CC:
              </dt>
              <dd className="min-w-0 break-words" style={{ color: 'var(--pb-text-secondary)' }}>
                {message.cc.map(formatEmailAddress).join(', ')}
              </dd>
            </div>
          )}

          {message.bcc.length > 0 && (
            <div className="flex gap-2">
              <dt className="w-12 shrink-0 font-medium" style={{ color: 'var(--pb-text-muted)' }}>
                BCC:
              </dt>
              <dd className="min-w-0 break-words" style={{ color: 'var(--pb-text-secondary)' }}>
                {message.bcc.map(formatEmailAddress).join(', ')}
              </dd>
            </div>
          )}
        </dl>

        {message.headersRaw && (
          <div className="no-print mt-3">
            <button
              type="button"
              onClick={() => setShowRawHeaders((v) => !v)}
              aria-expanded={showRawHeaders}
              className="inline-flex items-center gap-1 text-[11px] font-medium hover:underline"
              style={{ color: 'var(--pb-accent)' }}
            >
              {showRawHeaders ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              <span>{showRawHeaders ? 'Hide Raw Internet Headers' : 'Show Raw Internet Headers'}</span>
            </button>

            {showRawHeaders && (
              <pre className="code-surface-dark font-mono-code mt-2 max-h-56 overflow-auto rounded-lg p-3 text-[11px] leading-relaxed">
                {message.headersRaw}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Attachment Bar */}
      {allDownloadableAttachments.length > 0 && (
        <div
          className="no-print border-b px-6 py-3"
          style={{
            borderColor: 'var(--pb-border)',
            backgroundColor: 'var(--pb-bg-muted)',
          }}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <Paperclip className="h-3.5 w-3.5" style={{ color: 'var(--pb-text-muted)' }} />
              <span>
                {allDownloadableAttachments.length}{' '}
                {allDownloadableAttachments.length === 1 ? 'Attachment' : 'Attachments'}
              </span>
            </div>

            {allDownloadableAttachments.length > 1 && (
              <button
                type="button"
                disabled={isZippingAtts}
                onClick={handleDownloadAllZip}
                className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:opacity-80 disabled:opacity-50"
                style={{
                  borderColor: 'var(--pb-border)',
                  backgroundColor: 'var(--pb-bg-surface)',
                }}
              >
                {isZippingAtts ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Archive className="h-3 w-3" />
                )}
                <span>Download All as ZIP</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {allDownloadableAttachments.map((att) => {
              const Icon = getAttachmentIcon(att);
              return (
                <button
                  key={att.id}
                  type="button"
                  onClick={() => triggerBlobDownload(att.data, att.mimeType, att.filename)}
                  className="group flex max-w-xs items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors hover:opacity-85"
                  style={{
                    borderColor: 'var(--pb-border)',
                    backgroundColor: 'var(--pb-bg-surface)',
                  }}
                  title={`Download ${att.filename} (${formatBytes(att.size)})`}
                >
                  <Icon className="h-4 w-4 shrink-0" style={{ color: 'var(--pb-accent)' }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{att.filename}</div>
                    <div className="text-[10px]" style={{ color: 'var(--pb-text-muted)' }}>
                      {formatBytes(att.size)}
                    </div>
                  </div>
                  <Download
                    className="h-3.5 w-3.5 shrink-0 opacity-60 transition-opacity group-hover:opacity-100"
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Remote Pixel Privacy Banner */}
      {sanitized && (sanitized.blockedExternalCount > 0 || !blockExternalImages) && (
        <div
          className="no-print flex flex-wrap items-center justify-between gap-2 border-b px-6 py-2 text-xs"
          style={{
            borderColor: 'var(--pb-border)',
            backgroundColor: blockExternalImages
              ? 'rgba(245, 158, 11, 0.1)'
              : 'rgba(14, 165, 233, 0.1)',
          }}
        >
          <div className="flex items-center gap-2">
            <Shield className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span>
              {blockExternalImages
                ? `External images blocked for privacy (${sanitized.blockedExternalCount} remote ${
                    sanitized.blockedExternalCount === 1 ? 'reference' : 'references'
                  } stripped)`
                : 'External image references unstripped in HTML (still air-gapped by img-src CSP)'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setBlockExternalImages((v) => !v)}
            className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium"
            style={{
              borderColor: 'var(--pb-border)',
              backgroundColor: 'var(--pb-bg-surface)',
            }}
          >
            {blockExternalImages ? (
              <>
                <Eye className="h-3 w-3" />
                <span>Allow External Images</span>
              </>
            ) : (
              <>
                <EyeOff className="h-3 w-3" />
                <span>Block External Images</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* View Switcher Tabs */}
      <div
        className="no-print flex items-center justify-between border-b px-6"
        style={{
          borderColor: 'var(--pb-border)',
          backgroundColor: 'var(--pb-bg-muted)',
        }}
      >
        <div className="flex items-center gap-1" role="tablist" aria-label="Message view mode">
          {(
            [
              { id: 'html', label: 'HTML View', Icon: Eye },
              { id: 'text', label: 'Plain Text View', Icon: FileText },
              {
                id: 'raw',
                label:
                  message.mapiProperties && message.mapiProperties.length > 0
                    ? 'Raw Source / MAPI Properties'
                    : 'Raw Source',
                Icon: Code2,
              },
            ] as const
          ).map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(id)}
                className="inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors"
                style={{
                  borderColor: active ? 'var(--pb-accent)' : 'transparent',
                  color: active ? 'var(--pb-text-primary)' : 'var(--pb-text-muted)',
                }}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Body Viewport */}
      <div className="flex-1">
        {activeTab === 'html' && sanitized && (
          <iframe
            ref={iframeRef}
            title={message.subject || 'Sanitized Email Content'}
            sandbox="allow-same-origin"
            srcDoc={sanitized.srcDoc}
            onLoad={syncIframeHeight}
            className="block w-full border-0"
            style={{ height: `${iframeHeight}px`, minHeight: '360px' }}
          />
        )}

        {activeTab === 'text' && (
          <div className="p-6">
            <pre
              className="font-mono-code whitespace-pre-wrap break-words text-xs leading-relaxed"
              style={{ color: 'var(--pb-text-primary)' }}
            >
              {message.textBody || '(No plain text body present in this message)'}
            </pre>
          </div>
        )}

        {activeTab === 'raw' && (
          <div className="space-y-6 p-6">
            {message.mapiProperties && message.mapiProperties.length > 0 && (
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--pb-text-secondary)' }}>
                    MAPI Properties ({filteredMapi.length})
                  </h3>
                  <input
                    type="text"
                    value={mapiFilter}
                    onChange={(e) => setMapiFilter(e.target.value)}
                    placeholder="Filter tag, name, or value…"
                    className="rounded-md border bg-transparent px-2.5 py-1 text-xs outline-none"
                    style={{ borderColor: 'var(--pb-border)' }}
                  />
                </div>
                <div
                  className="max-h-96 overflow-auto rounded-lg border"
                  style={{ borderColor: 'var(--pb-border)' }}
                >
                  <table className="w-full border-collapse text-left text-xs">
                    <thead
                      className="sticky top-0 border-b text-[11px]"
                      style={{
                        backgroundColor: 'var(--pb-bg-muted)',
                        borderColor: 'var(--pb-border)',
                        color: 'var(--pb-text-secondary)',
                      }}
                    >
                      <tr>
                        <th className="px-3 py-2 font-medium">Tag</th>
                        <th className="px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Type</th>
                        <th className="px-3 py-2 font-medium">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y" style={{ borderColor: 'var(--pb-border)' }}>
                      {filteredMapi.map((prop, i) => (
                        <tr key={`${prop.tag}-${i}`} className="align-top">
                          <td className="font-mono-code whitespace-nowrap px-3 py-1.5 text-[11px]">
                            {prop.tag}
                          </td>
                          <td className="px-3 py-1.5 font-medium">{prop.name}</td>
                          <td
                            className="font-mono-code whitespace-nowrap px-3 py-1.5 text-[11px]"
                            style={{ color: 'var(--pb-text-muted)' }}
                          >
                            {prop.type}
                          </td>
                          <td className="font-mono-code break-all px-3 py-1.5 text-[11px]">
                            {prop.value}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--pb-text-secondary)' }}>
                {message.format === 'eml' || message.format === 'mbox'
                  ? 'Raw RFC 5322 Source'
                  : 'Transport Internet Headers'}
              </h3>
              <pre className="code-surface-dark font-mono-code max-h-[32rem] overflow-auto rounded-lg p-4 text-[11px] leading-relaxed">
                {message.rawSource || message.headersRaw || '(No transport internet headers stored on this item)'}
              </pre>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
