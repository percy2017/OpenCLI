import { MessageSquare, Terminal, TerminalSquare, Folder, MonitorPlay, Database, Sparkles, type LucideIcon } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { Tooltip, PillBar, Pill } from '../../../../shared/view/ui';
import type { AppTab } from '../../../../types/app';

type MainContentTabSwitcherProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  shouldShowBrowserTab: boolean;
  shouldShowRagVectorTab: boolean;
  shouldShowMinimaxTab: boolean;
  shouldShowTerminalModuleTab: boolean;
  shouldShowShellTab: boolean;
};

type BuiltInTab = {
  id: AppTab;
  labelKey: string;
  icon: LucideIcon;
  displayLabel?: string;
};

const BASE_TABS: BuiltInTab[] = [
  { id: 'chat',  labelKey: 'tabs.chat',  icon: MessageSquare },
  { id: 'shell', labelKey: 'tabs.shell', icon: Terminal },
  { id: 'files', labelKey: 'tabs.files', icon: Folder },
];

// Second "Terminal" entry in the header — opens the Terminal module panel
// (toggle status, link to Settings). Distinct from the agent-facing xterm.js
// tab above (id: 'shell') which runs the agent's shell session.
const TERMINAL_MODULE_TAB: BuiltInTab = {
  id: 'terminal',
  labelKey: 'tabs.shell',
  icon: TerminalSquare,
  displayLabel: 'Terminal',
};

const BROWSER_TAB: BuiltInTab = {
  id: 'browser',
  labelKey: 'tabs.browser',
  icon: MonitorPlay,
  displayLabel: 'Browser MCP',
};

const RAG_VECTOR_TAB: BuiltInTab = {
  id: 'rag-vector',
  labelKey: 'tabs.ragVector',
  icon: Database,
};

const MINIMAX_TAB: BuiltInTab = {
  id: 'minimax',
  labelKey: 'tabs.minimax',
  icon: Sparkles,
};

export default function MainContentTabSwitcher({
  activeTab,
  setActiveTab,
  shouldShowBrowserTab,
  shouldShowRagVectorTab,
  shouldShowMinimaxTab,
  shouldShowTerminalModuleTab,
  shouldShowShellTab,
}: MainContentTabSwitcherProps) {
  const { t } = useTranslation();

  const tabs: BuiltInTab[] = [
    ...(shouldShowShellTab ? BASE_TABS : BASE_TABS.filter((tab) => tab.id !== 'shell')),
    ...(shouldShowTerminalModuleTab ? [TERMINAL_MODULE_TAB] : []),
    ...(shouldShowBrowserTab ? [BROWSER_TAB] : []),
    ...(shouldShowRagVectorTab ? [RAG_VECTOR_TAB] : []),
    ...(shouldShowMinimaxTab ? [MINIMAX_TAB] : []),
  ];

  return (
    <PillBar>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        const displayLabel = tab.displayLabel ?? t(tab.labelKey);

        return (
          <Tooltip key={tab.id} content={displayLabel} position="bottom">
            <Pill
              isActive={isActive}
              onClick={() => setActiveTab(tab.id)}
              className="px-2.5 py-[5px]"
            >
              <tab.icon className="h-3.5 w-3.5" strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="hidden lg:inline">{displayLabel}</span>
            </Pill>
          </Tooltip>
        );
      })}
    </PillBar>
  );
}