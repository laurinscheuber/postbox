import { FileArchive, HardDrive, Lock, ShieldAlert, Sparkles, Upload } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { PostboxLogo } from './PostboxLogo';

interface DropzoneScreenProps {
  onFilesSelected: (files: File[]) => void;
  onLoadSample: () => void;
  isLoading: boolean;
  progressText: string | null;
  errorMessages: string[];
}

const SUPPORTED_FORMATS = [
  { ext: '.PST', desc: 'Outlook Personal Folders' },
  { ext: '.OST', desc: 'Offline Outlook Data' },
  { ext: '.MSG', desc: 'Outlook Single Message' },
  { ext: '.EML', desc: 'RFC 5322 Internet Mail' },
  { ext: '.MBOX', desc: 'Unix / Thunderbird Mailbox' },
];

export function DropzoneScreen({
  onFilesSelected,
  onLoadSample,
  isLoading,
  progressText,
  errorMessages,
}: DropzoneScreenProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      onFilesSelected(files);
    }
  };

  return (
    <main className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-10">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center">
          <PostboxLogo className="mx-auto mb-3 h-12 w-12 drop-shadow-sm" />
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Inspect mail archives without uploading a single byte
          </h1>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--pb-text-secondary)' }}>
            Open Outlook <code>.pst</code>, <code>.ost</code>, <code>.msg</code>, <code>.eml</code>, and{' '}
            <code>.mbox</code> files directly in your browser. Search tens of thousands of messages, inspect
            raw MAPI headers, and export attachments locally.
          </p>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!isDragging) setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(false);
          }}
          onDrop={handleDrop}
          className="relative rounded-2xl border-2 border-dashed p-8 text-center transition-all sm:p-12"
          style={{
            backgroundColor: isDragging ? 'var(--pb-bg-selected)' : 'var(--pb-bg-surface)',
            borderColor: isDragging ? 'var(--pb-accent)' : 'var(--pb-border)',
          }}
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border" style={{
            backgroundColor: 'var(--pb-bg-muted)',
            borderColor: 'var(--pb-border)',
            color: 'var(--pb-accent)',
          }}>
            {isLoading ? (
              <FileArchive className="h-6 w-6 animate-pulse" />
            ) : (
              <Upload className="h-6 w-6" />
            )}
          </div>

          <p className="mt-4 text-sm font-medium">
            {isLoading
              ? progressText || 'Parsing archive locally in Web Worker…'
              : 'Drop mail archive or message files here'}
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--pb-text-muted)' }}>
            Multi-file drop supported for <code>.msg</code> and <code>.eml</code> messages
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
            <label
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-xs transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--pb-accent)' }}
            >
              <Upload className="h-3.5 w-3.5" />
              Choose Files from Disk
              <input
                type="file"
                multiple
                disabled={isLoading}
                accept=".pst,.ost,.msg,.eml,.mbox"
                className="sr-only"
                onChange={(e) => {
                  const files = e.target.files ? Array.from(e.target.files) : [];
                  if (files.length > 0) onFilesSelected(files);
                  e.target.value = '';
                }}
              />
            </label>

            <button
              type="button"
              disabled={isLoading}
              onClick={onLoadSample}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors hover:opacity-80 disabled:opacity-50"
              style={{
                borderColor: 'var(--pb-border)',
                backgroundColor: 'var(--pb-bg-muted)',
                color: 'var(--pb-text-primary)',
              }}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Load Sample Archive
            </button>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {SUPPORTED_FORMATS.map((fmt) => (
              <span
                key={fmt.ext}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium"
                style={{
                  borderColor: 'var(--pb-border)',
                  backgroundColor: 'var(--pb-bg-muted)',
                  color: 'var(--pb-text-secondary)',
                }}
                title={fmt.desc}
              >
                <span className="font-mono-code font-semibold">{fmt.ext}</span>
                <span className="hidden sm:inline">· {fmt.desc}</span>
              </span>
            ))}
          </div>
        </div>

        {errorMessages.length > 0 && (
          <div
            className="flex items-start gap-2.5 rounded-xl border p-3.5 text-xs text-rose-700 dark:text-rose-300"
            style={{
              borderColor: 'rgba(244, 63, 94, 0.35)',
              backgroundColor: 'rgba(244, 63, 94, 0.08)',
            }}
            role="alert"
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              {errorMessages.map((err, idx) => (
                <div key={idx}>{err}</div>
              ))}
            </div>
          </div>
        )}

        <div
          className="grid gap-3 rounded-xl border p-4 text-xs sm:grid-cols-2"
          style={{
            borderColor: 'var(--pb-border)',
            backgroundColor: 'var(--pb-bg-surface)',
          }}
        >
          <div className="flex items-start gap-2.5">
            <HardDrive className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--pb-accent)' }} />
            <div>
              <div className="font-medium">Stays Strictly in Browser RAM</div>
              <p className="mt-0.5 leading-relaxed" style={{ color: 'var(--pb-text-secondary)' }}>
                Files are read via local <code>File.slice()</code> chunks in a Web Worker and wiped
                immediately when you close this tab or click <strong>Clear Session</strong>.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--pb-emerald-text)' }} />
            <div>
              <div className="font-medium">Air-Gapped CSP &amp; XSS Isolation</div>
              <p className="mt-0.5 leading-relaxed" style={{ color: 'var(--pb-text-secondary)' }}>
                Enforces <code>connect-src &apos;none&apos;</code>, DOMPurify HTML sanitization, sandboxed
                iframes, and blocks remote tracking pixels by default.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
