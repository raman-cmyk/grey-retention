# Grey Retention MVP — Parallel Task Blueprint

October 4, 2026 amendment: follow `docs/OVERNIGHT_BUILD_PLAN.md` for the new v2 sequential implementation assignment. Do not restart completed foundation/identity work. The bounded baseline prompts below remain reference lanes; the owner-led design approval correction overrides their older admin-review wording. The unattended assignment does not itself authorize spawning agents or live provider operations.

## 1. Recommended operating model

Different chats are a good fit if explicitly requested and run in isolated Git worktrees with the same integrated blueprint. Foundation and identity now exist; inspect the ledger before choosing remaining work. For explicitly authorized parallel work, the model is:

- one foundation task first;
- up to four feature tasks concurrently after each dependency gate;
- one integration task that owns merges, generated types, shared dependency changes, full-suite verification, and deployment readiness;
- every task updates `docs/BUILD_LEDGER.md` before handoff.

Do not ask every chat to “build Grey Retention.” Give each chat one bounded task below. Start each batch from the same integrated commit, not from independently stale branches.

## 2. Batch and dependency map

```text
FND-001 Repository foundation
        │
        ├──────────────┐
        ▼              ▼
IAM-001 Identity     UI-001 UI system
        └──────┬───────┘
               ▼
        M1 integration gate
               │
      ┌────────┼───────────┬───────────┐
      ▼        ▼           ▼           ▼
 CAM-001     AI-001      INT-001     OPS-001
      │        │           │           │
      └────────┴─────┬─────┴───────────┘
                     ▼
              P0 vertical-slice gate
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
       REF-001     DSG-001     SUP-001
          └──────────┼──────────┘
                     ▼
                  QUA-001
```

## 3. Integration protocol

Before starting a task:

1. Ensure its dependencies are merged into the shared base.
2. Create a new worktree/branch from that exact commit.
3. Read `AGENTS.md` and all four project documents.
4. Claim the ledger row.

Before handing off:

1. Rebase or merge the latest integration base as directed by the integration owner.
2. Resolve only conflicts in owned paths; escalate contract conflicts.
3. Run required verification.
4. Update ledger status and append a handoff entry.
5. Commit with a focused message and report the commit hash.

The integration owner merges one completed lane at a time and runs schema reset, generated types, typecheck, and tests after each merge. This makes the first failing lane identifiable.

## 4. Task prompts

Copy one prompt into each new Codex task. Replace only the bracketed task name if desired.

### FND-001 — Repository foundation

```text
Build task FND-001 for the Grey Retention MVP. Work autonomously until the task is complete or genuinely blocked.

First read AGENTS.md, docs/MVP_PLAN.md, docs/ARCHITECTURE_BLUEPRINT.md, docs/PARALLEL_TASKS.md, docs/BUILD_LEDGER.md, and the relevant architecture portions of GREY_RETENTION_DISCOVERY.md. Claim FND-001 in the ledger.

The current folder contains planning documents and is not yet a Git repository. Preserve those documents, initialize Git, and create the Next.js App Router + strict TypeScript + pnpm repository foundation in the current directory. Add Tailwind, project-owned accessible UI foundations, Zod environment validation, Supabase SSR/local configuration, Vitest, Testing Library, Playwright, lint/format/typecheck/build scripts, CI, .env.example, and placeholder route groups/layouts for public/auth/client/admin/designer. Add shared typed result/error, logger, ID/time/money helpers, provider interfaces, and fake-adapter conventions without building feature behavior. Establish migration naming, Supabase test/seed scaffolding, and safe security-header defaults. Do not add real credentials or call/deploy external services.

Fresh install, lint, typecheck, unit test, Playwright smoke test, and production build must work as far as the local environment permits. Keep placeholders thin. Update the ledger with verification, contracts, migrations, known issues, and a handoff entry. Commit the result and report the hash and exact commands run.
```

### IAM-001 — Authentication, tenancy, and RLS

```text
Build task IAM-001 for the Grey Retention MVP after FND-001 is integrated. Work only in an isolated worktree and autonomously finish the bounded task.

Read AGENTS.md and all project blueprint/ledger documents, then claim IAM-001. Implement Supabase Auth SSR, profiles, tenants, platform_admins, tenant_memberships, tenant_invites, designers, and designer_tenant_access using the `2026091401xxxx` migration namespace. Implement typed client/admin/designer RequestContext resolution, middleware/page protection, login/logout/reset/signup foundations, membership-based tenant selection, inactive-account handling, and server authorization helpers. Add RLS to every owned table and rigorous two-tenant positive/negative SQL tests for owner/admin/staff/platform-admin/designer cases. Add deterministic local-only seed identities without production demo passwords.

Do not redesign shared UI primitives; use the existing shell slots. Do not use the service-role key in browser code. Run database reset, RLS tests, unit/integration tests, typecheck, and build. Update the ledger and handoff log, commit, and report the hash and evidence.
```

### UI-001 — Design system and role shells

```text
Build task UI-001 for the Grey Retention MVP after FND-001 is integrated. Work autonomously in an isolated worktree.

Read AGENTS.md, the plan, architecture blueprint, parallel blueprint, ledger, and the UI/navigation sections of GREY_RETENTION_DISCOVERY.md. Claim UI-001. Build a cohesive, accessible, responsive design system and the client, admin, and designer shells. Own components/ui, components/shell, navigation configuration, role layouts, dashboard skeleton states, forms, dialogs, toasts, tables, tabs, pagination, status badges, empty/error/loading/stale states, and story/demo routes or focused component tests. Match the product's restrained charcoal/system-blue direction while creating original implementation and improving accessibility/responsiveness. Avoid page-specific monolithic scripts and CDN runtime dependencies.

Do not implement domain persistence or replace auth contracts. Expose stable typed component APIs for feature lanes. Verify keyboard behavior, responsive layouts, unit/accessibility checks, typecheck, and build. Update ledger/handoff, commit, and report the hash and evidence.
```

### CAM-001 — Campaign and calendar vertical slice

```text
Build task CAM-001 after the M1 identity/UI gate is integrated. Work autonomously in an isolated worktree.

Read AGENTS.md and all project documents; inspect the campaign/calendar/draft sections of GREY_RETENTION_DISCOVERY.md. Claim CAM-001. Using the `2026091404xxxx` migration namespace, implement campaigns, subjects, content, audiences, products links, references links, comments, attachments metadata, events, and calendar_plans. Implement the campaign state machine and authorized transition service. Build the client Campaign Agent calendar, day/month planning forms, campaign create/edit workspace, audience/product/reference slots, autosave-safe persistence, schedule controls, status history, and seeded end-to-end workflow. Define typed interfaces where AI, Klaviyo, references, or designer services will plug in; use fake implementations rather than owning those domains.

Add constraints/indexes/RLS, two-tenant security tests, state-machine unit tests, server-action tests, and Playwright coverage for create-edit-refresh-schedule. Do not write directly to state columns from UI code. Update ledger/handoff, commit, and report the hash and verification.
```

### AI-001 — Brand intelligence, prompts, and GROS

```text
Build task AI-001 after the M1 gate is integrated. Work autonomously in an isolated worktree.

Read AGENTS.md and all project documents plus the Brand, GROS, prompt-engine, Admin's Take, and Email Knowledge discovery sections. Claim AI-001. Using the `2026091402xxxx` migration namespace, implement brand_profiles, Brand Truth/Voice sections, offers, prompt_definitions, immutable prompt_versions, knowledge entries and match tables, admin_takes, tenant_llm_controls, ai_calls, ai_action_proposals, and token-ledger foundations. Build deterministic prompt assembly, variable validation, JSON-schema/Zod output validation, fake/fixture AI provider, provider-neutral runner, effective max-token calculation, usage reservation/reconciliation interface, and proposal-confirm-action semantics. Implement client Brand & Store/GROS surfaces and admin Prompts, Email Knowledge, injection preview, and LLM Controls surfaces.

Create original clean-room prompt defaults for the 34 discovered keys; do not reproduce private prompt or tenant-note contents. Do not call paid providers. Treat packages/spend persistence through an interface that OPS-001 can complete. Test filtering/injection, prompt version immutability, JSON repair/error behavior, token math, confirmation gating, tenant isolation, and the fake-provider UI journey. Update ledger/handoff, commit, and report the hash and verification.
```

### INT-001 — Queues, Klaviyo, Shopify foundations, and dashboard

```text
Build task INT-001 after the M1 gate is integrated. Work autonomously in an isolated worktree.

Read AGENTS.md and all project documents plus the Dashboard, Connections, Klaviyo diagnostics, Shopify, and cron sections of the discovery report. Claim INT-001. Using the `2026091403xxxx` migration namespace, implement integration_connections, sanitized integration_requests, sync_jobs/steps, job_runs, normalized Klaviyo resource tables, and Shopify sync foundations. Implement the durable queue abstraction, leasing/visibility/heartbeat, idempotency, retry/backoff/dead-letter behavior, stale-job recovery, secured drain endpoint, logical schedules, fixture adapters, and real Klaviyo adapter behind environment configuration. Follow provider next links/cursors and resource-specific pagination; cover 429, 401, timeout, malformed and partial responses. Add Shopify interfaces and fixture flow; live Shopify can remain adapter-complete rather than exhaustive if time is constrained.

Build Connections, sync status/diagnostics, admin cron monitor, and client dashboard/resource explorer against persisted fixture data. Never log credentials or raw sensitive responses. Test duplicate cron delivery, concurrent claims, replay safety, multi-page sync, tenant isolation, and diagnostic redaction. Do not invoke live providers. Update ledger/handoff, commit, and report the hash and verification.
```

### OPS-001 — Admin operations, packages, usage, and reports

```text
Build task OPS-001 after the M1 gate is integrated and coordinate only through existing interfaces with AI-001 and INT-001. Work autonomously in an isolated worktree.

Read AGENTS.md and all project documents plus every admin discovery section. Claim OPS-001. Using the `2026091408xxxx` migration namespace, implement packages, tenant package cycles, persistent spend/entitlement policies, provider health checks, audit events, and reporting views/functions. Build admin dashboard, client roster/detail/classification, packages, reports, settings, operations/admin invites/toggles, provider status, and safe tenant diagnostics. Integrate the AI usage-policy interface without changing AI-owned internals; if AI-001 is not merged, provide a contract-compatible implementation and document the integration step.

Implement package snapshots so editing a package does not rewrite an active cycle. Make effective prompt/tenant limits explicit and reject contradictory spend caps. Never call live provider tests without authorization. Add role authorization, package/token/cost math, report range, projection, and cross-tenant tests. Update ledger/handoff, commit, and report the hash and verification.
```

### REF-001 — References, templates, and competitor intelligence

```text
Build task REF-001 after the campaign and integration contracts are merged. Work autonomously in an isolated worktree.

Read AGENTS.md and all project documents plus the reference and competitor discovery sections. Claim REF-001. Using the `2026091405xxxx` migration namespace, implement three-level categories with sibling-name uniqueness, reference assets/categories, tenant/global/best-pick libraries, competitor domains, senders, mappings, and inspirations. Build secure Storage metadata/policies, signed asset access, client reference/inspiration pickers, competitor-domain requests, admin templates/categories, and admin competitor inbox with cursor pagination, mapping, type correction, curator descriptions, and sanitized preview. Implement inbound email as an adapter with fixtures and webhook/poller-compatible interface; do not connect a real mailbox.

Sanitize email HTML and render only in a sandboxed iframe. Test duplicate categories, tenant mapping visibility, cursor pagination, upload validation, signed access, hostile HTML fixtures, and campaign-reference integration. Update ledger/handoff, commit, and report the hash and verification.
```

### DSG-001 — Designer workflow

```text
Build task DSG-001 after campaign and identity contracts are merged. Work autonomously in an isolated worktree.

Read AGENTS.md and all project documents plus both designer workflow discovery sections. Claim DSG-001. Using the `2026091406xxxx` migration namespace, implement designer assignments, versioned submissions, section feedback, and owner reviews; explicit state transitions; due dates/SLA state; tenant access; and assignment-scoped Storage policies. Build designer activation/login landing behavior, dashboard, assignment detail, submission/revision workflow, and owner approve/reject/revision experiences. Admin handles assignment, SLA intervention, and escalation; it cannot silently replace owner creative approval. Approval binds to the exact current submission and approved copy version. Use notification interfaces rather than owning delivery infrastructure.

Designers must not enumerate unrelated tenant campaigns or assets. Add state-machine, two-tenant/designer authorization, file-access, SLA, route-action, and Playwright tests covering assignment through approval and revision. Update ledger/handoff, commit, and report the hash and verification.
```

### SUP-001 — Team, settings, holidays, support, feedback, notifications

```text
Build task SUP-001 after the M1 gate is integrated. Work autonomously in an isolated worktree.

Read AGENTS.md and all project documents plus Team, Settings, Holidays, Support, Feedback, Profile, and admin-support discovery sections. Claim SUP-001. Using the `2026091407xxxx` migration namespace, implement tenant settings, platform/tenant holidays, support tickets/messages/attachments, feedback items/updates, and notification delivery/audit records. Finish team invite/member controls through IAM-owned interfaces. Build client and admin support queues with cursor pagination and safe polling or Supabase Realtime fallback, status transitions, attachments, feature requests/triage, settings, holidays, and profile surfaces. Implement a fake notification adapter and provider interface; do not send real email.

Test authorization, pagination, message ordering, status transitions, attachment access, invite boundaries, notification retries, and client/admin Playwright paths. Update ledger/handoff, commit, and report the hash and verification.
```

### QUA-001 — Integration, hardening, and deployment readiness

```text
Own task QUA-001 only after all selected P0 lanes are ready for integration. This task is the merge and quality owner, not a rewrite.

Read AGENTS.md and all project documents. Claim QUA-001. Merge feature branches one at a time from the current integration base. After each merge run database reset, regenerate committed Supabase types through the project's standard command, typecheck, lint, tests, and build; fix contract drift at the narrowest layer and record it. Complete cross-domain wiring: campaign AI actions, audience sync, references, designer handoff, package/spend enforcement, job monitor, and notifications. Add the critical Playwright journeys, security headers, rate limits, webhook/cron authorization, log redaction tests, health endpoints, seed safety, and operational/deployment runbooks.

Do not connect or mutate live external accounts and do not deploy until explicitly authorized. The final handoff must include a green release checklist, exact verification commands/results, unresolved P1 items, migration list, environment requirements, and rollback steps. Update ledger, commit, and report the final hash.
```

## 5. Suggested first sequence

1. Start only FND-001.
2. Review and integrate its commit.
3. Start IAM-001 and UI-001 in parallel.
4. Integrate both and run the M1 gate.
5. Start CAM-001, AI-001, INT-001, and OPS-001 in parallel.
6. Integrate into the P0 vertical slice before starting secondary features.
7. Start REF-001, DSG-001, and SUP-001 in parallel.
8. Finish with QUA-001.

If speed matters more than breadth, complete FND → IAM/UI → CAM/AI/INT → QUA and postpone OPS/REF/DSG/SUP. That produces a useful retention-campaign product sooner than implementing every admin screen before the core loop works.
