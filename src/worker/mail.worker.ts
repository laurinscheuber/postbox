import { Buffer } from 'buffer';
import JSZip from 'jszip';
import type {
  FolderNode,
  LoadedArchiveInfo,
  MessageDetail,
  MessageSummary,
  SearchFilter,
  WorkerRequest,
  WorkerResponse,
} from '../types/mail';
import { sanitizeExportFilename, serializeMessageToEml } from '../utils/emlSerializer';
import {
  indexMboxFile,
  loadMboxMessageDetail,
  parseEmlFile,
  readMboxMessageBodyText,
  type MboxArchiveSession,
  type ParsedEmlRecord,
} from './parsers/emlMboxAdapter';
import { parseMsgFile, type ParsedMsgRecord } from './parsers/msgAdapter';
import {
  loadPstMessageDetail,
  openPstArchive,
  parsePstMessageId,
  readPstMessageBodyText,
  streamPstFolderHeaders,
  type PstArchiveSession,
} from './parsers/pstAdapter';

// Ensure Buffer global is available for @kenjiuno/msgreader's iconv-lite / safer-buffer dependency
(globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;

const VIRTUAL_IMPORTED_FOLDER_ID = 'virtual:imported';

const pstSessions = new Map<string, PstArchiveSession>();
const mboxSessions = new Map<string, MboxArchiveSession>();
const importedRecords = new Map<string, ParsedMsgRecord | ParsedEmlRecord>();
const importedOrder: string[] = [];
const loadedArchives: LoadedArchiveInfo[] = [];
const folderToArchive = new Map<string, { kind: 'pst' | 'mbox'; archiveId: string }>();
const cancelledRequests = new Set<string>();

let archiveSeq = 0;

const yieldTick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function post(response: WorkerResponse, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) {
    self.postMessage(response, { transfer });
  } else {
    self.postMessage(response);
  }
}

function emitProgress(requestId: string, label: string, current: number, total: number): void {
  post({ type: 'PROGRESS', requestId, label, current, total });
}

function getExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? '';
}

function buildFolderTree(): FolderNode[] {
  const tree: FolderNode[] = [];
  if (importedOrder.length > 0) {
    tree.push({
      id: VIRTUAL_IMPORTED_FOLDER_ID,
      archiveId: 'virtual',
      archiveName: 'Imported Messages',
      name: 'Imported Messages',
      path: 'Imported Messages',
      kind: 'imported',
      totalCount: importedOrder.length,
      unreadCount: 0,
      children: [],
    });
  }
  for (const pst of pstSessions.values()) {
    tree.push(...pst.rootFolders);
  }
  for (const mbox of mboxSessions.values()) {
    tree.push(mbox.folderNode);
  }
  return tree;
}

function registerPstFolders(session: PstArchiveSession): void {
  for (const folderId of session.foldersById.keys()) {
    folderToArchive.set(folderId, { kind: 'pst', archiveId: session.archiveId });
  }
}

function getImportedSummaries(): MessageSummary[] {
  const list: MessageSummary[] = [];
  for (const id of importedOrder) {
    const rec = importedRecords.get(id);
    if (rec) list.push(rec.summary);
  }
  return list.sort((a, b) => b.timestamp - a.timestamp);
}

function countPstTotalMessages(session: PstArchiveSession): number {
  let total = 0;
  for (const meta of session.foldersById.values()) {
    total += meta.node.totalCount;
  }
  return total;
}

async function resolveMessageDetail(messageId: string): Promise<MessageDetail | null> {
  const imported = importedRecords.get(messageId);
  if (imported) {
    return imported.detail;
  }

  for (const mbox of mboxSessions.values()) {
    if (mbox.spansById.has(messageId)) {
      return await loadMboxMessageDetail(mbox, messageId);
    }
  }

  const pstId = parsePstMessageId(messageId);
  if (pstId) {
    const pst = pstSessions.get(pstId.archiveId);
    if (pst) {
      return await loadPstMessageDetail(pst, messageId);
    }
  }

  return null;
}

async function readMessageBodyForSearch(msg: MessageSummary): Promise<string> {
  if (msg.format === 'msg' || msg.format === 'eml') {
    const rec = importedRecords.get(msg.id);
    return rec?.detail.textBody || rec?.detail.htmlBody || '';
  }
  if (msg.format === 'mbox') {
    const mbox = mboxSessions.get(msg.archiveId);
    if (!mbox) return '';
    return await readMboxMessageBodyText(mbox, msg.id);
  }
  const pst = pstSessions.get(msg.archiveId);
  const parsed = parsePstMessageId(msg.id);
  if (!pst || !parsed) return '';
  return await readPstMessageBodyText(pst, parsed.msgNid);
}

function buildMatchSnippet(text: string, queryLower: string): string {
  const idx = text.toLowerCase().indexOf(queryLower);
  if (idx === -1) return '';
  const start = Math.max(0, idx - 45);
  const end = Math.min(text.length, idx + queryLower.length + 95);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

function matchesMetadata(
  msg: MessageSummary,
  filter: SearchFilter,
  queryLower: string,
  fromTs: number | null,
  toTs: number | null,
): { passesPreFilter: boolean; matchesHeaderText: boolean } {
  if (filter.hasAttachmentsOnly && !msg.hasAttachments) {
    return { passesPreFilter: false, matchesHeaderText: false };
  }
  if (fromTs !== null && !Number.isNaN(fromTs) && (msg.timestamp === 0 || msg.timestamp < fromTs)) {
    return { passesPreFilter: false, matchesHeaderText: false };
  }
  if (toTs !== null && !Number.isNaN(toTs) && (msg.timestamp === 0 || msg.timestamp > toTs)) {
    return { passesPreFilter: false, matchesHeaderText: false };
  }
  if (!queryLower) {
    return { passesPreFilter: true, matchesHeaderText: true };
  }

  const headerHit =
    msg.subject.toLowerCase().includes(queryLower) ||
    msg.senderName.toLowerCase().includes(queryLower) ||
    msg.senderAddress.toLowerCase().includes(queryLower) ||
    msg.toSummary.toLowerCase().includes(queryLower) ||
    (msg.date ? msg.date.toLowerCase().includes(queryLower) : false) ||
    msg.snippet.toLowerCase().includes(queryLower);

  return { passesPreFilter: true, matchesHeaderText: headerHit };
}

async function streamFolderToClient(requestId: string, folderId: string): Promise<void> {
  const isCancelled = () => cancelledRequests.has(requestId);

  if (folderId === VIRTUAL_IMPORTED_FOLDER_ID) {
    const all = getImportedSummaries();
    post({
      type: 'FOLDER_MESSAGES_BATCH',
      requestId,
      folderId,
      batch: all,
      loadedCount: all.length,
      totalCount: all.length,
      done: true,
    });
    return;
  }

  const ref = folderToArchive.get(folderId);
  if (!ref) {
    post({
      type: 'FOLDER_MESSAGES_BATCH',
      requestId,
      folderId,
      batch: [],
      loadedCount: 0,
      totalCount: 0,
      done: true,
    });
    return;
  }

  if (ref.kind === 'mbox') {
    const list = mboxSessions.get(ref.archiveId)?.messages ?? [];
    const CHUNK = 500;
    if (list.length === 0) {
      post({
        type: 'FOLDER_MESSAGES_BATCH',
        requestId,
        folderId,
        batch: [],
        loadedCount: 0,
        totalCount: 0,
        done: true,
      });
      return;
    }
    for (let i = 0; i < list.length; i += CHUNK) {
      if (isCancelled()) {
        post({
          type: 'FOLDER_MESSAGES_BATCH',
          requestId,
          folderId,
          batch: [],
          loadedCount: i,
          totalCount: list.length,
          done: true,
          cancelled: true,
        });
        return;
      }
      const batch = list.slice(i, i + CHUNK);
      const loadedCount = Math.min(i + batch.length, list.length);
      const isLast = loadedCount >= list.length;
      post({
        type: 'FOLDER_MESSAGES_BATCH',
        requestId,
        folderId,
        batch,
        loadedCount,
        totalCount: list.length,
        done: isLast,
      });
      if (!isLast) await yieldTick();
    }
    return;
  }

  const pst = pstSessions.get(ref.archiveId);
  if (!pst) return;

  let lastCount = 0;
  let lastTotal = 0;
  const { cancelled } = await streamPstFolderHeaders(pst, folderId, {
    batchSize: 500,
    useCache: true,
    isCancelled,
    onBatch: async (batch, loadedCount, totalCount) => {
      lastCount = loadedCount;
      lastTotal = totalCount;
      post({
        type: 'FOLDER_MESSAGES_BATCH',
        requestId,
        folderId,
        batch,
        loadedCount,
        totalCount,
        done: false,
      });
    },
  });

  post({
    type: 'FOLDER_MESSAGES_BATCH',
    requestId,
    folderId,
    batch: [],
    loadedCount: lastCount,
    totalCount: lastTotal,
    done: true,
    cancelled,
  });
}

function collectSearchFolderIds(filter: SearchFilter): string[] {
  if (filter.scope === 'folder') {
    return filter.folderId ? [filter.folderId] : [];
  }
  const ids: string[] = [];
  if (importedOrder.length > 0) ids.push(VIRTUAL_IMPORTED_FOLDER_ID);
  for (const pst of pstSessions.values()) {
    for (const folderId of pst.allFolderIds) {
      const meta = pst.foldersById.get(folderId);
      if (meta && meta.node.totalCount > 0) {
        ids.push(folderId);
      }
    }
  }
  for (const mbox of mboxSessions.values()) {
    ids.push(mbox.folderNode.id);
  }
  return ids;
}

async function handleStreamingSearch(requestId: string, filter: SearchFilter): Promise<void> {
  const isCancelled = () => cancelledRequests.has(requestId);
  const queryLower = filter.query.trim().toLowerCase();
  const fromTs = filter.dateFrom ? new Date(`${filter.dateFrom}T00:00:00`).getTime() : null;
  const toTs = filter.dateTo ? new Date(`${filter.dateTo}T23:59:59.999`).getTime() : null;
  const targetFolderIds = collectSearchFolderIds(filter);

  const totalFolders = targetFolderIds.length;
  let totalMessagesEst = 0;
  for (const fId of targetFolderIds) {
    if (fId === VIRTUAL_IMPORTED_FOLDER_ID) totalMessagesEst += importedOrder.length;
    else {
      const ref = folderToArchive.get(fId);
      if (ref?.kind === 'mbox') {
        totalMessagesEst += mboxSessions.get(ref.archiveId)?.messages.length ?? 0;
      } else if (ref?.kind === 'pst') {
        totalMessagesEst += pstSessions.get(ref.archiveId)?.foldersById.get(fId)?.node.totalCount ?? 0;
      }
    }
  }

  let scannedFolders = 0;
  let scannedMessages = 0;

  const processBatch = async (headers: MessageSummary[]) => {
    const matched: MessageSummary[] = [];
    let bodyReadsInTick = 0;

    for (const msg of headers) {
      if (isCancelled()) break;
      scannedMessages += 1;

      const { passesPreFilter, matchesHeaderText } = matchesMetadata(
        msg,
        filter,
        queryLower,
        fromTs,
        toTs,
      );
      if (!passesPreFilter) continue;

      if (matchesHeaderText) {
        matched.push(msg);
        continue;
      }

      if (filter.searchBodies && queryLower) {
        // Stream body check for this message and immediately let body string be GC'd
        const bodyText = await readMessageBodyForSearch(msg);
        bodyReadsInTick += 1;
        if (bodyText && bodyText.toLowerCase().includes(queryLower)) {
          const hitSnippet = buildMatchSnippet(bodyText, queryLower);
          matched.push(hitSnippet ? { ...msg, snippet: hitSnippet } : msg);
        }
        if (bodyReadsInTick >= 25) {
          bodyReadsInTick = 0;
          if (matched.length > 0) {
            post({
              type: 'SEARCH_RESULTS_BATCH',
              requestId,
              batch: matched.splice(0, matched.length),
              scannedFolders,
              totalFolders,
              scannedMessages,
              totalMessages: Math.max(totalMessagesEst, scannedMessages),
              done: false,
            });
          } else {
            post({
              type: 'SEARCH_RESULTS_BATCH',
              requestId,
              batch: [],
              scannedFolders,
              totalFolders,
              scannedMessages,
              totalMessages: Math.max(totalMessagesEst, scannedMessages),
              done: false,
            });
          }
          await yieldTick();
        }
      }
    }

    if (!isCancelled()) {
      post({
        type: 'SEARCH_RESULTS_BATCH',
        requestId,
        batch: matched,
        scannedFolders,
        totalFolders,
        scannedMessages,
        totalMessages: Math.max(totalMessagesEst, scannedMessages),
        done: false,
      });
    }
  };

  for (let fIdx = 0; fIdx < targetFolderIds.length; fIdx += 1) {
    if (isCancelled()) break;
    const fId = targetFolderIds[fIdx];

    if (fId === VIRTUAL_IMPORTED_FOLDER_ID) {
      await processBatch(getImportedSummaries());
    } else {
      const ref = folderToArchive.get(fId);
      if (ref?.kind === 'mbox') {
        const list = mboxSessions.get(ref.archiveId)?.messages ?? [];
        for (let i = 0; i < list.length; i += 250) {
          if (isCancelled()) break;
          await processBatch(list.slice(i, i + 250));
          await yieldTick();
        }
      } else if (ref?.kind === 'pst') {
        const pst = pstSessions.get(ref.archiveId);
        if (pst) {
          await streamPstFolderHeaders(pst, fId, {
            batchSize: 500,
            // Avoid polluting headerCache during full-archive sweeps
            useCache: filter.scope === 'folder',
            isCancelled,
            onBatch: async (batch) => {
              await processBatch(batch);
            },
          });
        }
      }
    }

    scannedFolders = fIdx + 1;
    await yieldTick();
  }

  post({
    type: 'SEARCH_RESULTS_BATCH',
    requestId,
    batch: [],
    scannedFolders,
    totalFolders,
    scannedMessages,
    totalMessages: Math.max(totalMessagesEst, scannedMessages),
    done: true,
    cancelled: isCancelled(),
  });
}

async function collectAllFolderHeadersForExport(folderId: string): Promise<MessageSummary[]> {
  if (folderId === VIRTUAL_IMPORTED_FOLDER_ID) {
    return getImportedSummaries();
  }
  const ref = folderToArchive.get(folderId);
  if (!ref) return [];
  if (ref.kind === 'mbox') {
    return mboxSessions.get(ref.archiveId)?.messages ?? [];
  }
  const pst = pstSessions.get(ref.archiveId);
  if (!pst) return [];
  const out: MessageSummary[] = [];
  await streamPstFolderHeaders(pst, folderId, {
    batchSize: 500,
    useCache: false,
    onBatch: (batch) => {
      out.push(...batch);
    },
  });
  return out;
}

async function handleLoadFiles(requestId: string, files: File[]): Promise<void> {
  const warnings: string[] = [];
  let defaultFolderId: string | null = null;

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const ext = getExtension(file.name);
    archiveSeq += 1;
    const archiveId = `arch-${archiveSeq}`;

    emitProgress(
      requestId,
      `Opening ${file.name}…`,
      files.length > 1 ? i : 0,
      files.length > 1 ? files.length : 0,
    );

    try {
      if (ext === 'pst' || ext === 'ost') {
        const { session, defaultFolderId: pstDefault } = await openPstArchive(
          file,
          archiveId,
          ext,
          (label) => emitProgress(requestId, label, 0, 0),
        );
        pstSessions.set(archiveId, session);
        registerPstFolders(session);
        if (!defaultFolderId) defaultFolderId = pstDefault;
        loadedArchives.push({
          id: archiveId,
          name: file.name,
          format: ext,
          size: file.size,
          messageCount: countPstTotalMessages(session),
        });
      } else if (ext === 'msg') {
        const parsed = await parseMsgFile(file, archiveId, VIRTUAL_IMPORTED_FOLDER_ID);
        importedRecords.set(parsed.summary.id, parsed);
        importedOrder.push(parsed.summary.id);
        if (!defaultFolderId) defaultFolderId = VIRTUAL_IMPORTED_FOLDER_ID;
        loadedArchives.push({
          id: archiveId,
          name: file.name,
          format: 'msg',
          size: file.size,
          messageCount: 1,
        });
      } else if (ext === 'eml') {
        const parsed = await parseEmlFile(file, archiveId, VIRTUAL_IMPORTED_FOLDER_ID);
        importedRecords.set(parsed.summary.id, parsed);
        importedOrder.push(parsed.summary.id);
        if (!defaultFolderId) defaultFolderId = VIRTUAL_IMPORTED_FOLDER_ID;
        loadedArchives.push({
          id: archiveId,
          name: file.name,
          format: 'eml',
          size: file.size,
          messageCount: 1,
        });
      } else if (ext === 'mbox') {
        const session = await indexMboxFile(file, archiveId, (bytesRead, totalBytes) => {
          emitProgress(requestId, `Scanning ${file.name}…`, bytesRead, totalBytes);
        });
        mboxSessions.set(archiveId, session);
        folderToArchive.set(session.folderNode.id, { kind: 'mbox', archiveId });
        if (!defaultFolderId) defaultFolderId = session.folderNode.id;
        loadedArchives.push({
          id: archiveId,
          name: file.name,
          format: 'mbox',
          size: file.size,
          messageCount: session.messages.length,
        });
      } else {
        warnings.push(`Unsupported file extension ".${ext || 'unknown'}" for ${file.name}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Could not parse ${file.name}: ${msg}`);
    }
  }

  const folders = buildFolderTree();
  if (!defaultFolderId && folders.length > 0) {
    defaultFolderId = folders[0].id;
  }

  post({
    type: 'FILES_LOADED',
    requestId,
    archives: [...loadedArchives],
    folders,
    defaultFolderId,
    warnings,
  });
}

async function handleClearSession(requestId: string): Promise<void> {
  for (const pst of pstSessions.values()) {
    pst.headerCache.clear();
    pst.engine.clearCaches();
    await pst.engine.close().catch(() => undefined);
  }
  pstSessions.clear();
  mboxSessions.clear();
  importedRecords.clear();
  importedOrder.length = 0;
  loadedArchives.length = 0;
  folderToArchive.clear();
  cancelledRequests.clear();
  post({ type: 'SESSION_CLEARED', requestId });
}

async function dispatchRequest(req: WorkerRequest): Promise<void> {
  try {
    switch (req.type) {
      case 'CANCEL_TASK': {
        cancelledRequests.add(req.targetRequestId);
        post({ type: 'TASK_CANCELLED', requestId: req.requestId });
        break;
      }
      case 'LOAD_FILES': {
        await handleLoadFiles(req.requestId, req.files);
        break;
      }
      case 'GET_FOLDER_MESSAGES': {
        await streamFolderToClient(req.requestId, req.folderId);
        cancelledRequests.delete(req.requestId);
        break;
      }
      case 'SEARCH_MESSAGES': {
        await handleStreamingSearch(req.requestId, req.filter);
        cancelledRequests.delete(req.requestId);
        break;
      }
      case 'GET_MESSAGE_DETAIL': {
        const detail = await resolveMessageDetail(req.messageId);
        if (!detail) {
          post({
            type: 'ERROR',
            requestId: req.requestId,
            message: 'Message could not be located in memory.',
          });
          return;
        }
        post({ type: 'MESSAGE_DETAIL', requestId: req.requestId, detail });
        break;
      }
      case 'EXPORT_EML': {
        const detail = await resolveMessageDetail(req.messageId);
        if (!detail) {
          post({
            type: 'ERROR',
            requestId: req.requestId,
            message: 'Message not found for export.',
          });
          return;
        }
        const bytes = serializeMessageToEml(detail);
        const filename = sanitizeExportFilename(detail.subject || 'message', '.eml');
        post({ type: 'EML_EXPORTED', requestId: req.requestId, filename, bytes }, [bytes.buffer]);
        break;
      }
      case 'EXPORT_FOLDER_ZIP': {
        const messages = await collectAllFolderHeadersForExport(req.folderId);
        const zip = new JSZip();
        const usedNames = new Map<string, number>();

        for (let i = 0; i < messages.length; i += 1) {
          if (i === 0 || i % 10 === 0 || i === messages.length - 1) {
            emitProgress(req.requestId, 'Bundling .eml archive…', i + 1, messages.length);
          }
          const detail = await resolveMessageDetail(messages[i].id);
          if (!detail) continue;
          const baseName = sanitizeExportFilename(detail.subject || `message-${i + 1}`, '.eml');
          const count = usedNames.get(baseName) ?? 0;
          usedNames.set(baseName, count + 1);
          const uniqueName =
            count === 0 ? baseName : baseName.replace(/\.eml$/i, ` (${count + 1}).eml`);
          zip.file(uniqueName, serializeMessageToEml(detail));
        }

        const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
        const filename = sanitizeExportFilename(`postbox-folder-${Date.now()}`, '.zip');
        post(
          { type: 'FOLDER_ZIP_EXPORTED', requestId: req.requestId, filename, bytes },
          [bytes.buffer],
        );
        break;
      }
      case 'CLEAR_SESSION': {
        await handleClearSession(req.requestId);
        break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: 'ERROR', requestId: req.requestId, message });
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  void dispatchRequest(event.data);
};
