# CI runbook (STAB-004)

GitHub Actions checks every pull request before it is merged. Merging to `main` deploys the live app, so a red check means "do not merge yet".

## What runs, and when

| Workflow                               | Job        | Runs on                                                                                                | What it checks                                                                                                      | Typical time |
| -------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------ |
| `.github/workflows/ci.yml`             | `verify`   | Every pull request, every push to `main`, or by hand                                                   | Formatting, lint, typecheck, unit tests, production build                                                           | ~5 min       |
| `.github/workflows/database.yml`       | `database` | Pull requests (and merges to `main`) that change `supabase/**` or the Supabase CLI version, or by hand | Fresh local Supabase → reset → all pgTAP / RLS assertions                                                           | ~5 min       |
| `.github/workflows/browser.yml`        | `browser`  | Pull requests that change app, test, script, schema or build files, or by hand                         | Fresh local Supabase → reset → every desktop and mobile journey, then the first-draft and email concurrency scripts | ~20–30 min   |
| `.github/workflows/scheduled-jobs.yml` | `run`      | Every 30 minutes, only when switched on (see `docs/SCHEDULED_JOBS_RUNBOOK.md`)                         | Runs queued jobs on the live app                                                                                    | ~1 min       |
| `.github/workflows/project-sync.yml`   | `sync`     | Pushes to `main` that change the roadmap or register                                                   | Labels and milestones                                                                                               | ~1 min       |

Draft pull requests skip the database and browser checks until they are marked "Ready for review". A pull request that only changes documentation runs only `verify`. `tests/ci/workflows.test.ts` fails if a new tracked file is neither covered by the browser filter nor listed as unable to affect journeys, so a new folder cannot silently skip the browser check. A newer push to a pull request cancels its older runs; runs on `main` are never cancelled.

Both Supabase checks start only the services the tests use (database, auth, REST, storage, mail). On November 6, 2026 this lean stack passed 600/600 database assertions, 80/80 browser journeys and all three concurrency scripts locally. `tests/ci/workflows.test.ts` checks that the workflows keep their triggers, time limits, permissions and path filters.

All checks use fake providers and a throwaway local database inside the runner. Nothing talks to the live Supabase project, Klaviyo, Shopify, OpenAI or email.

## Setup (Raman)

1. **Turn on GitHub Actions:** repository → Settings → Actions → General → "Allow all actions and reusable workflows" → Save.
2. **Make `verify` required** so a red pull request cannot be merged: Settings → Branches → "Add branch ruleset" (or "Add classic branch protection rule") for `main`:
   - turn on "Require status checks to pass" and add the check named **`verify`** (it appears in the list after it has run once on a pull request);
   - leave "Require branches to be up to date" **off** — it would re-run every check after every other merge and use many more minutes;
   - do **not** add `database` or `browser` as required: they only run when their files change, and a required check that never starts blocks the pull request forever.
3. Optional: Settings → Billing → set an Actions spending limit so CI cannot stop mid-month when free minutes run out.

## Minutes (private repository)

GitHub rounds every job up to a whole minute. Rough cost per pull request update: `verify` ~5 minutes; plus ~5 when the schema changes; plus ~25 when app code changes. A busy day with five app pull requests, each pushed twice, is about 300 minutes. GitHub Free includes 2,000 minutes a month (Pro: 3,000), shared with the scheduled-jobs workflow (about 1,500 a month at every 30 minutes when switched on), so roughly 500 free minutes are left for CI — about 20 browser-check runs. Ways to spend less:

- open work-in-progress pull requests as drafts (slow checks wait until "Ready for review");
- push related fixes together rather than one commit at a time (each push restarts the checks; older runs are cancelled automatically);
- run the browser check by hand only when needed: Actions → Browser → "Run workflow";
- run the scheduled-jobs workflow less often (see its runbook).

## When a check is red

- Open the pull request → "Checks" → the red job → the failing step. When the browser job fails it uploads the HTML Playwright report and test output (screenshots, traces of retried tests) as an artifact named `playwright-report`, kept 7 days. Traces can show the random passwords and secret of that run's throwaway local stack; they stop working when the run ends, and the hidden `.audit/` folder is never uploaded.
- Reproduce locally with the same commands: `pnpm verify`; `pnpm supabase:start && pnpm supabase:reset && pnpm test:db`; `pnpm supabase:reset && pnpm test:e2e`.
- Never skip, disable or quarantine a test to make a check green.
