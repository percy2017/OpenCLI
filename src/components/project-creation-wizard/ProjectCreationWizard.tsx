import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

import { Button } from '../../shared/view/ui';
import { createProjectRequest } from './data/workspaceApi';
import type { WizardStep } from './types';

import StepConfiguration from './components/StepConfiguration';
import StepReview from './components/StepReview';
import WizardFooter from './components/WizardFooter';
import WizardProgress from './components/WizardProgress';
import ErrorBanner from './components/ErrorBanner';

type ProjectCreationWizardProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (project: Record<string, unknown>) => void;
};

type WizardFormState = {
  workspacePath: string;
};

export default function ProjectCreationWizard({
  isOpen,
  onClose,
  onCreated,
}: ProjectCreationWizardProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<WizardStep>(1);
  const [formState, setFormState] = useState<WizardFormState>({ workspacePath: '' });
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const resetState = useCallback(() => {
    setStep(1);
    setFormState({ workspacePath: '' });
    setIsCreating(false);
    setErrorMessage(null);
  }, []);

  const handleClose = useCallback(() => {
    if (isCreating) {
      return;
    }
    resetState();
    onClose();
  }, [isCreating, resetState, onClose]);

  const handleWorkspacePathChange = useCallback((value: string) => {
    setFormState((previous) => ({ ...previous, workspacePath: value }));
    setErrorMessage(null);
  }, []);

  const handleAdvanceToConfirm = useCallback(() => {
    if (!formState.workspacePath.trim()) {
      setErrorMessage(t('projectWizard.errors.pathRequired', { defaultValue: 'Path is required' }));
      return;
    }
    setErrorMessage(null);
    setStep(2);
  }, [formState.workspacePath, t]);

  const handleBack = useCallback(() => {
    if (isCreating) return;
    setErrorMessage(null);
    setStep(1);
  }, [isCreating]);

  const handleCreate = useCallback(async () => {
    setIsCreating(true);
    setErrorMessage(null);
    try {
      const project = await createProjectRequest({
        path: formState.workspacePath.trim(),
      });
      onCreated?.(project ?? {});
      resetState();
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create project');
    } finally {
      setIsCreating(false);
    }
  }, [formState.workspacePath, onCreated, onClose, resetState]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-200 p-6 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t('projectWizard.title', { defaultValue: 'Create new project' })}
            </h2>
            <WizardProgress step={step} />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            disabled={isCreating}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ErrorBanner message={errorMessage ?? ''} />

        <div className="p-6">
          {step === 1 && (
            <StepConfiguration
              workspacePath={formState.workspacePath}
              isCreating={isCreating}
              onWorkspacePathChange={handleWorkspacePathChange}
              onAdvanceToConfirm={handleAdvanceToConfirm}
            />
          )}
          {step === 2 && (
            <StepReview formState={formState} />
          )}
        </div>

        <WizardFooter
          step={step}
          isCreating={isCreating}
          onClose={handleClose}
          onBack={handleBack}
          onNext={handleAdvanceToConfirm}
          onCreate={handleCreate}
        />
      </div>
    </div>
  );
}