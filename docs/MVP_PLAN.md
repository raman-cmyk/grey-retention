# Grey Retention MVP — Build Plan

Status: planning complete; implementation not started  
Source of product truth: `GREY_RETENTION_DISCOVERY.md`  
Architecture source of truth: `docs/ARCHITECTURE_BLUEPRINT.md`  
Parallel-work source of truth: `docs/PARALLEL_TASKS.md`  
Execution ledger: `docs/BUILD_LEDGER.md`

## 1. Goal

Build a clean-room, production-shaped MVP of Grey Retention using Next.js, Vercel, and Supabase. The MVP must provide a complete working campaign-planning loop, not just disconnected mock screens:

1. A user signs in and enters a tenant workspace.
2. The tenant connects Klaviyo or uses seeded demo data.
3. Grey Retention synchronizes retention data into a tenant-isolated database.
4. The user records brand context and generates Brand Truth/Voice intelligence.
5. The user plans a campaign on a calendar and creates a draft.
6. The user selects an audience, products, references, copy, and schedule.
7. AI assists through centrally governed prompt contracts and usage controls.
8. The draft moves through review and optional designer handoff.
9. An admin can operate tenants, prompts, jobs, packages, and support.

## 2. Delivery principles

- Contract first: schema, identity, route naming, response envelopes, and job semantics are fixed before feature work fans out.
- Vertical slices: each milestone must work through UI, server authorization, persistence, and tests.
- Tenant isolation by construction: every tenant-owned row carries `tenant_id`; Row Level Security is mandatory and tested.
- External APIs are adapters: application code depends on internal interfaces, not directly on Klaviyo, Shopify, or an AI SDK.
- Async by default: synchronization, AI generation, email ingestion, exports, and notifications run as durable, idempotent jobs.
- Safe AI: prompts are versioned; calls record model, tokens, cost, status, and tenant; spend/token checks happen before dispatch.
- Demoable without secrets: seeded demo data and fake adapters must exercise the whole workflow locally.
- No mystery state: long-running operations have explicit queued/running/succeeded/failed/cancelled states, attempts, cursors, and stale-job recovery.
- Accessibility and responsive behavior are acceptance criteria, not cleanup tasks.
- No credentials, tokens, or customer content are committed to the repository.

## 3. Scope

### P0 — must be working for MVP

- Client, admin, and designer authentication boundaries.
- Multi-tenant memberships and role-based authorization.
- Client dashboard with synced/demo lists, segments, campaigns, flows, and metrics.
- Klaviyo connection, encrypted credential reference, cursor-based sync, diagnostics, and retries.
- Brand profile, products/offers, Brand Truth, and copy/voice context.
- Campaign calendar, day/month planning, campaign draft editor, audience selection, products, subjects, body, references, notes, and scheduling state.
- Prompt registry, prompt versions, provider/model selection, testable fake provider, scoped knowledge injection, AI-call audit, quotas, and spend caps.
- GROS-style campaign assistance using proposal/confirm/action semantics.
- Admin tenant roster/detail, prompt management, LLM controls, job monitor, and packages.
- Team invitations, tenant settings, holidays, profile, and support tickets.
- Durable job queue, cron dispatcher, retry policy, locking, and job diagnostics.
- Seeded demo tenant and repeatable local setup.

### P1 — should be included if P0 remains stable

- Shopify connection and product/order/customer synchronization.
- Competitor-domain requests, inbound-email collection adapter, inspiration library, sender mappings, and curator descriptions.
- Global reference/template library and three-level category taxonomy.
- Designer roster, tenant access, assignment, submission, rejection, approval, and SLA oversight.
- Feature-request/feedback triage.
- AI usage/cost reports and projections.
- CSV export and native XLSX/DOCX only where genuinely needed.
- Provider health checks and notification audit.

### Explicitly deferred

- Subscription payment collection and automatic invoicing; packages and entitlements are implemented, but billing can remain manual.
- Sending a live Klaviyo campaign. MVP creates or prepares a draft and requires explicit operator confirmation.
- A perfect reproduction of undisclosed prompt text or proprietary scoring formulas.
- Enterprise SSO, advanced compliance, mobile applications, and multi-region failover.

## 4. Milestones and gates

### M0 — repository and contracts

Deliver:

- Next.js/TypeScript application scaffold.
- Git repository initialization and first integrated baseline commit; the planning workspace is not yet a Git repository.
- Formatting, linting, unit tests, Playwright, environment validation, CI.
- Supabase local configuration and migration convention.
- Route groups and placeholder layouts for client/admin/designer/auth.
- Shared result/error/job/status types.
- Seed strategy and fake external adapters.

Exit gate:

- Fresh clone installs, starts, tests, and builds.
- `/login`, `/admin/login`, and `/designer/login` render.
- No feature lane needs to choose a second framework or redefine core conventions.

### M1 — identity, tenancy, and shell

Deliver:

- Supabase Auth integration.
- Profiles, tenants, memberships, roles, invitations, and active state.
- Server-side authorization helpers and RLS policies.
- Client/admin/designer navigation shells and responsive primitives.
- Demo accounts/tenant through seed tooling.

Exit gate:

- Cross-tenant access tests fail closed.
- Each role lands in the correct shell.
- Disabled memberships cannot access protected routes.

### M2 — core campaign vertical slice

Deliver:

- Brand profile and manual products/offers.
- Calendar and campaign draft persistence.
- Audience selector backed by seeded lists/segments.
- Draft edit/save/state transitions.
- Prompt registry, fake AI provider, Brand Truth generation, and GROS proposal/confirm flow.

Exit gate:

- A seeded user can create, enrich, edit, and schedule a draft end to end.
- Every AI-like operation is audited even when the fake provider is used.
- Refreshing or opening a second session preserves correct state.

### M3 — integrations and asynchronous execution

Deliver:

- Klaviyo adapter and connection verification.
- Queue/worker/cron infrastructure.
- Cursor-based lists/segments/campaigns/flows/metrics/templates sync.
- Sync status, attempt history, diagnostics, and stale-job recovery.
- Optional Shopify adapter and incremental sync.

Exit gate:

- Replaying a job does not duplicate records or side effects.
- Pagination fixtures cover multiple pages and invalid/expired credentials.
- One tenant cannot observe another tenant's integration data.

### M4 — references, competitor intelligence, and design workflow

Deliver:

- Tenant references and global templates.
- Competitor sender/domain mapping and mock/inbound collector adapter.
- Designer accounts, assignments, submissions, revisions, approvals, and tenant rejection.
- Storage policies for reference and submission files.

Exit gate:

- A draft can select a reference, enter design review, receive a submission, and reach approval.
- File access is signed and tenant/assignment scoped.

### M5 — admin operations and stabilization

Deliver:

- Tenant detail/classification/Admin's Take.
- Prompt editing/versioning/reset/heal/test.
- Tenant LLM overrides and package entitlements.
- Job monitor, provider status, support, feedback, holidays, reporting, and notification audit.
- Security headers, structured logging, rate limits, health checks, backups/runbook notes.

Exit gate:

- Admin can diagnose a failed sync without database access.
- Critical journeys pass Playwright in demo mode.
- CI build, unit, integration, RLS, and end-to-end checks pass.

### M6 — deploy and acceptance

Deliver:

- Supabase hosted project and Vercel preview deployment.
- Secrets configured only in platform environments.
- Production seed limited to safe platform configuration; no demo credentials in production.
- Smoke test and rollback instructions.

Exit gate:

- Preview environment completes the P0 journey.
- Job retries and provider failures are observable.
- Release checklist in `docs/BUILD_LEDGER.md` is green.

## 5. Recommended parallelization

Do not start every feature simultaneously from an empty folder. Use three batches:

1. Batch A: one foundation task initializes Git and completes M0 in the current directory. This is intentionally serial.
2. Batch B: identity/data security and UI shell can proceed in parallel after M0, with the integration maintainer reconciling them into M1.
3. Batch C: Campaign, AI/Brand, Integrations, and Operations workstreams proceed in separate worktrees after M1 contracts are merged.
4. Batch D: References/Designer and Admin/Support/Reports proceed after their underlying domain tables exist.
5. Batch E: a dedicated integration task merges, runs the full suite, fixes contract drift, and owns deployment.

The maximum useful concurrency is four feature tasks plus one integration owner. More lanes create migration, generated-type, dependency, and shared-component conflicts faster than they create product value.

## 6. Verification strategy

Every feature task must include proportional tests:

- Unit: state machines, pricing/token math, prompt rendering, pagination, retry decisions.
- Database: constraints, indexes, triggers, and RLS using two tenants and multiple roles.
- Contract: adapter fixtures for Klaviyo, Shopify, AI, email, and storage.
- Integration: route/server-action authorization and persistence.
- End-to-end: login, campaign creation, AI generation in fake mode, design approval, admin diagnosis.
- Build: typecheck, lint, test, production build, and migration reset from zero.

## 7. Definition of MVP complete

The project is complete only when:

- all P0 journeys operate against persisted data;
- demo mode works without third-party secrets;
- real Klaviyo credentials can be connected without code changes;
- tenant isolation and role boundaries have automated negative tests;
- jobs are idempotent, retryable, locked, and diagnosable;
- AI calls obey prompt version, package quota, tenant limits, and spend caps;
- no page depends on hardcoded tenant IDs or in-memory-only state;
- no secrets or service-role keys reach browser bundles;
- critical UI paths are responsive and keyboard usable;
- a clean database can be created entirely from committed migrations and seed scripts;
- the build ledger contains no unresolved P0 blockers.
