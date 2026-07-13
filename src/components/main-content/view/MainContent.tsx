import React, { useCallback, useEffect, useState } from 'react';
import { Terminal, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import ChatInterface from '../../chat/view/ChatInterface';
import FileTree from '../../file-tree/view/FileTree';
import StandaloneShell from '../../standalone-shell/view/StandaloneShell';
import KnowledgeBaseView from '../../knowledge-base/KnowledgeBaseView';
import MinimaxPanel from '../../minimax-mcp/MinimaxPanel';
import { BrowserUsePanel } from '../../browser-use';
import type { MainContentProps } from '../types/types';
import { usePaletteOpsRegister } from '../../../contexts/PaletteOpsContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useFileOpenResolver } from '../../../hooks/useFileOpenResolver';
import { authenticatedFetch } from '../../../utils/api';
import { useEditorSidebar } from '../../code-editor/hooks/useEditorSidebar';
import EditorSidebar from '../../code-editor/view/EditorSidebar';
import { Button } from '../../../shared/view/ui';

import MainContentHeader from './subcomponents/MainContentHeader';
import MainContentStateView from './subcomponents/MainContentStateView';
import ErrorBoundary from './ErrorBoundary';
import TerminalShellView from './TerminalShellView';

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
  const { t } = useTranslation('common');

  // New Terminal module state (separate from the agent-facing xterm.js tab).
  const [terminalState, setTerminalState] = useState<{ enabled: boolean } | null>(null);

  const loadTerminalState = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/terminal/state');
      const data = await response.json();
      if (response.ok && data?.success !== false && data?.data) {
        setTerminalState({ enabled: data.data.enabled === true });
      } else {
        setTerminalState({ enabled: true });
      }
    } catch {
      setTerminalState({ enabled: true });
    }
  }, []);

  useEffect(() => {
    void loadTerminalState();
    const handler = () => void loadTerminalState();
    window.addEventListener('terminalStateChanged', handler);
    return () => window.removeEventListener('terminalStateChanged', handler);
  }, [loadTerminalState]);

  const [browserUseEnabled, setBrowserUseEnabled] = useState(false);
  const [ragVectorEnabled, setRagVectorEnabled] = useState(false);
  const [minimaxMcpEnabled, setMinimaxMcpEnabled] = useState(false);

  const shouldShowBrowserTab = browserUseEnabled;
  const shouldShowRagVectorTab = ragVectorEnabled;
  // Visible whenever the MiniMax MCP toggle is on (mirrors ragVector).
  const shouldShowMinimaxTab = minimaxMcpEnabled;
  // VITE_SHOW_SHELL_TAB controls the first "Terminal" tab in the header
  // (agent-facing xterm.js shell). Defaults to true when unset.
  const shouldShowShellTab = String(import.meta.env.VITE_SHOW_SHELL_TAB ?? 'true').toLowerCase() !== 'false';
  // The second "Terminal" pill in the header is only meaningful when the
  // Terminal module is enabled. While loading (terminalState === null) we
  // hide it to avoid a flash of a tab that will immediately disappear.
  const shouldShowTerminalModuleTab = terminalState?.enabled === true;

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

  const loadMinimaxMcpFlag = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/mcp-minimax/state');
      const data = await response.json();
      setMinimaxMcpEnabled(Boolean(response.ok && data?.success !== false && data?.data?.state?.enabled === true));
    } catch {
      setMinimaxMcpEnabled(false);
    }
  }, []);

  useEffect(() => {
    void loadMinimaxMcpFlag();
    window.addEventListener('mcpMinimaxStateChanged', loadMinimaxMcpFlag);
    return () => window.removeEventListener('mcpMinimaxStateChanged', loadMinimaxMcpFlag);
  }, [loadMinimaxMcpFlag]);

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
    if (!shouldShowMinimaxTab && activeTab === 'minimax') {
      setActiveTab('chat');
    }
  }, [shouldShowMinimaxTab, activeTab, setActiveTab]);

  useEffect(() => {
    if (!shouldShowShellTab && activeTab === 'shell') {
      setActiveTab('chat');
    }
  }, [shouldShowShellTab, activeTab, setActiveTab]);

  useEffect(() => {
    if (!shouldShowTerminalModuleTab && activeTab === 'terminal') {
      setActiveTab('chat');
    }
  }, [shouldShowTerminalModuleTab, activeTab, setActiveTab]);

  usePaletteOpsRegister({
    openFile: (filePath: string) => {
      setActiveTab('files');
      handleFileOpen(filePath);
    },
    // Opens the editor side panel in place, keeping the current tab (e.g. chat).
    openFileInEditor: (filePath: string) => {
      resolvedFileOpen(filePath);
    },
  });

  if (isLoading) {
    return <MainContentStateView mode="loading" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  if (!selectedProject) {
    // On mobile we still want to show the brand header so the title "OpenCLI"
    // is visible while the user lands on the empty "Choose Your Project" view.
    // On desktop the empty state stands alone — the sidebar already carries
    // the brand, so the header would be redundant.
    if (isMobile) {
      return (
        <div className="flex h-full flex-col">
          <MainContentHeader
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            selectedProject={null}
            selectedSession={null}
            shouldShowBrowserTab={shouldShowBrowserTab}
            shouldShowRagVectorTab={shouldShowRagVectorTab}
            shouldShowMinimaxTab={shouldShowMinimaxTab}
            shouldShowTerminalModuleTab={shouldShowTerminalModuleTab}
            shouldShowShellTab={shouldShowShellTab}
            isMobile={isMobile}
            onMenuClick={onMenuClick}
          />
          <MainContentStateView mode="empty" isMobile={isMobile} onMenuClick={onMenuClick} />
        </div>
      );
    }
    return <MainContentStateView mode="empty" isMobile={isMobile} onMenuClick={onMenuClick} />;
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
        shouldShowMinimaxTab={shouldShowMinimaxTab}
        shouldShowTerminalModuleTab={shouldShowTerminalModuleTab}
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

          {activeTab === 'files' && (
            <div className="h-full overflow-hidden">
              <FileTree selectedProject={selectedProject} onFileOpen={handleFileOpen} />
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

          {activeTab === 'terminal' && (
            terminalState?.enabled === false ? (
              <div className="flex h-full w-full items-center justify-center p-6">
                <div className="max-w-md space-y-4 text-center">
                  <Terminal className="mx-auto h-10 w-10 text-muted-foreground" />
                  <h2 className="text-lg font-semibold text-foreground">
                    {t('terminal.disabledTitle')}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {t('terminal.disabledDescription')}
                  </p>
                  <Button onClick={() => onShowSettings('terminal')} variant="default">
                    {t('terminal.openSettings')}
                  </Button>
                </div>
              </div>
            ) : (
              <TerminalShellView
                project={selectedProject}
                isActive={activeTab === 'terminal'}
              />
            )
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

          {shouldShowMinimaxTab && activeTab === 'minimax' && (
            <div className="h-full overflow-hidden">
              <MinimaxPanel />
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
