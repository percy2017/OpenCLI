---
name: cloudcli-file-manager-module
description: Add or modify a workspace-rooted file-manager module in CloudCLI by integrating a focused backend module, an authenticated REST + WebSocket realtime layer, and a project-independent main-content tab.
source: auto-skill
extracted_at: '2026-07-14T21:45:20.430Z'
---

## When to use

Use this skill whenever a CloudCLI change introduces, extends, or rewires the workspace-rooted file manager — a tab in `MainContent` that hosts CRUD over the directory pointed at by `WORKSPACES_ROOT`, including hidden and ignored entries, recoverable trash, and realtime updates without a page reload.

Reach for it when:

- Creating the first version of the file-manager feature (e.g. when the previous tree was deliberately removed by the user and only the backend/frontend scaffolding survives).
- Extending the module with new operations (upload, rename, copy, move, trash, empty trash).
- Adding realtime change notifications between backend changes and the UI.
- Wiring the file manager into the existing in-app CodeEditor (so files opened here never bypass `WORKSPACES_ROOT`).
- Surfacing the feature through a top-level tab that mirrors `Chat`/`Shell`/`Browser`/`RAG Vector`.

## Why this matters

CloudCLI enforces strict architecture boundaries (`server/modules/<name>/index.ts` barrel only, backend alias `@/* -> server/*`, ESLint boundaries errors). The user already modified several shared files in the working tree (header tabs, `AppTab` union, `useProjectsState`, `app.locals.wss`, Vite proxy), so any new module must be additive and never overwrite their changes.

Implementing the file manager from scratch surfaced these recurring traps:

- The WebSocket server routes by pathname in `server/modules/websocket/services/websocket-server.service.ts` — a new event channel requires mounting a route there and matching it in `vite.config.js`'s proxy block.
- The code editor's read/save paths are project-scoped by default. Files opened via the workspace tab must switch the editor into a workspace-aware mode (`source: 'workspace'`) so `/api/projects/:projectId/file` is never called with an empty `projectId`.
- The "Files" tab should be reachable without a selected project because its data lives in `WORKSPACES_ROOT`. Reusing the existing empty-state slot (which currently hides the desktop header) means both headers and the file manager must render even when no project is active.
- Tests for these backend modules rely on the `backend-tsx-test` skill (`npx tsx --tsconfig server/tsconfig.json --test ...`).
- Several lint warnings already exist in `useFileManager.ts`; the `react-hooks/exhaustive-deps` warning is acceptable when the hook intentionally mirrors an external ref without re-running the effect on every ref change.

## Procedure

### Backend module

1. Verify the user's current working tree (`git status --short`) so you only add or extend modules without overwriting files they intentionally deleted.
2. Create `server/modules/file-manager/` with at minimum:
   - `file-manager.types.ts` — entry, trash entry, root info types.
   - `file-manager.service.ts` — `FileManagerService` class. Resolve all paths relative to `WORKSPACES_ROOT` and reject lexical escapes, absolute paths, symlink targets outside the root, and operations against the root itself with specific `AppError` codes (`FILE_PATH_OUTSIDE_ROOT`, `WORKSPACES_ROOT_IMMUTABLE`, `SYMLINK_OUTSIDE_ROOT`, etc.).
   - `file-manager.routes.ts` — `express.Router` mounted under `/api/file-manager`. Include endpoints for root info, directory entries, file read/put, raw bytes, download, create, rename, copy, move, trash, and trash list/restore/delete/empty. Use `asyncHandler` + `createApiSuccessResponse`.
   - `file-manager-watcher.service.ts` — wraps `chokidar` with depth 0, `ignoreInitial: true`, an `awaitWriteFinish` guard, and a JSON subscription protocol so multiple directories can be added/removed on demand.
   - `index.ts` barrel exporting the router, service, watcher, and types — never deep-import the internals.
3. Wire the routes and watcher into the existing composition root:
   - `server/index.js` — add the import near the existing module imports and `app.use('/api/file-manager', authenticateToken, fileManagerRoutes);` next to `/api/assets`.
   - `server/modules/websocket/services/websocket-server.service.ts` — add `handleFileManagerConnection(ws)` and a new `pathname === '/file-manager-events'` branch.
   - `vite.config.js` — add `/file-manager-events` to the dev proxy `ws` block so the client upgrade isn't lost.
4. Write focused backend tests in `server/modules/file-manager/tests/file-manager.service.test.ts`. Use `mkdtemp` + `os.homedir` patching (restore in `finally`) for isolation; cover hidden entries, traversal rejection, symlink escape, CRUD, copy/move, upload, download access, and trash lifecycle. Run them with `npx tsx --tsconfig server/tsconfig.json --test <path>` (see `backend-tsx-test` skill).

### Frontend module

1. Add `src/components/file-manager/` with:
   - `types.ts` mirroring the backend types and a small `FileManagerDialogState` discriminated union.
   - `utils/fileManagerPaths.ts` with pure helpers (`parentPathOf`, `joinWorkspacePath`, `formatFileSize`) — keep these Node-import-free so they can be unit tested with `node:test`.
   - `hooks/useFileManager.ts` exposing entries, path expansion, mutation runners, drag-and-drop friendly paths, recoverable downloads, trash helpers, and a WebSocket subscription with reconnect + debounced refresh.
   - `view/FileManager.tsx` for the two-pane UI: toolbar with create/upload/refresh/trash/search, recursive tree sidebar, breadcrumb + table main panel, dialogs for create/rename/copy/move/trash, and a trash viewer dialog with restore / permanent delete / empty trash.
2. Extend `src/utils/api.js` with a `fileManager` namespace under `api` (root, entries, file read/put, create, rename, copy, move, trash, upload, download, raw bytes, and trash operations).
3. Extend `CodeEditor` to handle workspace source files safely:
   - Add `source?: 'project' | 'workspace'` to `CodeEditorFile` in `src/components/code-editor/types/types.ts`.
   - Update `useEditorSidebar.handleFileOpen` to forward the new `source` argument and only attach `projectId` when `source === 'project'`.
   - In `useCodeEditorDocument` and `CodeEditorMediaPreview` branch on `file.source === 'workspace'` to call `api.fileManager.readFile` / `saveFile` / `raw` instead of the project endpoints. Block SQLite previews and the binary placeholder when the file is from the workspace (or render the binary placeholder), so SQLite introspection never assumes a `projectId`.
4. Update header/tab plumbing:
   - Add `id: 'files'` to `BASE_TABS` in `src/components/main-content/view/subcomponents/MainContentTabSwitcher.tsx` (so it sits immediately after `shell`).
   - Extend `AppTab` (`src/types/app.ts`) and the validator set in `src/hooks/useProjectsState.ts`.
   - Update `MainContentTitle.getTabTitle` to return the localized tab title.
   - In `src/components/main-content/view/MainContent.tsx` render `<FileManager>` both inside the project branch and inside the empty-state branch (so the tab is reachable without picking a project). Pass a `handleWorkspaceFileOpen` wrapper that calls `handleFileOpen(filePath, null, 'workspace')`.
5. Add i18n keys under `tabs.files` and `fileManager.*` in both `src/i18n/locales/en/common.json` and `src/i18n/locales/es/common.json`. Translate every success notice — the hook uses `t('fileManager.<key>', { count })` and breaks silently if keys are missing.
6. Add a focused frontend test that only depends on the pure utility module (`src/components/file-manager/view/FileManager.test.tsx`) so it works under `node:test` without `import.meta.env`. Avoid SSR tests of the full component because `src/constants/config.ts` reads `import.meta.env` and will crash outside Vite.

### Documentation

- Update `QWEN.md` — list `file-manager` in the backend modules, add a short `### File manager` subsection covering `WORKSPACES_ROOT`, the REST + WebSocket endpoints, the trash contract, and the workspace-aware CodeEditor mode.
- Translate every success notice so localized plural keys (`uploaded_one`, `uploaded_other`) are populated in both `en` and `es`.

## Common pitfalls

- **Overwriting the user's deleted `src/components/file-tree/`** — the file manager is brand new; do not recreate that module. Implement it under `src/components/file-manager/`.
- **Mounting `/api/file-manager` without `authenticateToken`** — every file-manager endpoint must be protected like `/api/projects` and `/api/assets`.
- **Missing `/file-manager-events` proxy in Vite** — devs running `npm run dev` will see the connection drop silently without that proxy entry.
- **Forgetting the `WORKSPACES_ROOT_IMMUTABLE` guard** — without it the user can `trashEntry('')` and delete every project file at once.
- **Reusing the project CodeEditor for workspace files** — calling `/api/projects/:projectId/file` with an empty project identifier causes a 404. Always branch on `file.source === 'workspace'`.
- **Emitting WebSocket paths through the wrong proxy target** — keep the proxy target as `ws://${proxyHost}:${serverPort}` (note `ws://`, not `http://`).
- **Relying on `useMemo` over `manager.entriesByPath`** — that map mutates on every refresh and forces a recomputation. Stabilise the dependency with `manager.currentPath` instead and read inside `useMemo`.
- **Forgetting i18n keys** — the i18next scanner will fall back to the key itself; add `fileManager.*` in every locale file before relying on the UI.
- **Running tests with the frontend tsconfig** — see the `backend-tsx-test` skill; the file-manager backend tests must run with `--tsconfig server/tsconfig.json`.

## How to apply

- Reach for this skill whenever the question is about adding the Files tab, extending workspace CRUD, adding realtime file-manager events, or routing the in-app editor to files outside the active project.
- Combine with `backend-tsx-test` whenever running the new tests.
- Keep `QWEN.md` and i18n catalogues in sync with any new operation or locale.
