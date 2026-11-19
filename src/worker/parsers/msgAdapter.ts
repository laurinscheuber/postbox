import MsgReader, { type FieldsData } from '@kenjiuno/msgreader';
import type {
  AttachmentItem,
  EmailAddress,
  MapiPropertyItem,
  MessageDetail,
  MessageSummary,
} from '../../types/mail';
import {
  buildSnippet,
  formatToSummary,
  guessMimeTypeFromFilename,
  normalizeCidValue,
  parseDateSafe,
  stripHtmlToText,
} from './helpers';

const textDecoder = new TextDecoder('utf-8', { fatal: false });

export interface ParsedMsgRecord {
  summary: MessageSummary;
  detail: MessageDetail;
  searchText: string;
}

function decodeHtmlField(data: FieldsData): string {
  if (data.bodyHtml && data.bodyHtml.trim()) {
    return data.bodyHtml;
  }
  if (data.html instanceof Uint8Array && data.html.byteLength > 0) {
    return textDecoder.decode(data.html);
  }
  return '';
}

function mapMsgRecipients(recipients: FieldsData[] | undefined): {
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
} {
  const to: EmailAddress[] = [];
  const cc: EmailAddress[] = [];
  const bcc: EmailAddress[] = [];
  for (const r of recipients ?? []) {
    const addr: EmailAddress = {
      name: (r.name || '').trim(),
      address: (r.smtpAddress || r.email || '').trim(),
    };
    if (r.recipType === 'cc') {
      cc.push(addr);
    } else if (r.recipType === 'bcc') {
      bcc.push(addr);
    } else {
      to.push(addr);
    }
  }
  return { to, cc, bcc };
}

function buildMsgMapiProperties(data: FieldsData): MapiPropertyItem[] {
  const items: MapiPropertyItem[] = [];
  for (const prop of data.rawProps ?? []) {
    let valStr = '';
    if (typeof prop.value === 'string') {
      valStr = prop.value;
    } else if (prop.value instanceof Uint8Array) {
      const hex = Array.from(prop.value.subarray(0, 24))
        .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
        .join(' ');
      valStr = `[${prop.value.byteLength} bytes] ${hex}`;
    }
    items.push({
      tag: prop.propertyTag ? `0x${prop.propertyTag}` : prop.propertyLid ? `LID:0x${prop.propertyLid}` : 'Named',
      name: prop.propertyName || prop.propertySet || 'MAPI Property',
      type: prop.propertyTag ? prop.propertyTag.slice(-4) : 'Raw',
      value: valStr.length > 2000 ? `${valStr.slice(0, 2000)}…` : valStr,
    });
  }
  return items;
}

export async function parseMsgFile(
  file: File,
  archiveId: string,
  folderId: string,
): Promise<ParsedMsgRecord> {
  const arrayBuffer = await file.arrayBuffer();
  const reader = new MsgReader(arrayBuffer);
  reader.parserConfig = { includeRawProps: true };
  const data = reader.getFileData();

  if (data.error) {
    throw new Error(`Failed to parse MSG file "${file.name}": ${data.error}`);
  }

  const msgId = `${archiveId}:msg:0`;
  const senderAddress = (
    data.senderSmtpAddress ||
    data.sentRepresentingSmtpAddress ||
    data.senderEmail ||
    ''
  ).trim();
  const senderName = (data.senderName || senderAddress || 'Unknown Sender').trim();
  const { to, cc, bcc } = mapMsgRecipients(data.recipients);
  const { iso, timestamp } = parseDateSafe(
    data.messageDeliveryTime ?? data.clientSubmitTime ?? data.creationTime ?? file.lastModified,
  );

  const htmlBody = decodeHtmlField(data);
  const textBody = (data.body || '').trim() || (htmlBody ? stripHtmlToText(htmlBody) : '');
  const subject = (data.subject || file.name.replace(/\.msg$/i, '') || '(No Subject)').trim();
  const toSummary = formatToSummary(to);

  const attachments: AttachmentItem[] = [];
  const rawAtts = data.attachments ?? [];
  for (let i = 0; i < rawAtts.length; i += 1) {
    const attMeta = rawAtts[i];
    try {
      const attContent = reader.getAttachment(attMeta);
      const filename = (attContent.fileName || attMeta.fileName || `attachment-${i + 1}.bin`).trim();
      const bytes =
        attContent.content instanceof Uint8Array
          ? attContent.content
          : new Uint8Array(attContent.content);
      const contentId = normalizeCidValue(attMeta.pidContentId);
      const mimeType = (attMeta.attachMimeTag || '').trim() || guessMimeTypeFromFilename(filename);

      attachments.push({
        id: `${msgId}:att:${i}`,
        filename,
        mimeType,
        size: bytes.byteLength,
        contentId,
        isInline: Boolean(contentId) || Boolean(attMeta.attachmentHidden),
        data: bytes,
      });
    } catch {
      // Skip unreadable attachment
    }
  }

  const summary: MessageSummary = {
    id: msgId,
    folderId,
    folderPath: 'Imported Messages',
    archiveId,
    format: 'msg',
    subject,
    senderName,
    senderAddress,
    toSummary,
    date: iso,
    timestamp,
    snippet: buildSnippet(textBody, htmlBody),
    hasAttachments: attachments.length > 0,
    isRead: true,
    size: file.size,
  };

  const detail: MessageDetail = {
    ...summary,
    from: { name: senderName, address: senderAddress },
    to,
    cc,
    bcc,
    headersRaw: data.headers || '',
    htmlBody: htmlBody || undefined,
    textBody: textBody || undefined,
    rawSource: data.headers || undefined,
    mapiProperties: buildMsgMapiProperties(data),
    attachments,
  };

  const searchText = `${subject}\n${senderName}\n${senderAddress}\n${toSummary}\n${textBody.slice(0, 20000)}`.toLowerCase();

  return { summary, detail, searchText };
}
