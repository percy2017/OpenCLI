import { Database, UploadCloud } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../shared/view/ui';

type EmptyStateProps = {
  onUpload: () => void;
};

export default function EmptyState({ onUpload }: EmptyStateProps) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-1 items-center justify-center p-8">
      <div className="max-w-md space-y-4 text-center">
        <Database className="mx-auto h-12 w-12 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">{t('knowledgeBase.empty.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('knowledgeBase.empty.description')}</p>
        </div>
        <Button type="button" size="sm" onClick={onUpload} className="mx-auto">
          <UploadCloud className="h-4 w-4" />
          {t('knowledgeBase.empty.uploadCta')}
        </Button>
        <p className="pt-2 text-xs text-muted-foreground">{t('knowledgeBase.empty.hint')}</p>
      </div>
    </div>
  );
}
