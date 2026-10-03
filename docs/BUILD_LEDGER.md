# Grey Retention MVP — Build Ledger

This file is the durable cross-task memory. Every implementation task must update only its own row and append a handoff entry. Never mark an item complete without verification evidence.

## Current state

| ID      | Workstream                             | Depends on       | Status      | Owner/task             | Verification                                                                                                                       | Notes                                                                                                         |
| ------- | -------------------------------------- | ---------------- | ----------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| FND-001 | Repository foundation                  | —                | complete    | root integration task  | Frozen install; format/lint/typecheck; 8 tests; 26-route build; Playwright 4/4; Impeccable PASS; CI verify/browser/database green. | Commit `dc8a429`; [CI run 34826503699](https://github.com/lookitsme/grey-retention/actions/runs/34826503699). |
| IAM-001 | Auth, tenancy, RLS                     | FND-001          | complete    | root integration task  | CI: reset/seed + 18 RLS assertions; 11 unit tests; 30-route build; 6 browser checks.                                               | Commit `e1ca4ce`; [CI run 34828884619](https://github.com/lookitsme/grey-retention/actions/runs/34828884619). |
| UI-001  | Design system and shells               | FND-001          | in_progress | root integration task  | Reference-neutral semantic theme; responsive role/auth shells; 11 tests; 30-route build; desktop/mobile visual QA.                 | Theme slice complete; active next lane: shared states, forms, dialogs, tables, and shell context.             |
| CAM-001 | Campaign/calendar domain               | IAM-001, UI-001  | blocked     | unassigned             | —                                                                                                                                  | P0 vertical slice.                                                                                            |
| AI-001  | Prompt engine, Brand Truth, GROS       | IAM-001          | blocked     | unassigned             | —                                                                                                                                  | Fake provider first.                                                                                          |
| INT-001 | Queue and Klaviyo integration          | IAM-001          | blocked     | unassigned             | —                                                                                                                                  | Fixture adapter first.                                                                                        |
| OPS-001 | Admin core, packages, jobs             | IAM-001, UI-001  | blocked     | unassigned             | —                                                                                                                                  | Must consume shared contracts.                                                                                |
| REF-001 | References and competitor intelligence | CAM-001, INT-001 | blocked     | unassigned             | —                                                                                                                                  | P1 after campaign IDs stabilize.                                                                              |
| DSG-001 | Designer workflow                      | CAM-001, IAM-001 | blocked     | unassigned             | —                                                                                                                                  | Uses Storage policies.                                                                                        |
| SUP-001 | Team, settings, holidays, support      | IAM-001, UI-001  | blocked     | unassigned             | —                                                                                                                                  | Mostly independent after M1.                                                                                  |
| QUA-001 | Integration, E2E, deployment           | all P0           | blocked     | unassigned             | —                                                                                                                                  | One integration owner.                                                                                        |
| DOC-001 | New-product use cases                  | —                | complete    | root use-case task     | Prettier check; typecheck; 18 unique sequential use cases; 14 decision records; diff whitespace check.                             | Owns `docs/USE_CASES.md`; proposed requirements only; no application/shared contract changes.                 |
| DOC-002 | Diagrams and autonomous v2 build plan  | DOC-001          | complete    | root planning task     | Prettier; typecheck; local link/use-case/task checks; three Mermaid block/participant checks; diff whitespace.                     | Owner-led diagrams and v2 plan aligned; V2-000 is ready; application implementation not started.              |
| V2-000  | Freeze v2 contracts and capabilities   | IAM-001          | complete    | root v2 implementation | pnpm verify: 15 tests; format/lint/types/build pass                                                                                | Frozen policy/ports; no schema change; owner authority and separate states.                                   |
| V2-001  | UI and core persisted campaigns        | V2-000           | in_progress | root v2 implementation | —                                                                                                                                  | Shared UI; brand/catalog/offers/calendar; tenant and owner-approval tests.                                    |
| V2-002  | Owner-designer end-to-end slice        | V2-001           | blocked     | unassigned             | —                                                                                                                                  | Versioned copy/design approvals, revisions, fake delivery/cancel; first working checkpoint.                   |
| V2-003  | Onboarding and classified assets       | V2-002           | blocked     | unassigned             | —                                                                                                                                  | Bulk/ZIP, Drive fixtures, gallery corrections, readiness.                                                     |
| V2-004  | Competitor intelligence and playbook   | V2-003           | blocked     | unassigned             | —                                                                                                                                  | Shared capture; extraction/sequences; tenant-private synthesis and lineage.                                   |
| V2-005  | Calendar generation and bulk copy      | V2-004           | blocked     | unassigned             | —                                                                                                                                  | Server guards, standing rules, approved-entry copy, bulk version approvals.                                   |
| V2-006  | Design rendering and email assembly    | V2-005           | blocked     | unassigned             | —                                                                                                                                  | Owner-reviewed human/AI paths, artifacts, slicing/links/footer, own templates.                                |
| V2-007  | Delivery fidelity and L0/L1 policies   | V2-006           | blocked     | unassigned             | —                                                                                                                                  | Fake schedule/reschedule/cancel/reconcile; 100 fixture pushes; no live execution.                             |
| V2-008  | GROS and operating surfaces            | V2-007           | blocked     | unassigned             | —                                                                                                                                  | Private/shared chat, version-bound proposals, spend, diagnostics, team/support.                               |
| V2-009  | Results, learning and L2 simulation    | V2-008           | blocked     | unassigned             | —                                                                                                                                  | Timed results, evidence thresholds; production L2/design delegation disabled.                                 |
| V2-010  | Optimizer fixtures and libraries       | V2-009           | blocked     | unassigned             | —                                                                                                                                  | Protected-profile sweep simulation and own-template reuse; public archive separate.                           |
| V2-011  | Integrated acceptance and handoff      | V2-010           | blocked     | unassigned             | —                                                                                                                                  | Full checks, reproducibility, honest capability report, progress/handoff, process cleanup.                    |

Allowed statuses: `ready`, `in_progress`, `blocked`, `review`, `complete`.

## Global decisions

| Decision            | Value                                                                                          | Reason                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Runtime             | Next.js App Router + TypeScript                                                                | One deployable web application with server-rendered role surfaces.                                         |
| Architecture        | Modular monolith with explicit domain modules                                                  | Fast MVP iteration without premature distributed-system overhead.                                          |
| Hosting             | Vercel                                                                                         | Preview deployments and server functions.                                                                  |
| Backend             | Supabase Postgres/Auth/Storage/Realtime/Queues                                                 | Durable relational core and tenant security.                                                               |
| Isolation           | Server authorization plus PostgreSQL RLS                                                       | Deny-by-default tenant boundaries with defense in depth.                                                   |
| Data access         | `@supabase/ssr` plus generated database types and SQL/RPC                                      | Keeps RLS authoritative and avoids a competing schema source.                                              |
| Validation          | Zod                                                                                            | Shared environment, form, action, and adapter validation.                                                  |
| UI                  | Tailwind CSS + accessible headless primitives                                                  | Fast, consistent, responsive implementation.                                                               |
| Tests               | Vitest + Playwright + pgTAP/SQL security tests                                                 | Covers code, user journeys, and RLS.                                                                       |
| Async               | Durable queue + idempotent workers                                                             | External API work must survive retries and timeouts.                                                       |
| Demo behavior       | Seeded fixtures + fake adapters                                                                | Complete workflow without external secrets or billable calls.                                              |
| Dates               | Store UTC; render in tenant IANA timezone                                                      | Removes the timezone contradiction found in the reference product.                                         |
| Money               | Integer micro-USD internally                                                                   | Avoids floating-point cost errors.                                                                         |
| IDs                 | UUID primary keys; external IDs in unique scoped columns                                       | Stable internal identity and provider reconciliation.                                                      |
| Visual system       | Cool neutral field, white panels, graphite actions, blue interaction cues                      | Matches the user-selected reference theme through original semantic tokens.                                |
| Design review       | Brand owner reviews/revises and approves the exact current design version                      | User-confirmed correction; admins handle assignment, SLA, and escalation.                                  |
| v2 build scope      | New implementation on existing foundation; email-first fake/fixture execution                  | Autonomous plan in `docs/OVERNIGHT_BUILD_PLAN.md`; external actions remain separately authorization-gated. |
| Approval / delivery | Revision-bound approvals; immutable package; reconcile unknown provider outcomes               | Aligns diagrams and target contracts; V2-000 owns code/type/migration integration.                         |
| Autopilot default   | L0 owner confirms; L1 standing policy after owner approvals; production L2/delegation disabled | Preserves owner design control while permitting simulated background scheduling.                           |

Confirmed: reference-neutral visual direction, white-label-first architecture, code-first build path, DRY shared implementation. The selected Impeccable direction uses seed `6f728f1c`; its durable contract is `DESIGN.md` plus `.impeccable/design.json`.

## Migration allocation

To reduce parallel conflicts, each workstream owns a numeric migration block. Do not renumber an already shared migration.

| Range            | Owner                                |
| ---------------- | ------------------------------------ |
| `2026091400xxxx` | Foundation/extensions/helpers        |
| `2026091401xxxx` | Identity/tenancy/RLS                 |
| `2026091402xxxx` | Brand/AI/prompts/usage               |
| `2026091403xxxx` | Integrations/jobs/Klaviyo/Shopify    |
| `2026091404xxxx` | Campaigns/calendar/audiences         |
| `2026091405xxxx` | References/competitors/templates     |
| `2026091406xxxx` | Designers/submissions                |
| `2026091407xxxx` | Support/feedback/notifications       |
| `2026091408xxxx` | Packages/reporting/admin additions   |
| `2026091409xxxx` | Integration fixes/materialized views |

Use a valid 14-digit Supabase migration version inside the assigned UTC-hour namespace, for example `20260914010000_create_tenants.sql`, then increment seconds monotonically. The namespace is an ordering device, not a claim about wall-clock creation time.

## Handoff log

Append entries using this exact shape:

```text
### YYYY-MM-DD — TASK-ID — task name
- Status: review|complete|blocked
- Branch/worktree:
- Commit(s):
- Changed contracts:
- Migrations:
- Verification run:
- Known issues:
- Next consumer:
```

### 2026-09-14 — FND-001 — root integration task

- Status: complete
- Branch/worktree: `main` / `/Users/able/Documents/ChatGPT/Grey Retention`
- Commit(s): `dc8a429`
- Changed contracts: Strict Next.js/TypeScript app; role route groups and shells; typed result/error/logging/id/time/money/provider/job/status helpers; validated white-label `BrandPresentation`; Supabase SSR boundary; CI and test commands; `DESIGN.md` and `.impeccable/design.json`.
- Migrations: `20260914000000_foundation.sql`
- Verification run: `pnpm install --frozen-lockfile`; `pnpm verify` (3 files, 8 tests; 26-route production build); `pnpm test:e2e` (4/4); Impeccable detector/review PASS; GitHub CI 34826503699 verify/browser/database jobs green, including Supabase reset and pgTAP.
- Known issues: GitHub warns that v4 setup actions target deprecated Node 20 internally; runners force Node 24 and all jobs pass. Local database verification requires Docker, so CI remains authoritative on this host.
- Next consumer: IAM-001, then remaining UI-001 states against stable request-context contracts.

### 2026-09-14 — IAM-001 — root integration task

- Status: complete
- Branch/worktree: `main` / `/Users/able/Documents/ChatGPT/Grey Retention`
- Commit(s): `e1ca4ce`
- Changed contracts: Typed client/admin/designer `RequestContext`; active-tenant cookie validated against membership; Supabase SSR client/session-refresh proxy; role-specific page gates; JSON `/api/v1/me`; login/logout/signup/reset/callback/onboarding actions; transactional workspace creation; explicit tenant/platform authorization helpers.
- Migrations: `20260914010000_identity_tenancy.sql`
- Verification run: `pnpm verify` (4 files, 11 tests; 30-route production build); `pnpm test:e2e` (6/6); GitHub CI 34828884619 verify/browser/database jobs green; clean reset and seed; pgTAP identity/RLS suite 18/18.
- Known issues: Seed identities intentionally have no passwords; create login-capable local users through Supabase Studio/Auth Admin API. Hosted Supabase and Vercel are not connected or deployed yet because external mutation needs explicit authorization.
- Next consumer: UI-001, then CAM-001/AI-001/INT-001 against the stable request-context and tenant-isolation contracts.

### 2026-09-14 — UI-001 — reference-neutral theme refresh

- Status: review
- Branch/worktree: `main` / `/Users/able/Documents/ChatGPT/Grey Retention`
- Commit(s): current UI-001 theme commit; hash reported at handoff.
- Changed contracts: Default `BrandPresentation` now uses the user-selected cool neutral theme; Inter is the shared display/body/data face; navigation, auth, buttons, status, and review surfaces consume accessible semantic tokens without dark-rail assumptions. Updated `DESIGN.md` and `.impeccable/design.json` to seed `6f728f1c`.
- Migrations: none.
- Verification run: `pnpm verify` (4 files, 11 tests; 30-route production build); `pnpm test:e2e` (6/6); Impeccable detector; Playwright screenshots at 1440×1000 and 390×844 for authenticated dashboard plus desktop auth.
- Known issues: Remaining UI-001 shared states, dialogs, and data-table primitives are outside this theme slice. Vercel preview SSO protection was disabled so the app's own role login is the only access gate.
- Next consumer: remaining UI-001 component work, then CAM-001 and OPS-001.

### 2026-10-03 — DOC-001 — root use-case task

- Status: complete
- Branch/worktree: `main` / `/Users/able/Documents/ChatGPT/Grey Retention`; local documentation changes only.
- Commit(s): not committed.
- Changed contracts: none. Added proposed `docs/USE_CASES.md` with actors, an illustrative journey, 18 use cases, acceptance/exception paths, build traceability, and 14 open decisions. Existing architecture and deferred-live-send scope remain authoritative pending explicit revision.
- Migrations: none.
- Verification run: `pnpm exec prettier --check docs/USE_CASES.md`; `pnpm typecheck`; document structure checks (18 unique sequential case IDs, 14 decision IDs, closed fences, planning boundary); `git diff --check`.
- Known issues: product decisions are intentionally unresolved and explicitly listed; prior archive inventory does not establish runtime correctness. No proprietary source or runtime data was imported.
- Next consumer: product scope review, then bounded implementation planning against confirmed decisions.

### 2026-10-04 — DOC-002 — root planning task

- Status: complete
- Branch/worktree: `main` / `/Users/able/Documents/ChatGPT/Grey Retention`; local documentation changes only.
- Commit(s): not committed; implementation agent must carry authorized planning changes into a feature branch.
- Changed contracts: Documented user-confirmed owner design-review authority, revision-bound approvals, separate delivery/job states, private/shared chat, simulated delivery/reconciliation, and L1 standing policy. Added `docs/UML_DIAGRAMS.md`, `docs/OVERNIGHT_BUILD_PLAN.md`, and V2-000 through V2-011 ledger rows; aligned use cases and baseline planning docs. V2-000 owns the future code/type/migration integration.
- Migrations: none.
- Verification run: `pnpm typecheck`; Prettier check on eight planning documents; document consistency checks (18 UC IDs, 12 V2 task rows, local links, closed fences); three Mermaid blocks with main-sequence participant/block checks; `git diff --check`. Mermaid render/production app behavior was not tested by this documentation task.
- Known issues: full old SQL schema is unavailable; final segment definitions, production providers, real vision/design quality, L2 delegation, and other commercial decisions remain open. Conservative reversible defaults and disabled live capabilities are documented. No source/runtime/customer data imported and no live provider actions performed.
- Next consumer: implementation agent starts V2-000 from the actual current worktree, then executes eligible phases while maintaining progress/handoff files and verified checkpoints.

## Release checklist

- [ ] Database resets from zero with migrations and safe seed.
- [ ] Generated Supabase types match the final schema.
- [ ] Typecheck, lint, unit, integration, RLS, and Playwright suites pass.
- [ ] Client/admin/designer authorization is deny-by-default.
- [ ] Two-tenant negative-access suite passes.
- [ ] Service-role key never appears in a client bundle.
- [ ] External credentials are encrypted or held only in platform secrets.
- [ ] Queue consumers use leases, attempts, idempotency keys, and dead-letter behavior.
- [ ] Cron endpoints validate a secret and do not trust public callers.
- [ ] AI usage checks run before provider dispatch and reconcile actual usage afterward.
- [ ] File buckets and signed URLs enforce tenant/assignment access.
- [ ] Security headers and rate limits are enabled.
- [ ] Production contains no demo passwords or destructive seed behavior.
- [ ] Preview smoke test completes the P0 campaign journey.
- [ ] Rollback and operational runbooks are documented.

### 2026-10-04 — V2-000 — root v2 implementation

- Status: complete
- Branch/worktree: `codex/grey-retention-v2` / current project; base `b6f92a7`.
- Commit(s): planning preserved in `bf6f968`; contract commit follows this entry.
- Changed contracts: typed approval/design/delivery/revision/lineage/package/queue/usage and provider ports; tested role, visibility, proposal, invalidation, retry defaults. Blueprint freeze above. Format/lint exclude pre-existing generated graph cache without modifying it.
- Migrations: none; existing versions audited.
- Verification run: `pnpm verify` — format, lint, typecheck, 15 tests, 30-route production build passed.
- Known issues: real-provider/vision/design quality and L2 delegation remain disabled/unverified; local Supabase initial image pull in progress.
- Next consumer: V2-001 persisted brand/catalog/campaign slice.
