# Scheduled jobs runbook (STAB-001)

Background work — sample copy drafts, design renders, sample scheduling and cancelling, result pulls, daily reports and health checks, standing (L1) scheduling policy — waits in the job queue until a worker runs it. Before STAB-001 that only happened when someone pressed a "Run … jobs" button. Now a scheduled worker runs it on its own.

## How it works

| Piece                                  | What it does                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /api/internal/jobs`               | The worker. Needs `Authorization: Bearer <CRON_SECRET>`; anything else gets `401` and runs nothing.                |
| `.github/workflows/scheduled-jobs.yml` | Calls the worker every 30 minutes (minute 3 and 33) once switched on. This is the frequent trigger.                |
| `vercel.json` cron                     | Calls the worker once a day, some time between 01:00 and 02:00 UTC (Hobby crons are not minute-exact). A backstop. |
| `features/cron/scheduler.ts`           | Visits workspaces in bounded batches: waiting work first, then daily housekeeping for the rest.                    |
| `POST /api/internal/jobs` (unchanged)  | Loopback-only test dispatch for one workspace; refused anywhere but a local fake stack.                            |

One request visits at most 100 workspaces, claims at most 4 jobs per workspace per visit (up to 3 visits when a workspace still has more), and starts no new visit after 40 seconds (the route may run for 60). Workspaces it did not reach are reported as `deferred` and picked up by the next run.

The response contains counts only, for example `{"live":false,"tenants":3,"processed":5,"failed":0,"deferred":0,"rounds":1}`.

### Safety

- **Fails closed.** No secret configured, a secret shorter than 32 characters, a wrong secret or a non-`Bearer` header → `401`. `ADAPTER_MODE=real` (or any value other than `fake`) → `503`: this worker only has sample (fixture) providers. Nothing talks to live Klaviyo, Shopify or email.
- **No paid AI.** AI rewrites (`email.rewrite`) and uploaded-file imports (`email.import`) are never picked up. They keep their own resume path on the owner's page, so the scheduler cannot start or retry anything that costs real money.
- **Safe to run twice at once.** Vercel and GitHub may overlap, and cron delivery is at-least-once. Each job is claimed under the workspace lock with one lease (`claim_job`, `for update skip locked`), retries stop after 4 attempts, stale leases are recovered, and daily housekeeping jobs have unique keys. The browser test `tests/e2e/scheduled-sweep.spec.ts` runs three sweeps at the same moment and checks every job ran exactly once. It also checks that a job whose retry wait has passed runs again (attempt 2), a job left by a crashed worker is picked up again (attempt 2), and a job that already used its fourth attempt is marked failed instead of tried a fifth time.
- **Paused workspaces are skipped.** Only `active` workspaces are visited (waiting work is looked up with that filter in the same query); the database re-checks this on every claim.
- **One broken workspace does not stop the others.** Its visit is counted in `failed`, logged with the workspace ID and error code (never a message or secret), and its jobs stay queued for the next run.

## Setup (Raman)

You need one random secret and you put the **same value** in two places. Do not paste it in chat, an issue or a commit.

1. **Make the secret.** Use your password manager to generate a random password of at least 40 characters, letters and numbers only (no spaces or quotes).
2. **Vercel:** Project `grey-retention-app` → Settings → Environment Variables → add `CRON_SECRET` with that value for **Production** → Save → redeploy (Deployments → latest → Redeploy) so the app sees it.
3. **GitHub secret:** repository → Settings → Secrets and variables → Actions → **Secrets** tab → New repository secret → name `CRON_SECRET`, same value.
4. **Turn on GitHub Actions** if it is still off: repository → Settings → Actions → General → "Allow all actions and reusable workflows" → Save. Without this neither CI nor the 30-minute schedule runs (the daily Vercel cron still does).
5. **Switch the 30-minute schedule on** (read the cost note first): same page as step 3 → **Variables** tab → New repository variable → name `SCHEDULED_JOBS_ENABLED`, value `true`. Until this exists every scheduled run is skipped and uses no Actions minutes.

### Check it works

- GitHub → Actions → **Scheduled jobs** → "Run workflow". The run log ends with a line like `{"live":false,"tenants":…}`. A red run shows the reason: the secret is missing, `401` (the two secrets differ) or `503` (server setup). A yellow warning means some workspace visits stopped on an error; their jobs wait for the next run and the Vercel function logs show the error code.
- Or queue some sample work (for example "Generate copy" on a campaign) and wait up to 30 minutes: the campaign moves on without pressing "Run fixture jobs".

### Pause or change

- **Pause:** GitHub → Settings → Secrets and variables → Actions → **Variables** tab → change `SCHEDULED_JOBS_ENABLED` to `false` (or delete it). Skipped runs use no Actions minutes. Set it back to `true` to resume. Queued work then waits for the daily Vercel run.
- **Different frequency:** edit the `cron:` line in `.github/workflows/scheduled-jobs.yml`.
- **Change the secret:** generate a new one, then update Vercel (and redeploy) and the GitHub secret one right after the other. Runs in between get `401` and do nothing; queued work simply waits for the next run.
- The address is fixed to `https://grey-retention-app.vercel.app` and HTTPS only, so the secret is never sent anywhere else.

### Cost note

The repository is private, so GitHub Actions minutes count against the account allowance (GitHub Free: 2,000 minutes a month; Pro: 3,000). GitHub rounds every run up to one minute. Every 30 minutes (Raman's choice, November 6, 2026) is about **1,500 minutes a month**. That leaves about 500 free minutes for CI, which is roughly 20 runs of the browser check (see `docs/CI_RUNBOOK.md`). When minutes run out, Actions stops (including CI) until next month unless a spending limit is set. Options: set a spending limit (Settings → Billing), run hourly (`cron: '3 * * * *'`, about 750 minutes), or switch the schedule off and rely on the daily Vercel run. A later option is a database-side schedule (Supabase `pg_cron`), which costs no Actions minutes.

## The Inspiration inbox (INB-001, INB-002)

Each sweep first reads the Inspiration inbox, for at most 18 seconds. It reads Gmail when `INBOX_IMAP_USER` and `INBOX_IMAP_APP_PASSWORD` are set in Vercel, and the sample inbox otherwise. It records new newsletters and keeps every image they use. Then the workspace jobs run in what is left of the time.

A server function cannot run a browser, so the **600px screenshot** of each new email is taken by a second workflow, **Inbox screenshots** (`.github/workflows/inbox-screenshots.yml`). It runs at minutes 18 and 48, 15 minutes after each sweep, and needs nothing new: the same `CRON_SECRET` secret and the same `SCHEDULED_JOBS_ENABLED=true` variable switch it on and off.

- **When nothing is waiting**, a run makes one small request and stops, in a few seconds.
- **When emails are waiting**, it installs Chromium (about two minutes) and photographs up to 20 emails per run. It opens each one with JavaScript off and only that email's own stored files allowed.
- **Its log shows counts only**, for example `Screenshots taken: 3. Failed: 0.`
- **Check it:** GitHub → Actions → **Inbox screenshots** → "Run workflow".
- **Stop reading the real inbox without a code change:** set `INBOX_TRANSPORT=fake` in Vercel, then redeploy (Deployments → latest → Redeploy) so the app sees it.

## Not covered yet

- The "Run fixture jobs" buttons still exist; hiding them from brand owners is STAB-002.
- AI rewrites and file imports resume from the owner's page, not from the scheduler (by design, see Safety).
- There is no admin screen for the last run's status, duration and errors yet (register item OPS-014); use the GitHub Actions run log or Vercel function logs.
- With more than 1,000 active workspaces, daily housekeeping would need cursor paging; workspaces with waiting jobs are still found and visited first.
- A workspace visit that starts just before the 40-second cut-off can run past Vercel's 60-second limit. If it is stopped mid-job, that job's lease is recovered on the next run and one of its four attempts is used.
