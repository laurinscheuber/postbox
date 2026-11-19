import DOMPurify from 'dompurify';
import type { AttachmentItem } from '../types/mail';
import { toBlobPart } from './formatters';

export interface SanitizeEmailResult {
  srcDoc: string;
  blockedExternalCount: number;
  resolvedInlineCount: number;
  objectUrls: string[];
}

const TRANSPARENT_PLACEHOLDER_SVG =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
  );

function normalizeCid(raw: string | undefined): string {
  if (!raw) return '';
  return raw.trim().replace(/^cid:/i, '').replace(/^<|>$/g, '').toLowerCase();
}

function isExternalUrl(value: string): boolean {
  const trimmed = value.trim();
  return /^(https?:)?\/\//i.test(trimmed);
}

function isSafeLinkHref(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('#')) return true;
  return /^(https?:|mailto:|tel:)/i.test(trimmed);
}

function stripCssUrls(cssText: string): { sanitized: string; blockedCount: number } {
  let blockedCount = 0;
  const sanitized = cssText.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (full, _quote, urlValue: string) => {
    const trimmed = urlValue.trim();
    if (isExternalUrl(trimmed) || /^javascript:/i.test(trimmed)) {
      blockedCount += 1;
      return 'none';
    }
    return full;
  });
  // Also strip CSS @import rules pointing externally
  const withoutImports = sanitized.replace(/@import\s+(?:url\()?['"]?(?:https?:)?\/\/[^;]+;?/gi, () => {
    blockedCount += 1;
    return '';
  });
  return { sanitized: withoutImports, blockedCount };
}

function rewriteSrcset(
  srcset: string,
  blockExternal: boolean,
  cidMap: Map<string, string>,
): { value: string | null; blocked: number } {
  let blocked = 0;
  const candidates = srcset
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const kept: string[] = [];

  for (const candidate of candidates) {
    const [urlPart, ...rest] = candidate.split(/\s+/);
    if (!urlPart) continue;
    if (urlPart.toLowerCase().startsWith('cid:')) {
      const resolved = cidMap.get(normalizeCid(urlPart));
      if (resolved) {
        kept.push([resolved, ...rest].join(' '));
      }
      continue;
    }
    if (blockExternal && isExternalUrl(urlPart)) {
      blocked += 1;
      continue;
    }
    kept.push(candidate);
  }

  return {
    value: kept.length > 0 ? kept.join(', ') : null,
    blocked,
  };
}

/**
 * Sanitizes untrusted email HTML with DOMPurify, resolves `cid:` inline attachments to
 * local `blob:` URLs, blocks external tracking pixels / remote images / remote styles by default,
 * and returns a self-contained HTML document ready for `<iframe sandbox="allow-same-origin">`.
 */
export function sanitizeEmailHtml(
  rawHtml: string,
  options: {
    attachments?: AttachmentItem[];
    blockExternalImages?: boolean;
    theme?: 'light' | 'dark';
  } = {},
): SanitizeEmailResult {
  const attachments = options.attachments ?? [];
  const blockExternal = options.blockExternalImages ?? true;
  const theme = options.theme ?? 'light';

  const objectUrls: string[] = [];
  const cidMap = new Map<string, string>();
  const filenameMap = new Map<string, string>();

  for (const att of attachments) {
    const cid = normalizeCid(att.contentId);
    const hasImageOrCid = cid.length > 0 || att.mimeType.startsWith('image/');
    if (!hasImageOrCid) continue;
    const blob = new Blob([toBlobPart(att.data)], { type: att.mimeType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    objectUrls.push(url);
    if (cid) {
      cidMap.set(cid, url);
    }
    if (att.filename) {
      filenameMap.set(att.filename.toLowerCase(), url);
    }
  }

  const cleanHtml = DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true, svg: true },
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: [
      'script',
      'object',
      'embed',
      'applet',
      'form',
      'input',
      'button',
      'textarea',
      'select',
      'base',
      'meta',
      'iframe',
      'frame',
      'frameset',
      'link',
      'noscript',
    ],
    FORBID_ATTR: [
      'onerror',
      'onload',
      'onclick',
      'onmouseover',
      'onfocus',
      'onblur',
      'formaction',
    ],
    ADD_TAGS: ['style'],
  });

  const parser = new DOMParser();
  const parsedDoc = parser.parseFromString(cleanHtml, 'text/html');
  let blockedExternalCount = 0;
  let resolvedInlineCount = 0;

  // Strip or neutralize style elements containing remote URLs
  for (const styleEl of Array.from(parsedDoc.querySelectorAll('style'))) {
    const cssText = styleEl.textContent ?? '';
    if (blockExternal) {
      const { sanitized, blockedCount } = stripCssUrls(cssText);
      blockedExternalCount += blockedCount;
      styleEl.textContent = sanitized;
    }
  }

  const allElements = Array.from(parsedDoc.body.querySelectorAll('*'));
  for (const el of allElements) {
    // Sanitize inline style attributes
    const inlineStyle = el.getAttribute('style');
    if (inlineStyle && blockExternal) {
      const { sanitized, blockedCount } = stripCssUrls(inlineStyle);
      blockedExternalCount += blockedCount;
      el.setAttribute('style', sanitized);
    }

    // Remove/block legacy background attributes
    const bgAttr = el.getAttribute('background');
    if (bgAttr) {
      if (bgAttr.toLowerCase().startsWith('cid:')) {
        const localUrl = cidMap.get(normalizeCid(bgAttr));
        if (localUrl) {
          el.setAttribute('background', localUrl);
          resolvedInlineCount += 1;
        } else {
          el.removeAttribute('background');
        }
      } else if (blockExternal && isExternalUrl(bgAttr)) {
        el.removeAttribute('background');
        blockedExternalCount += 1;
      }
    }

    // Handle images and media sources
    const srcAttr = el.getAttribute('src');
    if (srcAttr !== null) {
      const trimmedSrc = srcAttr.trim();
      if (trimmedSrc.toLowerCase().startsWith('cid:')) {
        const key = normalizeCid(trimmedSrc);
        const localUrl = cidMap.get(key) ?? filenameMap.get(key);
        if (localUrl) {
          el.setAttribute('src', localUrl);
          resolvedInlineCount += 1;
        } else {
          el.removeAttribute('src');
          el.setAttribute('data-blocked-cid', 'true');
        }
      } else if (blockExternal && isExternalUrl(trimmedSrc)) {
        blockedExternalCount += 1;
        el.setAttribute('src', TRANSPARENT_PLACEHOLDER_SVG);
        el.setAttribute('alt', el.getAttribute('alt') || 'Blocked external image');
        el.setAttribute('data-external-blocked', 'true');
      } else if (/^(javascript|vbscript):/i.test(trimmedSrc)) {
        el.removeAttribute('src');
      }
    }

    const srcsetAttr = el.getAttribute('srcset');
    if (srcsetAttr !== null) {
      const { value, blocked } = rewriteSrcset(srcsetAttr, blockExternal, cidMap);
      blockedExternalCount += blocked;
      if (value) {
        el.setAttribute('srcset', value);
      } else {
        el.removeAttribute('srcset');
      }
    }

    const posterAttr = el.getAttribute('poster');
    if (posterAttr && blockExternal && isExternalUrl(posterAttr)) {
      el.removeAttribute('poster');
      blockedExternalCount += 1;
    }

    // Enforce safe external links
    if (el.tagName.toLowerCase() === 'a') {
      const href = el.getAttribute('href') ?? '';
      if (!isSafeLinkHref(href)) {
        el.removeAttribute('href');
      } else if (!href.trim().startsWith('#')) {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
    }
  }

  const headStyles = Array.from(parsedDoc.head.querySelectorAll('style'))
    .map((s) => {
      const content = s.textContent ?? '';
      if (!blockExternal) return `<style>${content}</style>`;
      const { sanitized, blockedCount } = stripCssUrls(content);
      blockedExternalCount += blockedCount;
      return `<style>${sanitized}</style>`;
    })
    .join('\n');

  const bodyMarkup = parsedDoc.body.innerHTML;
  const isDark = theme === 'dark';

  // Emails frequently specify light backgrounds internally; keep reading canvas legible while adapting default unstyled text
  const baseStyles = `
    :root {
      color-scheme: ${isDark ? 'dark' : 'light'};
    }
    html, body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.58;
      color: ${isDark ? '#e2e8f0' : '#0f172a'};
      background-color: ${isDark ? '#0f172a' : '#ffffff'};
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    body {
      padding: 20px 24px;
    }
    img {
      max-width: 100%;
      height: auto;
    }
    img[data-external-blocked="true"] {
      width: 22px;
      height: 22px;
      padding: 4px;
      border-radius: 6px;
      border: 1px dashed ${isDark ? '#475569' : '#cbd5e1'};
      background: ${isDark ? '#1e293b' : '#f8fafc'};
      vertical-align: middle;
    }
    a {
      color: ${isDark ? '#38bdf8' : '#0284c7'};
    }
    table {
      max-width: 100% !important;
      border-collapse: collapse;
    }
    pre, code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      white-space: pre-wrap;
    }
    blockquote {
      margin: 12px 0;
      padding: 4px 0 4px 12px;
      border-left: 3px solid ${isDark ? '#334155' : '#cbd5e1'};
      color: ${isDark ? '#94a3b8' : '#475569'};
    }
    @media print {
      html, body {
        background: #ffffff !important;
        color: #000000 !important;
        padding: 0 !important;
      }
    }
  `;

  const srcDoc = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="${isDark ? 'dark' : 'light'}" />
    <style>${baseStyles}</style>
    ${headStyles}
  </head>
  <body>${bodyMarkup}</body>
</html>`;

  return {
    srcDoc,
    blockedExternalCount,
    resolvedInlineCount,
    objectUrls,
  };
}
