import type { EmailAddress, FolderKind } from '../../types/mail';

export function inferFolderKind(name: string): FolderKind {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return 'custom';
  if (/^(inbox|posteingang|boîte de réception|bandeja de entrada)$/.test(normalized)) return 'inbox';
  if (/^(sent|sent items|sent mail|gesendete elemente|gesendet|éléments envoyés)$/.test(normalized)) {
    return 'sent';
  }
  if (/^(deleted|deleted items|trash|bin|gelöschte elemente|papierkorb|corbeille)$/.test(normalized)) {
    return 'trash';
  }
  if (/^(drafts|entwürfe|brouillons)$/.test(normalized)) return 'drafts';
  if (/^(archive|archived|archiv)$/.test(normalized)) return 'archive';
  if (/^(junk|junk email|spam|junk-e-mail)$/.test(normalized)) return 'junk';
  return 'custom';
}

export function stripHtmlToText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export function buildSnippet(text?: string, html?: string, maxLength = 160): string {
  const source = (text && text.trim()) || (html ? stripHtmlToText(html) : '');
  if (!source) return '';
  const singleLine = source.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength - 1).trimEnd()}…`;
}

export function formatToSummary(addresses: EmailAddress[], fallback = ''): string {
  if (addresses.length > 0) {
    return addresses
      .map((a) => (a.name ? `${a.name} <${a.address}>` : a.address))
      .filter(Boolean)
      .join(', ');
  }
  return fallback;
}

export function parseDateSafe(input: Date | string | number | null | undefined): {
  iso: string | null;
  timestamp: number;
} {
  if (!input) return { iso: null, timestamp: 0 };
  const date = input instanceof Date ? input : new Date(input);
  const time = date.getTime();
  if (Number.isNaN(time)) return { iso: null, timestamp: 0 };
  return { iso: date.toISOString(), timestamp: time };
}

export function normalizeCidValue(cid: string | undefined): string | undefined {
  if (!cid) return undefined;
  const cleaned = cid.trim().replace(/^<|>$/g, '');
  return cleaned || undefined;
}

export function guessMimeTypeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'pdf':
      return 'application/pdf';
    case 'txt':
    case 'log':
      return 'text/plain';
    case 'csv':
      return 'text/csv';
    case 'html':
    case 'htm':
      return 'text/html';
    case 'json':
      return 'application/json';
    case 'zip':
      return 'application/zip';
    case 'eml':
      return 'message/rfc822';
    default:
      return 'application/octet-stream';
  }
}

export function parseAddressStringList(raw: string): EmailAddress[] {
  if (!raw.trim()) return [];
  return raw
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((entry) => {
      const match = entry.match(/^(?:"?([^"]*)"?\s*)?<([^>]+)>$/);
      if (match) {
        return { name: (match[1] ?? '').trim(), address: match[2].trim() };
      }
      if (entry.includes('@')) {
        return { name: '', address: entry };
      }
      return { name: entry, address: '' };
    });
}
