---
description: Run the right verification gates for the current changes and report pass/fail in plain words.
argument-hint: '[quick | full]'
---

Verify the current working tree. Mode: `$ARGUMENTS` (default: decide from the diff).

1. Run `git diff --stat main...HEAD` and `git status --short` to see what changed.
2. Always run, one at a time and in this order: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`.
3. Unless the mode is `quick`, run `pnpm build` (never at the same time as Playwright — they share `.next/`).
4. If any file under `supabase/` changed, or the mode is `full`, and Docker is available:
   - confirm the local Supabase instance is the disposable local `grey-retention` project, then ask before running `pnpm supabase:reset`;
   - run `pnpm test:db` immediately after the reset;
   - run `pnpm supabase:types` and `pnpm format`, then check `git diff lib/supabase/database.types.ts` matches the schema change.
5. If any file under `app/`, `components/` or `tests/e2e/` changed, or the mode is `full`, run `pnpm test:e2e` after the build has finished.
6. If Docker or network access is missing, say which gate could not run and why. CI runs the same verify, browser and database jobs on every PR.

Report as a short table: gate, result, key number (for example "80/80 tests"), and the first real error for anything that failed. Fix formatting failures with `pnpm format`. Do not mark the task complete while any runnable gate fails.
