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

- GitHub → Actions → **Scheduled jobs** → "Run workflow". The run log ends with a line like `{"live":false,"tenants":…}`. A red run shows the reason in the app's own words: the secret is missing, `401 (Unauthorized)` (the two secrets differ) or `503` (server setup).
- **Retries (CI-005):** each of the six scheduled workflows (Scheduled jobs, Onboarding readers, Inbox tagging, Inbox screenshots, Klaviyo results, Studio renders) tries its first call (Inbox screenshots and Studio renders: the check for waiting work) once more after 2 minutes when it gets no answer or an error. A yellow "Trying again in 2 minutes" line is not a failure; the run is red only when both tries fail. Spaces and line breaks at either end of `CRON_SECRET` (an easy slip when pasting) are ignored in GitHub and in the app.
- **Failure emails are off** (owner, 15 Nov): check the Actions tab after a batch of merges. A yellow warning means some workspace visits stopped on an error; their jobs wait for the next run and the Vercel function logs show the error code.
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

`INBOX_SUBSCRIBER_NAMES` (not secret, optional) lists the names the inbox subscribed to newsletters with, comma separated, for example `Sam Rivera, Sam`. Before a workspace may read a real brand's email, the privacy cleaner (REAL-1b1) removes these names, the address in `INBOX_IMAP_USER` and every other email address from it. Use a persona's name, never a common word ("Rose", "May"): every whole-word copy of it is removed. Write the name with its accents: it is read one way only. Capitals do not matter, and a copy without an accent or ß the name has still goes ("José" also as "jose" or "JOSE", "Strauß" as "STRAUSS"; so does the word "angel" for "Ángel"). A copy with an accent or ß the name lacks stays ("Noel" keeps "Noël", "Weiss" keeps "Weiß"), and so does a word in another script ("Tom" keeps the Russian "том"); only a word that mixes Latin, Cyrillic and Greek letters is read as a disguise ("Ѕаm"). Arabic vowel signs, Hebrew points and marks that only decorate a letter (a strike-through, a dot below) never matter. A name word is also found glued to other text: at a digit ("SAM20", "20SAM"), where a small letter meets a capital ("HappyBirthdaySam", "#SamStyle", "SamR."), after `#` or `@`, in capitals with up to three more capitals ("SAMVIP", "VIPSAM"), and the name with its words run together in any case ("samrivera", "@SamRiveraOfficial"). Words that only start like the name stay ("Samsung", "Samba", "Maxwell", "MAXIMUM"); some others go on the safe side ("#SamSmith", "MaxMara", "samrivera.example"). In a picture's address a name word of three letters or more counts anywhere, even inside a longer word, so a picture whose address only looks like it is not shown. Only stored copies of pictures are shown, never a `data:` picture written into the email (its own text may name the person), and never a picture from a service that draws one for each subscriber (the hosts in `personalisedImageHosts`, `features/inbox/config.ts`; add one there when it shows up) or whose address carries a recipient's id (`rid`, `uid`, `email_id`, `contact`, `user` and similar, six characters or more). Stored copies keep no text from the file (PNG text chunks, JPEG EXIF, XMP and comments). While it is empty, real brands' emails are not shared with workspaces. Names are removed from the words, most attribute values and CSS strings, but never from class names, ids, font faces, CSS words or HTML tag and attribute names, so a persona called "Max Georgia" keeps `max-width`, `class="max-w"` and `face="Georgia"`. CSS never draws an attribute (`content: attr(class)` is removed), so a name kept there is never shown. A font named like the persona inside a CSS string (`font-family:'Georgia'`) does lose that name.

A server function cannot run a browser, so the **600px screenshot** of each new email is taken by a second workflow, **Inbox screenshots** (`.github/workflows/inbox-screenshots.yml`). It runs at minutes 18 and 48, 15 minutes after each sweep, and needs nothing new: the same `CRON_SECRET` secret and the same `SCHEDULED_JOBS_ENABLED=true` variable switch it on and off.

- **When nothing is waiting**, a run makes one small request and stops, in a few seconds.
- **When emails are waiting**, it installs Chromium (about two minutes) and photographs up to 20 emails per run. It opens each one with JavaScript off and only that email's own stored files allowed.
- **Its log shows counts only**, for example `Screenshots taken: 3. Failed: 0.`
- **Check it:** GitHub → Actions → **Inbox screenshots** → "Run workflow".
- **Stop reading the real inbox without a code change:** set `INBOX_TRANSPORT=fake` in Vercel, then redeploy (Deployments → latest → Redeploy) so the app sees it.

## The design studio's pictures (DST-001)

A designed email has sections drawn as pictures (the design studio, D25). A server function cannot run a browser, so a workflow draws them: **Studio renders** (`.github/workflows/studio-renders.yml`). It runs every 10 minutes (minutes 5, 15, … 55) and needs nothing new: the same `CRON_SECRET` secret and the same `SCHEDULED_JOBS_ENABLED=true` variable switch it on and off.

- **When nothing is waiting**, a run makes three small requests and stops, in a few seconds: one peek for sections, one for the emails' views (DST-005b), and the designs waiting for their pictures carry on. Nothing asks for pictures until "Create email" uses the design studio (`DESIGN_STUDIO`), so for now every run is idle.
- **When pictures are waiting**, it installs Chromium (about two minutes) and draws up to 24 pictures per run: first the designed sections, then the emails' views (desktop 600 px, phone 375 px, dark mode). Each is drawn with JavaScript off and only its own pictures and fonts allowed, and uploaded straight into the private `studio-renders` bucket.
- **Its log shows counts only**, one line for each kind, for example `Sections drawn: 3. Failed: 0. Not recorded: 0.` and `Email views drawn: 3. Failed: 0. Not recorded: 0.` ("Not recorded": the app did not take the result; the picture is drawn again once its lease runs out). A run stops after 6 minutes, or when the browser stops. The repository is public, so its logs are too: it never prints a section, a link or the secret.
- **Cost:** the repository is public, so GitHub Actions minutes are free for it (the cost note above was written when it was private).
- **Check it:** GitHub → Actions → **Studio renders** → "Run workflow".
- **Pause it** with the same `SCHEDULED_JOBS_ENABLED` switch as the other jobs.

## Not covered yet

- The "Run fixture jobs" buttons still exist; hiding them from brand owners is STAB-002.
- AI rewrites and file imports resume from the owner's page, not from the scheduler (by design, see Safety).
- There is no admin screen for the last run's status, duration and errors yet (register item OPS-014); use the GitHub Actions run log or Vercel function logs.
- With more than 1,000 active workspaces, daily housekeeping would need cursor paging; workspaces with waiting jobs are still found and visited first.
- A workspace visit that starts just before the 40-second cut-off can run past Vercel's 60-second limit. If it is stopped mid-job, that job's lease is recovered on the next run and one of its four attempts is used.
