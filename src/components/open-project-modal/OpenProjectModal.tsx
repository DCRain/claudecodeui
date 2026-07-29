import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, FolderOpen, FolderPlus, Loader2, Plus, X } from 'lucide-react';
import { Button, Input } from '../../shared/view/ui';
import { browseFilesystemFolders, createFolderInFilesystem, createProjectRequest } from '../project-creation-wizard/data/workspaceApi';
import { getParentPath, joinFolderPath } from '../project-creation-wizard/utils/pathUtils';
import type { FolderSuggestion } from '../project-creation-wizard/types';

type OpenProjectModalProps = {
  onClose: () => void;
  onProjectOpened?: () => void;
};

export default function OpenProjectModal({ onClose, onProjectOpened }: OpenProjectModalProps) {
  const { t } = useTranslation('sidebar');
  const [currentPath, setCurrentPath] = useState('~');
  const [folders, setFolders] = useState<FolderSuggestion[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [showHiddenFolders, setShowHiddenFolders] = useState(false);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpening, setIsOpening] = useState(false);

  const loadFolders = useCallback(async (pathToLoad: string) => {
    setLoadingFolders(true);
    setError(null);
    try {
      const result = await browseFilesystemFolders(pathToLoad);
      setCurrentPath(result.path);
      setFolders(result.suggestions);
    } catch (loadError) {
      // Keep the previous folder list so a browse failure does not freeze the picker.
      setError(loadError instanceof Error ? loadError.message : 'Failed to load folders');
    } finally {
      setLoadingFolders(false);
    }
  }, []);

  useEffect(() => {
    loadFolders('~');
  }, [loadFolders]);

  const visibleFolders = useMemo(
    () =>
      folders
        .filter((folder) => showHiddenFolders || !folder.name.startsWith('.'))
        .sort((a, b) =>
          a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
        ),
    [folders, showHiddenFolders],
  );

  const resetNewFolderState = () => {
    setShowNewFolderInput(false);
    setNewFolderName('');
  };

  const handleCreateFolder = useCallback(async () => {
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    setError(null);
    try {
      const folderPath = joinFolderPath(currentPath, newFolderName);
      const createdPath = await createFolderInFilesystem(folderPath);
      resetNewFolderState();
      await loadFolders(createdPath);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create folder');
    } finally {
      setCreatingFolder(false);
    }
  }, [currentPath, loadFolders, newFolderName]);

  const handleOpenProject = useCallback(async (folderPath: string) => {
    if (!folderPath.trim() || isOpening) return;
    setIsOpening(true);
    setError(null);
    try {
      await createProjectRequest({ path: folderPath.trim() });
      onProjectOpened?.();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('messages.createProjectFailed', 'Failed to open project');
      setError(message);
    } finally {
      setIsOpening(false);
    }
  }, [isOpening, onClose, onProjectOpened, t]);

  const parentPath = getParentPath(currentPath);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-0 backdrop-blur-sm sm:p-4">
      <div className="flex max-h-[80vh] w-full flex-col rounded-none border-0 border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800 sm:h-auto sm:max-w-2xl sm:rounded-lg sm:border">
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/50">
              <FolderOpen className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t('projects.openProject', 'Open Folder as Project')}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHiddenFolders((prev) => !prev)}
              className={`rounded-md p-2 transition-colors ${
                showHiddenFolders
                  ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300'
              }`}
              title={showHiddenFolders ? 'Hide hidden folders' : 'Show hidden folders'}
            >
              {showHiddenFolders ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
            </button>
            <button
              onClick={() => setShowNewFolderInput((prev) => !prev)}
              className={`rounded-md p-2 transition-colors ${
                showNewFolderInput
                  ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300'
              }`}
              title="Create new folder"
            >
              <Plus className="h-5 w-5" />
            </button>
            <button
              onClick={onClose}
              disabled={isOpening}
              className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {showNewFolderInput && (
          <div className="border-b border-gray-200 bg-blue-50 px-4 py-3 dark:border-gray-700 dark:bg-blue-900/20">
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="New folder name"
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateFolder();
                  }
                  if (e.key === 'Escape') {
                    resetNewFolderState();
                  }
                }}
                autoFocus
              />
              <Button size="sm" onClick={handleCreateFolder} disabled={!newFolderName.trim() || creatingFolder}>
                {creatingFolder ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
              </Button>
              <Button size="sm" variant="ghost" onClick={resetNewFolderState}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="px-4 pt-3">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {loadingFolders && folders.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <div className={`space-y-1 ${loadingFolders || isOpening ? 'pointer-events-none opacity-60' : ''}`}>
              {parentPath && (
                <button
                  onClick={() => loadFolders(parentPath)}
                  disabled={loadingFolders || isOpening}
                  className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <FolderOpen className="h-5 w-5 text-gray-400" />
                  <span className="font-medium text-gray-700 dark:text-gray-300">..</span>
                </button>
              )}

              {visibleFolders.length === 0 ? (
                <div className="py-8 text-center text-gray-500 dark:text-gray-400">
                  No subfolders found
                </div>
              ) : (
                visibleFolders.map((folder) => (
                  <div key={folder.path} className="flex items-center gap-2">
                    <button
                      onClick={() => loadFolders(folder.path)}
                      disabled={loadingFolders || isOpening}
                      className="flex flex-1 items-center gap-3 rounded-lg px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      <FolderPlus className="h-5 w-5 text-blue-500" />
                      <span className="font-medium text-gray-900 dark:text-white">
                        {folder.name}
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenProject(folder.path)}
                      disabled={isOpening || loadingFolders}
                      className="px-3 text-xs"
                    >
                      Open
                    </Button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 bg-gray-50 px-4 py-3 dark:bg-gray-900/50">
            <span className="text-sm text-gray-600 dark:text-gray-400">Path:</span>
            <code className="flex-1 truncate font-mono text-sm text-gray-900 dark:text-white">
              {currentPath}
            </code>
          </div>
          <div className="flex items-center justify-end gap-2 p-4">
            <Button variant="outline" onClick={onClose} disabled={isOpening}>
              Cancel
            </Button>
            <Button
              onClick={() => handleOpenProject(currentPath)}
              disabled={isOpening || loadingFolders}
            >
              {isOpening ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Opening...
                </>
              ) : (
                'Open this folder'
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
