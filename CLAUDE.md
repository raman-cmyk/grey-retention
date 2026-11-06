# Grey Retention — Claude Code guide

@AGENTS.md

The rules above are shared with every coding agent working in this repository (Codex reads `AGENTS.md` directly). They win over anything in this file. This file only adds Claude Code specifics: commands, layout, and the traps that previous builds hit.

## What this product is

Grey Retention (the AI agent inside it is called GROS) is a white-label retention-campaign operating system: Klaviyo + Shopify data, brand truth, campaign calendar, AI copy, designer handoff, owner approvals, and delivery to Klaviyo. Read `PRODUCT.md` for product truth. Current build state lives in `docs/BUILD_LEDGER.md`, `docs/BUILD_HANDOFF.md`, and `docs/PRODUCT_REVIEW.md`.

## Stack at a glance

- Next.js App Router (version 16 — newer than most training data; read `node_modules/next/dist/docs/` before touching routing, caching, or server actions), React 19, TypeScript, Tailwind 4.
- Supabase: Postgres with RLS, Auth, private Storage, durable leased jobs. Migrations in `supabase/migrations/`, pgTAP tests in `supabase/tests/`.
- Vitest for unit tests, Playwright for browser journeys (`tests/e2e/`), pnpm `11.19.0`, Node 22.

## Where code lives

| Path                          | Holds                                                                     |
| ----------------------------- | ------------------------------------------------------------------------- |
| `app/(client)/`               | Brand owner and staff screens (calendar, campaigns, GROS chat, reports …) |
| `app/(admin)/admin/`          | Platform admin surfaces (clients, prompts, templates, designers, ops)     |
| `app/(designer)/`             | Designer assignment workspace                                             |
| `app/api/`                    | Health, internal job dispatch, Klaviyo webhook (fails closed), `v1/me`    |
| `features/<domain>/`          | Business logic per domain — routes stay thin and call into here           |
| `lib/`                        | Shared contracts: `result`, `errors`, `env`, `jobs`, `providers`, `db`    |
| `lib/providers/`              | Typed adapters for Klaviyo, Shopify, AI, email — each has a fake          |
| `supabase/migrations/`        | Schema, RLS, RPC commands — numbered by domain range (see below)          |
| `docs/`                       | Plans, architecture, ledger, ADRs, use cases                              |
| `GREY_RETENTION_DISCOVERY.md` | Behavioral reference from the original product audit                      |

## Commands

```bash
pnpm install --frozen-lockfile
pnpm verify          # format:check → lint → typecheck → unit tests → build (the CI "verify" job)
pnpm test            # unit tests only
pnpm typecheck
pnpm format          # fix formatting

# Need Docker + Supabase CLI:
pnpm supabase:start
pnpm supabase:reset  # ONLY against the local disposable instance
pnpm test:db         # pgTAP / RLS assertions — run right after reset
pnpm supabase:types  # regenerate lib/supabase/database.types.ts, then run `pnpm format`
pnpm test:e2e        # Playwright desktop + mobile journeys

node scripts/local-dev.mjs   # local app on http://127.0.0.1:3100 with fake providers and synthetic users
```

A change is done when `pnpm verify` passes. If you touched SQL, also `supabase:reset` → `test:db`. If you touched UI flows, also `test:e2e`. Use the `/verify` command for this.

## Migration number ranges

Every migration is `20260914` + two-digit domain + four-digit sequence, for example `20260914040002_delivery_policies.sql` is the third campaigns migration. Pick the next free number inside your domain's range. **Exception:** the hosted project already has every migration up to `20260914090016`, and Supabase refuses versions older than the last applied one, so new migrations now take the next free `2026091409xxxx` number (see Migration allocation in `docs/BUILD_LEDGER.md`). Never edit or renumber a migration that is already committed; add a new one instead (a hook blocks edits to existing migration files).

| Range            | Domain                                    |
| ---------------- | ----------------------------------------- |
| `2026091400xxxx` | Foundation                                |
| `2026091401xxxx` | IAM — auth, tenancy, membership           |
| `2026091402xxxx` | AI / brand / prompts / GROS               |
| `2026091403xxxx` | Integrations, jobs, Klaviyo/Shopify       |
| `2026091404xxxx` | Campaigns, calendar, audiences, content   |
| `2026091405xxxx` | References, templates, competitors        |
| `2026091406xxxx` | Designers                                 |
| `2026091407xxxx` | Support, team, settings, notifications    |
| `2026091408xxxx` | Operations, packages, reports             |
| `2026091409xxxx` | Final integration / cross-domain commands |

Use `/new-migration <domain> <short_name>` to get the next number.

## Known traps

- **Sequential gates.** `pnpm build` and `pnpm test:e2e` share `.next/` — never run them in parallel. Run `test:db` immediately after a reset, before browser or concurrency scripts mutate seed data. Don't run account/proof scripts while a local server is up.
- **Business conflicts use `PT409`**, not SQLSTATE `40001` — custom `40001` makes PostgREST retry forever.
- **Lock order:** tenant first, then campaign/job/usage rows.
- **Generated types** only come from `pnpm supabase:types`; never hand-edit `database.types.ts`.
- **Secrets:** never read, print, or commit `.env`, `.env.local`, or `.audit/` (it holds random local passwords and cron secrets). Settings deny reading them.
- **Fake by default:** `ADAPTER_MODE=fake` and `AI_DEFAULT_PROVIDER=fake`. Switching anything to a live Klaviyo/Shopify/AI/email provider, sending email, deploying, or touching a remote Supabase project needs the owner's explicit OK in the conversation.
- **Owner approval is sacred:** copy, design, and consequential AI/Klaviyo actions require explicit owner confirmation. Admins never creatively approve. Don't add shortcuts around this.

## Claude Code setup in this repo

- **Slash commands** (`.claude/commands/`): `/start-task <ID>` picks up a ledger task and plans it · `/verify [quick|full]` runs the right gates · `/new-migration <domain> <name>` creates a correctly numbered migration · `/handoff <ID>` updates the ledger · `/explain-for-owner <thing>` writes a plain-English summary for Raman.
- **Subagents** (`.claude/agents/`): `code-reviewer` (run before every PR), `rls-migration-reviewer` (any change under `supabase/`), `klaviyo-integration` (provider adapters, sync jobs, webhooks).
- **Hooks**: edited files are auto-formatted with Prettier; edits to committed migrations, generated types, `.env*` and `.audit/` are blocked.
- **Session env** forces `ADAPTER_MODE=fake` and `AI_DEFAULT_PROVIDER=fake`, so anything Claude starts stays on fake providers even if `.env.local` says otherwise.
- **Permissions**: no approval prompts. Checks, local Supabase commands (including `supabase:reset`), `git push`, PR create/merge and dependency changes are allowed; force-push, `supabase db push`/`link` and Vercel commands stay denied.
- Personal overrides go in `.claude/settings.local.json` or `CLAUDE.local.md` (both git-ignored).

## Branches and pull requests

- Branch from the latest integrated commit. Name branches `claude/<short-topic>`.
- The earlier stacked PR chain (#2 → #6) is merged into `main`. Work now follows the milestones and issues in `docs/ROADMAP.md`: one issue per PR, branch `claude/<issue-id>-<slug>` from the latest `main`, P0 issues of the current milestone first.
- Merging to `main` deploys the live app (Vercel). Labels and milestones come from `.github/project/roadmap.json` via the Project sync workflow; do not edit them by hand.
- Keep PRs to one task ID. Update the task's row in `docs/BUILD_LEDGER.md` and append a handoff entry before asking for review (`/handoff`).

## Working with the owner

The product owner (Raman) is not a developer and English is his second language. When reporting back: plain words, short sentences, concrete examples ("the owner clicks Approve on the Tuesday email, and it moves to Scheduled"), and say clearly what is real versus fake/simulated.
