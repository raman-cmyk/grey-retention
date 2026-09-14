# Grey Retention MVP — Build Ledger

This file is the durable cross-task memory. Every implementation task must update only its own row and append a handoff entry. Never mark an item complete without verification evidence.

## Current state

| ID      | Workstream                             | Depends on       | Status  | Owner/task            | Verification                                                                                     | Notes                                                                |
| ------- | -------------------------------------- | ---------------- | ------- | --------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| FND-001 | Repository foundation                  | —                | review  | root integration task | Frozen install; format/lint/typecheck; 8 tests; 26-route build; Playwright 4/4; Impeccable PASS. | Database reset/pgTAP pending CI because local Docker is unavailable. |
| IAM-001 | Auth, tenancy, RLS                     | FND-001          | blocked | unassigned            | —                                                                                                | Starts after foundation.                                             |
| UI-001  | Design system and shells               | FND-001          | blocked | unassigned            | —                                                                                                | Can parallel IAM.                                                    |
| CAM-001 | Campaign/calendar domain               | IAM-001, UI-001  | blocked | unassigned            | —                                                                                                | P0 vertical slice.                                                   |
| AI-001  | Prompt engine, Brand Truth, GROS       | IAM-001          | blocked | unassigned            | —                                                                                                | Fake provider first.                                                 |
| INT-001 | Queue and Klaviyo integration          | IAM-001          | blocked | unassigned            | —                                                                                                | Fixture adapter first.                                               |
| OPS-001 | Admin core, packages, jobs             | IAM-001, UI-001  | blocked | unassigned            | —                                                                                                | Must consume shared contracts.                                       |
| REF-001 | References and competitor intelligence | CAM-001, INT-001 | blocked | unassigned            | —                                                                                                | P1 after campaign IDs stabilize.                                     |
| DSG-001 | Designer workflow                      | CAM-001, IAM-001 | blocked | unassigned            | —                                                                                                | Uses Storage policies.                                               |
| SUP-001 | Team, settings, holidays, support      | IAM-001, UI-001  | blocked | unassigned            | —                                                                                                | Mostly independent after M1.                                         |
| QUA-001 | Integration, E2E, deployment           | all P0           | blocked | unassigned            | —                                                                                                | One integration owner.                                               |

Allowed statuses: `ready`, `in_progress`, `blocked`, `review`, `complete`.

## Global decisions

| Decision      | Value                                                     | Reason                                                             |
| ------------- | --------------------------------------------------------- | ------------------------------------------------------------------ |
| Runtime       | Next.js App Router + TypeScript                           | One deployable web application with server-rendered role surfaces. |
| Architecture  | Modular monolith with explicit domain modules             | Fast MVP iteration without premature distributed-system overhead.  |
| Hosting       | Vercel                                                    | Preview deployments and server functions.                          |
| Backend       | Supabase Postgres/Auth/Storage/Realtime/Queues            | Durable relational core and tenant security.                       |
| Isolation     | Server authorization plus PostgreSQL RLS                  | Deny-by-default tenant boundaries with defense in depth.           |
| Data access   | `@supabase/ssr` plus generated database types and SQL/RPC | Keeps RLS authoritative and avoids a competing schema source.      |
| Validation    | Zod                                                       | Shared environment, form, action, and adapter validation.          |
| UI            | Tailwind CSS + accessible headless primitives             | Fast, consistent, responsive implementation.                       |
| Tests         | Vitest + Playwright + pgTAP/SQL security tests            | Covers code, user journeys, and RLS.                               |
| Async         | Durable queue + idempotent workers                        | External API work must survive retries and timeouts.               |
| Demo behavior | Seeded fixtures + fake adapters                           | Complete workflow without external secrets or billable calls.      |
| Dates         | Store UTC; render in tenant IANA timezone                 | Removes the timezone contradiction found in the reference product. |
| Money         | Integer micro-USD internally                              | Avoids floating-point cost errors.                                 |
| IDs           | UUID primary keys; external IDs in unique scoped columns  | Stable internal identity and provider reconciliation.              |

Confirmed: original replacement visual world, white-label-first architecture, code-first build path, DRY shared implementation. Direction selection is in progress under Impeccable seed `0a100401`.

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
