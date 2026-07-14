---
name: backend-tsx-test
description: Run focused backend TypeScript tests in CloudCLI with the correct tsconfig and `tsx --test` invocation so the `@/*` alias resolves and `node:test` finds the files.
source: auto-skill
extracted_at: '2026-07-14T20:47:29.373Z'
---

## When to use

Use this skill when you need to run a single backend test (or a small set of tests) in CloudCLI without a global `test` script in `package.json`. It also applies when a `node --import tsx --test` command fails with `ERR_MODULE_NOT_FOUND` on `Cannot find package '@/shared'`.

## Why this matters

`package.json` does not define a `test` script. Tests live alongside the modules they exercise (for example `server/shared/tests/*.test.ts`, `server/modules/**/tests/*.test.ts`, `server/routes/tests/*.test.js`) and use Node's built-in `node:test` runner with `node:assert/strict`.

The frontend `tsconfig.json` defines `@/* -> src/*`, so letting `tsx` default to that file breaks any backend test that imports `server/shared/*` via the backend alias `@/*`. The backend alias `@/* -> server/*` is only declared in `server/tsconfig.json`.

## Procedure

1. Identify the focused test file you want to run (e.g. `server/shared/tests/slice-tail-page.test.ts`).
2. From the repository root, invoke `tsx` through `npx` with the backend TypeScript configuration so the `@/*` alias resolves correctly:

   ```bash
   npx tsx --tsconfig server/tsconfig.json --test <path-to-test-file>
   ```

3. Pass multiple test paths in the same command when you want a broader run; `tsx --test` accepts a list of files.

4. Verify the output reports `tests ... pass ... fail 0`. The runner prints a summary such as `ℹ tests N / ℹ suites 0 / ℹ pass N / ℹ fail 0`.

## Common pitfalls

- **`Cannot find package '@/shared'`** — caused by using `node --import tsx --test ...` or by letting `tsx` use the frontend `tsconfig.json`. Always pass `--tsconfig server/tsconfig.json` explicitly.
- **Running from a subdirectory** — `tsx` resolves the config relative to the file, but the `@/*` alias still matches `server/*`. Always run from the repository root.
- **Assuming `npm test` exists** — there is no canonical all-tests command yet; stay focused and document the explicit path rather than inventing one.

## How to apply

- Reach for this skill whenever a backend test needs to be exercised during a change, a CI-like local check, or a quick verification after editing shared helpers.
- Update `QWEN.md` with the exact command only after running it and confirming `pass` lines (this skill reflects the verified, passing command).
