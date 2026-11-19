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

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  onProgress?: (event: WorkerProgressEvent) => void;
};

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

  private send<T extends WorkerResponse>(
    payload: DistributeOmit<WorkerRequest, 'requestId'>,
    onProgress?: (event: WorkerProgressEvent) => void,
  ): Promise<T> {
    this.reqCounter += 1;
    const requestId = `req-${this.reqCounter}`;
    const message = { ...payload, requestId } as WorkerRequest;

    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
        onProgress,
      });
      this.worker.postMessage(message);
    });
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
      onProgress,
    );
    return {
      archives: res.archives,
      folders: res.folders,
      defaultFolderId: res.defaultFolderId,
      warnings: res.warnings,
    };
  }

  async getFolderMessages(
    folderId: string,
    onProgress?: (event: WorkerProgressEvent) => void,
  ): Promise<MessageSummary[]> {
    const res = await this.send<Extract<WorkerResponse, { type: 'FOLDER_MESSAGES' }>>(
      { type: 'GET_FOLDER_MESSAGES', folderId },
      onProgress,
    );
    return res.messages;
  }

  async searchMessages(
    filter: SearchFilter,
    onProgress?: (event: WorkerProgressEvent) => void,
  ): Promise<MessageSummary[]> {
    const res = await this.send<Extract<WorkerResponse, { type: 'SEARCH_RESULTS' }>>(
      { type: 'SEARCH_MESSAGES', filter },
      onProgress,
    );
    return res.messages;
  }

  async getMessageDetail(messageId: string): Promise<MessageDetail> {
    const res = await this.send<Extract<WorkerResponse, { type: 'MESSAGE_DETAIL' }>>({
      type: 'GET_MESSAGE_DETAIL',
      messageId,
    });
    return res.detail;
  }

  async exportEml(messageId: string): Promise<{ filename: string; bytes: Uint8Array }> {
    const res = await this.send<Extract<WorkerResponse, { type: 'EML_EXPORTED' }>>({
      type: 'EXPORT_EML',
      messageId,
    });
    return { filename: res.filename, bytes: res.bytes };
  }

  async exportFolderZip(
    folderId: string,
    onProgress?: (event: WorkerProgressEvent) => void,
  ): Promise<{ filename: string; bytes: Uint8Array }> {
    const res = await this.send<Extract<WorkerResponse, { type: 'FOLDER_ZIP_EXPORTED' }>>(
      { type: 'EXPORT_FOLDER_ZIP', folderId },
      onProgress,
    );
    return { filename: res.filename, bytes: res.bytes };
  }

  /**
   * Immediately terminates the existing worker (releasing all WASM/JS heap allocations)
   * and spawns a clean fresh worker instance.
   */
  async resetSession(): Promise<void> {
    try {
      await this.send<Extract<WorkerResponse, { type: 'SESSION_CLEARED' }>>({
        type: 'CLEAR_SESSION',
      });
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
