import {
  FilePlus2,
  Github,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { LoadedArchiveInfo } from '../types/mail';
import { formatBytes } from '../utils/formatters';
import type { ColorSchemePreference } from '../utils/theme';
import { PostboxLogo } from './PostboxLogo';

interface TopBarProps {
  archives: LoadedArchiveInfo[];
  colorScheme: ColorSchemePreference;
  effectiveTheme: 'light' | 'dark';
  onColorSchemeChange: (pref: ColorSchemePreference) => void;
  onAddFiles: (files: File[]) => void;
  onClearSession: () => void;
}

const CSP_DISPLAY =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none';";

export function TopBar({
  archives,
  colorScheme,
  effectiveTheme,
  onColorSchemeChange,
  onAddFiles,
  onClearSession,
}: TopBarProps) {
  const [showSecurityModal, setShowSecurityModal] = useState(false);

  useEffect(() => {
    if (!showSecurityModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowSecurityModal(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showSecurityModal]);

  const totalSize = archives.reduce((acc, item) => acc + item.size, 0);
  const isLargeStreamingArchive =
    totalSize >= 1_000_000_000 || archives.some((a) => a.size >= 1_000_000_000);

  return (
    <>
      <header
        className="no-print flex h-13 shrink-0 items-center justify-between gap-3 border-b px-4"
        style={{
          backgroundColor: 'var(--pb-bg-surface)',
          borderColor: 'var(--pb-border)',
        }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex items-center gap-2.5">
            <PostboxLogo className="h-7 w-7 shrink-0" />
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold tracking-tight">Postbox</span>
              <span
                className="hidden text-xs sm:inline"
                style={{ color: 'var(--pb-text-muted)' }}
              >
                postbox.scheuber.dev
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowSecurityModal(true)}
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-85"
            style={{
              backgroundColor: 'var(--pb-emerald-bg)',
              borderColor: 'var(--pb-emerald-border)',
              color: 'var(--pb-emerald-text)',
            }}
            title="Click to inspect Content-Security-Policy and verify zero network egress"
          >
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">
              100% Local Processing — Zero Network Connections
            </span>
            <span className="md:hidden">Local · Zero Network</span>
          </button>

          {archives.length > 0 && (
            isLargeStreamingArchive ? (
              <span
                className="hidden items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium xl:inline-flex"
                style={{
                  borderColor: 'var(--pb-border)',
                  backgroundColor: 'var(--pb-bg-muted)',
                  color: 'var(--pb-text-secondary)',
                }}
                title="Reading via 64 KB paged File.slice() blocks with a 128 MB LRU cache"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                <span>{formatBytes(totalSize)} • Streaming Local Disk I/O</span>
              </span>
            ) : (
              <span
                className="hidden truncate text-xs xl:inline"
                style={{ color: 'var(--pb-text-muted)' }}
                title={archives.map((a) => `${a.name} (${formatBytes(a.size)})`).join(', ')}
              >
                {archives.length} {archives.length === 1 ? 'archive' : 'archives'} ({formatBytes(totalSize)})
              </span>
            )
          )}
        </div>

        <div className="flex items-center gap-2">
          {archives.length > 0 && (
            <>
              <label
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors"
                style={{
                  borderColor: 'var(--pb-border)',
                  backgroundColor: 'var(--pb-bg-surface)',
                  color: 'var(--pb-text-primary)',
                }}
              >
                <FilePlus2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Add Files</span>
                <input
                  type="file"
                  multiple
                  accept=".pst,.ost,.msg,.eml,.mbox"
                  className="sr-only"
                  onChange={(e) => {
                    const list = e.target.files ? Array.from(e.target.files) : [];
                    if (list.length > 0) onAddFiles(list);
                    e.target.value = '';
                  }}
                />
              </label>

              <button
                type="button"
                onClick={onClearSession}
                className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-500/10 dark:text-rose-400"
                style={{ borderColor: 'var(--pb-border)' }}
                title="Purge RAM, terminate Web Worker, and revoke all Blob URLs"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Clear Session / Unload File</span>
                <span className="sm:hidden">Unload</span>
              </button>
            </>
          )}

          <div
            className="flex items-center rounded-md border p-0.5"
            style={{
              borderColor: 'var(--pb-border)',
              backgroundColor: 'var(--pb-bg-muted)',
            }}
            role="group"
            aria-label="Color theme"
          >
            {(
              [
                { id: 'system', label: `System (${effectiveTheme})`, Icon: Monitor },
                { id: 'light', label: 'Light theme', Icon: Sun },
                { id: 'dark', label: 'Dark theme', Icon: Moon },
              ] as const
            ).map(({ id, label, Icon }) => {
              const active = colorScheme === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onColorSchemeChange(id)}
                  aria-label={label}
                  aria-pressed={active}
                  title={label}
                  className="rounded px-1.5 py-1 transition-colors"
                  style={{
                    backgroundColor: active ? 'var(--pb-bg-surface)' : 'transparent',
                    color: active ? 'var(--pb-text-primary)' : 'var(--pb-text-muted)',
                  }}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>

          <a
            href="https://github.com/laurinscheuber/postbox"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-md border p-1.5 transition-colors hover:opacity-80"
            style={{
              borderColor: 'var(--pb-border)',
              color: 'var(--pb-text-secondary)',
            }}
            title="Inspect Postbox open-source repository on GitHub"
            aria-label="Postbox GitHub Repository"
          >
            <Github className="h-4 w-4" />
          </a>
        </div>
      </header>

      {showSecurityModal && (
        <div
          className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="csp-audit-title"
          onClick={() => setShowSecurityModal(false)}
        >
          <div
            className="w-full max-w-xl rounded-xl border p-5 shadow-2xl"
            style={{
              backgroundColor: 'var(--pb-bg-surface)',
              borderColor: 'var(--pb-border)',
              color: 'var(--pb-text-primary)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-lg border"
                  style={{
                    backgroundColor: 'var(--pb-emerald-bg)',
                    borderColor: 'var(--pb-emerald-border)',
                    color: 'var(--pb-emerald-text)',
                  }}
                >
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h2 id="csp-audit-title" className="text-sm font-semibold">
                    Zero-Upload Air-Gapped Verification
                  </h2>
                  <p className="text-xs" style={{ color: 'var(--pb-text-secondary)' }}>
                    Browser-enforced Content Security Policy guarantees zero outbound network calls.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSecurityModal(false)}
                className="rounded-md p-1 transition-colors hover:opacity-75"
                aria-label="Close security verification dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs leading-relaxed">
              <div>
                <div className="mb-1 font-medium" style={{ color: 'var(--pb-text-secondary)' }}>
                  Active Content-Security-Policy (Meta &amp; HTTP Header)
                </div>
                <pre className="code-surface-dark font-mono-code overflow-x-auto rounded-lg p-3 text-[11px] leading-relaxed">
                  {CSP_DISPLAY}
                </pre>
              </div>

              <ul className="space-y-1.5" style={{ color: 'var(--pb-text-secondary)' }}>
                <li>
                  <strong style={{ color: 'var(--pb-text-primary)' }}>connect-src &apos;none&apos;:</strong>{' '}
                  The browser blocks all <code>fetch</code>, <code>XHR</code>, <code>WebSocket</code>, and{' '}
                  <code>sendBeacon</code> connections at the engine level.
                </li>
                <li>
                  <strong style={{ color: 'var(--pb-text-primary)' }}>Web Worker + File.slice():</strong>{' '}
                  Large <code>.pst</code>, <code>.ost</code>, and <code>.mbox</code> files are read via local
                  byte-range slicing with an LRU cache directly in browser RAM.
                </li>
                <li>
                  <strong style={{ color: 'var(--pb-text-primary)' }}>DOMPurify + Sandboxed Iframe:</strong>{' '}
                  Email HTML is sanitized and rendered inside <code>&lt;iframe sandbox=&quot;allow-same-origin&quot;&gt;</code>{' '}
                  with external images stripped by default.
                </li>
              </ul>
            </div>

            <div className="mt-4 flex items-center justify-between border-t pt-3 text-xs" style={{ borderColor: 'var(--pb-border)' }}>
              <a
                href="https://github.com/laurinscheuber/postbox"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 font-medium hover:underline"
                style={{ color: 'var(--pb-accent)' }}
              >
                <Github className="h-3.5 w-3.5" />
                Audit source code on GitHub
              </a>
              <button
                type="button"
                onClick={() => setShowSecurityModal(false)}
                className="rounded-md border px-3 py-1.5 font-medium"
                style={{ borderColor: 'var(--pb-border)' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
