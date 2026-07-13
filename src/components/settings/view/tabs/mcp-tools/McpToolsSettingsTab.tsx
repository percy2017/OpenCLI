import { useTranslation } from 'react-i18next';
import { Cable, MonitorPlay, Sparkles } from 'lucide-react';

import type { McpSubTab } from '../../../types/types';
import SettingsSection from '../../SettingsSection';
import { Pill, PillBar } from '../../../../../shared/view/ui';

import BrowserMcpPanel from './BrowserMcpPanel';
import MinimaxMcpPanel from './MinimaxMcpPanel';
import RagMcpPanel from './RagMcpPanel';

type McpToolsSettingsTabProps = {
  activeSubTab: McpSubTab;
  onSubTabChange: (sub: McpSubTab) => void;
};

const SUB_TABS: Array<{ id: McpSubTab; icon: typeof MonitorPlay; key: 'browser' | 'minimax' | 'rag' }> = [
  { id: 'browser', icon: MonitorPlay, key: 'browser' },
  { id: 'minimax', icon: Cable, key: 'minimax' },
  { id: 'rag', icon: Sparkles, key: 'rag' },
];

export default function McpToolsSettingsTab({ activeSubTab, onSubTabChange }: McpToolsSettingsTabProps) {
  const { t } = useTranslation('settings');

  const active = SUB_TABS.find((s) => s.id === activeSubTab) ?? SUB_TABS[0];

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t('mcpTools.sectionTitle')}
        description={t('mcpTools.sectionDescription')}
      >
        <div className="space-y-2">
          <PillBar className="w-fit">
            {SUB_TABS.map((sub) => {
              const Icon = sub.icon;
              const isActive = activeSubTab === sub.id;
              return (
                <Pill
                  key={sub.id}
                  isActive={isActive}
                  onClick={() => onSubTabChange(sub.id)}
                  className="whitespace-nowrap"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t(`mcpTools.subTabs.${sub.key}.label`)}
                </Pill>
              );
            })}
          </PillBar>
          <p className="text-xs text-muted-foreground">
            {t(`mcpTools.subTabs.${active.key}.description`)}
          </p>
        </div>
      </SettingsSection>

      {activeSubTab === 'browser' && <BrowserMcpPanel />}
      {activeSubTab === 'minimax' && <MinimaxMcpPanel />}
      {activeSubTab === 'rag' && <RagMcpPanel />}
    </div>
  );
}
