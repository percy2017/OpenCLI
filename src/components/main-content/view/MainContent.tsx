import React, { useCallback, useEffect, useState } from 'react';

import ChatInterface from '../../chat/view/ChatInterface';
import FileManager from '../../file-manager/view/FileManager';
import StandaloneShell from '../../standalone-shell/view/StandaloneShell';
import KnowledgeBaseView from '../../knowledge-base/KnowledgeBaseView';
import { BrowserUsePanel } from '../../browser-use';
import type { MainContentProps } from '../types/types';
import { usePaletteOpsRegister } from '../../../contexts/PaletteOpsContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useFileOpenResolver } from '../../../hooks/useFileOpenResolver';
import { authenticatedFetch } from '../../../utils/api';
import { useEditorSidebar } from '../../code-editor/hooks/useEditorSidebar';
import EditorSidebar from '../../code-editor/view/EditorSidebar';

import MainContentHeader from './subcomponents/MainContentHeader';
import MainContentStateView from './subcomponents/MainContentStateView';
import ErrorBoundary from './ErrorBoundary';

function MainContent({
  selectedProject,
  selectedSession,
  activeTab,
  setActiveTab,
  ws,
  sendMessage,
  isMobile,
  onMenuClick,
  isLoading,
  onInputFocusChange,
  onSessionProcessing,
  onSessionIdle,
  processingSessions,
  onNavigateToSession,
  onSessionEstablished,
  onShowSettings,
  externalMessageUpdate,
  newSessionTrigger,
}: MainContentProps) {
  const { preferences } = useUiPreferences();
  const { showRawParameters, showThinking, sendByCtrlEnter } = preferences;

  const [browserUseEnabled, setBrowserUseEnabled] = useState(false);
  const [ragVectorEnabled, setRagVectorEnabled] = useState(false);
  const shouldShowBrowserTab = browserUseEnabled;
  const shouldShowRagVectorTab = ragVectorEnabled;
  // VITE_SHOW_SHELL_TAB controls the first "Terminal" tab in the header
  // (agent-facing xterm.js shell). Defaults to true when unset.
  const shouldShowShellTab = String(import.meta.env.VITE_SHOW_SHELL_TAB ?? 'true').toLowerCase() !== 'false';
  const [hasVisitedFiles, setHasVisitedFiles] = useState(activeTab === 'files');

  useEffect(() => {
    if (activeTab === 'files') {
      setHasVisitedFiles(true);
    }
  }, [activeTab]);

  const {
    editingFile,
    editorWidth,
    editorExpanded,
    hasManualWidth,
    resizeHandleRef,
    handleFileOpen,
    handleCloseEditor,
    handleToggleEditorExpand,
    handleResizeStart,
  } = useEditorSidebar({
    selectedProject,
    isMobile,
  });

  const handleWorkspaceFileOpen = useCallback((filePath: string) => {
    handleFileOpen(filePath, null, 'workspace');
  }, [handleFileOpen]);

  // Resolves bare/partial file references (e.g. links inside chat messages) to
  // real project files before opening them in the in-app editor.
  const resolvedFileOpen = useFileOpenResolver(selectedProject, handleFileOpen);

  const loadBrowserUseSettings = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/browser-use/settings');
      const data = await response.json();
      setBrowserUseEnabled(Boolean(response.ok && data?.success !== false && data?.data?.settings?.enabled));
    } catch {
      setBrowserUseEnabled(false);
    }
  }, []);

  useEffect(() => {
    void loadBrowserUseSettings();
    window.addEventListener('browserUseSettingsChanged', loadBrowserUseSettings);
    return () => window.removeEventListener('browserUseSettingsChanged', loadBrowserUseSettings);
  }, [loadBrowserUseSettings]);

  const loadRagVectorFlag = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/feature-flags/rag-vector');
      const data = await response.json();
      setRagVectorEnabled(Boolean(response.ok && data?.success !== false && data?.data?.enabled));
    } catch {
      setRagVectorEnabled(false);
    }
  }, []);

  useEffect(() => {
    void loadRagVectorFlag();
    window.addEventListener('ragVectorStateChanged', loadRagVectorFlag);
    return () => window.removeEventListener('ragVectorStateChanged', loadRagVectorFlag);
  }, [loadRagVectorFlag]);

  useEffect(() => {
    if (!shouldShowBrowserTab && activeTab === 'browser') {
      setActiveTab('chat');
    }
  }, [shouldShowBrowserTab, activeTab, setActiveTab]);

  useEffect(() => {
    if (!shouldShowRagVectorTab && activeTab === 'rag-vector') {
      setActiveTab('chat');
    }
  }, [shouldShowRagVectorTab, activeTab, setActiveTab]);

  useEffect(() => {
    if (!shouldShowShellTab && activeTab === 'shell') {
      setActiveTab('chat');
    }
  }, [shouldShowShellTab, activeTab, setActiveTab]);

  usePaletteOpsRegister({
    // Opens the editor side panel in place, keeping the current tab (e.g. chat).
    openFile: (filePath: string) => {
      resolvedFileOpen(filePath);
    },
    openFileInEditor: (filePath: string) => {
      resolvedFileOpen(filePath);
    },
  });

  if (isLoading) {
    return <MainContentStateView mode="loading" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  if (!selectedProject) {
    return (
      <div className="flex h-full flex-col">
        <MainContentHeader
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          selectedProject={null}
          selectedSession={null}
          shouldShowBrowserTab={shouldShowBrowserTab}
          shouldShowRagVectorTab={shouldShowRagVectorTab}
          shouldShowShellTab={shouldShowShellTab}
          isMobile={isMobile}
          onMenuClick={onMenuClick}
        />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {hasVisitedFiles && (
              <div className={activeTab === 'files' ? 'h-full overflow-hidden' : 'hidden'} aria-hidden={activeTab !== 'files'}>
                <FileManager onFileOpen={handleWorkspaceFileOpen} />
              </div>
            )}
            {activeTab !== 'files' && (
              <MainContentStateView mode="empty" isMobile={isMobile} onMenuClick={onMenuClick} />
            )}
          </div>
          {activeTab === 'files' && (
            <EditorSidebar
              editingFile={editingFile}
              isMobile={isMobile}
              editorExpanded={editorExpanded}
              editorWidth={editorWidth}
              hasManualWidth={hasManualWidth}
              resizeHandleRef={resizeHandleRef}
              onResizeStart={handleResizeStart}
              onCloseEditor={handleCloseEditor}
              onToggleEditorExpand={handleToggleEditorExpand}
              fillSpace
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <MainContentHeader
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        shouldShowBrowserTab={shouldShowBrowserTab}
        shouldShowRagVectorTab={shouldShowRagVectorTab}
        shouldShowShellTab={shouldShowShellTab}
        isMobile={isMobile}
        onMenuClick={onMenuClick}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className={`flex min-h-0 min-w-[200px] flex-col overflow-hidden ${editorExpanded ? 'hidden' : ''} flex-1`}>
          <div className={`h-full ${activeTab === 'chat' ? 'block' : 'hidden'}`}>
            <ErrorBoundary showDetails>
              <ChatInterface
                selectedProject={selectedProject}
                selectedSession={selectedSession}
                ws={ws}
                sendMessage={sendMessage}
                onFileOpen={handleFileOpen}
                onInputFocusChange={onInputFocusChange}
                onSessionProcessing={onSessionProcessing}
                onSessionIdle={onSessionIdle}
                processingSessions={processingSessions}
                onNavigateToSession={onNavigateToSession}
                onSessionEstablished={onSessionEstablished}
                onShowSettings={onShowSettings}
                showRawParameters={showRawParameters}
                showThinking={showThinking}
                sendByCtrlEnter={sendByCtrlEnter}
                externalMessageUpdate={externalMessageUpdate}
                newSessionTrigger={newSessionTrigger}
              />
            </ErrorBoundary>
          </div>

          {hasVisitedFiles && (
            <div className={activeTab === 'files' ? 'h-full overflow-hidden' : 'hidden'} aria-hidden={activeTab !== 'files'}>
              <FileManager onFileOpen={handleWorkspaceFileOpen} />
            </div>
          )}

          {activeTab === 'shell' && (
            <div className="h-full w-full overflow-hidden">
              <StandaloneShell
                project={selectedProject}
                session={selectedSession}
                showHeader={false}
                isActive={activeTab === 'shell'}
              />
            </div>
          )}

          {shouldShowBrowserTab && activeTab === 'browser' && (
            <div className="h-full overflow-hidden">
              <BrowserUsePanel isVisible={activeTab === 'browser'} onShowSettings={onShowSettings} />
            </div>
          )}

          {shouldShowRagVectorTab && activeTab === 'rag-vector' && (
            <div className="h-full overflow-hidden">
              <KnowledgeBaseView />
            </div>
          )}
        </div>

        <EditorSidebar
          editingFile={editingFile}
          isMobile={isMobile}
          editorExpanded={editorExpanded}
          editorWidth={editorWidth}
          hasManualWidth={hasManualWidth}
          resizeHandleRef={resizeHandleRef}
          onResizeStart={handleResizeStart}
          onCloseEditor={handleCloseEditor}
          onToggleEditorExpand={handleToggleEditorExpand}
          projectPath={selectedProject.path}
          fillSpace={activeTab === 'files'}
        />
      </div>
    </div>
  );
}

export default React.memo(MainContent);
