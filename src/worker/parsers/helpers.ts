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

const HTML_NAMED_ENTITIES: Readonly<Record<string, string>> = {
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  euro: '€',
  eacute: 'é',
  Eacute: 'É',
  egrave: 'è',
  Egrave: 'È',
  ecirc: 'ê',
  Ecirc: 'Ê',
  euml: 'ë',
  agrave: 'à',
  Agrave: 'À',
  acirc: 'â',
  aring: 'å',
  Aring: 'Å',
  ccedil: 'ç',
  Ccedil: 'Ç',
  ntilde: 'ñ',
  Ntilde: 'Ñ',
  oslash: 'ø',
  Oslash: 'Ø',
  ugrave: 'ù',
  ucirc: 'û',
  yuml: 'ÿ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  hellip: '…',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  sect: '§',
  deg: '°',
  apos: "'",
  nbsp: ' ',
  lt: '<',
  gt: '>',
  quot: '"',
  amp: '&',
};

export function decodeHtmlEntities(input: string): string {
  if (!input || !input.includes('&')) return input;
  return input.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (full, body: string) => {
    if (body[0] === '#') {
      const cp =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (Number.isFinite(cp) && cp >= 1 && cp <= 0x10ffff) {
        return String.fromCodePoint(cp);
      }
      return full;
    }
    return HTML_NAMED_ENTITIES[body] ?? full;
  });
}

export function stripHtmlToText(html: string): string {
  if (!html) return '';
  const stripped = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(stripped)
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
