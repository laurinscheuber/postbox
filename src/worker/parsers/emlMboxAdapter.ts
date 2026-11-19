import PostalMime, { type Address, type Email } from 'postal-mime';
import type {
  AttachmentItem,
  EmailAddress,
  FolderNode,
  MessageDetail,
  MessageSummary,
} from '../../types/mail';
import { decodeMimeWords, decodeSmartTextBytes } from '../../utils/encoding';
import { compareMessagesByDate } from '../../utils/sortMessages';
import {
  buildSnippet,
  formatToSummary,
  guessMimeTypeFromFilename,
  normalizeCidValue,
  parseDateSafe,
  stripHtmlToText,
} from './helpers';

const textEncoder = new TextEncoder();

export interface ParsedEmlRecord {
  summary: MessageSummary;
  detail: MessageDetail;
}

export interface MboxMessageSpan {
  id: string;
  start: number;
  end: number;
  summary: MessageSummary;
}

export interface MboxArchiveSession {
  archiveId: string;
  file: File;
  folderNode: FolderNode;
  messages: MessageSummary[];
  spansById: Map<string, MboxMessageSpan>;
}

function flattenAddresses(list: Address[] | undefined): EmailAddress[] {
  if (!list) return [];
  const out: EmailAddress[] = [];
  for (const item of list) {
    if ('group' in item && Array.isArray(item.group)) {
      for (const member of item.group) {
        out.push({
          name: decodeMimeWords(member.name || ''),
          address: member.address || '',
        });
      }
    } else {
      out.push({
        name: decodeMimeWords(item.name || ''),
        address: item.address || '',
      });
    }
  }
  return out;
}

function toUint8Array(content: ArrayBuffer | Uint8Array | string, encoding?: 'base64' | 'utf8'): Uint8Array {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (encoding === 'base64') {
    const binary = atob(content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return textEncoder.encode(content);
}

function convertPostalMimeEmail(
  parsed: Email,
  rawText: string,
  meta: {
    id: string;
    folderId: string;
    folderPath: string;
    archiveId: string;
    format: 'eml' | 'mbox';
    size: number;
    fallbackSubject: string;
    fallbackTimestamp: number;
  },
): { summary: MessageSummary; detail: MessageDetail } {
  const fromList = parsed.from ? flattenAddresses([parsed.from]) : [];
  const from: EmailAddress = fromList[0] ?? { name: 'Unknown Sender', address: '' };
  const to = flattenAddresses(parsed.to);
  const cc = flattenAddresses(parsed.cc);
  const bcc = flattenAddresses(parsed.bcc);

  const { iso, timestamp } = parseDateSafe(parsed.date ?? meta.fallbackTimestamp);
  const subject = decodeMimeWords((parsed.subject || meta.fallbackSubject || '(No Subject)').trim());
  const htmlBody = parsed.html || '';
  const textBody = (parsed.text || '').trim() || (htmlBody ? stripHtmlToText(htmlBody) : '');
  const toSummary = formatToSummary(to);

  const attachments: AttachmentItem[] = (parsed.attachments ?? []).map((att, idx) => {
    const data = toUint8Array(att.content, att.encoding);
    const filename = (att.filename || `attachment-${idx + 1}.bin`).trim();
    const contentId = normalizeCidValue(att.contentId);
    return {
      id: `${meta.id}:att:${idx}`,
      filename,
      mimeType: att.mimeType || guessMimeTypeFromFilename(filename),
      size: data.byteLength,
      contentId,
      isInline: Boolean(att.related) || att.disposition === 'inline' || Boolean(contentId),
      data,
    };
  });

  const headersRaw = (parsed.headerLines ?? []).map((h) => h.line).join('\n');

  const summary: MessageSummary = {
    id: meta.id,
    folderId: meta.folderId,
    folderPath: meta.folderPath,
    archiveId: meta.archiveId,
    format: meta.format,
    subject,
    senderName: from.name || from.address || 'Unknown Sender',
    senderAddress: from.address,
    toSummary,
    date: iso,
    timestamp,
    snippet: buildSnippet(textBody, htmlBody),
    hasAttachments: attachments.length > 0,
    isRead: true,
    size: meta.size,
  };

  const detail: MessageDetail = {
    ...summary,
    from,
    to,
    cc,
    bcc,
    headersRaw,
    htmlBody: htmlBody || undefined,
    textBody: textBody || undefined,
    rawSource: rawText,
    attachments,
  };

  return { summary, detail };
}

export async function parseEmlFile(
  file: File,
  archiveId: string,
  folderId: string,
): Promise<ParsedEmlRecord> {
  const buf = await file.arrayBuffer();
  const rawText = decodeSmartTextBytes(new Uint8Array(buf));
  const parsed = await PostalMime.parse(buf);
  return convertPostalMimeEmail(parsed, rawText, {
    id: `${archiveId}:eml:0`,
    folderId,
    folderPath: 'Imported Messages',
    archiveId,
    format: 'eml',
    size: file.size,
    fallbackSubject: file.name.replace(/\.eml$/i, ''),
    fallbackTimestamp: file.lastModified,
  });
}

/**
 * Strips one leading '>' on mboxrd-escaped lines (`^>(>*From )`) at the raw byte level so
 * non-UTF-8 8-bit MIME parts (e.g. ISO-8859-1 / Windows-1252) are preserved intact for PostalMime.
 */
function unescapeMboxFromBytes(bytes: Uint8Array): Uint8Array {
  const stripIndices: number[] = [];
  let lineStart = 0;

  while (lineStart < bytes.length) {
    if (bytes[lineStart] === 0x3e) {
      let pos = lineStart + 1;
      while (pos < bytes.length && bytes[pos] === 0x3e) {
        pos += 1;
      }
      if (
        pos + 5 <= bytes.length &&
        bytes[pos] === 0x46 && // F
        bytes[pos + 1] === 0x72 && // r
        bytes[pos + 2] === 0x6f && // o
        bytes[pos + 3] === 0x6d && // m
        bytes[pos + 4] === 0x20 // ' '
      ) {
        stripIndices.push(lineStart);
      }
    }

    const nlIdx = bytes.indexOf(0x0a, lineStart);
    if (nlIdx === -1) break;
    lineStart = nlIdx + 1;
  }

  if (stripIndices.length === 0) return bytes;

  const out = new Uint8Array(bytes.length - stripIndices.length);
  let srcCursor = 0;
  let dstCursor = 0;
  for (const dropIdx of stripIndices) {
    if (dropIdx > srcCursor) {
      out.set(bytes.subarray(srcCursor, dropIdx), dstCursor);
      dstCursor += dropIdx - srcCursor;
    }
    srcCursor = dropIdx + 1;
  }
  if (srcCursor < bytes.length) {
    out.set(bytes.subarray(srcCursor), dstCursor);
  }
  return out;
}

function findNextFromLine(bytes: Uint8Array, fromPos: number): number {
  for (let i = fromPos; i <= bytes.length - 6; i += 1) {
    if (
      bytes[i] === 0x0a &&
      bytes[i + 1] === 0x46 &&
      bytes[i + 2] === 0x72 &&
      bytes[i + 3] === 0x6f &&
      bytes[i + 4] === 0x6d &&
      bytes[i + 5] === 0x20
    ) {
      return i + 1;
    }
  }
  return -1;
}

function findLineEnd(bytes: Uint8Array, start: number): number {
  for (let i = start; i < bytes.length; i += 1) {
    if (bytes[i] === 0x0a) return i + 1;
  }
  return bytes.length;
}

/**
 * Scans an `.mbox` file in 4 MB chunks via `File.slice()` and reads only header slices
 * during indexing—never holding full bodies or raw search strings in RAM.
 */
export async function indexMboxFile(
  file: File,
  archiveId: string,
  onProgress?: (bytesRead: number, totalBytes: number) => void,
): Promise<MboxArchiveSession> {
  const folderId = `${archiveId}:mbox:root`;
  const spans: Array<{ start: number; end: number }> = [];
  const CHUNK_SIZE = 4 * 1024 * 1024;
  const OVERLAP = 16;

  let offset = 0;
  let currentMsgStart = -1;

  while (offset < file.size) {
    const readEnd = Math.min(offset + CHUNK_SIZE + OVERLAP, file.size);
    const chunkBuf = await file.slice(offset, readEnd).arrayBuffer();
    const bytes = new Uint8Array(chunkBuf);
    const logicalLimit = Math.min(CHUNK_SIZE, file.size - offset);

    let cursor = 0;
    if (offset === 0) {
      const startsWithFrom =
        bytes.length >= 5 &&
        bytes[0] === 0x46 &&
        bytes[1] === 0x72 &&
        bytes[2] === 0x6f &&
        bytes[3] === 0x6d &&
        bytes[4] === 0x20;
      if (startsWithFrom) {
        currentMsgStart = findLineEnd(bytes, 0);
        cursor = currentMsgStart;
      } else {
        currentMsgStart = 0;
      }
    }

    while (cursor < logicalLimit) {
      const fromLineOffset = findNextFromLine(bytes, cursor);
      if (fromLineOffset === -1 || fromLineOffset >= logicalLimit) {
        break;
      }
      const absFromLine = offset + fromLineOffset;
      if (currentMsgStart !== -1 && absFromLine > currentMsgStart) {
        spans.push({ start: currentMsgStart, end: absFromLine });
      }
      const headerStartInChunk = findLineEnd(bytes, fromLineOffset);
      currentMsgStart = offset + headerStartInChunk;
      cursor = headerStartInChunk;
    }

    offset += CHUNK_SIZE;
    onProgress?.(Math.min(offset, file.size), file.size);
  }

  if (currentMsgStart !== -1 && currentMsgStart < file.size) {
    spans.push({ start: currentMsgStart, end: file.size });
  }

  const messages: MessageSummary[] = [];
  const spansById = new Map<string, MboxMessageSpan>();

  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i];
    const spanSize = span.end - span.start;
    const msgId = `${folderId}:msg:${i}`;

    // Read small header/preamble slice only so multi-GB mbox indexing stays lightweight
    const previewBytesLen = Math.min(spanSize, 64 * 1024);
    const previewBuf = await file.slice(span.start, span.start + previewBytesLen).arrayBuffer();
    const previewBytes = unescapeMboxFromBytes(new Uint8Array(previewBuf));

    let summary: MessageSummary;
    try {
      const parsed = await PostalMime.parse(previewBytes);
      const converted = convertPostalMimeEmail(parsed, '', {
        id: msgId,
        folderId,
        folderPath: file.name,
        archiveId,
        format: 'mbox',
        size: spanSize,
        fallbackSubject: `Message #${i + 1}`,
        fallbackTimestamp: file.lastModified,
      });
      summary = converted.summary;
    } catch {
      summary = {
        id: msgId,
        folderId,
        folderPath: file.name,
        archiveId,
        format: 'mbox',
        subject: `Message #${i + 1}`,
        senderName: 'Unknown Sender',
        senderAddress: '',
        toSummary: '',
        date: null,
        timestamp: 0,
        snippet: '',
        hasAttachments: false,
        isRead: true,
        size: spanSize,
      };
    }

    messages.push(summary);
    spansById.set(msgId, {
      id: msgId,
      start: span.start,
      end: span.end,
      summary,
    });
  }

  messages.sort((a, b) => compareMessagesByDate(a, b, 'desc'));

  const folderNode: FolderNode = {
    id: folderId,
    archiveId,
    archiveName: file.name,
    name: file.name,
    path: file.name,
    kind: 'archive',
    totalCount: messages.length,
    unreadCount: 0,
    children: [],
  };

  return {
    archiveId,
    file,
    folderNode,
    messages,
    spansById,
  };
}

export async function loadMboxMessageDetail(
  session: MboxArchiveSession,
  messageId: string,
): Promise<MessageDetail | null> {
  const span = session.spansById.get(messageId);
  if (!span) return null;

  const buf = await session.file.slice(span.start, span.end).arrayBuffer();
  const unescapedBytes = unescapeMboxFromBytes(new Uint8Array(buf));
  const rawSource = decodeSmartTextBytes(unescapedBytes);
  const parsed = await PostalMime.parse(unescapedBytes);

  const { detail } = convertPostalMimeEmail(parsed, rawSource, {
    id: messageId,
    folderId: session.folderNode.id,
    folderPath: session.file.name,
    archiveId: session.archiveId,
    format: 'mbox',
    size: span.end - span.start,
    fallbackSubject: span.summary.subject,
    fallbackTimestamp: span.summary.timestamp,
  });

  return detail;
}

export async function readMboxMessageBodyText(
  session: MboxArchiveSession,
  messageId: string,
): Promise<string> {
  const span = session.spansById.get(messageId);
  if (!span) return '';
  const buf = await session.file.slice(span.start, span.end).arrayBuffer();
  const unescapedBytes = unescapeMboxFromBytes(new Uint8Array(buf));
  const parsed = await PostalMime.parse(unescapedBytes);
  return (parsed.text || '').trim() || (parsed.html ? stripHtmlToText(parsed.html) : '');
}
