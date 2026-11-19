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
  type MboxArchiveSession,
  type ParsedEmlRecord,
} from './parsers/emlMboxAdapter';
import { parseMsgFile, type ParsedMsgRecord } from './parsers/msgAdapter';
import {
  loadPstFolderMessages,
  loadPstMessageDetail,
  openPstArchive,
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
const searchTextIndex = new Map<string, string>();
const folderToArchive = new Map<string, { kind: 'pst' | 'mbox'; archiveId: string }>();

let archiveSeq = 0;

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

async function resolveFolderMessages(
  folderId: string,
  requestId: string,
): Promise<MessageSummary[]> {
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
  return await loadPstFolderMessages(pst, folderId, searchTextIndex, (current, total) => {
    emitProgress(requestId, 'Indexing folder messages…', current, total);
  });
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

  for (const pst of pstSessions.values()) {
    for (const handle of pst.foldersById.values()) {
      if (handle.messageById.has(messageId)) {
        return await loadPstMessageDetail(pst, handle.node.id, messageId);
      }
    }
  }
  return null;
}

function filterMessages(messages: MessageSummary[], filter: SearchFilter): MessageSummary[] {
  const q = filter.query.trim().toLowerCase();
  const fromTs = filter.dateFrom ? new Date(`${filter.dateFrom}T00:00:00`).getTime() : null;
  const toTs = filter.dateTo ? new Date(`${filter.dateTo}T23:59:59.999`).getTime() : null;

  return messages.filter((msg) => {
    if (filter.hasAttachmentsOnly && !msg.hasAttachments) {
      return false;
    }
    if (fromTs !== null && !Number.isNaN(fromTs) && (msg.timestamp === 0 || msg.timestamp < fromTs)) {
      return false;
    }
    if (toTs !== null && !Number.isNaN(toTs) && (msg.timestamp === 0 || msg.timestamp > toTs)) {
      return false;
    }
    if (!q) return true;

    const indexed = searchTextIndex.get(msg.id);
    if (indexed) {
      return indexed.includes(q);
    }
    return (
      msg.subject.toLowerCase().includes(q) ||
      msg.senderName.toLowerCase().includes(q) ||
      msg.senderAddress.toLowerCase().includes(q) ||
      msg.toSummary.toLowerCase().includes(q) ||
      msg.snippet.toLowerCase().includes(q)
    );
  });
}

async function handleLoadFiles(requestId: string, files: File[]): Promise<void> {
  const warnings: string[] = [];
  let defaultFolderId: string | null = null;

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const ext = getExtension(file.name);
    archiveSeq += 1;
    const archiveId = `arch-${archiveSeq}`;

    emitProgress(requestId, `Opening ${file.name}…`, i, files.length);

    try {
      if (ext === 'pst' || ext === 'ost') {
        const { session, defaultFolderId: pstDefault } = await openPstArchive(
          file,
          archiveId,
          ext,
        );
        pstSessions.set(archiveId, session);
        registerPstFolders(session);
        if (!defaultFolderId) defaultFolderId = pstDefault;
        loadedArchives.push({
          id: archiveId,
          name: file.name,
          format: ext,
          size: file.size,
          messageCount: Array.from(session.foldersById.values()).reduce(
            (sum, h) => sum + h.node.totalCount,
            0,
          ),
        });
      } else if (ext === 'msg') {
        const parsed = await parseMsgFile(file, archiveId, VIRTUAL_IMPORTED_FOLDER_ID);
        importedRecords.set(parsed.summary.id, parsed);
        importedOrder.push(parsed.summary.id);
        searchTextIndex.set(parsed.summary.id, parsed.searchText);
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
        searchTextIndex.set(parsed.summary.id, parsed.searchText);
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
        for (const span of session.spansById.values()) {
          searchTextIndex.set(span.id, span.searchText);
        }
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
    await pst.closeReader().catch(() => undefined);
  }
  pstSessions.clear();
  mboxSessions.clear();
  importedRecords.clear();
  importedOrder.length = 0;
  loadedArchives.length = 0;
  searchTextIndex.clear();
  folderToArchive.clear();
  post({ type: 'SESSION_CLEARED', requestId });
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;

  try {
    switch (req.type) {
      case 'LOAD_FILES': {
        await handleLoadFiles(req.requestId, req.files);
        break;
      }
      case 'GET_FOLDER_MESSAGES': {
        const messages = await resolveFolderMessages(req.folderId, req.requestId);
        post({
          type: 'FOLDER_MESSAGES',
          requestId: req.requestId,
          folderId: req.folderId,
          messages,
        });
        break;
      }
      case 'SEARCH_MESSAGES': {
        const all = await resolveFolderMessages(req.filter.folderId, req.requestId);
        const filtered = filterMessages(all, req.filter);
        post({
          type: 'SEARCH_RESULTS',
          requestId: req.requestId,
          folderId: req.filter.folderId,
          messages: filtered,
        });
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
        post({
          type: 'MESSAGE_DETAIL',
          requestId: req.requestId,
          detail,
        });
        break;
      }
      case 'EXPORT_EML': {
        const detail = await resolveMessageDetail(req.messageId);
        if (!detail) {
          post({ type: 'ERROR', requestId: req.requestId, message: 'Message not found for export.' });
          return;
        }
        const bytes = serializeMessageToEml(detail);
        const filename = sanitizeExportFilename(detail.subject || 'message', '.eml');
        post({ type: 'EML_EXPORTED', requestId: req.requestId, filename, bytes }, [bytes.buffer]);
        break;
      }
      case 'EXPORT_FOLDER_ZIP': {
        const messages = await resolveFolderMessages(req.folderId, req.requestId);
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
};
