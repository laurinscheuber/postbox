import {
  Consts,
  openPst,
  type IPSTAttachment,
  type IPSTFile,
  type IPSTFolder,
  type IPSTMessage,
  type IPSTRecipient,
} from '@hiraokahypertools/pst-extractor';
import type {
  ArchiveFormat,
  AttachmentItem,
  EmailAddress,
  FolderNode,
  MapiPropertyItem,
  MessageDetail,
  MessageSummary,
} from '../../types/mail';
import { toMapiPropertyItem } from '../mapiTags';
import { createPstBlockReader } from '../pstBlockReader';
import {
  buildSnippet,
  guessMimeTypeFromFilename,
  inferFolderKind,
  normalizeCidValue,
  parseAddressStringList,
  parseDateSafe,
  stripHtmlToText,
} from './helpers';

export interface PstFolderHandle {
  folder: IPSTFolder;
  node: FolderNode;
  messagesLoaded: boolean;
  messages: MessageSummary[];
  messageById: Map<string, { index: number }>;
}

export interface PstArchiveSession {
  archiveId: string;
  archiveName: string;
  format: ArchiveFormat;
  pstFile: IPSTFile;
  closeReader: () => Promise<void>;
  foldersById: Map<string, PstFolderHandle>;
  rootFolders: FolderNode[];
}

const textDecoder = new TextDecoder('utf-8', { fatal: false });

function extractBestSenderEmail(msg: IPSTMessage): string {
  const smtpProp = msg.getProperty(0x5d01)?.value;
  if (typeof smtpProp === 'string' && smtpProp.includes('@')) return smtpProp.trim();
  const repSmtpProp = msg.getProperty(0x5d02)?.value;
  if (typeof repSmtpProp === 'string' && repSmtpProp.includes('@')) return repSmtpProp.trim();
  if (msg.senderEmailAddress && msg.senderEmailAddress.trim()) {
    return msg.senderEmailAddress.trim();
  }
  if (msg.sentRepresentingEmailAddress && msg.sentRepresentingEmailAddress.trim()) {
    return msg.sentRepresentingEmailAddress.trim();
  }
  return '';
}

function extractPstHtmlBody(msg: IPSTMessage): string {
  const htmlStr = msg.bodyHTML;
  if (htmlStr && htmlStr.trim()) {
    return htmlStr;
  }
  const rawHtmlProp = msg.getProperty(0x1013)?.value;
  if (rawHtmlProp instanceof ArrayBuffer && rawHtmlProp.byteLength > 0) {
    return textDecoder.decode(new Uint8Array(rawHtmlProp));
  }
  if (rawHtmlProp instanceof Uint8Array && rawHtmlProp.byteLength > 0) {
    return textDecoder.decode(rawHtmlProp);
  }
  return '';
}

function resolveSenderDisplay(msg: IPSTMessage): { name: string; address: string } {
  const address = extractBestSenderEmail(msg);
  const name = (msg.senderName || msg.sentRepresentingName || '').trim();
  return {
    name: name || address || 'Unknown Sender',
    address,
  };
}

function findDefaultPstFolder(nodes: FolderNode[]): string | null {
  for (const n of nodes) {
    if (n.kind === 'inbox' && n.totalCount > 0) return n.id;
  }
  for (const n of nodes) {
    const childMatch = findDefaultPstFolder(n.children);
    if (childMatch) return childMatch;
  }
  for (const n of nodes) {
    if (n.totalCount > 0) return n.id;
  }
  for (const n of nodes) {
    const firstWithItems = findFirstNonEmpty(n.children);
    if (firstWithItems) return firstWithItems;
  }
  return nodes[0]?.id ?? null;
}

function findFirstNonEmpty(nodes: FolderNode[]): string | null {
  for (const n of nodes) {
    if (n.totalCount > 0) return n.id;
    const nested = findFirstNonEmpty(n.children);
    if (nested) return nested;
  }
  return null;
}

export async function openPstArchive(
  file: File,
  archiveId: string,
  format: 'pst' | 'ost',
): Promise<{ session: PstArchiveSession; defaultFolderId: string | null }> {
  const reader = createPstBlockReader(file);
  const pstFile = await openPst(reader, { ansiEncoding: 'latin1' });
  const foldersById = new Map<string, PstFolderHandle>();

  async function walkFolder(
    pstFolder: IPSTFolder,
    parentPath: string,
    isTopWrapper: boolean,
  ): Promise<FolderNode | null> {
    const rawName = (pstFolder.displayName || '').trim();
    const subFolders = await pstFolder.getSubFolders();
    const emailCount = await pstFolder.getEmailCount().catch(() => pstFolder.contentCount || 0);

    // Unwrap empty nameless PST root wrapper if it only contains Top of Outlook data file / IPM subtree
    if (isTopWrapper && !rawName && emailCount === 0 && subFolders.length > 0) {
      const unwrappedChildren: FolderNode[] = [];
      for (const child of subFolders) {
        const childNode = await walkFolder(child, '', false);
        if (childNode) unwrappedChildren.push(childNode);
      }
      // If single "Top of Outlook data file" / "Top of Personal Folders" wrapper with no direct emails, surface its children directly under archive root
      if (
        unwrappedChildren.length === 1 &&
        unwrappedChildren[0].totalCount === 0 &&
        unwrappedChildren[0].children.length > 0
      ) {
        const topFolder = unwrappedChildren[0];
        const archiveRoot: FolderNode = {
          ...topFolder,
          name: file.name,
          kind: 'root',
        };
        const handle = foldersById.get(topFolder.id);
        if (handle) {
          handle.node = archiveRoot;
        }
        return archiveRoot;
      }

      const rootId = `${archiveId}:folder:${pstFolder.primaryNodeId}`;
      const rootNode: FolderNode = {
        id: rootId,
        archiveId,
        archiveName: file.name,
        name: file.name,
        path: file.name,
        kind: 'root',
        totalCount: 0,
        unreadCount: 0,
        children: unwrappedChildren,
      };
      foldersById.set(rootId, {
        folder: pstFolder,
        node: rootNode,
        messagesLoaded: true,
        messages: [],
        messageById: new Map(),
      });
      return rootNode;
    }

    const displayName = rawName || 'Folder';
    const path = parentPath ? `${parentPath}/${displayName}` : displayName;
    const folderId = `${archiveId}:folder:${pstFolder.primaryNodeId}`;
    const children: FolderNode[] = [];
    for (const sub of subFolders) {
      const childNode = await walkFolder(sub, path, false);
      if (childNode) children.push(childNode);
    }

    const totalCount = emailCount || pstFolder.contentCount || 0;
    const unreadCount = Math.max(0, pstFolder.unreadCount || 0);
    const node: FolderNode = {
      id: folderId,
      archiveId,
      archiveName: file.name,
      name: displayName,
      path,
      kind: inferFolderKind(displayName),
      totalCount,
      unreadCount,
      children,
    };

    foldersById.set(folderId, {
      folder: pstFolder,
      node,
      messagesLoaded: false,
      messages: [],
      messageById: new Map(),
    });

    return node;
  }

  const rootFolder = await pstFile.getRootFolder();
  const rootNode = await walkFolder(rootFolder, '', true);
  const rootFolders = rootNode ? [rootNode] : [];

  const session: PstArchiveSession = {
    archiveId,
    archiveName: file.name,
    format,
    pstFile,
    closeReader: () => reader.close(),
    foldersById,
    rootFolders,
  };

  return {
    session,
    defaultFolderId: findDefaultPstFolder(rootFolders),
  };
}

export async function loadPstFolderMessages(
  session: PstArchiveSession,
  folderId: string,
  searchTextByMsgId: Map<string, string>,
  onProgress?: (current: number, total: number) => void,
): Promise<MessageSummary[]> {
  const handle = session.foldersById.get(folderId);
  if (!handle) return [];
  if (handle.messagesLoaded) return handle.messages;

  const total = await handle.folder.getEmailCount();
  const messages: MessageSummary[] = [];
  const messageById = new Map<string, { index: number }>();

  for (let i = 0; i < total; i += 1) {
    if (i === 0 || i % 75 === 0 || i === total - 1) {
      onProgress?.(i + 1, total);
    }

    try {
      const msg = await handle.folder.getEmail(i);
      const msgId = `${folderId}:msg:${i}:${msg.primaryNodeId}`;
      const sender = resolveSenderDisplay(msg);
      const { iso, timestamp } = parseDateSafe(
        msg.messageDeliveryTime ?? msg.clientSubmitTime ?? msg.creationTime,
      );
      const htmlBody = extractPstHtmlBody(msg);
      const textBody = msg.body || '';
      const subject = (msg.subject || msg.displayName || '(No Subject)').trim();
      const snippet = buildSnippet(textBody, htmlBody);

      const summary: MessageSummary = {
        id: msgId,
        folderId,
        archiveId: session.archiveId,
        format: session.format,
        subject,
        senderName: sender.name,
        senderAddress: sender.address,
        toSummary: msg.displayTo || msg.receivedByName || '',
        date: iso,
        timestamp,
        snippet,
        hasAttachments: msg.hasAttachments || (await msg.getNumberOfAttachments().catch(() => 0)) > 0,
        isRead: msg.isRead,
        size: msg.messageSize?.toNumber?.() ?? undefined,
      };

      messages.push(summary);
      messageById.set(msgId, { index: i });

      const bodyForIndex = (textBody || stripHtmlToText(htmlBody)).slice(0, 20000);
      searchTextByMsgId.set(
        msgId,
        `${subject}\n${sender.name}\n${sender.address}\n${summary.toSummary}\n${bodyForIndex}`.toLowerCase(),
      );
    } catch {
      // Skip corrupted individual MAPI items without failing the entire folder
    }
  }

  messages.sort((a, b) => b.timestamp - a.timestamp);
  handle.messages = messages;
  handle.messageById = messageById;
  handle.messagesLoaded = true;
  handle.node.totalCount = messages.length;
  return messages;
}

function mapRecipients(recipients: IPSTRecipient[], msg: IPSTMessage): {
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
} {
  const to: EmailAddress[] = [];
  const cc: EmailAddress[] = [];
  const bcc: EmailAddress[] = [];

  for (const r of recipients) {
    const addr: EmailAddress = {
      name: (r.displayName || '').trim(),
      address: (r.smtpAddress || r.emailAddress || '').trim(),
    };
    if (r.recipientType === Consts.MAPI_CC) {
      cc.push(addr);
    } else if (r.recipientType === Consts.MAPI_BCC) {
      bcc.push(addr);
    } else {
      to.push(addr);
    }
  }

  if (to.length === 0 && msg.displayTo) {
    to.push(...parseAddressStringList(msg.displayTo));
  }
  if (cc.length === 0 && msg.displayCC) {
    cc.push(...parseAddressStringList(msg.displayCC));
  }
  if (bcc.length === 0 && msg.displayBCC) {
    bcc.push(...parseAddressStringList(msg.displayBCC));
  }

  return { to, cc, bcc };
}

async function extractAttachments(
  pstAtts: IPSTAttachment[],
  messageId: string,
): Promise<AttachmentItem[]> {
  const result: AttachmentItem[] = [];
  for (let idx = 0; idx < pstAtts.length; idx += 1) {
    const att = pstAtts[idx];
    let bytes: Uint8Array | null = null;
    if (att.fileData instanceof ArrayBuffer && att.fileData.byteLength > 0) {
      bytes = new Uint8Array(att.fileData);
    }
    if (!bytes && att.attachMethod === 5) {
      try {
        const embedded = await att.getEmbeddedPSTMessage();
        if (embedded) {
          const text = `Subject: ${embedded.subject}\nFrom: ${embedded.senderName}\n\n${embedded.body || ''}`;
          bytes = new TextEncoder().encode(text);
        }
      } catch {
        // Ignore unreadable embedded message
      }
    }
    if (!bytes) continue;

    const rawName = (att.longFilename || att.filename || `attachment-${idx + 1}.bin`).trim();
    const contentId = normalizeCidValue(att.contentId);
    const mimeType =
      (att.mimeTag && att.mimeTag.trim()) || guessMimeTypeFromFilename(rawName);

    result.push({
      id: `${messageId}:att:${idx}`,
      filename: rawName,
      mimeType,
      size: bytes.byteLength,
      contentId,
      isInline: Boolean(contentId) || att.isAttachmentInvisibleInHtml,
      data: bytes,
    });
  }
  return result;
}

export async function loadPstMessageDetail(
  session: PstArchiveSession,
  folderId: string,
  messageId: string,
): Promise<MessageDetail | null> {
  const handle = session.foldersById.get(folderId);
  if (!handle) return null;
  const loc = handle.messageById.get(messageId);
  if (!loc) return null;

  const msg = await handle.folder.getEmail(loc.index);
  const summary = handle.messages.find((m) => m.id === messageId);
  if (!summary) return null;

  const [recipients, pstAtts] = await Promise.all([
    msg.getRecipients().catch(() => [] as IPSTRecipient[]),
    msg.getAttachments().catch(() => [] as IPSTAttachment[]),
  ]);

  const { to, cc, bcc } = mapRecipients(recipients, msg);
  const sender = resolveSenderDisplay(msg);
  const htmlBody = extractPstHtmlBody(msg);
  const textBody = msg.body || (htmlBody ? stripHtmlToText(htmlBody) : '');
  const attachments = await extractAttachments(pstAtts, messageId);

  const mapiProperties: MapiPropertyItem[] = msg
    .getAllProperties()
    .map((p) => toMapiPropertyItem(p.key, p.type, p.value));

  return {
    ...summary,
    from: sender,
    to,
    cc,
    bcc,
    headersRaw: msg.transportMessageHeaders || '',
    htmlBody: htmlBody || undefined,
    textBody: textBody || undefined,
    rawSource: msg.transportMessageHeaders || undefined,
    mapiProperties,
    attachments,
  };
}
