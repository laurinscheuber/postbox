import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DropzoneScreen } from './components/DropzoneScreen';
import { MailWorkspace } from './components/MailWorkspace';
import { TopBar } from './components/TopBar';
import type {
  FolderNode,
  LoadedArchiveInfo,
  MessageDetail,
  MessageSummary,
  SearchFilter,
  WorkerProgressEvent,
} from './types/mail';
import { triggerBlobDownload } from './utils/formatters';
import { createSampleMboxFile } from './utils/sampleArchive';
import {
  applyColorSchemePreference,
  getStoredColorScheme,
  getSystemDarkMatch,
  resolveEffectiveTheme,
  type ColorSchemePreference,
} from './utils/theme';
import { MailWorkerClient } from './worker/workerClient';

function findFolderName(nodes: FolderNode[], id: string | null): string {
  if (!id) return 'Messages';
  for (const node of nodes) {
    if (node.id === id) return node.name;
    const child = findFolderName(node.children, id);
    if (child !== 'Messages') return child;
  }
  return 'Messages';
}

export default function App() {
  const workerRef = useRef<MailWorkerClient | null>(null);
  const activeObjectUrlsRef = useRef<Set<string>>(new Set());

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

  const [filter, setFilter] = useState<SearchFilter>({
    folderId: '',
    query: '',
    dateFrom: '',
    dateTo: '',
    hasAttachmentsOnly: false,
  });

  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isFolderLoading, setIsFolderLoading] = useState(false);
  const [isMessageLoading, setIsMessageLoading] = useState(false);
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

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
      for (const url of activeObjectUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      activeObjectUrlsRef.current.clear();
      workerRef.current?.dispose();
    };
    window.addEventListener('beforeunload', onUnload);

    return () => {
      mq.removeEventListener('change', onSystemChange);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);

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

  const loadFolderAndFirstMessage = useCallback(
    async (folderId: string) => {
      const client = workerRef.current;
      if (!client) return;

      setSelectedFolderId(folderId);
      setFilter({
        folderId,
        query: '',
        dateFrom: '',
        dateTo: '',
        hasAttachmentsOnly: false,
      });
      setIsFolderLoading(true);
      setActiveDetail(null);
      setSelectedMessageId(null);

      try {
        const list = await client.getFolderMessages(folderId, handleProgress);
        setMessages(list);
        if (list.length > 0) {
          setSelectedMessageId(list[0].id);
          setIsMessageLoading(true);
          const detail = await client.getMessageDetail(list[0].id);
          setActiveDetail(detail);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setWarnings((prev) => [...prev, msg]);
      } finally {
        setIsFolderLoading(false);
        setIsMessageLoading(false);
        setProgressText(null);
      }
    },
    [handleProgress],
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
        await loadFolderAndFirstMessage(targetFolder);
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

  const handleSelectMessage = useCallback(async (messageId: string) => {
    const client = workerRef.current;
    if (!client) return;
    setSelectedMessageId(messageId);
    setIsMessageLoading(true);
    try {
      const detail = await client.getMessageDetail(messageId);
      setActiveDetail(detail);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setWarnings((prev) => [...prev, msg]);
    } finally {
      setIsMessageLoading(false);
    }
  }, []);

  const handleFilterChange = useCallback(
    async (partial: Partial<SearchFilter>) => {
      const client = workerRef.current;
      if (!client || !selectedFolderId) return;

      const next: SearchFilter = {
        ...filter,
        ...partial,
        folderId: selectedFolderId,
      };
      setFilter(next);

      try {
        const results = await client.searchMessages(next);
        setMessages(results);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setWarnings((prev) => [...prev, msg]);
      }
    },
    [filter, selectedFolderId],
  );

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
    for (const url of activeObjectUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    activeObjectUrlsRef.current.clear();

    await workerRef.current?.resetSession();
    setArchives([]);
    setFolders([]);
    setSelectedFolderId(null);
    setMessages([]);
    setSelectedMessageId(null);
    setActiveDetail(null);
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
          theme={effectiveTheme}
          isFolderLoading={isFolderLoading}
          isMessageLoading={isMessageLoading}
          isExportingZip={isExportingZip}
          progressText={progressText}
          warnings={warnings}
          onDismissWarnings={() => setWarnings([])}
          onSelectFolder={loadFolderAndFirstMessage}
          onSelectMessage={handleSelectMessage}
          onFilterChange={handleFilterChange}
          onExportEml={handleExportEml}
          onExportFolderZip={handleExportFolderZip}
          registerObjectUrls={registerObjectUrls}
          revokeObjectUrls={revokeObjectUrls}
        />
      )}
    </div>
  );
}
