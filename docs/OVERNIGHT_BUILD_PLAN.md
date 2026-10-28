# Grey Retention v2 — Autonomous Build Plan

Date: October 4, 2026  
Repository: `/Users/able/Documents/ChatGPT/Grey Retention`  
Planning task: DOC-002  
Status: ready for implementation handoff; application implementation is not part of this planning task.

## 1. Objective and working baseline

Build the new Grey Retention product in this repository, using the existing Next.js App Router, TypeScript, Supabase, white-label presentation, and design system. Keep completed foundation and identity work. Replace feature placeholders with authorized, persisted journeys.

The target is an owner-operated retention pipeline:

**Onboard → learn competitors → approve calendar → approve copy → produce design → owner reviews/revises/approves design → validate delivery package → schedule/cancel → report → learn.**

The previous PHP archive and incomplete SQL paste are behavioral references. They are not implementation inputs, migration sources, or authority to copy source, prompts, secrets, customer records, or runtime assets. Everything needed to start is summarized in this repository; missing access to those attachments is not a blocker.

As of planning, FND-001 and IAM-001 are complete; UI-001 is incomplete; domain feature lanes are mostly placeholders. Reinspect code and the ledger before starting because another task may have made progress. Do not recreate the foundation or infer completed behavior from route existence.

## 2. What this unattended run is authorized to do

- Implement the assigned phases below, local migrations, synthetic seed fixtures, provider adapters, tests, and documentation.
- Resolve routine reversible implementation choices using established contracts; record significant choices in the ledger.
- Create a `codex/` feature branch, make focused local commits, and preserve unrelated work. Do not commit or push directly to `main`.
- Start local Supabase and tracked local app/test processes when needed. Reset only a verified disposable local database created for this task; never an unknown, shared, staging, or production database.
- Continue sequentially through eligible phases after each verified checkpoint. One working slice is the first checkpoint, not the end of the task.

Do not deploy, connect/mutate live provider accounts, send email/SMS, call paid AI/vision, run real mailbox subscriptions, change production data, or import the old database. Use synthetic fixtures and fake adapters for external behavior. Do not push, create a PR, or merge unless the human separately authorizes that step; if later told to push, follow the project's feature-branch/PR/checks/merge workflow.

This plan does not schedule a chat or guarantee execution after the agent's runtime ends. Use durable checkpoints so the same run can continue through context compaction or be resumed. Full v2 completion is a multi-phase objective; do not declare it finished merely because a night or runtime window ends.

## 3. Read order and precedence

Read the full `AGENTS.md`, `docs/MVP_PLAN.md`, `docs/SYSTEM_ARCHITECTURE.md`, `docs/ARCHITECTURE_BLUEPRINT.md`, `docs/PARALLEL_TASKS.md`, and `docs/BUILD_LEDGER.md`. Then read this plan, `docs/USE_CASES.md`, `docs/UML_DIAGRAMS.md`, `DESIGN.md`, and relevant discovery sections.

Explicit user direction wins: this is a new product, and default creative design approval belongs to the brand owner. The diagram and use cases reflect that correction. The October 4 blueprint amendment reconciles the older admin-review and draft-only planning text. Structural architecture, security, ownership, and migration allocation remain authoritative.

Read the relevant installed Next.js guides in `node_modules/next/dist/docs/` before implementing framework APIs. Reuse existing dependencies, conventions, and shared components. Validate real adapter interfaces against current official provider documentation when implementing them; never verify by calling a live account.

## 4. Defaults that let implementation proceed

These are explicit development defaults, not final commercial decisions. Implement them as typed policies/configuration with tests; do not bury them in prompts.

| Area                | Development default                                                                                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channels            | Design email and text email first. Keep SMS unavailable until consent, recipient timezone, quiet hours, and provider contract are defined. WhatsApp is out of scope.                                                                                                                                      |
| Owner approval      | Only an active tenant owner approves brand context, calendar, copy, and design, or confirms L0 scheduling. No admin bypass of creative approval.                                                                                                                                                          |
| Tenant team         | Tenant admin/staff can edit permitted unapproved drafts and use authorized shared chat. Existing tested identity/team permissions remain intact. Approval, credentials, autopilot, and sending remain denied unless a specific confirmed policy grants them.                                              |
| Platform operators  | Platform admin operates assignments, SLA escalation, and sanitized diagnostics through scoped server policies. Super admin additionally manages packages/platform access and autopilot settings. Neither inherits owner creative approval.                                                                |
| Designer            | Active assignment plus permitted tenant access; only approved brief and assignment-relevant assets. No tenant revenue, credentials, unrelated drafts, or GROS conversations.                                                                                                                              |
| Chat                | Private: creator-only by default. Shared: active permitted members of that workspace. Shared visibility is not permission to execute another user's proposal. Diagnostics expose metadata, not private conversation content.                                                                              |
| Learning readiness  | Preserve the PRD's configurable evidence gate: connected Klaviyo, approved profile, saved whitelist, 20 classified assets, three LIVE competitors with ten emails each. Show evidence progress; do not promise readiness in eight days. Synthetic seeds may meet the gate and must be labelled demo data. |
| Evergreen bootstrap | Preserve calendar drafts/history access; do not automatically send during onboarding before the full gate. Keep a separate policy seam for future approval.                                                                                                                                               |
| Catalog             | Support validated manual/demo catalog data and Shopify fixtures. Missing or stale product/stock evidence blocks a product campaign; never assume availability.                                                                                                                                            |
| G segments          | Define a canonical registry and account-scoped mapping with fixture-only definitions. Final segment definitions remain unresolved; disable real provisioning until confirmed.                                                                                                                             |
| Cadence/offers      | Five emails/week per engaged audience, at most 40% discounted sends, no two distinct sitewide offer campaigns within seven days. Treat overlapping/ambiguous sequences conservatively as separate offers until exception semantics are confirmed. Include existing approved/scheduled sends in checks.    |
| L0                  | Explicit owner copy/design approval and package scheduling confirmation.                                                                                                                                                                                                                                  |
| L1                  | Owner copy/design approval; persisted standing automation policy permits background scheduling when Ready. New side-effecting GROS requests still require confirmation.                                                                                                                                   |
| L2                  | Implement eligibility and simulation tests; production enablement stays disabled. Copy silence approval is conditional, version-bound, and delayed 72 hours. Owner design approval still applies; fully unattended design delegation requires a separately confirmed policy.                              |
| Delivery retry      | Initial attempt plus at most three retries for eligible transient failures. Unknown side-effect outcomes reconcile first and remain blocked if inconclusive; permanent auth/validation failures do not blindly retry.                                                                                     |
| Budget              | Atomic pre-dispatch reservation; soft alert at 80%, hard stop at 100%; reconcile actual usage. Exhausted AI budget does not silently cancel already approved delivery.                                                                                                                                    |
| Learning            | Five campaigns per comparison side by default; show window/source/confounders. Learned patterns never override explicit owner prohibitions or hard rules.                                                                                                                                                 |
| Bill optimizer      | Fixture-only sweep; protect all purchasers in the last 12 months. Exclude hard bounces/spam from winback; respect suppression reasons/consent before any reversal. Real suppression and automatic unsuppression remain disabled.                                                                          |
| Shared templates    | Own-tenant designs may be reused. Cross-client curation/publication remains disabled without a permission policy.                                                                                                                                                                                         |

## 5. Contract checkpoint before feature work

Claim **V2-000** and act as integration owner. Use the allocated migration namespaces; audit already-used versions and do not renumber existing migrations. Generated database types must come from schema tooling, not manually fabricated type definitions.

Plan dependencies in migration sort order, not phase execution order. A lower-numbered namespace cannot reference a table created only in a higher-numbered migration on a clean reset. Defer cross-domain constraints/wiring to the allocated integration namespace where necessary, and verify reset from zero.

Freeze these typed interfaces before dependent work:

1. Role/capability policy and tenant/resource resolution, including private/shared conversations.
2. Versioned brand facts and corrections; permitted offers with validity/depth/conditions.
3. Campaign entries, sequence membership, lineage, audiences, and separate content/design/delivery revisions.
4. Approval records tied to actor and exact revision; material-edit invalidation matrix.
5. Assignment, submitted design version, section-specific feedback, revision history, and owner approval.
6. Immutable delivery package containing content, assets, links, footer, audience, sender, schedule/timezone, and source approval references.
7. Delivery-provider port: prepare/create, confirm schedule/state, reschedule, cancel, reconcile unknown outcomes, collect results, and canonical segment mappings.
8. Durable queue/outbox with leases, retry classification, checkpoints, idempotency, and stale recovery.
9. AI usage reservation/reconciliation and versioned structured outputs.
10. Asset/catalog matching, capture/extraction/playbook, notification, and commerce ports with fake/fixture implementations.

Use separate approval/design/delivery/job states rather than one enum that conflates generation, creative decisions, and provider failures. Domain services own transitions; actor permissions and version checks are mandatory. Update blueprint and ledger when contracts change, run the full relevant suite, then proceed.

## 6. Build sequence and gates

Each phase must include database persistence, authorized server actions/routes, usable UI, deterministic demo data, failure states, and proportional tests. A mocked external provider is allowed; in-memory application persistence or static placeholder screens are not acceptance substitutes.

### V2-001 — Finish shared UI and core campaign persistence

**Depends on:** V2-000. **Ownership:** UI primitives/shells, campaign domain, brand/product/offer baseline, shared types through integration ownership; use existing UI-001/CAM-001/AI-001 touchpoints and namespaces.

- Finish forms, dialogs, tables, loading/empty/error/stale states without redesigning the accepted visual system.
- Persist brand profile, products, offers, calendars, campaign entries/content, subjects, audiences, references, notes, and audit events.
- Implement calendar/month/list views, draft editor, save/refresh behavior, timezone display, and owner approval controls.
- Seed two fictional tenants, multiple team roles, a designer, and synthetic brand/catalog/campaign data using safe local tooling.

**Gate:** an authenticated owner creates, edits, refreshes, and approves a calendar entry; another tenant and unauthorized staff cannot approve or read it. No runtime hardcoded tenant ID. Typecheck, state tests, RLS tests, and a persisted browser journey pass.

### V2-002 — First complete human-design vertical slice

**Depends on:** V2-001. **Ownership:** designers, minimal jobs/provider delivery, notifications, campaign approval interfaces; DSG-001/INT-001/SUP-001 touchpoints.

- Implement version-bound copy approval with deterministic original fake-AI output.
- Assemble an inspiration pack, assign a designer, and persist uploaded submissions and section feedback.
- Deliver review to the owner; permit revision requests and resubmission; approve the exact current design version. Admin handles assignment/escalation, not final creative approval.
- Add durable delivery intent, a fake provider, deterministic simulated scheduling/cancellation, and an explicit final preview using a minimally complete validated package.
- Show assignment/SLA status, in-app notifications, and a fake email-delivery audit.

**Gate:** owner → approved copy → designer submission → owner revision → new submission → owner design approval → verified package → simulated schedule → confirmed cancel. Refresh preserves every step. Designer cannot enumerate unrelated campaigns/assets. Stale approval and replayed delivery jobs fail safely.

This is the first checkpoint to demonstrate working software. Continue into the following phases once it passes.

### V2-003 — Onboarding and asset pipeline

**Depends on:** V2-001 and V2-002 contracts. **Ownership:** brand, integrations, asset/reference module and relevant migrations.

- Implement resumable readiness, owner corrections, typed offer intake, brand-kit extraction adapter, connection diagnostics, and catalog freshness.
- Implement real private Storage upload/metadata/access policies; bulk/ZIP ingestion with file signatures, bounded expanded size/path validation, per-file failures, and dedupe.
- Add read-only Drive folder-sync port/configuration with fixture jobs; do not connect a real account.
- Implement classified gallery, manual re-tag/match corrections, and product/variant matching interface.

**Gate:** upload/ZIP processing survives retry without duplicates; access is scoped; corrections persist; missing requirements remain visible. Vision output is explicitly synthetic in fixture mode. The 90% real-image quality target remains unverified until an authorized real evaluation; do not claim it passed using fixtures.

### V2-004 — Competitor capture, intelligence, and playbook

**Depends on:** V2-003 and durable jobs. **Ownership:** references/competitors, AI extraction, typed inbound transport; REF-001 touchpoint.

- Implement tenant subscriptions mapped to shared capture identity, opt-in/status simulation, sanitization, dedupe, and capture health warnings.
- Extract micro records, aggregate cadence/offer/event profiles, detect sequences, and generate brand-specific evidence-linked playbooks.
- Add library/profile/sequence views and transparent incomplete-evidence states.

**Gate:** two tenants reuse shared capture without seeing private rules/playbooks; hostile email previews are sandboxed; replay is deduplicated; sequence fixtures cover false matches and gaps. No competitor wording is reproduced into generated client copy.

### V2-005 — Guardrailed planning and bulk copy approval

**Depends on:** V2-004, approved brand inputs, and campaign contracts. **Ownership:** campaigns, AI, notifications/settings.

- Generate rolling 30-day entries, preserve approved entries during regeneration, and attach offer/product/reference/sequence/input lineage.
- Validate cadence, offer caps, conflicts, exclusions, readiness, dates, and owner rules independently of AI.
- Implement approved-entry copy generation, coordinated sequence briefs, verified factual claims/deadlines, weekly bulk approval, and rejection rules with visible scope.
- Add reminders and simulated-clock silence policy tests; no real-time 72-hour waits in tests.

**Gate:** representative plans always satisfy guards; invalid AI output blocks approval; concurrent/stale bulk approval cannot approve unseen versions. Browser journey proves month review and weekly copy queue. Record usability targets as targets until measured with a representative owner.

### V2-006 — Design generation, assembly, and templates

**Depends on:** V2-003 and V2-005. **Ownership:** designers, email assembly/rendering, reference/template integration.

- Extend the human inspiration pack and implement a deterministic reference-structure renderer using approved brand assets/copy. Introduce a runtime rendering dependency only if necessary and justified in the ledger.
- Add AI-design orchestration via fake/fixture output and per-strip revisions; local deterministic rendering should produce inspectable real artifacts, not a success flag alone.
- Preserve owner review for both paths; record asset/copy/design revision provenance.
- Implement slicing, multi-destination footer handling, product/CTA mapping, UTMs, link/stock validation adapters, and immutable delivery packages.
- Implement own-template skeleton reuse. Save own designs when a simulated send is confirmed; do not publish them across clients.

**Gate:** human and automated paths yield previewable artifacts; approval binds to the current design; missing assets, stock, links, and footer block readiness. Rendering references structures, never copies another brand's creative. Text-email output remains readable text/HTML and does not inherit irrelevant image-slicing requirements.

### V2-007 — Delivery fidelity, L0/L1, and cancellation

**Depends on:** V2-006 and provider/job contracts. **Ownership:** integration delivery adapter, campaign delivery policy, operations diagnostics.

- Implement account-scoped canonical segment registry/mapping in fixtures, required excludes, sender/footer defaults, schedule/timezone snapshot, and push-time guardrails.
- Extend fake provider scheduling/state/reschedule/cancel/reconcile semantics and result identities. Implement real adapters behind disabled configuration where current official docs permit; do not invoke them.
- L0 requires owner package confirmation; L1 uses an explicitly persisted standing policy after owner copy/design approval. Chat-requested mutations still confirm.
- Handle duplicate jobs, timeout-after-success, inconclusive reconciliation, rejected cancellation, stale stock, past-due send, rate limits, permanent failure, and bounded retry.

**Gate:** 100 consecutive fixture pushes match package audience/content/links/footer/schedule; fault fixtures prove no duplicate sends. Provider acceptance, scheduling, and sending are distinct confirmed states. Report this as fixture fidelity, not real Klaviyo acceptance.

### V2-008 — GROS, access, and operating surfaces

**Depends on:** V2-005 and V2-007. **Ownership:** AI/GROS, identity policy, operations/support/settings; AI-001/OPS-001/SUP-001 touchpoints.

- Persist private/shared chats and proposals, verify visibility at each query/mutation, and attach target revision/actor to confirmation.
- Answer why a campaign exists using its evidence; support permitted edits, reference selection, assignment, scheduling proposals, and status inspection through domain services.
- Implement packages/snapshots, atomic spend reservations, usage by feature, admin job/provider diagnostics, team controls, settings, holidays, and support/feedback flows.
- Notify owners of connection health and delivery issues through in-app and fake notification adapters.

**Gate:** another team member cannot read a private chat or execute its proposal; shared chat cannot cross tenants; designers cannot access GROS/revenue; expired proposals require reconfirmation. Concurrent budget tests prove limits. Admin can diagnose a failure without seeing secrets or customer payloads.

### V2-009 — Results, learning, and guarded L2 simulation

**Depends on:** V2-007 and V2-008. **Ownership:** reporting/learning AI, campaign policy, integrations.

- Persist campaign metadata before the first send. Schedule 48-hour/seven-day result pulls with source/window/freshness and daily digests.
- Produce evidence-backed rules at the defined sample threshold; pin/dismiss controls and rule precedence are explicit.
- Implement ten-send rejection-free eligibility as a configurable policy with a conservative consecutive-streak default; record rejections and reset behavior.
- Simulate L2 silence approval and scheduling only within policies. Keep production L2 and fully unattended design-review delegation disabled; surface the unresolved requirement rather than bypassing owner approval.

**Gate:** insufficient/incomparable samples produce no influential rule, rejected/dismissed rules do not reapply silently, incomplete metrics remain visible, and learned rules cannot override owner prohibitions. Frozen-clock tests prove silence behavior and approval invalidation.

### V2-010 — Fixture bill optimizer and remaining library work

**Depends on:** V2-009 and audience/consent contracts. **Ownership:** integrations/operations, references/templates.

- Implement candidate preview, protected-purchaser exclusions, owner-approved first sweep, consent-aware winback/suppression simulation, audit, and guarded reversal.
- Show dated pricing fixture estimates as estimates; never claim measured billing savings from simulation.
- Finish own-template performance links and build-from-reference flow through the same guards/approvals.

**Gate:** recent purchasers and invalid winback recipients are excluded; replay cannot duplicate suppression; protected consent states cannot be lifted by blanket reversal; reference creation never skips approval. Real suppression and cross-client publication remain unavailable.

The public archive is a separate future track with its own capture budget, publication rules, search evaluation, and release plan. Do not spend the unattended run building a public marketing archive while core pipeline gates remain incomplete.

### V2-011 — Integrated acceptance and handoff

**Depends on:** all implemented core phases. **Ownership:** integration owner; narrow cross-domain fixes.

- Verify clean migration reset, generated types, seed reproducibility, unit/integration/RLS/browser journeys, production build, sanitized logs, cron/webhook gates, and responsive/keyboard core paths.
- Run the complete suite after shared-contract changes; fix underlying failures without weakening guards or skipping checks.
- Record implemented versus simulated versus externally unverified functionality. Map UC IDs to actual tests and screens.
- Produce `docs/BUILD_PROGRESS.md` and `docs/BUILD_HANDOFF.md` with phase status, commit hashes, commands/results, migrations, environment needs, remaining decisions, exact next task, and local startup instructions.
- Stop task-started servers/workers/test processes and verify their listening ports are closed unless the human explicitly asks to keep a preview running.

**Gate:** the new product's full core loop operates on persisted synthetic data with all role boundaries. Do not mark entire v2 complete if real-provider/vision/design evaluation, L2 delegation, or extension acceptance remains outstanding.

## 7. Verification and progress protocol

For every task, claim its ledger row, record owned paths, inspect current changes, implement one coherent slice, run the relevant tests and `pnpm typecheck`, append the required handoff entry, and make a focused commit on the feature branch. Update the original baseline rows only when their full acceptance is actually satisfied; a new phase passing does not automatically complete every old lane.

Commands must follow the actual repository scripts. Use `pnpm verify` at integration gates (format, lint, types, tests, build), `pnpm test:e2e` for journeys, and local Supabase reset/type generation/`pnpm test:db` when a verified disposable local database is available. If Docker/database tooling is unavailable, do not invent generated types or claim DB/RLS checks passed. Continue useful domain/UI/fixture work, record the limitation, and leave database-dependent completion unverified until the tooling is available.

Before ending a phase, review browser behavior at desktop and mobile widths when relevant. Keep processes attached to tracked sessions; record session/process and port in progress notes, and clean them up. Do not disable auth to make screenshots/tests easier.

Maintain `docs/BUILD_PROGRESS.md` at each checkpoint with:

- Active branch/base, current phase, owned files, and next concrete action.
- Completed acceptance gates and exact checks, including failures/limitations.
- Decisions/defaults chosen, remaining external blockers, and simulated capabilities.
- Tracked process/session/port inventory.

Do not create recurring automations, new chats, delegated agents, or live provider changes merely to keep the run active. Execute sequentially by default. If the human later explicitly authorizes parallel agents, assign disjoint paths, protect shared config/generated types, and integrate one lane at a time.

Do not stop after planning, a scaffold, a placeholder screen, or the first successful test. Continue all eligible implementation phases. When blocked on one external decision, isolate that capability behind a disabled policy/adapter and proceed on independent work. Stop dependent unsafe work until required information is available. A runtime interruption requires an honest resumable handoff, not a completion claim.

## 8. Paste this into the implementation agent

```text
Build the new Grey Retention product in /Users/able/Documents/ChatGPT/Grey Retention. This is an implementation request: work autonomously through the ordered phases during this unattended run, continuing after each verified checkpoint rather than ending after planning or one feature. The complete assignment and acceptance gates are in docs/OVERNIGHT_BUILD_PLAN.md. Read it fully and follow it.

First read AGENTS.md and the complete required project documents: docs/MVP_PLAN.md, docs/SYSTEM_ARCHITECTURE.md, docs/ARCHITECTURE_BLUEPRINT.md, docs/PARALLEL_TASKS.md, docs/BUILD_LEDGER.md. Then read docs/USE_CASES.md, docs/UML_DIAGRAMS.md, DESIGN.md, the build plan, and relevant GREY_RETENTION_DISCOVERY.md sections. Inspect the current worktree and actual code before choosing the next task. Read the installed Next.js guides relevant to each framework change.

Keep the existing Next.js/TypeScript/Supabase foundation, identity, RLS, and visual direction. We are making a new implementation. Do not copy or import the previous PHP source, private prompts, credentials, customer content, uploaded customer designs, or old database rows. The attached backup/dump is not required to start. Current repository documents contain the behavioral requirements.

Important product correction: brand owner reviews designs, requests section-specific revisions from the assigned designer or AI path, and approves the exact final version. Admin manages assignment, SLA issues, and escalation. Admin does not silently replace owner creative approval. L1 may schedule automatically after required owner approvals through a persisted policy. New GROS mutations stay confirm-gated. Full unattended L2 design delegation remains disabled until explicitly specified. Private/shared GROS chat must enforce tenant and creator visibility.

Act as integration owner for V2-000 through V2-011 and their assigned paths. Claim each task in docs/BUILD_LEDGER.md. Complete the first persisted owner-copy-designer-owner-review-simulated-delivery journey, then proceed into onboarding/assets, competitors/playbooks, guarded calendar/copy, rendering/assembly, delivery, GROS/operations, learning, and the eligible extensions. Do not replace persisted behavior with static screens or in-memory app state. Use labelled synthetic demo data and fake/fixture external adapters. Record contract changes and migration ownership.

Preserve unrelated changes. Create a codex/ feature branch before implementation commits; carry the current authorized planning documents into it without discarding them. Make focused local commits and stage explicit owned files. Never commit or push directly to main. Do not push, create a PR, merge, deploy, connect/mutate live providers, send messages, consume paid AI, import production data, or reset an unknown/shared database. These actions are not authorized by this unattended build request.

Resolve reversible choices with the documented defaults and continue without asking routine confirmation questions. Record unresolved external/commercial decisions, disable only the affected capability, and continue independent work. Run relevant tests plus typecheck per phase and the full suite at integration/shared-contract gates. Never fabricate passing checks, real-provider fidelity, classifier accuracy, or completion.

Maintain docs/BUILD_PROGRESS.md after each checkpoint so context compaction or interruption can resume the next action. Keep servers/workers in tracked sessions and stop task-started process trees and verify ports closed when finishing. Do not spawn agents or create recurring automations by default. Finish with docs/BUILD_HANDOFF.md listing commits, migrations, check results, implemented/simulated/unverified capabilities, blockers, and the exact next task. If all core gates are not achieved within the runtime, report partial progress honestly and preserve a working checkpoint. Begin now by inspecting the repository and claiming the first eligible task.
```
