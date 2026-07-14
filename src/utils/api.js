import { IS_PLATFORM } from "../constants/config";

// Only accept a refreshed token that has this app's issued JWT shape
// (three base64url segments). An attacker-injected/malformed header value
// must never overwrite the stored auth token.
/**
 * @param {unknown} token
 * @returns {token is string}
 */
export const isValidRefreshedToken = (token) =>
  typeof token === 'string' &&
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);

// Utility function for authenticated API calls
export const authenticatedFetch = (url, options = {}) => {
  const token = localStorage.getItem('auth-token');

  const defaultHeaders = {};

  // Only set Content-Type for non-FormData requests
  if (!(options.body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  if (!IS_PLATFORM && token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }

  return fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  }).then((response) => {
    const refreshedToken = response.headers.get('X-Refreshed-Token');
    if (isValidRefreshedToken(refreshedToken)) {
      localStorage.setItem('auth-token', refreshedToken);
    }
    return response;
  });
};

// API endpoints
export const api = {
  // Auth endpoints (no token required)
  auth: {
    status: () => fetch('/api/auth/status'),
    login: (username, password) => fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    register: (username, password) => fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    user: () => authenticatedFetch('/api/auth/user'),
    logout: () => authenticatedFetch('/api/auth/logout', { method: 'POST' }),
  },

  // Protected endpoints
  // config endpoint removed - no longer needed (frontend uses window.location)
  // After the projectName → projectId migration the path/query identifier is
  // the DB-assigned `projectId`; parameter names reflect that for clarity.
  projects: () => authenticatedFetch('/api/projects'),
  archivedProjects: () => authenticatedFetch('/api/projects/archived'),
  projectSessions: (projectId, { limit = 20, offset = 0 } = {}) => {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    return authenticatedFetch(`/api/projects/${encodeURIComponent(projectId)}/sessions?${params.toString()}`);
  },
  // Unified endpoint for persisted session messages.
  // Provider/project metadata are resolved by the backend from sessionId.
  unifiedSessionMessages: (sessionId, _provider = 'claude', { limit = null, offset = 0 } = {}) => {
    const params = new URLSearchParams();
    if (limit !== null) {
      params.append('limit', String(limit));
      params.append('offset', String(offset));
    }
    const queryString = params.toString();
    return authenticatedFetch(`/api/providers/sessions/${encodeURIComponent(sessionId)}/messages${queryString ? `?${queryString}` : ''}`);
  },
  renameProject: (projectId, displayName) =>
    authenticatedFetch(`/api/projects/${projectId}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ displayName }),
    }),
  restoreProject: (projectId) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectId)}/restore`, {
      method: 'POST',
    }),
  // Session deletion now mirrors project deletion:
  // - default: archive only (`isArchived = 1`)
  // - hardDelete: remove the row and, by default, its persisted transcript file
  deleteSession: (sessionId, hardDelete = false) => {
    const params = new URLSearchParams();
    if (hardDelete) {
      params.set('force', 'true');
    }
    const qs = params.toString();
    return authenticatedFetch(`/api/providers/sessions/${sessionId}${qs ? `?${qs}` : ''}`, {
      method: 'DELETE',
    });
  },
  getArchivedSessions: () =>
    authenticatedFetch('/api/providers/sessions/archived'),
  runningSessions: () =>
    authenticatedFetch('/api/providers/sessions/running'),
  restoreSession: (sessionId) =>
    authenticatedFetch(`/api/providers/sessions/${sessionId}/restore`, {
      method: 'POST',
    }),
  renameSession: (sessionId, summary) =>
    authenticatedFetch(`/api/providers/sessions/${sessionId}`, {
      method: 'PUT',
      body: JSON.stringify({ summary }),
    }),
  // `hardDelete` => server `?force=true` (remove DB row + Claude *.jsonl + sessions rows for path).
  deleteProject: (projectId, hardDelete = false) => {
    const params = new URLSearchParams();
    if (hardDelete) params.set('force', 'true');
    const qs = params.toString();
    return authenticatedFetch(`/api/projects/${projectId}${qs ? `?${qs}` : ''}`, {
      method: 'DELETE',
    });
  },
  searchConversationsUrl: (query, limit = 50) => {
    const token = localStorage.getItem('auth-token');
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (token) params.set('token', token);
    return `/api/providers/search/sessions?${params.toString()}`;
  },
  createProject: (projectData) =>
    authenticatedFetch('/api/projects/create-project', {
      method: 'POST',
      body: JSON.stringify(projectData),
    }),
  migrateLegacyProjectStars: (projectIds) =>
    authenticatedFetch('/api/projects/migrate-legacy-stars', {
      method: 'POST',
      body: JSON.stringify({ projectIds }),
    }),
  toggleProjectStar: (projectId) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectId)}/toggle-star`, {
      method: 'POST',
    }),
  readFile: (projectId, filePath) =>
    authenticatedFetch(`/api/projects/${projectId}/file?filePath=${encodeURIComponent(filePath)}`),
  readFileBlob: (projectId, filePath) =>
    authenticatedFetch(`/api/projects/${projectId}/files/content?path=${encodeURIComponent(filePath)}`),
  saveFile: (projectId, filePath, content) =>
    authenticatedFetch(`/api/projects/${projectId}/file`, {
      method: 'PUT',
      body: JSON.stringify({ filePath, content }),
    }),
  getFiles: (projectId, options = {}) => {
    const { showIgnored, ...fetchOptions } = options;
    const qs = showIgnored ? '?showIgnored=true' : '';
    return authenticatedFetch(`/api/projects/${projectId}/files${qs}`, fetchOptions);
  },

  fileManager: {
    root: () => authenticatedFetch('/api/file-manager/root'),
    entries: (filePath = '') => {
      const params = new URLSearchParams({ path: filePath });
      return authenticatedFetch(`/api/file-manager/entries?${params.toString()}`);
    },
    readFile: (filePath) => {
      const params = new URLSearchParams({ path: filePath });
      return authenticatedFetch(`/api/file-manager/file?${params.toString()}`);
    },
    saveFile: (filePath, content) => authenticatedFetch('/api/file-manager/file', {
      method: 'PUT',
      body: JSON.stringify({ path: filePath, content }),
    }),
    createEntry: (parentPath, name, type) => authenticatedFetch('/api/file-manager/entries', {
      method: 'POST',
      body: JSON.stringify({ parentPath, name, type }),
    }),
    renameEntry: (filePath, newName) => authenticatedFetch('/api/file-manager/entries/rename', {
      method: 'PATCH',
      body: JSON.stringify({ path: filePath, newName }),
    }),
    copyEntry: (sourcePath, targetDirectory, newName) => authenticatedFetch('/api/file-manager/entries/copy', {
      method: 'POST',
      body: JSON.stringify({ sourcePath, targetDirectory, ...(newName ? { newName } : {}) }),
    }),
    moveEntry: (sourcePath, targetDirectory, newName) => authenticatedFetch('/api/file-manager/entries/move', {
      method: 'POST',
      body: JSON.stringify({ sourcePath, targetDirectory, ...(newName ? { newName } : {}) }),
    }),
    copyEntries: (paths, targetDirectory) => authenticatedFetch('/api/file-manager/entries/batch/copy', {
      method: 'POST',
      body: JSON.stringify({ paths, targetDirectory }),
    }),
    moveEntries: (paths, targetDirectory) => authenticatedFetch('/api/file-manager/entries/batch/move', {
      method: 'POST',
      body: JSON.stringify({ paths, targetDirectory }),
    }),
    trashEntries: (paths) => authenticatedFetch('/api/file-manager/entries/batch', {
      method: 'DELETE',
      body: JSON.stringify({ paths }),
    }),
    downloadArchive: (paths) => authenticatedFetch('/api/file-manager/download/archive', {
      method: 'POST',
      body: JSON.stringify({ paths }),
    }),
    trashEntry: (filePath) => authenticatedFetch('/api/file-manager/entries', {
      method: 'DELETE',
      body: JSON.stringify({ path: filePath }),
    }),
    upload: (targetDirectory, files) => {
      const body = new FormData();
      body.append('targetDirectory', targetDirectory);
      files.forEach((file) => body.append('files', file));
      return authenticatedFetch('/api/file-manager/upload', { method: 'POST', body });
    },
    download: (filePath) => {
      const params = new URLSearchParams({ path: filePath });
      return authenticatedFetch(`/api/file-manager/download?${params.toString()}`);
    },
    raw: (filePath, options = {}) => {
      const params = new URLSearchParams({ path: filePath });
      return authenticatedFetch(`/api/file-manager/raw?${params.toString()}`, options);
    },
    trash: () => authenticatedFetch('/api/file-manager/trash'),
    restoreTrash: (id) => authenticatedFetch(`/api/file-manager/trash/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
    }),
    deleteTrash: (id) => authenticatedFetch(`/api/file-manager/trash/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
    emptyTrash: () => authenticatedFetch('/api/file-manager/trash', { method: 'DELETE' }),
  },

  getSqliteTables: (projectId, filePath) =>
    authenticatedFetch(
      `/api/projects/${projectId}/sqlite/tables?path=${encodeURIComponent(filePath)}`,
    ),

  getSqliteTable: (projectId, { path, table, limit = 100, offset = 0 }) =>
    authenticatedFetch(
      `/api/projects/${projectId}/sqlite/table?path=${encodeURIComponent(path)}&table=${encodeURIComponent(table)}&limit=${limit}&offset=${offset}`,
    ),

  // Browse filesystem for project suggestions
  browseFilesystem: (dirPath = null) => {
    const params = new URLSearchParams();
    if (dirPath) params.append('path', dirPath);

    return authenticatedFetch(`/api/browse-filesystem?${params}`);
  },

  createFolder: (folderPath) =>
    authenticatedFetch('/api/create-folder', {
      method: 'POST',
      body: JSON.stringify({ path: folderPath }),
    }),

  // User endpoints
  user: {
    gitConfig: () => authenticatedFetch('/api/user/git-config'),
    updateGitConfig: (gitName, gitEmail) =>
      authenticatedFetch('/api/user/git-config', {
        method: 'POST',
        body: JSON.stringify({ gitName, gitEmail }),
      }),
    onboardingStatus: () => authenticatedFetch('/api/user/onboarding-status'),
    completeOnboarding: () =>
      authenticatedFetch('/api/user/complete-onboarding', {
        method: 'POST',
      }),
  },

  // Generic GET method for any endpoint
  get: (endpoint) => authenticatedFetch(`/api${endpoint}`),

  // Generic POST method for any endpoint
  post: (endpoint, body) => authenticatedFetch(`/api${endpoint}`, {
    method: 'POST',
    ...(body instanceof FormData ? { body } : { body: JSON.stringify(body) }),
  }),

  // Generic PUT method for any endpoint
  put: (endpoint, body) => authenticatedFetch(`/api${endpoint}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  }),

  // Generic DELETE method for any endpoint
  delete: (endpoint, options = {}) => authenticatedFetch(`/api${endpoint}`, {
    method: 'DELETE',
    ...options,
  }),
};
