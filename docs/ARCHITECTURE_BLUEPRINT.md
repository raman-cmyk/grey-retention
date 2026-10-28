# Grey Retention MVP — Architecture Blueprint

This document defines the shared contracts for all implementation tasks. A feature task may extend these contracts, but it must record the change in `docs/BUILD_LEDGER.md` and must not silently introduce a competing pattern.

The rationale, NFRs, failure modes, deployment path, and scalability thresholds live in `docs/SYSTEM_ARCHITECTURE.md`. Significant decisions are recorded in `docs/adr/`.

## October 4, 2026 — New-product v2 amendment

The user confirmed a new implementation and owner-led design review. `docs/UML_DIAGRAMS.md` describes the updated use-case, main sequence, and workflow views; `docs/OVERNIGHT_BUILD_PLAN.md` assigns the implementation phases and reversible development defaults. Those confirmed product changes supersede older admin-review wording. Existing technology, security, path ownership, and migration-allocation contracts remain in force.

- Owner approval binds to the current copy/design revision. Section feedback and each resubmission are retained. Platform admin handles assignment, SLA issues, and escalation, not silent creative approval.
- Separate calendar/content approval, design workflow, delivery, and background-job states. Material changes invalidate dependent approvals and delivery-package confirmations; a job error does not erase an owner's creative decision.
- Private GROS conversations are creator-scoped by default; workspace-shared conversations require active permitted membership. Proposal confirmation is actor-, tenant-, and target-version-bound.
- Implement prepare/schedule/reschedule/cancel/reconcile/results ports and simulated delivery. Real account mutation, live sending, paid AI, and deployment are not authorized by the build plan.
- L0 requires owner scheduling confirmation. L1 background scheduling uses a persisted standing policy after required owner approvals; new GROS mutations remain confirm-gated. Production L2 and fully unattended design delegation stay disabled until their policy is explicitly settled.
- The current code has only foundation-level provider contracts. V2-000 must extend and test those contracts before dependent features; this documentation amendment does not claim the code already implements them.

## 1. System shape

```text
Browser
  ├─ Client workspace
  ├─ Admin console
  └─ Designer workspace
          │
          ▼
Next.js App Router on Vercel
  ├─ Server Components and authenticated Server Actions
  ├─ Route Handlers for webhooks, workers, exports and integrations
  ├─ Authorization/policy layer
  ├─ Domain services
  └─ Provider adapters
          │
          ▼
Supabase
  ├─ Auth
  ├─ PostgreSQL + Row Level Security
  ├─ Storage
  ├─ Realtime
  ├─ Queues/pgmq
  └─ Cron/pg_cron
          │
          ├─ Klaviyo
          ├─ Shopify
          ├─ AI providers
          ├─ Transactional email
          └─ Inbound competitor email
```

The browser never receives the Supabase service-role key, tenant integration credentials, provider credentials, or cron secret. Client-side Supabase access is allowed only for tables/buckets with tested RLS policies.

## 2. Technology baseline

| Concern                | Choice                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| Language               | TypeScript with strict mode                                                                              |
| Web framework          | Next.js App Router                                                                                       |
| Package manager        | pnpm                                                                                                     |
| Database/Auth/Storage  | Supabase                                                                                                 |
| Styling                | Tailwind CSS and CSS variables                                                                           |
| Components             | Accessible headless primitives; wrap them in project-owned components                                    |
| Forms                  | React Hook Form plus Zod where client interactivity is needed; server validation is always authoritative |
| Server validation      | Zod                                                                                                      |
| Date/time              | UTC persistence, tenant IANA timezone presentation                                                       |
| Query caching          | Server Components first; TanStack Query only for polling/infinite/client-mutated views                   |
| Tables                 | TanStack Table for data-heavy admin screens                                                              |
| Charts                 | Recharts or an equivalently lightweight accessible library                                               |
| Unit/integration tests | Vitest and Testing Library                                                                               |
| Browser tests          | Playwright                                                                                               |
| Database/RLS tests     | pgTAP or SQL tests run against local Supabase                                                            |
| Logging                | Structured JSON with request, tenant, user, job, and external-request correlation IDs                    |
| Error tracking         | Adapter interface; console/local implementation first, hosted provider later                             |

Pin exact versions in the lockfile during FND-001. Subsequent tasks must not replace these choices without recording an architecture decision.

## 3. Repository layout

```text
/
├─ AGENTS.md
├─ app/
│  ├─ (public)/
│  ├─ (auth)/
│  │  ├─ login/
│  │  ├─ forgot-password/
│  │  ├─ signup/
│  │  ├─ admin/login/
│  │  └─ designer/login/
│  ├─ (client)/
│  │  ├─ dashboard/
│  │  ├─ brand/
│  │  ├─ campaign-agent/
│  │  ├─ campaigns/[campaignId]/
│  │  ├─ gros/
│  │  ├─ competitor-agent/
│  │  ├─ connections/
│  │  ├─ settings/
│  │  ├─ holidays/
│  │  ├─ team/
│  │  ├─ support/
│  │  ├─ feedback/
│  │  └─ profile/
│  ├─ (admin)/admin/
│  │  ├─ dashboard/
│  │  ├─ clients/
│  │  ├─ designers/
│  │  ├─ prompts/
│  │  ├─ llm-controls/
│  │  ├─ email-knowledge/
│  │  ├─ competitor-inspirations/
│  │  ├─ templates/
│  │  ├─ holidays/
│  │  ├─ reports/
│  │  ├─ packages/
│  │  ├─ settings/
│  │  ├─ operations/
│  │  ├─ cron-jobs/
│  │  ├─ feedback/
│  │  ├─ support/
│  │  └─ profile/
│  ├─ (designer)/designer/dashboard/
│  └─ api/
│     ├─ v1/
│     ├─ webhooks/
│     ├─ internal/jobs/
│     └─ health/
├─ components/
│  ├─ ui/
│  ├─ shell/
│  └─ domain/
├─ features/
│  ├─ auth/
│  ├─ tenancy/
│  ├─ dashboard/
│  ├─ brand/
│  ├─ campaigns/
│  ├─ ai/
│  ├─ integrations/
│  ├─ references/
│  ├─ designers/
│  ├─ support/
│  └─ admin/
├─ lib/
│  ├─ auth/
│  ├─ db/
│  ├─ env/
│  ├─ errors/
│  ├─ jobs/
│  ├─ logger/
│  ├─ money/
│  ├─ providers/
│  ├─ rate-limit/
│  ├─ result/
│  ├─ supabase/
│  └─ time/
├─ supabase/
│  ├─ migrations/
│  ├─ seed.sql
│  ├─ tests/
│  └─ config.toml
├─ tests/
│  ├─ fixtures/
│  ├─ integration/
│  └─ e2e/
└─ docs/
```

Route folders compose pages; business logic lives in `features/` or `lib/`. A page must not contain provider SDK calls or raw service-role queries.

## 4. Identity and authorization

### Identity classes

- Platform operator: `super_admin` or `admin`.
- Tenant member: `owner`, `admin`, or `staff`, scoped through membership.
- Designer: global designer identity with explicit tenant access and assignment-scoped visibility.

### Required tables

| Table                    | Essential fields and constraints                                                |
| ------------------------ | ------------------------------------------------------------------------------- |
| `profiles`               | `id = auth.users.id`, name, job title, phone, status, timestamps                |
| `platform_admins`        | profile ID unique, role, active, invited/accepted timestamps                    |
| `tenants`                | UUID, slug unique, name, status, timezone, onboarding state, timestamps         |
| `tenant_memberships`     | tenant/profile unique pair, role, status, invited_by, accepted_at               |
| `tenant_invites`         | tenant, normalized email, role, token hash, expiry, accepted/revoked timestamps |
| `designers`              | profile ID unique, status, activation state, last login                         |
| `designer_tenant_access` | designer/tenant unique pair                                                     |

### Request context

Every protected server entrypoint resolves one typed context:

```ts
type RequestContext =
  | {
      kind: 'client'
      userId: string
      tenantId: string
      tenantRole: 'owner' | 'admin' | 'staff'
    }
  | { kind: 'admin'; userId: string; adminRole: 'super_admin' | 'admin' }
  | { kind: 'designer'; userId: string; designerId: string }
```

Tenant selection comes from a validated membership, never directly from an untrusted URL/cookie alone. Admin access is checked against `platform_admins`; designer access requires both tenant permission and, for draft assets, an assignment.

### RLS rules

- Enable RLS on every application table, including globally readable configuration tables.
- Client members can read/write tenant rows only when an active membership and role permit the action.
- Designers cannot enumerate tenant data; they see assigned campaign material and permitted brand assets only.
- Platform admins use narrowly scoped server functions or server-only service-role access. Do not expose blanket admin access to the browser.
- Global templates/holidays/categories are readable by authenticated tenant members but writable only through admin server actions.
- AI calls, credentials, token ledger, job output, and support internals are server-only except through filtered views/actions.
- Every policy gets positive and negative tests using two tenants.

## 5. Database domains

All mutable tables include `created_at`, `updated_at`, and where valuable `created_by`. Tenant-owned tables include a non-null indexed `tenant_id`.

### Tenant configuration and commerce

- `tenant_settings`: campaign defaults, timezone, revenue goal, feature flags.
- `brand_profiles`: industry/category, brand type, identity fields, generation status.
- `brand_truth_sections`: section key, source/version, structured content, status.
- `brand_voice_sections`: tone, audience, vocabulary, examples, structured content.
- `products`: internal UUID, optional provider/external ID, title, URL, image, price minor units, status, raw metadata.
- `offers`: label, type, value/configuration, active period, status.
- `holidays`: platform or tenant scope, name, date, type, recurrence rule, notes.

### Integrations and synchronized resources

- `integration_connections`: tenant/provider unique pair, status, encrypted credential blob, last verified/synced/error timestamps.
- `integration_requests`: diagnostic record for external request path, status, latency, sanitized params/response excerpt, correlation ID.
- `sync_jobs`: one logical sync, status, mode, cursor, started/completed/heartbeat, counts, error.
- `sync_job_steps`: provider resource/page attempt records.
- `klaviyo_lists`, `klaviyo_segments`, `klaviyo_campaigns`, `klaviyo_campaign_messages`, `klaviyo_flows`, `klaviyo_flow_actions`, `klaviyo_flow_messages`, `klaviyo_metrics`, `klaviyo_templates`.
- `shopify_products`, `shopify_orders`, `shopify_customers`, `shopify_bulk_operations`.

Each synchronized table has a unique `(tenant_id, external_id)` constraint, `external_updated_at`, `synced_at`, and a bounded `raw jsonb` field where lossless reconciliation is useful.

### Campaign planning

- `campaigns`: tenant, title, goal, kind, channel, state, planned/scheduled date/time, timezone snapshot, source planner, owner.
- `campaign_subjects`: campaign, text, position, selected.
- `campaign_content`: campaign unique, preheader, body, CTA, structured sections, revision.
- `campaign_audiences`: campaign, source type (`list`, `segment`, `manual`), external/internal reference, inclusion/exclusion.
- `campaign_products`: campaign/product, position, featured.
- `campaign_references`: campaign, reference/inspiration, purpose, position.
- `campaign_events`: append-only state/audit timeline.
- `calendar_plans`: request scope, inputs, output, status, prompt/call reference.
- `campaign_comments`: tenant/editor/designer collaboration.
- `campaign_attachments`: Storage path, media type, size, uploader.

### AI, prompts, usage, and entitlements

- `prompt_definitions`: stable key, label, description, expected response kind, active.
- `prompt_versions`: prompt definition, version, system/user templates, variables, provider/model/temp/max tokens, created_by; immutable after use.
- `knowledge_entries`: Play/Craft/Rule, body, active, sort, match scopes.
- `knowledge_entry_brand_types` and `knowledge_entry_categories`.
- `admin_takes`: tenant, category, body, active, sort.
- `tenant_llm_controls`: provider/model/max-token overrides, daily/monthly caps in micro-USD, note.
- `ai_calls`: tenant, prompt version, provider/model, status, input/output tokens, cost micro-USD, latency, error class, correlation ID, timestamps.
- `ai_action_proposals`: tenant/campaign, kind, payload, state, confirmation actor/time, execution job.
- `packages`: input/output entitlement, price minor units/currency, cycle days, active/default.
- `tenant_package_cycles`: package snapshot, period, allocated/used input and output, status.
- `token_ledger`: append-only reservation/actual/release records tied to an AI call.

### References, competitors, and designers

- `categories`: self-referencing parent, maximum three levels, normalized-name sibling uniqueness.
- `reference_assets`: tenant or global scope, library kind, title, description, Storage path, best pick, primary category.
- `reference_asset_categories`.
- `competitor_domains`: tenant request/status.
- `competitor_senders`: normalized sender identity and classification.
- `competitor_sender_mappings`: tenant-domain/sender unique mapping.
- `competitor_inspirations`: sender, message UID/hash, subject metadata, received date, sanitized preview path/body, email type, curator description.
- `designer_assignments`: campaign/designer, state, due date, SLA, assigned/submitted/reviewed timestamps.
- `designer_submissions`: assignment, revision number, Storage path, notes, created_by.
- `designer_reviews`: assignment/submission, decision, reason, actor, timestamp.

### Operations and communication

- `support_tickets`, `support_messages`, `support_attachments`.
- `feedback_items`, `feedback_updates`.
- `notifications`: channel, recipient, template, state, attempts, sent/error timestamps.
- `job_runs`: job key, queue message, state, lease/heartbeat, attempt, duration, counts, output/error excerpts.
- `audit_events`: actor/context/action/entity/correlation ID, sanitized before/after metadata.
- `provider_health_checks`: provider/model, state, latency, sanitized error, checked_at.

## 6. State machines

### Campaign

Target v2 lifecycle uses separate domain records rather than one overloaded status:

```text
Calendar entry: proposed → owner_approved | rejected
Copy revision: draft → pending_approval → approved | rejected
Design: unassigned → assigned → in_design → submitted
         ├─→ revisions_requested → in_design → new submission
         └─→ owner_approved (exact current submission)
Delivery: not_ready → ready → queued → preparing → prepared
            → scheduling → scheduled → sent
Unknown provider outcome → reconciliation; no blind duplicate creation
Cancellation request → provider-confirmed cancelled or actual provider outcome
```

These are target semantics, not automatically introduced enum values. V2-000 freezes exact typed states and compatibility before migrations. Transitions occur through a domain service that verifies actor, current state, approved revisions, prerequisites, and idempotency. UI buttons never update state columns directly. Preserve approval history on revisions, errors, and cancellation.

### Background job

```text
queued → leased → running → succeeded
                   ├─→ retry_wait → queued
                   ├─→ failed
                   └─→ cancelled
stale leased/running → retry_wait or failed
```

Every job has an idempotency key, bounded attempts, exponential backoff with jitter, visibility timeout/lease, heartbeat, and dead-letter outcome. Workers commit progress at page/chunk boundaries.

### AI action proposal

```text
proposed → confirmed → queued → executing → succeeded
    └─→ rejected                 └─→ failed
```

New side-effecting GROS proposals cannot skip confirmation. Reconfirm if the proposal payload, actor authority, or target revision changed. A standing background automation policy is a separate audited authorization record, not a shortcut that marks every chat proposal confirmed.

## 7. Server contracts

Ordinary form mutations use typed Server Actions. Public integrations, polling, exports, and workers use versioned Route Handlers.

### Result envelope

```ts
type ApiSuccess<T> = {
  ok: true
  data: T
  meta?: { requestId: string; cursor?: string | null; hasMore?: boolean }
}

type ApiFailure = {
  ok: false
  error: {
    code: string
    message: string
    fieldErrors?: Record<string, string[]>
    retryable?: boolean
  }
  meta: { requestId: string }
}
```

Protected JSON routes return JSON `401`/`403`, never an HTML login redirect. Pages may redirect. Mutations require authenticated context, schema validation, authorization, rate limiting where appropriate, and an audit event for sensitive operations.

### Core API families

| Family            | Representative endpoints                                                         |
| ----------------- | -------------------------------------------------------------------------------- |
| Session/context   | `GET /api/v1/me`, `GET /api/v1/tenant-context`                                   |
| Dashboard         | `GET /api/v1/dashboard/overview`, resource/detail queries                        |
| Campaign calendar | `GET /api/v1/calendar`, `POST /api/v1/calendar/plan`                             |
| Campaigns         | create/read/update, typed transitions, audiences, products, references, comments |
| AI                | generation request, call status, GROS proposal, confirm/reject action            |
| Integrations      | connection verification, sync request/status, diagnostics                        |
| References        | cursor library, upload metadata, signed URL                                      |
| Support           | cursor ticket list, messages, reply, status                                      |
| Admin             | tenant/prompt/package/job/report/provider operations                             |
| Webhooks          | `/api/webhooks/klaviyo`, `/api/webhooks/shopify`, `/api/webhooks/email`          |
| Workers           | `/api/internal/jobs/drain`, `/api/internal/jobs/{kind}`                          |
| Health            | `/api/health/live`, `/api/health/ready`                                          |

Cursor pagination is preferred over offset pagination for externally growing collections and message feeds.

## 8. Provider adapters

Domain services depend on interfaces:

```ts
interface RetentionProvider {
  verifyConnection(): Promise<ConnectionHealth>
  listLists(cursor?: string): Promise<Page<ExternalList>>
  listSegments(cursor?: string): Promise<Page<ExternalSegment>>
  listCampaigns(cursor?: string): Promise<Page<ExternalCampaign>>
  listFlows(cursor?: string): Promise<Page<ExternalFlow>>
  listMetrics(cursor?: string): Promise<Page<ExternalMetric>>
  prepareCampaignDraft(input: PreparedCampaign): Promise<ExternalDraftRef>
}

interface CommerceProvider {
  verifyConnection(): Promise<ConnectionHealth>
  startBulkSync(resource: CommerceResource): Promise<ExternalOperation>
  pollBulkOperation(id: string): Promise<ExternalOperationState>
  listIncremental(
    resource: CommerceResource,
    cursor?: string
  ): Promise<Page<unknown>>
}

interface AiProvider {
  generate(request: AiProviderRequest): Promise<AiProviderResponse>
}
```

Each interface has `fake`, `fixture`, and `real` implementations. Fixtures include success, pagination, rate limit, unauthorized, validation error, timeout, and partial-failure cases.

V2-000 extends the actual repository ports to cover canonical segment mapping, immutable delivery packages, prepare/schedule/reschedule/cancel, provider-state reconciliation, and results collection. Also define commerce, asset classification, Drive sync, capture, renderer, and notification boundaries. Unknown remote outcomes must reconcile before any repeat side effect. Real implementations remain disabled during the unattended run.

Klaviyo traversal must follow the response's next-link/cursor and use resource-specific query parameters. Do not globally apply one pagination parameter—the discovered application currently fails because it does this for campaigns.

## 9. Prompt engine

Prompt assembly order is deterministic:

1. Immutable prompt-version system template.
2. Matching active Email Knowledge ordered by sort order and ID.
3. Matching active Admin's Take for the tenant.
4. Sanitized Brand Truth, voice, product, offer, campaign, and audience context.
5. Prompt-version user template rendered from a declared variable whitelist.

Supported scopes begin with `calendar_build`, `campaign_draft`, and `gros_chat`. Template rendering must fail on missing declared variables or undeclared placeholders. JSON prompts validate output against a Zod/JSON schema; one repair attempt may run before returning a typed error.

Before dispatch:

1. Resolve prompt version and effective provider/model.
2. Compute `effectiveMaxTokens = min(promptMax, tenantOverride?)`.
3. Check package input/output availability.
4. Check daily and monthly spend caps.
5. Reserve an estimated token amount in the ledger.
6. Call the provider.
7. Record actual usage/cost and release the difference.

No tenant cap may silently increase a stricter prompt limit. Admin UI must display both values and the effective result.

## 10. Queue and synchronization design

Recommended queue kinds:

- `klaviyo.sync.resource`
- `shopify.bulk.start`
- `shopify.bulk.poll`
- `shopify.incremental`
- `ai.generate`
- `ai.action.execute`
- `competitor.ingest`
- `notification.send`
- `dashboard.warm`
- `maintenance.recover_stale_jobs`

A scheduler enqueues intent; workers process bounded chunks. A one-minute scheduler is not a reason to run every job every minute—each logical schedule stores `next_run_at`, and enqueue uses an atomic due-row claim.

Worker rules:

- At most one active resource sync for a `(tenant, provider, resource)` key.
- Upserts use scoped external IDs.
- Store cursor after each successful page.
- Obey `Retry-After` and provider rate-limit headers.
- Separate retryable transport/rate-limit failures from permanent authentication/schema failures.
- Redact credentials and PII from request logs and excerpts.
- Mark a remote bulk operation stale after configurable heartbeat thresholds and reconcile it explicitly.
- Cron/event delivery may occur twice; idempotency is mandatory.

## 11. File storage

Buckets:

- `brand-assets`
- `campaign-references`
- `designer-submissions`
- `support-attachments`
- `competitor-previews`
- `platform-templates`

Store object metadata in relational rows. Use UUID paths, content-type allowlists, size limits, malware-scanning hook interface, and short-lived signed URLs. Public buckets are not required. Tenant-owned paths must begin with tenant UUID; designer submissions additionally include assignment UUID.

## 12. Security baseline

- Strict environment validation at boot.
- Secure HttpOnly SameSite cookies through Supabase SSR.
- CSRF protection for cookie-authenticated non-idempotent endpoints where framework guarantees are insufficient.
- CSP with nonces/hashes, HSTS, frame-ancestors/frame-options, nosniff, referrer, and permissions policies.
- No unpinned third-party runtime scripts.
- Rate limits for login/reset, AI generation, connection tests, uploads, invites, and support sends.
- Integration credentials encrypted using a server-only envelope key; display only status and optional non-sensitive label.
- Webhook signature verification and replay protection.
- Cron/worker endpoints require a rotating secret and network-independent authorization.
- Audit sensitive admin actions and state transitions.
- Sanitize competitor HTML and render it in a sandboxed iframe; never trust email markup.
- Validate file signatures as well as extensions/content types.
- Logs use allowlisted fields and redact authorization, cookies, prompts with private context, and provider responses by default.

## 13. Demo and seed contract

Local/demo seed creates:

- one platform super-admin identity through documented local-only tooling;
- two tenants to exercise isolation;
- owner/admin/staff memberships;
- one designer with access to one tenant;
- package definitions and one active cycle per tenant;
- brand profile, products, offers, holidays, lists, segments, campaigns, flows, metrics, templates, references, and inspirations;
- at least two campaign drafts in different states;
- prompt definitions matching the 34 discovered keys with original clean-room text, not copied proprietary content;
- fake AI, Klaviyo, Shopify, notification, and inbound-email adapters;
- successful, retrying, failed, and stale job examples.

Seed scripts are idempotent. Production execution must refuse demo-user creation unless an explicit local/test flag is set.

## 14. Environment contract

```text
NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
DATABASE_URL
CREDENTIALS_ENCRYPTION_KEY
CRON_SECRET
ADAPTER_MODE=fake|real
KLAVIYO_API_REVISION
AI_DEFAULT_PROVIDER
ANTHROPIC_API_KEY          optional
OPENAI_API_KEY             optional
GOOGLE_GENERATIVE_AI_KEY   optional
DEEPSEEK_API_KEY           optional
EMAIL_PROVIDER_API_KEY     optional
EMAIL_FROM                 optional
INBOUND_EMAIL_SECRET       optional
SHOPIFY_WEBHOOK_SECRET     optional
```

Only `NEXT_PUBLIC_*` variables may enter browser bundles. Optional provider keys are required only when the corresponding real adapter is enabled.

## 15. Observability and operations

Every request/job/provider call receives a correlation ID. Logs and database diagnostics must let an operator answer:

- which tenant and logical operation ran;
- who or what initiated it;
- which prompt version/provider/model or integration resource was used;
- attempt count, duration, cursor/counts, and final state;
- whether an error is retryable;
- when a stale job will be recovered;
- approximate and actual AI usage/cost.

Admin diagnostics show sanitized request data only. Health readiness checks database connectivity, queue access, and configuration presence without calling paid providers.

## 16. UI contract

- One project-owned design system serves all three role surfaces.
- Use semantic HTML, visible focus, keyboard-accessible dialogs/menus, labelled fields, and live regions for async status.
- Every data view has loading, empty, error, partial/stale, and populated states.
- Destructive actions require explicit confirmation and describe consequences.
- Token-consuming actions show a meaningful estimate or uncertainty before confirmation.
- Long-running actions return immediately with a job/status link.
- Mobile layouts preserve core campaign editing and approval; dense admin diagnostics may use responsive tables/cards.
- Do not ship large page-specific inline scripts or runtime CDN dependencies.

## 17. Architecture decisions still open

These do not block M0 and must be resolved only when their owning task reaches them:

- Transactional email provider: Resend versus Postmark.
- Inbound competitor-email transport: provider webhook versus dedicated mailbox poller.
- Primary real AI provider for launch.
- Whether live Shopify is P0 or promoted after the Klaviyo vertical slice.
- Whether preparing a Klaviyo draft is allowed in the first external beta.

Until resolved, use interfaces and fake adapters rather than embedding assumptions.

## V2-000 contract freeze — October 4, 2026

Code contracts are in `features/workflow/domain/contracts.ts`; capability, chat/proposal, material edit and retry policies are in `features/workflow/domain/policy.ts`. Approval revisions are independent of job/provider outcomes. Owner-only approval/scheduling does not transfer to platform operators. Designers use assignment policy, never tenant-wide campaign queries. Private chat is creator-scoped; shared visibility never grants another actor's proposal confirmation.

Material edits: brief invalidates calendar/copy/design/delivery; copy invalidates copy/design/delivery; design invalidates design/delivery; audience or schedule invalidates calendar/delivery; sender invalidates delivery; links/footer invalidate design/delivery. Approval history remains append-only. Packages are immutable database snapshots with source approval IDs and source revisions. Any invalidation requires a new package; scheduled edits first reconcile/cancel under delivery policy.

Queue policy: initial attempt plus three eligible transient retries; unknown side effects reconcile to found/absent/unknown before retry. Durable job records include lease tokens/expiry, checkpoint, attempts, availability and a unique tenant/idempotency key. Provider preparation, scheduling and sent confirmation remain distinct states.

Schema sequencing: domain tables are allocated to their existing blocks, with cross-domain foreign keys/RPC wiring deferred to `2026091409xxxx` where sort-order requires it. Only Supabase schema tooling generates database types. No new runtime dependencies. Local generated `graphify-out` artifacts are excluded from format/lint checks; their contents remain untouched.

### V2-003 evidence and intake extension

Brand-kit extraction uses a typed `BrandKitExtractor` seam for supplied text tokens in fixture mode; no external/PDF inference is claimed. Asset hashes are tenant-scoped and immutable Storage paths are content-addressed. Original files and per-file import outcomes persist; owner corrections supersede stale classifier jobs. Brand revision corrections retain prior snapshots/events and invalidate dependent unsent approvals; active delivery must be cancelled/reconciled first. Competitor readiness remains an explicit unmet requirement until capture integration.
