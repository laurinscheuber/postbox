import { FolderTree } from './FolderTree';
import { MessageList } from './MessageList';
import { ReadingPane } from './ReadingPane';
import type {
  FolderNode,
  MessageDetail,
  MessageSummary,
  SearchFilter,
} from '../types/mail';

interface MailWorkspaceProps {
  folders: FolderNode[];
  selectedFolderId: string | null;
  selectedFolderName: string;
  messages: MessageSummary[];
  selectedMessageId: string | null;
  activeDetail: MessageDetail | null;
  filter: SearchFilter;
  theme: 'light' | 'dark';
  isFolderLoading: boolean;
  isMessageLoading: boolean;
  isExportingZip: boolean;
  progressText: string | null;
  warnings: string[];
  onDismissWarnings: () => void;
  onSelectFolder: (folderId: string) => void;
  onSelectMessage: (messageId: string) => void;
  onFilterChange: (next: Partial<SearchFilter>) => void;
  onExportEml: (messageId: string) => void;
  onExportFolderZip: () => void;
  registerObjectUrls: (urls: string[]) => void;
  revokeObjectUrls: (urls: string[]) => void;
}

export function MailWorkspace({
  folders,
  selectedFolderId,
  selectedFolderName,
  messages,
  selectedMessageId,
  activeDetail,
  filter,
  theme,
  isFolderLoading,
  isMessageLoading,
  isExportingZip,
  progressText,
  warnings,
  onDismissWarnings,
  onSelectFolder,
  onSelectMessage,
  onFilterChange,
  onExportEml,
  onExportFolderZip,
  registerObjectUrls,
  revokeObjectUrls,
}: MailWorkspaceProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(progressText || warnings.length > 0) && (
        <div className="no-print shrink-0">
          {progressText && (
            <div
              className="border-b px-4 py-1.5 text-xs font-medium"
              style={{
                borderColor: 'var(--pb-border)',
                backgroundColor: 'var(--pb-bg-selected)',
                color: 'var(--pb-text-primary)',
              }}
            >
              {progressText}
            </div>
          )}
          {warnings.length > 0 && (
            <div
              className="flex items-center justify-between gap-3 border-b px-4 py-1.5 text-xs text-amber-700 dark:text-amber-300"
              style={{
                borderColor: 'var(--pb-border)',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
              }}
            >
              <span>{warnings.join(' · ')}</span>
              <button type="button" onClick={onDismissWarnings} className="underline">
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-x-auto">
        <FolderTree
          folders={folders}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
        />

        <MessageList
          folderName={selectedFolderName}
          messages={messages}
          selectedMessageId={selectedMessageId}
          filter={filter}
          isLoading={isFolderLoading}
          isExportingZip={isExportingZip}
          onSelectMessage={onSelectMessage}
          onFilterChange={onFilterChange}
          onExportFolderZip={onExportFolderZip}
        />

        <ReadingPane
          message={activeDetail}
          isLoading={isMessageLoading}
          theme={theme}
          onExportEml={onExportEml}
          registerObjectUrls={registerObjectUrls}
          revokeObjectUrls={revokeObjectUrls}
        />
      </div>
    </div>
  );
}
