import type { AttachmentItem, EmailAddress, MessageDetail } from '../types/mail';

const encoder = new TextEncoder();

function encodeHeaderWord(value: string): string {
  if (!value) return '';
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(value)) {
    return value.replace(/[\r\n]+/g, ' ');
  }
  const bytes = encoder.encode(value);
  const base64 = bytesToBase64(bytes);
  return `=?UTF-8?B?${base64}?=`;
}

function formatAddress(addr: EmailAddress): string {
  const email = addr.address.replace(/[\r\n<>]/g, '').trim();
  const name = addr.name.replace(/[\r\n]/g, ' ').trim();
  if (!name && !email) return '';
  if (!name) return `<${email}>`;
  const encodedName = encodeHeaderWord(name);
  const safeName = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~ -]+$/.test(encodedName)
    ? encodedName
    : `"${encodedName.replace(/"/g, '\\"')}"`;
  return email ? `${safeName} <${email}>` : safeName;
}

function formatAddressList(list: EmailAddress[]): string {
  return list.map(formatAddress).filter(Boolean).join(', ');
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function wrapBase64(base64: string, lineLength = 76): string {
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += lineLength) {
    lines.push(base64.slice(i, i + lineLength));
  }
  return lines.join('\r\n');
}

function encodeUtf8Base64Part(contentType: string, text: string): string {
  const encoded = wrapBase64(bytesToBase64(encoder.encode(text)));
  return [
    `Content-Type: ${contentType}; charset="utf-8"`,
    'Content-Transfer-Encoding: base64',
    '',
    encoded,
  ].join('\r\n');
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\r\n"\\]/g, '_') || 'attachment.bin';
}

function encodeAttachmentPart(att: AttachmentItem): string {
  const filename = sanitizeFilename(att.filename);
  const mimeType = att.mimeType || 'application/octet-stream';
  const disposition = att.isInline && att.contentId ? 'inline' : 'attachment';
  const headers = [
    `Content-Type: ${mimeType}; name="${encodeHeaderWord(filename)}"`,
    `Content-Disposition: ${disposition}; filename="${encodeHeaderWord(filename)}"`,
    'Content-Transfer-Encoding: base64',
  ];
  if (att.contentId) {
    const cid = att.contentId.replace(/^<|>$/g, '');
    headers.push(`Content-ID: <${cid}>`);
  }
  headers.push('', wrapBase64(bytesToBase64(att.data)));
  return headers.join('\r\n');
}

function makeBoundary(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `----=_Postbox_${prefix}_${Date.now().toString(36)}_${rand}`;
}

function formatRfc2822Date(isoOrNull: string | null): string {
  const d = isoOrNull ? new Date(isoOrNull) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
}

export function sanitizeExportFilename(name: string, ext: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  const base = cleaned || 'message';
  return base.toLowerCase().endsWith(ext) ? base : `${base}${ext}`;
}

export function serializeMessageToEml(message: MessageDetail): Uint8Array {
  // If we already have exact raw RFC 5322 source (EML/MBOX), preserve it faithfully
  if (message.rawSource && (message.format === 'eml' || message.format === 'mbox')) {
    return encoder.encode(message.rawSource);
  }

  const headers: string[] = [];
  const fromLine = formatAddress(message.from);
  if (fromLine) headers.push(`From: ${fromLine}`);
  const toLine = formatAddressList(message.to);
  if (toLine) headers.push(`To: ${toLine}`);
  const ccLine = formatAddressList(message.cc);
  if (ccLine) headers.push(`Cc: ${ccLine}`);
  const bccLine = formatAddressList(message.bcc);
  if (bccLine) headers.push(`Bcc: ${bccLine}`);
  headers.push(`Subject: ${encodeHeaderWord(message.subject || '(No Subject)')}`);
  headers.push(`Date: ${formatRfc2822Date(message.date)}`);
  headers.push(`Message-ID: <postbox-${message.id.replace(/[^a-zA-Z0-9._-]/g, '')}@local>`);
  headers.push('MIME-Version: 1.0');

  const textBody = message.textBody ?? '';
  const htmlBody = message.htmlBody ?? '';

  const inlineAtts = message.attachments.filter((a) => a.isInline && a.contentId);
  const regularAtts = message.attachments.filter((a) => !(a.isInline && a.contentId));

  let bodySection: string;

  if (textBody && htmlBody) {
    const altBoundary = makeBoundary('Alt');
    bodySection = [
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      `--${altBoundary}`,
      encodeUtf8Base64Part('text/plain', textBody),
      `--${altBoundary}`,
      encodeUtf8Base64Part('text/html', htmlBody),
      `--${altBoundary}--`,
    ].join('\r\n');
  } else if (htmlBody) {
    bodySection = encodeUtf8Base64Part('text/html', htmlBody);
  } else {
    bodySection = encodeUtf8Base64Part('text/plain', textBody);
  }

  if (inlineAtts.length > 0) {
    const relBoundary = makeBoundary('Rel');
    const parts = [
      `Content-Type: multipart/related; boundary="${relBoundary}"`,
      '',
      `--${relBoundary}`,
      bodySection,
      ...inlineAtts.flatMap((att) => [`--${relBoundary}`, encodeAttachmentPart(att)]),
      `--${relBoundary}--`,
    ];
    bodySection = parts.join('\r\n');
  }

  if (regularAtts.length > 0) {
    const mixedBoundary = makeBoundary('Mix');
    const parts = [
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
      '',
      `--${mixedBoundary}`,
      bodySection,
      ...regularAtts.flatMap((att) => [`--${mixedBoundary}`, encodeAttachmentPart(att)]),
      `--${mixedBoundary}--`,
    ];
    bodySection = parts.join('\r\n');
  }

  return encoder.encode(`${headers.join('\r\n')}\r\n${bodySection}\r\n`);
}
