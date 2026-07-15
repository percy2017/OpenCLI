import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  CheckCircle2,
  FileCode2,
  FileText,
  FileUp,
  FolderUp,
  Github,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../lib/utils';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
} from '../../../shared/view/ui';
import { useProviderSkills } from '../hooks/useProviderSkills';
import type {
  ProviderSkill,
  ProviderSkillCreateEntryPayload,
  SkillsProject,
  SkillsProvider,
  SkillsScope,
} from '../types';

import GithubInstallDialog from './GithubInstallDialog';

type ProviderSkillsProps = {
  selectedProvider: SkillsProvider;
  currentProjects: SkillsProject[];
};

type QueuedSkillSourceFile = {
  file: File;
  relativePath: string;
};

type QueuedSkillFile = {
  id: string;
  name: string;
  size: number;
  kind: 'markdown' | 'folder';
  skillFile: File;
  files: QueuedSkillSourceFile[];
};

const MAX_SKILL_FOLDER_FILES = 500;
const MAX_SKILL_FOLDER_BYTES = 30 * 1024 * 1024;

const PROVIDER_NAMES: Record<SkillsProvider, string> = {
  claude: 'Claude',
};

const PROVIDER_SKILL_PATHS: Record<SkillsProvider, string> = {
  claude: '~/.claude/skills/<skill-name>/SKILL.md',
};

const SCOPE_LABELS: Record<SkillsScope, string> = {
  user: 'User',
  plugin: 'Plugin',
  repo: 'Repo',
  project: 'Project',
  admin: 'Admin',
  system: 'System',
};

const SCOPE_BADGE_CLASSES: Record<SkillsScope, string> = {
  user: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  plugin: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  repo: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  project: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  admin: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  system: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
};

const SCOPE_ORDER: SkillsScope[] = ['user', 'plugin', 'repo', 'project', 'admin', 'system'];

const groupSkillsByScope = (skills: ProviderSkill[]): Array<{ scope: SkillsScope; skills: ProviderSkill[] }> => (
  SCOPE_ORDER
    .map((scope) => ({ scope, skills: skills.filter((skill) => skill.scope === scope) }))
    .filter((group) => group.skills.length > 0)
);

const formatFileSize = (size: number): string => {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const GITHUB_ERROR_CODE_PATTERNS: Array<{ code: string; key: string }> = [
  { code: 'PROVIDER_SKILL_GITHUB_INVALID_URL', key: 'skillsManagement.githubError.invalidUrl' },
  { code: 'PROVIDER_SKILL_GITHUB_NON_GITHUB_HOST', key: 'skillsManagement.githubError.nonGithubHost' },
  { code: 'PROVIDER_SKILL_GITHUB_NOT_FOUND', key: 'skillsManagement.githubError.notFound' },
  { code: 'PROVIDER_SKILL_GITHUB_RATE_LIMIT', key: 'skillsManagement.githubError.rateLimit' },
  { code: 'PROVIDER_SKILL_GITHUB_FORBIDDEN', key: 'skillsManagement.githubError.rateLimit' },
  { code: 'PROVIDER_SKILL_GITHUB_ARCHIVE_TOO_LARGE', key: 'skillsManagement.githubError.archiveTooLarge' },
  { code: 'PROVIDER_SKILL_GITHUB_ENTRY_TOO_LARGE', key: 'skillsManagement.githubError.archiveTooLarge' },
  { code: 'PROVIDER_SKILL_GITHUB_EXTRACTED_TOO_LARGE', key: 'skillsManagement.githubError.extractedTooLarge' },
  { code: 'PROVIDER_SKILL_GITHUB_NO_SKILLS', key: 'skillsManagement.githubError.noSkillsFound' },
  { code: 'PROVIDER_SKILL_GITHUB_PATH_TRAVERSAL', key: 'skillsManagement.githubError.invalidUrl' },
  { code: 'PROVIDER_SKILL_GITHUB_NETWORK', key: 'skillsManagement.githubError.network' },
  { code: 'PROVIDER_SKILL_GITHUB_URL_REQUIRED', key: 'skillsManagement.githubError.invalidUrl' },
  { code: 'PROVIDER_SKILLS_WRITE_UNSUPPORTED', key: 'skillsManagement.githubError.unsupportedProvider' },
];

const matchGithubErrorCodeToTranslation = (
  t: (key: string, options?: Record<string, unknown>) => string,
  rawMessage: string,
): string | null => {
  for (const { code, key } of GITHUB_ERROR_CODE_PATTERNS) {
    if (rawMessage.includes(code)) {
      const translated = t(key, { defaultValue: '' });
      if (translated) {
        return translated;
      }
    }
  }
  return null;
};

const getBrowserRelativePath = (file: File): string => {
  const fileWithRelativePath = file as File & {
    path?: string;
    webkitRelativePath?: string;
  };
  return (
    fileWithRelativePath.webkitRelativePath
    || fileWithRelativePath.path
    || file.name
  )
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '');
};

const getParentPath = (filePath: string): string => {
  const separatorIndex = filePath.lastIndexOf('/');
  return separatorIndex >= 0 ? filePath.slice(0, separatorIndex) : '';
};

const getBaseName = (filePath: string): string => {
  const segments = filePath.split('/').filter(Boolean);
  return segments.at(-1) || 'skill';
};

const getSkillDirectoryNameFromSourcePath = (sourcePath: string): string => {
  if (!sourcePath) {
    return '';
  }
  const normalized = sourcePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length < 2) {
    return '';
  }
  // The sourcePath points to .../<directoryName>/SKILL.md, so drop the trailing SKILL.md segment.
  return segments[segments.length - 2] || '';
};

const readFileAsBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const result = typeof reader.result === 'string' ? reader.result : '';
    const separatorIndex = result.indexOf(',');
    resolve(separatorIndex >= 0 ? result.slice(separatorIndex + 1) : result);
  };
  reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`));
  reader.readAsDataURL(file);
});

const buildQueuedSkillFolders = (selectedFiles: File[]): QueuedSkillFile[] => {
  if (selectedFiles.length > MAX_SKILL_FOLDER_FILES) {
    throw new Error(`A skill folder can contain up to ${MAX_SKILL_FOLDER_FILES} files.`);
  }

  const totalSize = selectedFiles.reduce((size, file) => size + file.size, 0);
  if (totalSize > MAX_SKILL_FOLDER_BYTES) {
    throw new Error('Selected skill folders must be smaller than 30 MB in total.');
  }

  const files = selectedFiles.map((file) => ({
    file,
    relativePath: getBrowserRelativePath(file),
  }));
  const skillRoots = files
    .filter(({ relativePath }) => getBaseName(relativePath).toLowerCase() === 'skill.md')
    .map(({ relativePath }) => getParentPath(relativePath))
    .sort((left, right) => right.length - left.length);

  if (skillRoots.length === 0) {
    throw new Error('The selected folder does not contain a SKILL.md file.');
  }

  return skillRoots.map((skillRoot) => {
    const skillFiles = files.filter(({ relativePath }) => {
      const owningRoot = skillRoots.find((candidateRoot) => {
        const normalizedRelativePath = relativePath.toLowerCase();
        const normalizedSkillPath = `${candidateRoot}/skill.md`.toLowerCase();
        return normalizedRelativePath === normalizedSkillPath
          || relativePath.startsWith(`${candidateRoot}/`);
      });
      return owningRoot === skillRoot;
    });
    const skillSourceFile = skillFiles.find(
      ({ relativePath }) => (
        relativePath.toLowerCase() === `${skillRoot}/skill.md`.toLowerCase()
      ),
    );
    if (!skillSourceFile) {
      throw new Error(`Could not read SKILL.md from ${getBaseName(skillRoot)}.`);
    }

    return {
      id: `folder:${skillRoot}:${skillFiles.map(({ file }) => file.lastModified).join(':')}`,
      name: getBaseName(skillRoot),
      size: skillFiles.reduce((size, { file }) => size + file.size, 0),
      kind: 'folder' as const,
      skillFile: skillSourceFile.file,
      files: skillFiles.map(({ file, relativePath }) => ({
        file,
        relativePath: skillRoot ? relativePath.slice(skillRoot.length + 1) : relativePath,
      })),
    };
  });
};

export default function ProviderSkills({ selectedProvider, currentProjects }: ProviderSkillsProps) {
  const { t } = useTranslation('settings');
  const {
    skills,
    isLoading,
    isLoadingProjectScopes,
    loadError,
    saveStatus,
    addSkills,
    installFromGithub,
    deleteSkill,
    refreshSkills,
  } = useProviderSkills({ selectedProvider, currentProjects });
  const [queuedFiles, setQueuedFiles] = useState<QueuedSkillFile[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [justInstalled, setJustInstalled] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isGithubDialogOpen, setIsGithubDialogOpen] = useState(false);
  const [showInstallPath, setShowInstallPath] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const providerName = t(`skillsManagement.providerNames.${selectedProvider}`, { defaultValue: PROVIDER_NAMES[selectedProvider] });
  const providerPath = t(`skillsManagement.installPath.${selectedProvider}`, { defaultValue: PROVIDER_SKILL_PATHS[selectedProvider] });

  useEffect(() => {
    setQueuedFiles([]);
    setSubmitError(null);
    setIsSubmitting(false);
    setSearchQuery('');
    setIsAddDialogOpen(false);
    setIsGithubDialogOpen(false);
    setShowInstallPath(false);
    setJustInstalled(false);
    setDeleteTarget(null);
    setIsDeleting(false);
  }, [selectedProvider]);

  const setFolderInputRef = useCallback((node: HTMLInputElement | null) => {
    folderInputRef.current = node;
    if (!node) {
      return;
    }

    node.setAttribute('webkitdirectory', '');
    node.setAttribute('directory', '');
  }, []);

  const filteredSkills = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    if (!normalizedQuery) {
      return skills;
    }

    return skills.filter((skill) => (
      [
        skill.command,
        skill.name,
        skill.description,
        skill.scope,
        skill.pluginName,
        skill.projectDisplayName,
        skill.sourcePath,
      ]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery))
    ));
  }, [searchQuery, skills]);

  const groupedSkills = useMemo(() => groupSkillsByScope(filteredSkills), [filteredSkills]);

  const queueSkillFolders = useCallback((selectedFiles: File[]) => {
    const queuedFolders = buildQueuedSkillFolders(selectedFiles);
    setQueuedFiles((previous) => {
      const nextMap = new Map(previous.map((file) => [file.id, file]));
      queuedFolders.forEach((folder) => nextMap.set(folder.id, folder));
      return [...nextMap.values()].slice(0, 20);
    });
  }, []);

  const handleDrop = useCallback((files: File[]) => {
    const includesDirectory = files.some((file) => getBrowserRelativePath(file).includes('/'));
    if (includesDirectory) {
      try {
        queueSkillFolders(files);
        setSubmitError(null);
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : t('skillsManagement.readFolderError'));
      }
      return;
    }

    const acceptedFiles = files
      .filter((file) => file.name.toLowerCase().endsWith('.md'))
      .slice(0, 20);

    if (acceptedFiles.length === 0) {
      setSubmitError(t('skillsManagement.dropHint'));
      return;
    }

    setQueuedFiles((previous) => {
      const nextMap = new Map(previous.map((file) => [file.id, file]));
      acceptedFiles.forEach((file) => {
        const id = `${file.name}:${file.size}:${file.lastModified}`;
        nextMap.set(id, {
          id,
          name: file.name,
          size: file.size,
          kind: 'markdown',
          skillFile: file,
          files: [{ file, relativePath: 'SKILL.md' }],
        });
      });

      return [...nextMap.values()].slice(0, 20);
    });
    setSubmitError(null);
  }, [queueSkillFolders]);

  const handleFolderSelection = useCallback((selectedFiles: File[]) => {
    if (selectedFiles.length === 0) {
      return;
    }

    try {
      queueSkillFolders(selectedFiles);
      setSubmitError(null);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t('skillsManagement.readFolderError'));
    }
  }, [queueSkillFolders]);

  const { getRootProps, isDragActive } = useDropzone({
    maxFiles: MAX_SKILL_FOLDER_FILES,
    noClick: true,
    noKeyboard: true,
    onDrop: handleDrop,
  });

  const handleUploadInstall = useCallback(async () => {
    if (queuedFiles.length === 0) {
      setSubmitError(t('skillsManagement.addFirst'));
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const entries = await Promise.all<ProviderSkillCreateEntryPayload>(queuedFiles.map(async (queuedFile) => ({
        fileName: queuedFile.kind === 'folder' ? `${queuedFile.name}.md` : queuedFile.name,
        directoryName: queuedFile.kind === 'folder' ? queuedFile.name : undefined,
        content: await queuedFile.skillFile.text(),
        files: queuedFile.kind === 'folder'
          ? await Promise.all(
            queuedFile.files
              .filter(({ relativePath }) => relativePath.toLowerCase() !== 'skill.md')
              .map(async ({ file, relativePath }) => ({
                relativePath,
                content: await readFileAsBase64(file),
                encoding: 'base64' as const,
              })),
          )
          : undefined,
      })));
      await addSkills({ entries });
      setQueuedFiles([]);
      setJustInstalled(true);
      setIsAddDialogOpen(false);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t('skillsManagement.importError'));
    } finally {
      setIsSubmitting(false);
    }
  }, [addSkills, queuedFiles]);

  const handleAddDialogOpenChange = useCallback((open: boolean) => {
    if (open) {
      setSubmitError(null);
      setShowInstallPath(false);
      setJustInstalled(false);
      setIsAddDialogOpen(true);
      return;
    }

    setQueuedFiles([]);
    setSubmitError(null);
    setShowInstallPath(false);
    setJustInstalled(false);
    setIsAddDialogOpen(false);
  }, []);

  const handleGithubDialogOpenChange = useCallback((open: boolean) => {
    if (open) {
      setSubmitError(null);
      setJustInstalled(false);
      setIsGithubDialogOpen(true);
      return;
    }

    setSubmitError(null);
    setIsGithubDialogOpen(false);
  }, []);

  const handleGithubInstall = useCallback(async (payload: { url: string; ref?: string }) => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await installFromGithub(payload);
      setJustInstalled(true);
      setIsGithubDialogOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('skillsManagement.importError');
      // Map server-side codes to localized keys when possible.
      const localized = matchGithubErrorCodeToTranslation(t, message);
      setSubmitError(localized ?? message);
    } finally {
      setIsSubmitting(false);
    }
  }, [installFromGithub]);

  const [deleteTarget, setDeleteTarget] = useState<{ directoryName: string; displayName: string; sourcePath: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteRequest = useCallback((skill: ProviderSkill) => {
    if (skill.scope !== 'user') {
      setSubmitError(t('skillsManagement.deleteUnavailable'));
      return;
    }
    const directoryName = getSkillDirectoryNameFromSourcePath(skill.sourcePath);
    if (!directoryName) {
      setSubmitError(t('skillsManagement.deleteUnavailable'));
      return;
    }
    setDeleteTarget({
      directoryName,
      displayName: skill.name || directoryName,
      sourcePath: skill.sourcePath,
    });
  }, []);

  const handleDeleteCancel = useCallback(() => {
    if (isDeleting) {
      return;
    }
    setDeleteTarget(null);
  }, [isDeleting]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) {
      return;
    }
    setIsDeleting(true);
    setSubmitError(null);
    try {
      await deleteSkill({ directoryName: deleteTarget.directoryName });
      setJustInstalled(true);
      setDeleteTarget(null);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : t('skillsManagement.deleteError', { name: deleteTarget.displayName });
      setSubmitError(message);
      setDeleteTarget(null);
    } finally {
      setIsDeleting(false);
    }
  }, [deleteSkill, deleteTarget]);

  const uploadPanel = (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={cn(
          'rounded-lg border border-dashed p-3 transition-colors sm:p-4',
          isDragActive
            ? 'border-foreground/40 bg-muted/35'
            : 'border-border/70 bg-muted/15 hover:border-foreground/25 hover:bg-muted/25',
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,text/markdown"
          multiple
          className="hidden"
          onChange={(event) => {
            handleDrop(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
        <input
          ref={setFolderInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            handleFolderSelection(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
        <div className="flex flex-col items-center justify-center gap-2 py-3 text-center">
          <FileUp className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />
          <div className="space-y-1">
            <div className="text-sm font-medium text-foreground">Drop a skill folder or SKILL.md</div>
            <div className="text-sm text-muted-foreground">
              Folders can include scripts, references, and assets.
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="w-full sm:w-auto"
            >
              <FileUp className="h-4 w-4" />
              Choose Files
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => folderInputRef.current?.click()}
              className="w-full sm:w-auto"
            >
              <FolderUp className="h-4 w-4" />
              Choose Folder
            </Button>
          </div>
        </div>
      </div>

      {queuedFiles.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium text-foreground">Ready to install</div>
          <div className="grid gap-2">
            {queuedFiles.map((queuedFile) => (
              <div
                key={queuedFile.id}
                className="flex items-center gap-3 rounded-lg border border-border/70 bg-background/70 px-3 py-2"
              >
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
                  {queuedFile.kind === 'folder' ? <FolderUp className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{queuedFile.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {queuedFile.kind === 'folder'
                      ? `${queuedFile.files.length} files`
                      : t('skillsManagement.markdownFile')}
                    {' · '}
                    {formatFileSize(queuedFile.size)}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 flex-shrink-0 p-0 text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${queuedFile.name}`}
                  onClick={() => {
                    setQueuedFiles((previous) => previous.filter((file) => file.id !== queuedFile.id));
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {providerPath && (
        <div className="space-y-2">
          <button
            type="button"
            className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setShowInstallPath((current) => !current)}
          >
            {showInstallPath ? t('skillsManagement.hideInstallLocation') : t('skillsManagement.whereWillInstall')}
          </button>
          {showInstallPath && (
            <div className="rounded-lg border border-border/60 bg-muted/15 p-3">
              <code className="block whitespace-normal break-all text-xs text-foreground">{providerPath}</code>
            </div>
          )}
        </div>
      )}

    </div>
  );

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/20 text-muted-foreground">
          <FileCode2 className="h-4 w-4" strokeWidth={1.7} />
        </div>
        <div className="min-w-0 space-y-1">
          <h3 className="text-lg font-medium text-foreground">{t('skillsManagement.heading')}</h3>
          <p className="text-sm text-muted-foreground">
            {t(`skillsManagement.description${selectedProvider.charAt(0).toUpperCase()}${selectedProvider.slice(1)}`)}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1 sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('skillsManagement.searchPlaceholder')}
              aria-label={t('skillsManagement.searchAria')}
              className="h-9 w-full pl-9 pr-9"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear skill search"
                className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => handleAddDialogOpenChange(true)}
          >
            <Plus className="h-4 w-4" />
            {t('skillsManagement.addSkill')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => handleGithubDialogOpenChange(true)}
          >
            <Github className="h-4 w-4" />
            {t('skillsManagement.addFromGithub')}
          </Button>
          <Button
            onClick={() => void refreshSkills({ force: true })}
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            disabled={isLoading || isLoadingProjectScopes}
          >
            <RefreshCw className={cn('h-4 w-4', (isLoading || isLoadingProjectScopes) && 'animate-spin')} />
            {t('skillsManagement.refresh')}
          </Button>
        </div>
        {isLoadingProjectScopes && (
          <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('skillsManagement.scanningProjects')}
          </div>
        )}
      </div>

      <Dialog open={isAddDialogOpen} onOpenChange={handleAddDialogOpenChange}>
        <DialogContent
          wrapperClassName="z-[10000]"
          className="flex max-h-[min(720px,calc(100vh-2rem))] w-[calc(100vw-2rem)] max-w-4xl flex-col overflow-hidden p-0"
        >
          <DialogTitle>{t('skillsManagement.addSkill', { defaultValue: 'Add Skill' })} {t(`skillsManagement.providerNames.${selectedProvider}`)}</DialogTitle>
          <div className="flex-shrink-0 border-b border-border/60 px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/20 text-muted-foreground">
                <FileUp className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-base font-medium text-foreground">{t('skillsManagement.addSkill', { defaultValue: 'Add Skill' })} {t(`skillsManagement.providerNames.${selectedProvider}`)}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Upload a SKILL.md file or a complete skill folder.
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                aria-label="Close add skill dialog"
                disabled={isSubmitting}
                onClick={() => handleAddDialogOpenChange(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {uploadPanel}
          </div>

          <div className="flex flex-shrink-0 flex-col gap-3 border-t border-border/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              {(submitError || loadError || (justInstalled && saveStatus === 'success')) ? (
                <div className={cn(
                  'max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm',
                  submitError || loadError
                    ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-200'
                    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                )}>
                  {submitError || loadError || t('skillsManagement.savedSuccess')}
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Folder uploads keep the selected folder name; standalone files use the `name` in `SKILL.md`.
                </span>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
                disabled={isSubmitting}
                onClick={() => handleAddDialogOpenChange(false)}
              >
                {t('skillsManagement.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button
                type="button"
                size="sm"
                className="w-full sm:w-auto"
                onClick={() => void handleUploadInstall()}
                disabled={isSubmitting || queuedFiles.length === 0}
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {queuedFiles.length > 0
                  ? t('skillsManagement.installButton', { count: queuedFiles.length })
                  : t('skillsManagement.installOne')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <GithubInstallDialog
        open={isGithubDialogOpen}
        providerName={providerName}
        isSubmitting={isSubmitting}
        submitError={submitError}
        onOpenChange={handleGithubDialogOpenChange}
        onSubmit={handleGithubInstall}
      />

      {!isAddDialogOpen && (submitError || loadError) && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-200">
          {submitError || loadError}
        </div>
      )}

      {justInstalled && saveStatus === 'success' && !isAddDialogOpen && (
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          {t('skillsManagement.savedSuccess')}
        </div>
      )}

      <div className="space-y-5">
        {isLoading && skills.length === 0 && (
          <div className="flex min-h-[180px] items-center justify-center text-sm text-muted-foreground">
            {t(`skillsManagement.loading${selectedProvider.charAt(0).toUpperCase()}${selectedProvider.slice(1)}`)}
          </div>
        )}

        {!isLoading && skills.length === 0 && (
          <div className="rounded-lg border border-dashed border-border/70 bg-muted/15 px-4 py-10 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg border border-border/60 bg-background/80 text-muted-foreground">
              <FileText className="h-6 w-6" />
            </div>
            <div className="mt-4 text-sm font-medium text-foreground">{t(`skillsManagement.empty${selectedProvider.charAt(0).toUpperCase()}${selectedProvider.slice(1)}Title`)}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {t('skillsManagement.emptyBody')}
            </div>
          </div>
        )}

        {!isLoading && skills.length > 0 && filteredSkills.length === 0 && (
          <div className="rounded-lg border border-dashed border-border/70 bg-muted/15 px-4 py-10 text-center">
            <Search className="mx-auto h-6 w-6 text-muted-foreground" />
            <div className="mt-3 text-sm font-medium text-foreground">{t('skillsManagement.noMatchesTitle')}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {t('skillsManagement.noMatchesBody')}
            </div>
          </div>
        )}

        {groupedSkills.map((group) => (
          <section key={group.scope} className="min-w-0 space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={cn('rounded-full px-2.5 py-1 text-xs', SCOPE_BADGE_CLASSES[group.scope])}>
                {t(`skillsManagement.scopeLabels.${group.scope}`, { defaultValue: SCOPE_LABELS[group.scope] })}
              </Badge>
              <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                {group.skills.length} skill{group.skills.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="grid min-w-0 gap-3 lg:grid-cols-2">
              {group.skills.map((skill) => {
                const canDelete = skill.scope === 'user'
                  && Boolean(getSkillDirectoryNameFromSourcePath(skill.sourcePath));
                return (
                <div
                  key={`${skill.command}:${skill.sourcePath}:${skill.projectPath || 'global'}`}
                  className="min-w-0 rounded-lg border border-border bg-card/50 p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="break-all font-mono text-sm font-semibold text-foreground">{skill.command}</div>
                      <div className="text-sm text-muted-foreground">{skill.name}</div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 flex-shrink-0 p-0 text-muted-foreground hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={t('skillsManagement.deleteAria', { name: skill.name || skill.command })}
                      title={canDelete ? t('skillsManagement.delete') : t('skillsManagement.deleteUnavailable')}
                      disabled={!canDelete}
                      onClick={() => handleDeleteRequest(skill)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {skill.description || t('skillsManagement.noDescription')}
                  </p>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {skill.pluginName && (
                      <Badge variant="outline" className="rounded-full bg-background/70">
                        Plugin: {skill.pluginName}
                      </Badge>
                    )}
                    {skill.projectDisplayName && (
                      <Badge variant="outline" className="rounded-full bg-background/70">
                        Project: {skill.projectDisplayName}
                      </Badge>
                    )}
                  </div>

                  <div className="mt-4 min-w-0 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                    <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Source</div>
                    <code className="mt-1 block whitespace-normal break-all text-xs text-foreground">{skill.sourcePath}</code>
                  </div>
                </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) handleDeleteCancel(); }}>
        <DialogContent
          wrapperClassName="z-[10000]"
          className="max-h-[min(420px,calc(100vh-2rem))] w-[calc(100vw-2rem)] max-w-md p-0"
        >
          <DialogTitle>{t('skillsManagement.deleteConfirm.title')}</DialogTitle>
          <div className="flex-shrink-0 border-b border-border/60 px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300">
                <Trash2 className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-base font-medium text-foreground">{t('skillsManagement.deleteConfirm.title')}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {deleteTarget
                    ? t('skillsManagement.deleteConfirm.body', {
                        name: deleteTarget.displayName,
                        path: deleteTarget.sourcePath,
                      })
                    : ''}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center justify-end gap-2 px-4 py-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isDeleting}
              onClick={handleDeleteCancel}
            >
              {t('skillsManagement.deleteConfirm.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={isDeleting}
              onClick={() => void handleDeleteConfirm()}
            >
              {isDeleting
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Trash2 className="h-4 w-4" />}
              {isDeleting
                ? t('skillsManagement.deleteConfirm.deleting')
                : t('skillsManagement.deleteConfirm.confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
