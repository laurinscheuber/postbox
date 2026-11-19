import type { IPSTAttachment, IPSTMessage, IPSTRecipient } from '@hiraokahypertools/pst-extractor';
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
  Consts,
  NID_ROOT_FOLDER,
  NID_TYPE_CONTENTS_TABLE,
  NID_TYPE_HIERARCHY_TABLE,
  NID_TYPE_NORMAL_MESSAGE,
  PstEngine,
  makeSiblingNid,
} from '../pstEngine';
import {
  buildSnippet,
  guessMimeTypeFromFilename,
  inferFolderKind,
  normalizeCidValue,
  parseAddressStringList,
  parseDateSafe,
  stripHtmlToText,
} from './helpers';

export interface PstFolderMeta {
  folderNid: number;
  node: FolderNode;
}

export interface PstArchiveSession {
  archiveId: string;
  archiveName: string;
  format: ArchiveFormat;
  engine: PstEngine;
  rootFolders: FolderNode[];
  foldersById: Map<string, PstFolderMeta>;
  allFolderIds: string[];
  headerCache: Map<string, MessageSummary[]>;
}

const MAX_CACHED_FOLDERS = 2;
const MAX_CACHED_FOLDER_ROWS = 25000;
const HEADER_BATCH_SIZE = 500;

const FOLDER_KEYS = new Set<number>([0x3001, 0x3602, 0x3603, 0x360a, 0x3613]);

const HEADER_KEYS = new Set<number>([
  0x001a, // PR_MESSAGE_CLASS
  0x0037, // PR_SUBJECT
  0x0039, // PR_CLIENT_SUBMIT_TIME
  0x0040, // PR_RECEIVED_BY_NAME
  0x0042, // PR_SENT_REPRESENTING_NAME
  0x0065, // PR_SENT_REPRESENTING_EMAIL_ADDRESS
  0x0070, // PR_CONVERSATION_TOPIC
  0x0c1a, // PR_SENDER_NAME
  0x0c1f, // PR_SENDER_EMAIL_ADDRESS
  0x0e04, // PR_DISPLAY_TO
  0x0e06, // PR_MESSAGE_DELIVERY_TIME
  0x0e07, // PR_MESSAGE_FLAGS
  0x0e08, // PR_MESSAGE_SIZE
  0x0e1b, // PR_HASATTACH
  0x0e1d, // PR_NORMALIZED_SUBJECT
  0x3001, // PR_DISPLAY_NAME
  0x3007, // PR_CREATION_TIME
  0x5d01, // PR_SENDER_SMTP_ADDRESS
  0x5d02, // PR_SENT_REPRESENTING_SMTP_ADDRESS
  0x67f2, // PidTagLtpRowId
]);

const BODY_KEYS = new Set<number>([0x1000, 0x1013]);

const textDecoder = new TextDecoder('utf-8', { fatal: false });
const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function cleanSubjectPrefix(raw: string): string {
  if (!raw) return '';
  if (raw.length >= 2 && raw.charCodeAt(0) === 0x01) {
    return raw.length === 2 ? '' : raw.slice(2);
  }
  return raw;
}

function getStr(props: Map<number, unknown>, key: number): string {
  const val = props.get(key);
  return typeof val === 'string' ? val.trim() : '';
}

function getBool(props: Map<number, unknown>, key: number): boolean {
  const val = props.get(key);
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  return false;
}

function getNum(props: Map<number, unknown>, key: number): number {
  const val = props.get(key);
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const parsed = Number(val);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function findDefaultPstFolder(nodes: FolderNode[]): string | null {
  for (const n of nodes) {
    if (n.kind === 'inbox' && n.totalCount > 0) return n.id;
  }
  for (const n of nodes) {
    const child = findDefaultPstFolder(n.children);
    if (child) return child;
  }
  for (const n of nodes) {
    if (n.totalCount > 0) return n.id;
  }
  for (const n of nodes) {
    const nested = findFirstNonEmpty(n.children);
    if (nested) return nested;
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

function buildSummaryFromProps(
  props: Map<number, unknown>,
  meta: {
    archiveId: string;
    folderId: string;
    folderPath: string;
    folderNid: number;
    msgNid: number;
    format: ArchiveFormat;
  },
): MessageSummary {
  const rawSubject =
    cleanSubjectPrefix(getStr(props, 0x0037)) ||
    getStr(props, 0x0e1d) ||
    getStr(props, 0x3001) ||
    getStr(props, 0x0070) ||
    '(No Subject)';

  const smtp = getStr(props, 0x5d01) || getStr(props, 0x5d02);
  const rawAddr = getStr(props, 0x0c1f) || getStr(props, 0x0065);
  const senderAddress = (smtp.includes('@') ? smtp : rawAddr) || '';
  const senderName =
    getStr(props, 0x0c1a) ||
    getStr(props, 0x0042) ||
    senderAddress ||
    'Unknown Sender';

  const deliveryTime = props.get(0x0e06);
  const submitTime = props.get(0x0039);
  const creationTime = props.get(0x3007);
  const { iso, timestamp } = parseDateSafe(
    (deliveryTime instanceof Date ? deliveryTime : null) ??
      (submitTime instanceof Date ? submitTime : null) ??
      (creationTime instanceof Date ? creationTime : null),
  );

  const flags = getNum(props, 0x0e07);
  const isRead = (flags & 0x01) !== 0;
  const hasAttachments = getBool(props, 0x0e1b);
  const sizeVal = getNum(props, 0x0e08);

  return {
    id: `${meta.archiveId}:pst:${meta.folderNid}:${meta.msgNid}`,
    folderId: meta.folderId,
    folderPath: meta.folderPath,
    archiveId: meta.archiveId,
    format: meta.format,
    subject: rawSubject,
    senderName,
    senderAddress,
    toSummary: getStr(props, 0x0e04) || getStr(props, 0x0040),
    date: iso,
    timestamp,
    snippet: '',
    hasAttachments,
    isRead,
    size: sizeVal > 0 ? sizeVal : undefined,
  };
}

export function parsePstMessageId(
  messageId: string,
): { archiveId: string; folderNid: number; msgNid: number } | null {
  const match = messageId.match(/^([^:]+):pst:(\d+):(\d+)$/);
  if (!match) return null;
  return {
    archiveId: match[1],
    folderNid: Number(match[2]),
    msgNid: Number(match[3]),
  };
}

/**
 * Opens a `.pst` or `.ost` archive via 64 KB paged `File.slice()` I/O and parses ONLY
 * the root folder hierarchy so 40 GB+ archives open in under 2 seconds.
 */
export async function openPstArchive(
  file: File,
  archiveId: string,
  format: 'pst' | 'ost',
  onProgress?: (label: string) => void,
): Promise<{ session: PstArchiveSession; defaultFolderId: string | null }> {
  const reader = createPstBlockReader(file);
  const engine = await PstEngine.open(reader, 'latin1');

  const foldersById = new Map<string, PstFolderMeta>();
  const allFolderIds: string[] = [];
  const visitedNids = new Set<number>();

  async function getChildFolderNids(
    folderNid: number,
    isRootWrapper: boolean,
  ): Promise<number[]> {
    const hierNid = makeSiblingNid(folderNid, NID_TYPE_HIERARCHY_TABLE);
    const hierEntry = await engine.lookupNode(hierNid);
    if (hierEntry) {
      const hierSub = engine.createSubNodeHandle(
        hierEntry.nid,
        hierEntry.bidData,
        hierEntry.bidSub,
        `hier(${folderNid})`,
      );
      const childNids: number[] = [];
      await engine.streamTableRows(
        hierSub,
        new Set([0x67f2]),
        1000,
        (rows) => {
          for (const row of rows) {
            const nid = row.get(0x67f2);
            if (typeof nid === 'number' && nid !== 0 && nid !== folderNid) {
              childNids.push(nid);
            }
          }
        },
      );
      if (!isRootWrapper || childNids.length > 0) {
        return childNids;
      }
    }

    if (isRootWrapper) {
      const ipmSubTreeNid = await engine.readIpmSubTreeNid();
      if (ipmSubTreeNid !== null && ipmSubTreeNid !== folderNid) {
        return [ipmSubTreeNid];
      }
    }

    // One-time cached folder-only NBT fallback (never scans per leaf folder)
    return await engine.getFallbackChildFolderNids(folderNid);
  }

  async function walkFolder(
    folderNid: number,
    parentDisplayPath: string,
    isRootWrapper: boolean,
  ): Promise<FolderNode | null> {
    if (visitedNids.has(folderNid)) return null;
    visitedNids.add(folderNid);
    if (visitedNids.size === 1 || visitedNids.size % 10 === 0) {
      onProgress?.(`Scanning folder tree (${visitedNids.size} folders)…`);
    }

    const entry = await engine.lookupNode(folderNid);
    if (!entry) return null;

    const subNode = engine.createSubNodeHandle(
      entry.nid,
      entry.bidData,
      entry.bidSub,
      `folder(${folderNid})`,
    );
    const props = await engine.readProperties(subNode, FOLDER_KEYS);
    const propMap = new Map(props.map((p) => [p.key, p.value]));

    const rawName = getStr(propMap, 0x3001);
    const totalCount = Math.max(0, getNum(propMap, 0x3602));
    const unreadCount = Math.max(0, getNum(propMap, 0x3603));
    const hasSubfoldersProp = propMap.has(0x360a) ? getBool(propMap, 0x360a) : true;
    const childNids =
      !isRootWrapper && !hasSubfoldersProp
        ? []
        : await getChildFolderNids(folderNid, isRootWrapper);

    // Unwrap nameless PST root wrapper
    if (isRootWrapper && !rawName && totalCount === 0 && childNids.length > 0) {
      const unwrappedChildren: FolderNode[] = [];
      for (const childNid of childNids) {
        const child = await walkFolder(childNid, '', false);
        if (child) unwrappedChildren.push(child);
      }

      if (
        unwrappedChildren.length === 1 &&
        unwrappedChildren[0].totalCount === 0 &&
        unwrappedChildren[0].children.length > 0
      ) {
        const top = unwrappedChildren[0];
        const archiveRoot: FolderNode = {
          ...top,
          name: file.name,
          kind: 'root',
        };
        const topMeta = foldersById.get(top.id);
        if (topMeta) {
          topMeta.node = archiveRoot;
        }
        return archiveRoot;
      }

      const rootId = `${archiveId}:folder:${folderNid}`;
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
      foldersById.set(rootId, { folderNid, node: rootNode });
      allFolderIds.push(rootId);
      return rootNode;
    }

    const displayName = rawName || 'Folder';
    const isTopContainer =
      !parentDisplayPath &&
      totalCount === 0 &&
      /^top of (outlook data file|personal folders)$/i.test(displayName);
    const nextParentPath = isTopContainer
      ? ''
      : parentDisplayPath
        ? `${parentDisplayPath} / ${displayName}`
        : displayName;

    const children: FolderNode[] = [];
    for (const childNid of childNids) {
      const childNode = await walkFolder(childNid, nextParentPath, false);
      if (childNode) children.push(childNode);
    }

    const folderId = `${archiveId}:folder:${folderNid}`;
    const node: FolderNode = {
      id: folderId,
      archiveId,
      archiveName: file.name,
      name: displayName,
      path: nextParentPath || displayName,
      kind: inferFolderKind(displayName),
      totalCount,
      unreadCount,
      children,
    };

    foldersById.set(folderId, { folderNid, node });
    allFolderIds.push(folderId);
    return node;
  }

  const rootNode = await walkFolder(NID_ROOT_FOLDER, '', true);
  const rootFolders = rootNode ? [rootNode] : [];

  const session: PstArchiveSession = {
    archiveId,
    archiveName: file.name,
    format,
    engine,
    rootFolders,
    foldersById,
    allFolderIds,
    headerCache: new Map(),
  };

  return {
    session,
    defaultFolderId: findDefaultPstFolder(rootFolders),
  };
}

function storeCachedFolderHeaders(
  session: PstArchiveSession,
  folderId: string,
  headers: MessageSummary[],
): void {
  if (headers.length > MAX_CACHED_FOLDER_ROWS) return;
  if (session.headerCache.size >= MAX_CACHED_FOLDERS) {
    const oldest = session.headerCache.keys().next().value;
    if (oldest !== undefined) {
      session.headerCache.delete(oldest);
    }
  }
  session.headerCache.set(folderId, headers);
}

/**
 * Streams message headers for a single folder in 500-item chunks using the Contents Table (`0x0e`)
 * and selective Property Context lookups, never loading email bodies or attachments.
 */
export async function streamPstFolderHeaders(
  session: PstArchiveSession,
  folderId: string,
  options: {
    batchSize?: number;
    useCache?: boolean;
    onBatch: (
      batch: MessageSummary[],
      loadedCount: number,
      totalCount: number,
    ) => Promise<void> | void;
    isCancelled?: () => boolean;
  },
): Promise<{ total: number; cancelled: boolean }> {
  const meta = session.foldersById.get(folderId);
  if (!meta) return { total: 0, cancelled: false };

  const batchSize = options.batchSize ?? HEADER_BATCH_SIZE;
  const folderPath = meta.node.path || meta.node.name;

  if (options.useCache !== false) {
    const cached = session.headerCache.get(folderId);
    if (cached) {
      for (let i = 0; i < cached.length; i += batchSize) {
        if (options.isCancelled?.()) return { total: cached.length, cancelled: true };
        const slice = cached.slice(i, i + batchSize);
        await options.onBatch(slice, Math.min(i + slice.length, cached.length), cached.length);
      }
      return { total: cached.length, cancelled: false };
    }
  }

  const contentsNid = makeSiblingNid(meta.folderNid, NID_TYPE_CONTENTS_TABLE);
  const contentsEntry = await session.engine.lookupNode(contentsNid);
  const collected: MessageSummary[] = [];
  let canCache = options.useCache !== false;
  let handledByTable = false;

  if (contentsEntry) {
    const contentsSub = session.engine.createSubNodeHandle(
      contentsEntry.nid,
      contentsEntry.bidData,
      contentsEntry.bidSub,
      `contents(${meta.folderNid})`,
    );

    const streamResult = await session.engine.streamTableRows(
      contentsSub,
      HEADER_KEYS,
      batchSize,
      async (rows, processed, totalRows, tableSchemaKeys) => {
        const hasSubjectCol =
          tableSchemaKeys.has(0x0037) ||
          tableSchemaKeys.has(0x0e1d) ||
          tableSchemaKeys.has(0x0070) ||
          tableSchemaKeys.has(0x3001);
        const hasSenderOrToCol =
          tableSchemaKeys.has(0x0c1a) ||
          tableSchemaKeys.has(0x0042) ||
          tableSchemaKeys.has(0x5d01) ||
          tableSchemaKeys.has(0x0c1f) ||
          tableSchemaKeys.has(0x0e04);

        const rowEntries: Array<{ rowNid: number; rowMap: Map<number, unknown>; needsFallback: boolean }> = [];
        for (let idx = 0; idx < rows.length; idx += 1) {
          const rowMap = rows[idx];
          const rowNid = rowMap.get(0x67f2);
          if (typeof rowNid !== 'number' || rowNid === 0) continue;

          const missingSubject =
            !hasSubjectCol ||
            (!rowMap.get(0x0037) && !rowMap.get(0x0e1d) && !rowMap.get(0x0070) && !rowMap.get(0x3001));
          const missingSenderAndTo =
            !hasSenderOrToCol ||
            (!rowMap.get(0x0c1a) &&
              !rowMap.get(0x0042) &&
              !rowMap.get(0x5d01) &&
              !rowMap.get(0x0c1f) &&
              !rowMap.get(0x0e04));

          rowEntries.push({
            rowNid,
            rowMap,
            needsFallback: missingSubject || missingSenderAndTo,
          });
        }

        const batch: MessageSummary[] = [];
        for (let offset = 0; offset < rowEntries.length; offset += 20) {
          if (options.isCancelled?.()) return;
          const chunk = rowEntries.slice(offset, offset + 20);
          const resolvedChunk = await Promise.all(
            chunk.map(async ({ rowNid, rowMap, needsFallback }) => {
              let finalProps = rowMap;
              if (needsFallback) {
                const msgEntry = await session.engine.lookupNode(rowNid);
                if (msgEntry) {
                  const msgSub = session.engine.createSubNodeHandle(
                    msgEntry.nid,
                    msgEntry.bidData,
                    msgEntry.bidSub,
                    `hdr(${rowNid})`,
                  );
                  const extra = await session.engine.readProperties(msgSub, HEADER_KEYS);
                  finalProps = new Map(rowMap);
                  for (const p of extra) {
                    if (!finalProps.has(p.key)) finalProps.set(p.key, p.value);
                  }
                }
              }
              return buildSummaryFromProps(finalProps, {
                archiveId: session.archiveId,
                folderId,
                folderPath,
                folderNid: meta.folderNid,
                msgNid: rowNid,
                format: session.format,
              });
            }),
          );
          batch.push(...resolvedChunk);
        }

        if (canCache) {
          if (collected.length + batch.length <= MAX_CACHED_FOLDER_ROWS) {
            collected.push(...batch);
          } else {
            canCache = false;
            collected.length = 0;
          }
        }

        if (batch.length > 0) {
          await options.onBatch(batch, processed, totalRows || meta.node.totalCount);
        }
        await yieldToEventLoop();
      },
      options.isCancelled,
    );

    const total = streamResult.total;
    if (options.isCancelled?.()) {
      return { total, cancelled: true };
    }
    if (total > 0 || meta.node.totalCount === 0) {
      handledByTable = true;
      meta.node.totalCount = total;
      if (canCache) {
        storeCachedFolderHeaders(session, folderId, collected);
      }
      return { total, cancelled: false };
    }
  }

  // Fallback for folders without a readable Contents Table
  if (!handledByTable) {
    const childEntries = await session.engine.scanChildNidsByParent(
      meta.folderNid,
      NID_TYPE_NORMAL_MESSAGE,
    );
    const total = childEntries.length;
    meta.node.totalCount = total;

    let batch: MessageSummary[] = [];
    for (let i = 0; i < total; i += 1) {
      if (options.isCancelled?.()) {
        return { total, cancelled: true };
      }
      const entry = childEntries[i];
      const msgSub = session.engine.createSubNodeHandle(
        entry.nid,
        entry.bidData,
        entry.bidSub,
        `msgHdr(${entry.nid})`,
      );
      const props = await session.engine.readProperties(msgSub, HEADER_KEYS);
      const propMap = new Map(props.map((p) => [p.key, p.value]));
      batch.push(
        buildSummaryFromProps(propMap, {
          archiveId: session.archiveId,
          folderId,
          folderPath,
          folderNid: meta.folderNid,
          msgNid: entry.nid,
          format: session.format,
        }),
      );

      if (batch.length >= batchSize || i === total - 1) {
        if (canCache) {
          if (collected.length + batch.length <= MAX_CACHED_FOLDER_ROWS) {
            collected.push(...batch);
          } else {
            canCache = false;
            collected.length = 0;
          }
        }
        await options.onBatch(batch, i + 1, total);
        batch = [];
        await yieldToEventLoop();
      }
    }

    if (canCache) {
      storeCachedFolderHeaders(session, folderId, collected);
    }
    return { total, cancelled: false };
  }

  return { total: 0, cancelled: false };
}

/**
 * Reads ONLY the plain/HTML body text of a single message for streaming body search,
 * allowing the caller to discard the string immediately so RAM stays flat.
 */
export async function readPstMessageBodyText(
  session: PstArchiveSession,
  msgNid: number,
): Promise<string> {
  const entry = await session.engine.lookupNode(msgNid);
  if (!entry) return '';
  const subNode = session.engine.createSubNodeHandle(
    entry.nid,
    entry.bidData,
    entry.bidSub,
    `body(${msgNid})`,
  );
  const props = await session.engine.readProperties(subNode, BODY_KEYS);
  const textProp = props.find((p) => p.key === 0x1000)?.value;
  if (typeof textProp === 'string' && textProp.trim()) {
    return textProp;
  }
  const htmlProp = props.find((p) => p.key === 0x1013)?.value;
  if (typeof htmlProp === 'string' && htmlProp.trim()) {
    return stripHtmlToText(htmlProp);
  }
  if (htmlProp instanceof ArrayBuffer && htmlProp.byteLength > 0) {
    return stripHtmlToText(textDecoder.decode(new Uint8Array(htmlProp)));
  }
  return '';
}

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

/**
 * Loads full HTML/plain-text body, MAPI properties, recipients, and attachments
 * ONLY when an individual email is clicked or exported.
 */
export async function loadPstMessageDetail(
  session: PstArchiveSession,
  messageId: string,
): Promise<MessageDetail | null> {
  const parsed = parsePstMessageId(messageId);
  if (!parsed) return null;

  const folderId = `${session.archiveId}:folder:${parsed.folderNid}`;
  const folderPath = session.foldersById.get(folderId)?.node.path || 'Folder';
  const msg = await session.engine.openMessageByNid(parsed.msgNid);
  if (!msg) return null;

  const [recipients, pstAtts] = await Promise.all([
    msg.getRecipients().catch(() => [] as IPSTRecipient[]),
    msg.getAttachments().catch(() => [] as IPSTAttachment[]),
  ]);

  const { to, cc, bcc } = mapRecipients(recipients, msg);
  const senderAddress = extractBestSenderEmail(msg);
  const senderName = (msg.senderName || msg.sentRepresentingName || senderAddress || 'Unknown Sender').trim();
  const htmlBody = extractPstHtmlBody(msg);
  const textBody = msg.body || (htmlBody ? stripHtmlToText(htmlBody) : '');
  const attachments = await extractAttachments(pstAtts, messageId);
  const { iso, timestamp } = parseDateSafe(
    msg.messageDeliveryTime ?? msg.clientSubmitTime ?? msg.creationTime,
  );
  const subject = (msg.subject || msg.displayName || '(No Subject)').trim();

  const mapiProperties: MapiPropertyItem[] = msg
    .getAllProperties()
    .map((p) => toMapiPropertyItem(p.key, p.type, p.value));

  return {
    id: messageId,
    folderId,
    folderPath,
    archiveId: session.archiveId,
    format: session.format,
    subject,
    senderName,
    senderAddress,
    toSummary: msg.displayTo || msg.receivedByName || '',
    date: iso,
    timestamp,
    snippet: buildSnippet(textBody, htmlBody),
    hasAttachments: msg.hasAttachments || attachments.length > 0,
    isRead: msg.isRead,
    size: msg.messageSize?.toNumber?.() ?? undefined,
    from: { name: senderName, address: senderAddress },
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
