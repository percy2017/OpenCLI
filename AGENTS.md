# Repository Guidelines

CloudCLI (`@cloudcli-ai/cloudcli`) is a web UI for Claude Code CLI and other coding agents: a React/Vite frontend plus an Express/WebSocket backend, published as a server and a global `cloudcli` CLI. License: AGPL-3.0-or-later. Requires Node.js 22+ (see `.nvmrc`).

## Project Structure & Module Organization

- `src/` — React frontend (Vite + Tailwind), `@/*` aliases to `src/*`. Each feature lives under `src/components/<area>/` with a `view/` and co-located `hooks/`, `utils/`, `types/`, `constants/`. Cross-feature code: `src/{contexts,hooks,stores,i18n,lib,utils,types}`.
- `server/` — Express backend, `@/*` aliases to `server/*`. New work goes in `server/modules/<module>/`; legacy handlers stay in `server/routes/`. Cross-cutting code: `server/{middleware,services,shared,utils,constants}`.
- `shared/` is reused by both sides. `plugins/`, `public/`, `docs/`, `scripts/`, `database/` hold the plugin template, static assets, nginx config, build helpers, and a runtime DB hint.

## Build, Test, and Development Commands

- `npm install` — installs deps; postinstall runs `scripts/fix-node-pty.js`.
- `npm run dev` — runs `server:dev-watch` (backend, `$SERVER_PORT` default 3001) and `client` (Vite, `$VITE_PORT` default 5173) concurrently.
- `npm run server:dev` / `npm run client` — run one side only.
- `npm run build` — `vite build` plus `tsc -p server/tsconfig.json && tsc-alias` into `dist/` and `dist-server/`.
- `npm run typecheck` — `tsc --noEmit` against both root and server tsconfigs.
- `npm run lint` / `npm run lint:fix` — ESLint flat config over `src/` and `server/`.
- `npm run start` — `build` then start the compiled server (`npm run server`).
- `npm run release` — interactive release-it version bump with conventional changelog.

## Coding Style & Naming Conventions

TypeScript everywhere with `strict: true` and `module: ESNext`. Prefer `@/*`-aliased imports over long relative paths. `eslint-plugin-boundaries` enforces the server's module-folder architecture — don't introduce cross-module coupling. Tailwind for styling; classes are auto-sorted by `eslint-plugin-tailwindcss`. React components are PascalCase in `src/components/<area>/view/`; hooks are `useX` in `hooks/`. Run `npm run lint:fix` before committing.

## Testing Guidelines

There is no `npm test`. Tests use the built-in `node:test` runner with `node:assert/strict`. Name files `*.test.ts` / `*.test.js` and co-locate them under a module's `tests/` directory.

- Single file: `node --test --experimental-strip-types path/to/file.test.ts` (drop the flag for `.js`).
- Folder: `node --test server/modules/providers/tests/`.
- Integration DB tests need a writable SQLite file at `$DATABASE_PATH` (default `~/.cloudcli/auth.db`).

PRs must pass `npm run typecheck` and `npm run lint`.

## Commit & Pull Request Guidelines

We follow [Conventional Commits](https://wwwconventionalcommits.org); commitlint is enforced via Husky `commit-msg`. Format: `<type>(optional scope): <description>` in imperative, present tense. Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `style`, `chore`, `ci`, `test`, `build`. Mark breaking changes with `!` after the type or a `BREAKING CHANGE:` footer. Husky pre-commit also runs `lint-staged`.

PRs: clear title matching the commit convention, a "what changed and why" description, linked issues, screenshots/recordings for UI changes, reproduction steps for bug fixes, and confirmation that `npm run build` succeeds. One feature or fix per PR.

## Security & Configuration Tips

Copy `.env.example` to the path printed by `cloudcli status`. Ports (`SERVER_PORT`, `VITE_PORT`), `HOST`, `DATABASE_PATH`, context windows, and mmx voice settings (`MMX_BIN`, `VOICE_DEFAULT_MODEL`, `VOICE_DEFAULT_VOICE`, `VOICE_TIMEOUT_MS`) are env-driven — never hardcode secrets. Auth uses JWT in `server/middleware/auth.js`; do not log tokens or API keys, and never commit `.env`.
