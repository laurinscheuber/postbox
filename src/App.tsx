import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DropzoneScreen } from './components/DropzoneScreen';
import { MailWorkspace } from './components/MailWorkspace';
import type { ListScanProgress } from './components/MessageList';
import { TopBar } from './components/TopBar';
import type {
  FolderNode,
  LoadedArchiveInfo,
  MessageDetail,
  MessageSortOrder,
  MessageSummary,
  SearchFilter,
  WorkerProgressEvent,
} from './types/mail';
import { triggerBlobDownload } from './utils/formatters';
import { createSampleMboxFile } from './utils/sampleArchive';
import { sortMessages } from './utils/sortMessages';
import {
  applyColorSchemePreference,
  getStoredColorScheme,
  getSystemDarkMatch,
  resolveEffectiveTheme,
  type ColorSchemePreference,
} from './utils/theme';
import { MailWorkerClient, type StreamHandle } from './worker/workerClient';

function findFolderName(nodes: FolderNode[], id: string | null): string {
  if (!id) return 'Messages';
  for (const node of nodes) {
    if (node.id === id) return node.name;
    const child = findFolderName(node.children, id);
    if (child !== 'Messages') return child;
  }
  return 'Messages';
}

const DEFAULT_FILTER: SearchFilter = {
  folderId: '',
  scope: 'folder',
  searchBodies: false,
  query: '',
  dateFrom: '',
  dateTo: '',
  hasAttachmentsOnly: false,
};

export default function App() {
  const workerRef = useRef<MailWorkerClient | null>(null);
  const activeObjectUrlsRef = useRef<Set<string>>(new Set());
  const activeStreamRef = useRef<StreamHandle | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedMessageIdRef = useRef<string | null>(null);

  if (!workerRef.current) {
    workerRef.current = new MailWorkerClient();
  }

  const [colorScheme, setColorScheme] = useState<ColorSchemePreference>(() =>
    getStoredColorScheme(),
  );
  const [systemDark, setSystemDark] = useState<boolean>(() => getSystemDarkMatch());
  const effectiveTheme = resolveEffectiveTheme(colorScheme, systemDark);

  const [archives, setArchives] = useState<LoadedArchiveInfo[]>([]);
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [activeDetail, setActiveDetail] = useState<MessageDetail | null>(null);

  const [filter, setFilter] = useState<SearchFilter>(DEFAULT_FILTER);
  const [sortOrder, setSortOrder] = useState<MessageSortOrder>('desc');
  const sortOrderRef = useRef<MessageSortOrder>('desc');
  sortOrderRef.current = sortOrder;
  const [sortAnnouncement, setSortAnnouncement] = useState('');
  const userSelectedDuringStreamRef = useRef(false);

  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isFolderLoading, setIsFolderLoading] = useState(false);
  const [scanProgress, setScanProgress] = useState<ListScanProgress | null>(null);
  const [isMessageLoading, setIsMessageLoading] = useState(false);
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  selectedMessageIdRef.current = selectedMessageId;

  const revokeAllActiveObjectUrls = useCallback(() => {
    for (const url of activeObjectUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    activeObjectUrlsRef.current.clear();
  }, []);

  const cancelActiveStream = useCallback(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    if (activeStreamRef.current) {
      activeStreamRef.current.cancel();
      activeStreamRef.current = null;
    }
    setScanProgress(null);
    setIsFolderLoading(false);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onSystemChange);

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'color-scheme') {
        setColorScheme(getStoredColorScheme());
      }
    };
    window.addEventListener('storage', onStorage);

    const onUnload = () => {
      revokeAllActiveObjectUrls();
      workerRef.current?.dispose();
    };
    window.addEventListener('beforeunload', onUnload);

    return () => {
      mq.removeEventListener('change', onSystemChange);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [revokeAllActiveObjectUrls]);

  const handleColorSchemeChange = (pref: ColorSchemePreference) => {
    setColorScheme(pref);
    applyColorSchemePreference(pref);
  };

  const registerObjectUrls = useCallback((urls: string[]) => {
    for (const url of urls) {
      activeObjectUrlsRef.current.add(url);
    }
  }, []);

  const revokeObjectUrls = useCallback((urls: string[]) => {
    for (const url of urls) {
      URL.revokeObjectURL(url);
      activeObjectUrlsRef.current.delete(url);
    }
  }, []);

  const handleProgress = useCallback((ev: WorkerProgressEvent) => {
    if (ev.total > 0) {
      const pct = Math.min(100, Math.round((ev.current / ev.total) * 100));
      setProgressText(`${ev.label} (${pct}%)`);
    } else {
      setProgressText(ev.label);
    }
  }, []);

  const handleSelectMessage = useCallback(
    async (messageId: string) => {
      const client = workerRef.current;
      if (!client) return;

      // Immediately revoke any Blob URLs belonging to the previous email
      revokeAllActiveObjectUrls();

      setSelectedMessageId(messageId);
      setIsMessageLoading(true);
      try {
        const detail = await client.getMessageDetail(messageId);
        if (selectedMessageIdRef.current === messageId) {
          setActiveDetail(detail);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setWarnings((prev) => [...prev, msg]);
      } finally {
        if (selectedMessageIdRef.current === messageId) {
          setIsMessageLoading(false);
        }
      }
    },
    [revokeAllActiveObjectUrls],
  );

  const handleUserSelectMessage = useCallback(
    (messageId: string) => {
      userSelectedDuringStreamRef.current = true;
      void handleSelectMessage(messageId);
    },
    [handleSelectMessage],
  );

  const streamFolder = useCallback(
    (folderId: string) => {
      const client = workerRef.current;
      if (!client) return;

      cancelActiveStream();
      revokeAllActiveObjectUrls();
      userSelectedDuringStreamRef.current = false;
      setSortAnnouncement('');

      setSelectedFolderId(folderId);
      setFilter({ ...DEFAULT_FILTER, folderId });
      setMessages([]);
      setActiveDetail(null);
      setSelectedMessageId(null);
      setIsFolderLoading(true);
      setScanProgress({
        mode: 'folder',
        scannedFolders: 0,
        totalFolders: 1,
        scannedMessages: 0,
        totalMessages: 0,
      });

      let firstBatchHandled = false;
      let accumulated: MessageSummary[] = [];
      let batchesSinceSort = 0;

      const handle = client.streamFolderMessages(folderId, (update) => {
        if (activeStreamRef.current?.requestId !== handle.requestId) return;

        if (update.batch.length > 0) {
          accumulated.push(...update.batch);
          batchesSinceSort += 1;

          if (accumulated.length <= 15000 || batchesSinceSort >= 4 || update.done) {
            accumulated = sortMessages(accumulated, sortOrderRef.current);
            batchesSinceSort = 0;
            setMessages(accumulated);
          } else {
            setMessages([...accumulated]);
          }

          if (!firstBatchHandled && accumulated.length > 0) {
            firstBatchHandled = true;
            void handleSelectMessage(accumulated[0].id);
          }
        }

        if (update.done) {
          if (batchesSinceSort > 0) {
            accumulated = sortMessages(accumulated, sortOrderRef.current);
            batchesSinceSort = 0;
            setMessages(accumulated);
          }
          if (
            !userSelectedDuringStreamRef.current &&
            accumulated.length > 0 &&
            accumulated[0].id !== selectedMessageIdRef.current
          ) {
            void handleSelectMessage(accumulated[0].id);
          }
          setIsFolderLoading(false);
          setScanProgress(null);
          activeStreamRef.current = null;
        } else {
          setScanProgress({
            mode: 'folder',
            scannedFolders: 0,
            totalFolders: 1,
            scannedMessages: update.loadedCount,
            totalMessages: update.totalCount,
          });
        }
      });

      activeStreamRef.current = handle;
      handle.promise.catch((err) => {
        if (activeStreamRef.current?.requestId === handle.requestId) {
          const msg = err instanceof Error ? err.message : String(err);
          setWarnings((prev) => [...prev, msg]);
          setIsFolderLoading(false);
          setScanProgress(null);
        }
      });
    },
    [cancelActiveStream, handleSelectMessage, revokeAllActiveObjectUrls],
  );

  const handleFilesSelected = async (files: File[]) => {
    const client = workerRef.current;
    if (!client || files.length === 0) return;
    setIsLoadingFiles(true);
    setWarnings([]);

    try {
      const res = await client.loadFiles(files, handleProgress);
      setArchives(res.archives);
      setFolders(res.folders);
      if (res.warnings.length > 0) {
        setWarnings(res.warnings);
      }
      const targetFolder = selectedFolderId || res.defaultFolderId;
      if (targetFolder) {
        streamFolder(targetFolder);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setWarnings([msg]);
    } finally {
      setIsLoadingFiles(false);
      setProgressText(null);
    }
  };

  const handleLoadSample = () => {
    const sampleFile = createSampleMboxFile();
    void handleFilesSelected([sampleFile]);
  };

  const runSearchStream = useCallback(
    (nextFilter: SearchFilter) => {
      const client = workerRef.current;
      if (!client) return;

      const isEmptyFolderFilter =
        nextFilter.scope === 'folder' &&
        !nextFilter.query.trim() &&
        !nextFilter.dateFrom &&
        !nextFilter.dateTo &&
        !nextFilter.hasAttachmentsOnly;

      if (isEmptyFolderFilter) {
        if (nextFilter.folderId) {
          streamFolder(nextFilter.folderId);
        }
        return;
      }

      cancelActiveStream();
      setMessages([]);
      setSortAnnouncement('');
      setIsFolderLoading(true);
      setScanProgress({
        mode: 'search',
        scannedFolders: 0,
        totalFolders: 0,
        scannedMessages: 0,
        totalMessages: 0,
      });

      let accumulated: MessageSummary[] = [];
      let batchesSinceSort = 0;

      const handle = client.streamSearchMessages(nextFilter, (update) => {
        if (activeStreamRef.current?.requestId !== handle.requestId) return;

        if (update.batch.length > 0) {
          accumulated.push(...update.batch);
          batchesSinceSort += 1;

          if (accumulated.length <= 15000 || batchesSinceSort >= 4 || update.done) {
            accumulated = sortMessages(accumulated, sortOrderRef.current);
            batchesSinceSort = 0;
            setMessages(accumulated);
          } else {
            setMessages([...accumulated]);
          }
        }

        if (update.done) {
          if (batchesSinceSort > 0) {
            accumulated = sortMessages(accumulated, sortOrderRef.current);
            batchesSinceSort = 0;
            setMessages(accumulated);
          }
          setIsFolderLoading(false);
          setScanProgress(null);
          activeStreamRef.current = null;
        } else {
          setScanProgress({
            mode: 'search',
            scannedFolders: update.scannedFolders,
            totalFolders: update.totalFolders,
            scannedMessages: update.scannedMessages,
            totalMessages: update.totalMessages,
          });
        }
      });

      activeStreamRef.current = handle;
      handle.promise.catch((err) => {
        if (activeStreamRef.current?.requestId === handle.requestId) {
          const msg = err instanceof Error ? err.message : String(err);
          setWarnings((prev) => [...prev, msg]);
          setIsFolderLoading(false);
          setScanProgress(null);
        }
      });
    },
    [cancelActiveStream, streamFolder],
  );

  const handleFilterChange = useCallback(
    (partial: Partial<SearchFilter>) => {
      if (!selectedFolderId && partial.scope !== 'archive') return;

      const next: SearchFilter = {
        ...filter,
        ...partial,
        folderId: selectedFolderId || filter.folderId,
      };
      setFilter(next);

      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
      const delay = next.searchBodies ? 350 : 180;
      searchDebounceRef.current = setTimeout(() => {
        runSearchStream(next);
      }, delay);
    },
    [filter, runSearchStream, selectedFolderId],
  );

  const handleToggleSortOrder = useCallback(() => {
    const nextOrder: MessageSortOrder = sortOrderRef.current === 'desc' ? 'asc' : 'desc';
    sortOrderRef.current = nextOrder;
    setSortOrder(nextOrder);
    setMessages((prev) => {
      const sorted = sortMessages(prev, nextOrder);
      setSortAnnouncement(
        `Sorted by date, ${nextOrder === 'desc' ? 'newest first' : 'oldest first'}, ${sorted.length.toLocaleString()} messages`,
      );
      return sorted;
    });
  }, []);

  const handleExportEml = async (messageId: string) => {
    const client = workerRef.current;
    if (!client) return;
    try {
      const { filename, bytes } = await client.exportEml(messageId);
      triggerBlobDownload(bytes, 'message/rfc822', filename);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setWarnings((prev) => [...prev, msg]);
    }
  };

  const handleExportFolderZip = async () => {
    const client = workerRef.current;
    if (!client || !selectedFolderId) return;
    setIsExportingZip(true);
    try {
      const { filename, bytes } = await client.exportFolderZip(selectedFolderId, handleProgress);
      triggerBlobDownload(bytes, 'application/zip', filename);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setWarnings((prev) => [...prev, msg]);
    } finally {
      setIsExportingZip(false);
      setProgressText(null);
    }
  };

  const handleClearSession = async () => {
    cancelActiveStream();
    revokeAllActiveObjectUrls();

    await workerRef.current?.resetSession();
    setArchives([]);
    setFolders([]);
    setSelectedFolderId(null);
    setMessages([]);
    setSelectedMessageId(null);
    setActiveDetail(null);
    setFilter(DEFAULT_FILTER);
    setSortAnnouncement('');
    setWarnings([]);
    setProgressText(null);
  };

  const selectedFolderName = useMemo(
    () => findFolderName(folders, selectedFolderId),
    [folders, selectedFolderId],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar
        archives={archives}
        colorScheme={colorScheme}
        effectiveTheme={effectiveTheme}
        onColorSchemeChange={handleColorSchemeChange}
        onAddFiles={handleFilesSelected}
        onClearSession={handleClearSession}
      />

      {archives.length === 0 ? (
        <DropzoneScreen
          onFilesSelected={handleFilesSelected}
          onLoadSample={handleLoadSample}
          isLoading={isLoadingFiles}
          progressText={progressText}
          errorMessages={warnings}
        />
      ) : (
        <MailWorkspace
          folders={folders}
          selectedFolderId={selectedFolderId}
          selectedFolderName={selectedFolderName}
          messages={messages}
          selectedMessageId={selectedMessageId}
          activeDetail={activeDetail}
          filter={filter}
          sortOrder={sortOrder}
          sortAnnouncement={sortAnnouncement}
          theme={effectiveTheme}
          isFolderLoading={isFolderLoading}
          scanProgress={scanProgress}
          isMessageLoading={isMessageLoading}
          isExportingZip={isExportingZip}
          progressText={progressText}
          warnings={warnings}
          onDismissWarnings={() => setWarnings([])}
          onSelectFolder={streamFolder}
          onSelectMessage={handleUserSelectMessage}
          onFilterChange={handleFilterChange}
          onToggleSortOrder={handleToggleSortOrder}
          onCancelScan={cancelActiveStream}
          onExportEml={handleExportEml}
          onExportFolderZip={handleExportFolderZip}
          registerObjectUrls={registerObjectUrls}
          revokeObjectUrls={revokeObjectUrls}
        />
      )}
    </div>
  );
}
