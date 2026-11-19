import type {
  FolderNode,
  LoadedArchiveInfo,
  MessageDetail,
  MessageSummary,
  SearchFilter,
  WorkerProgressEvent,
  WorkerRequest,
  WorkerResponse,
} from '../types/mail';

type DistributeOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export interface FolderStreamUpdate {
  folderId: string;
  batch: MessageSummary[];
  loadedCount: number;
  totalCount: number;
  done: boolean;
  cancelled?: boolean;
}

export interface SearchStreamUpdate {
  batch: MessageSummary[];
  scannedFolders: number;
  totalFolders: number;
  scannedMessages: number;
  totalMessages: number;
  done: boolean;
  cancelled?: boolean;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  onProgress?: (event: WorkerProgressEvent) => void;
  onFolderBatch?: (update: FolderStreamUpdate) => void;
  onSearchBatch?: (update: SearchStreamUpdate) => void;
};

export interface StreamHandle {
  requestId: string;
  promise: Promise<void>;
  cancel: () => void;
}

export class MailWorkerClient {
  private worker: Worker;
  private pending = new Map<string, PendingRequest>();
  private reqCounter = 0;

  constructor() {
    this.worker = this.spawnWorker();
  }

  private spawnWorker(): Worker {
    const worker = new Worker(new URL('./mail.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      const entry = this.pending.get(msg.requestId);
      if (!entry) return;

      if (msg.type === 'PROGRESS') {
        entry.onProgress?.(msg);
        return;
      }

      if (msg.type === 'FOLDER_MESSAGES_BATCH') {
        entry.onFolderBatch?.({
          folderId: msg.folderId,
          batch: msg.batch,
          loadedCount: msg.loadedCount,
          totalCount: msg.totalCount,
          done: msg.done,
          cancelled: msg.cancelled,
        });
        if (!msg.done) return;
        this.pending.delete(msg.requestId);
        entry.resolve(undefined);
        return;
      }

      if (msg.type === 'SEARCH_RESULTS_BATCH') {
        entry.onSearchBatch?.({
          batch: msg.batch,
          scannedFolders: msg.scannedFolders,
          totalFolders: msg.totalFolders,
          scannedMessages: msg.scannedMessages,
          totalMessages: msg.totalMessages,
          done: msg.done,
          cancelled: msg.cancelled,
        });
        if (!msg.done) return;
        this.pending.delete(msg.requestId);
        entry.resolve(undefined);
        return;
      }

      this.pending.delete(msg.requestId);
      if (msg.type === 'ERROR') {
        entry.reject(new Error(msg.message));
      } else {
        entry.resolve(msg);
      }
    };

    worker.onerror = (err) => {
      const error = new Error(err.message || 'Web Worker encountered an unexpected error');
      for (const [, entry] of this.pending) {
        entry.reject(error);
      }
      this.pending.clear();
    };

    return worker;
  }

  private send<T>(
    payload: DistributeOmit<WorkerRequest, 'requestId'>,
    callbacks?: {
      onProgress?: (event: WorkerProgressEvent) => void;
      onFolderBatch?: (update: FolderStreamUpdate) => void;
      onSearchBatch?: (update: SearchStreamUpdate) => void;
    },
  ): { requestId: string; promise: Promise<T> } {
    this.reqCounter += 1;
    const requestId = `req-${this.reqCounter}`;
    const message = { ...payload, requestId } as WorkerRequest;

    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
        onProgress: callbacks?.onProgress,
        onFolderBatch: callbacks?.onFolderBatch,
        onSearchBatch: callbacks?.onSearchBatch,
      });
      this.worker.postMessage(message);
    });

    return { requestId, promise };
  }

  cancelTask(targetRequestId: string): void {
    this.reqCounter += 1;
    const requestId = `req-${this.reqCounter}`;
    this.worker.postMessage({
      type: 'CANCEL_TASK',
      requestId,
      targetRequestId,
    } satisfies WorkerRequest);
  }

  async loadFiles(
    files: File[],
    onProgress?: (event: WorkerProgressEvent) => void,
  ): Promise<{
    archives: LoadedArchiveInfo[];
    folders: FolderNode[];
    defaultFolderId: string | null;
    warnings: string[];
  }> {
    const res = await this.send<Extract<WorkerResponse, { type: 'FILES_LOADED' }>>(
      { type: 'LOAD_FILES', files },
      { onProgress },
    ).promise;
    return {
      archives: res.archives,
      folders: res.folders,
      defaultFolderId: res.defaultFolderId,
      warnings: res.warnings,
    };
  }

  streamFolderMessages(
    folderId: string,
    onBatch: (update: FolderStreamUpdate) => void,
  ): StreamHandle {
    const { requestId, promise } = this.send<void>(
      { type: 'GET_FOLDER_MESSAGES', folderId },
      { onFolderBatch: onBatch },
    );
    return {
      requestId,
      promise,
      cancel: () => this.cancelTask(requestId),
    };
  }

  streamSearchMessages(
    filter: SearchFilter,
    onBatch: (update: SearchStreamUpdate) => void,
  ): StreamHandle {
    const { requestId, promise } = this.send<void>(
      { type: 'SEARCH_MESSAGES', filter },
      { onSearchBatch: onBatch },
    );
    return {
      requestId,
      promise,
      cancel: () => this.cancelTask(requestId),
    };
  }

  async getMessageDetail(messageId: string): Promise<MessageDetail> {
    const res = await this.send<Extract<WorkerResponse, { type: 'MESSAGE_DETAIL' }>>({
      type: 'GET_MESSAGE_DETAIL',
      messageId,
    }).promise;
    return res.detail;
  }

  async exportEml(messageId: string): Promise<{ filename: string; bytes: Uint8Array }> {
    const res = await this.send<Extract<WorkerResponse, { type: 'EML_EXPORTED' }>>({
      type: 'EXPORT_EML',
      messageId,
    }).promise;
    return { filename: res.filename, bytes: res.bytes };
  }

  async exportFolderZip(
    folderId: string,
    onProgress?: (event: WorkerProgressEvent) => void,
  ): Promise<{ filename: string; bytes: Uint8Array }> {
    const res = await this.send<Extract<WorkerResponse, { type: 'FOLDER_ZIP_EXPORTED' }>>(
      { type: 'EXPORT_FOLDER_ZIP', folderId },
      { onProgress },
    ).promise;
    return { filename: res.filename, bytes: res.bytes };
  }

  /**
   * Clears LRU block cache, resets worker state, terminates the worker to release all heap RAM,
   * and spawns a clean worker instance.
   */
  async resetSession(): Promise<void> {
    try {
      await this.send<Extract<WorkerResponse, { type: 'SESSION_CLEARED' }>>({
        type: 'CLEAR_SESSION',
      }).promise;
    } catch {
      // Proceed to terminate even if worker failed
    }
    for (const [, entry] of this.pending) {
      entry.reject(new Error('Session cleared'));
    }
    this.pending.clear();
    this.worker.terminate();
    this.worker = this.spawnWorker();
  }

  dispose(): void {
    this.pending.clear();
    this.worker.terminate();
  }
}
