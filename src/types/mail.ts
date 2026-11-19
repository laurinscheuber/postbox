export type ArchiveFormat = 'pst' | 'ost' | 'msg' | 'eml' | 'mbox';

export type FolderKind =
  | 'root'
  | 'inbox'
  | 'sent'
  | 'trash'
  | 'drafts'
  | 'archive'
  | 'junk'
  | 'imported'
  | 'custom';

export interface FolderNode {
  id: string;
  archiveId: string;
  archiveName: string;
  name: string;
  path: string;
  kind: FolderKind;
  totalCount: number;
  unreadCount: number;
  children: FolderNode[];
}

export interface EmailAddress {
  name: string;
  address: string;
}

export interface MessageSummary {
  id: string;
  folderId: string;
  archiveId: string;
  format: ArchiveFormat;
  subject: string;
  senderName: string;
  senderAddress: string;
  toSummary: string;
  date: string | null;
  timestamp: number;
  snippet: string;
  hasAttachments: boolean;
  isRead: boolean;
  size?: number;
}

export interface AttachmentItem {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId?: string;
  isInline: boolean;
  data: Uint8Array;
}

export interface MapiPropertyItem {
  tag: string;
  name: string;
  type: string;
  value: string;
}

export interface MessageDetail extends MessageSummary {
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  headersRaw: string;
  htmlBody?: string;
  textBody?: string;
  rawSource?: string;
  mapiProperties?: MapiPropertyItem[];
  attachments: AttachmentItem[];
}

export interface SearchFilter {
  folderId: string;
  query: string;
  dateFrom: string;
  dateTo: string;
  hasAttachmentsOnly: boolean;
}

export interface LoadedArchiveInfo {
  id: string;
  name: string;
  format: ArchiveFormat;
  size: number;
  messageCount: number;
}

export type WorkerRequest =
  | { type: 'LOAD_FILES'; requestId: string; files: File[] }
  | { type: 'GET_FOLDER_MESSAGES'; requestId: string; folderId: string }
  | { type: 'SEARCH_MESSAGES'; requestId: string; filter: SearchFilter }
  | { type: 'GET_MESSAGE_DETAIL'; requestId: string; messageId: string }
  | { type: 'EXPORT_EML'; requestId: string; messageId: string }
  | { type: 'EXPORT_FOLDER_ZIP'; requestId: string; folderId: string }
  | { type: 'CLEAR_SESSION'; requestId: string };

export type WorkerProgressEvent = {
  type: 'PROGRESS';
  requestId: string;
  label: string;
  current: number;
  total: number;
};

export type WorkerResponse =
  | WorkerProgressEvent
  | {
      type: 'FILES_LOADED';
      requestId: string;
      archives: LoadedArchiveInfo[];
      folders: FolderNode[];
      defaultFolderId: string | null;
      warnings: string[];
    }
  | {
      type: 'FOLDER_MESSAGES';
      requestId: string;
      folderId: string;
      messages: MessageSummary[];
    }
  | {
      type: 'SEARCH_RESULTS';
      requestId: string;
      folderId: string;
      messages: MessageSummary[];
    }
  | {
      type: 'MESSAGE_DETAIL';
      requestId: string;
      detail: MessageDetail;
    }
  | {
      type: 'EML_EXPORTED';
      requestId: string;
      filename: string;
      bytes: Uint8Array;
    }
  | {
      type: 'FOLDER_ZIP_EXPORTED';
      requestId: string;
      filename: string;
      bytes: Uint8Array;
    }
  | {
      type: 'SESSION_CLEARED';
      requestId: string;
    }
  | {
      type: 'ERROR';
      requestId: string;
      message: string;
    };
