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
| V2-001  | UI and core persisted campaigns        | V2-000           | complete    | root v2 implementation | 33 DB assertions; 16 unit tests; 8 authenticated desktop/mobile journeys; full verify                                              | Core gate passes; shared dialog/table primitives verified in V2-002.                                          |
| V2-002  | Owner-designer end-to-end slice        | V2-001           | complete    | root v2 implementation | 59 DB assertions; full verify 19 unit tests; 10 browser journeys                                                                   | Versioned copy/design approvals, revisions, fake delivery/cancel; first working checkpoint.                   |
| V2-003  | Onboarding and classified assets       | V2-002           | complete    | root v2 implementation | 89 DB assertions; verify 24 unit tests; 14 desktop/mobile journeys                                                                 | Bulk/ZIP, Drive fixtures, gallery corrections, readiness.                                                     |
| V2-004  | Competitor intelligence and playbook   | V2-003           | complete    | root v2 implementation | 107 DB assertions; verify 28 unit tests; 16 desktop/mobile journeys                                                                | Shared capture; extraction/sequences; tenant-private synthesis and lineage.                                   |
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

### 2026-10-04 — V2-001 — root v2 implementation

- Status: review
- Branch/worktree: `codex/grey-retention-v2` / current project.
- Commit(s): follows this checkpoint; V2-000 `b5dd47f`.
- Changed contracts: relational brand/catalog/offers/audience/calendar/content/approval/events/notes schema; transactional owner approval and stale-revision RPCs; server action forms and authenticated calendar/editor/dashboard. Supabase-generated types replace the baseline definitions; optional RPC inputs use omitted arguments (narrow auth callback/context compatibility fix). E2E now requires real local Supabase sessions and random local-only passwords; CI browser job starts/reset its disposable local database. No dependency changes.
- Migrations: `20260914020000`, `20260914040000`, `20260914090000`.
- Verification run: clean local reset/seed; `pnpm supabase:types`; `pnpm test:db` (33 assertions); `pnpm verify` (16 unit tests and production build); `pnpm test:e2e` (8/8 authenticated desktop/mobile checks). Desktop/mobile screenshots inspected; no horizontal overflow. App port 3100 closed after tests.
- Known issues: initial baseline synthetic Auth records required normalization (instance/audience/role/token fields/timestamps and identity rows), now included in safe local seed. Framework emits aborted-stream diagnostics when tests rapidly change sessions; journeys pass. Shared dialog/table primitives remain for V2-002; old UI-001 lane is not marked complete. External provider claims remain unverified.
- Next consumer: V2-002 copy approval, assigned designer/owner revision loop and durable simulated scheduling/cancellation.

### 2026-10-04 — V2-002 — root v2 implementation

- Status: complete
- Branch/worktree: `codex/grey-retention-v2` / `/Users/able/Documents/ChatGPT/Grey Retention`
- Commit(s): this checkpoint commit; hash recorded in progress after commit.
- Changed contracts: Leased durable jobs, persisted fixture provider identity, immutable exact-approval delivery snapshots, creator/assignment-scoped private Storage uploads, original synthetic copy, section revisions, recipient-scoped notifications/fake email audit. Shared native dialogs/tables close V2-001 remainder. Null-safe revision/lease comparisons and remounted draft forms prevent stale execution. No dependency added. Next server action limit is 12 MiB for validated 10 MiB raster uploads; loopback image CSP allowed only in development.
- Migrations: `20260914020001`, `20260914030000`, `20260914060000`, `20260914070000`, `20260914090001`, `20260914090002`; narrow null-check fixes to unshared `20260914090000`.
- Verification run: clean disposable local reset; generated types; `pnpm test:db` 59/59; `pnpm verify` 19 tests, format/lint/typecheck/build; `pnpm test:e2e` 10/10 desktop/mobile real-auth journeys. Actual original PNG uploads/revision/approval/package/schedule/cancel tested; cross-tenant private Storage signed URL denied; no horizontal overflow; sandbox preview and Escape dialog checked; screenshots inspected. Two initial browser synchronization failures fixed, final complete suite passed.
- Known issues: Simulated providers only. Real vision/design quality, slicing and broad link validation not evaluated. Reschedule/result/fault fidelity remain later phases. Background runner is explicitly invoked through an owner action; cron/service dispatch not yet implemented. Framework logs aborted destination streams during rapid session switches; tests pass, no payload/secret logged.
- Next consumer: V2-003 onboarding and assets, then remaining eligible phases.

### 2026-10-04 — V2-003 — root v2 implementation

- Status: complete
- Branch/worktree: `codex/grey-retention-v2` / `/Users/able/Documents/ChatGPT/Grey Retention`
- Commit(s): this checkpoint commit; hash recorded after commit.
- Changed contracts: Private content-addressed asset imports with persisted per-file outcomes, bounded ZIP/raster validation, owner tag/product/variant correction events, synthetic classifier/matcher, read-only fixture Drive and Shopify, supplied-token brand-kit extraction/review, brand fact snapshots/events and conservative approval invalidation. Added `BrandKitExtractor` adapter seam without a dependency. Setup readiness displays unmet evidence and manual catalog stock freshness. Narrow shared changes: pending forms clear prior responses; designer uploads reuse bounded raster validation; fixture worker dispatches onboarding kinds; browser tests serialize shared fixture tenants/queues and await save confirmation before reload.
- Migrations: `20260914020002`, `20260914030001`, `20260914050000`, `20260914090003`. CLI-generated types.
- Verification run: clean local reset/types; `pnpm test:db` 89/89 assertions; `pnpm verify` 24 unit tests plus format/lint/types/production build; full `pnpm test:e2e` 14/14 desktop/mobile journeys. Actual private ZIP and Drive PNGs, SHA dedupe, per-file unsupported failures, corrections, fixture catalog/kit sync and repeat sync verified. Storage cross-tenant signing denied. Gallery screenshots inspected; no overflow. Initial SQL ambiguity and browser early-reload failures fixed before final passes.
- Known issues: Classifier/matcher/kit extraction are synthetic; no real vision quality or 90% target claim. ZIP64/encryption/symlinks/nested archives are explicitly unsupported; intake 10 MiB compressed, 20 MiB expanded, 100 files. PDF brand-kit parsing and real Drive/commerce connections remain unavailable. Competitor readiness is visibly unmet until V2-004. Raster container checks are not an aesthetic/vision evaluation.
- Next consumer: V2-004 capture/library/playbooks; V2-006 consumes corrected assets and kit provenance.

### 2026-10-04 — V2-004 — root v2 implementation

- Status: complete
- Branch/worktree: `codex/grey-retention-v2` / `/Users/able/Documents/ChatGPT/Grey Retention`
- Commit(s): this checkpoint; hash recorded after commit.
- Changed contracts: Shared synthetic capture identity, active tenant-private subscriptions/rules/playbooks, strict typed fixture inbound envelopes, micro extraction/cadence/offer profiles, evidence-linked sequence hypotheses and synthesis. Safe previews are rebuilt from escaped text inside sandboxed frames; no caller HTML, remote images or scripts. Active subscriptions authorize capture queries; designers denied. Readiness now uses actual persisted LIVE source/count evidence. No dependency or real transport endpoint added.
- Migrations: `20260914030002`, `20260914050001`, `20260914090004`; CLI-generated types.
- Verification run: clean reset/types; `pnpm test:db` 107/107; `pnpm verify` 28 unit tests plus format/lint/types/build; full `pnpm test:e2e` 16/16 desktop/mobile journeys. Two tenants reuse sources without reading another's subscription rules/playbooks; capture replay deduplicates; unsubscribe revokes access; hostile source/caller HTML escaped; sequence false matches/gaps tested. Safe-preview screenshots inspected and no overflow. Streamed not-found checks follow installed Next.js documentation (rendered 404 plus direct RLS denial, not an HTTP status assumption).
- Known issues: Entire capture/opt-in/extraction/playbook provider path is original synthetic fixture behavior. Real opt-in, mailbox transport, capture completeness, sequence accuracy and synthesis quality remain unverified/unavailable. Pattern output is advisory and cannot override owner rules. No competitor wording feeds fixture client copy.
- Next consumer: V2-005 guarded rolling plans and weekly copy approvals.
