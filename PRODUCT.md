# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated and confirmed: Next.js App Router with TypeScript on Vercel; Supabase for PostgreSQL, Auth, Storage, Realtime, queues, and scheduled work. Development begins on free tiers. External systems sit behind typed adapters so local/demo mode works without credentials.

## Users

Primary users are retention-marketing operators managing ecommerce email programs across planning, copy, audience, production, and performance review.

Secondary users:

- agency or brand administrators governing tenants, prompts, AI cost, integrations, packages, and support;
- designers receiving scoped campaign assignments, submitting work, and responding to reviews;
- tenant owners and staff collaborating on brand context, campaign approval, and scheduling.

## Product Purpose

Grey Retention turns fragmented retention-marketing work into one traceable operating loop. It combines Klaviyo and Shopify data, brand intelligence, campaign planning, AI-assisted drafting, references, design handoff, approvals, and operational diagnostics.

Success means an operator can move from connected or seeded data to a reviewed campaign draft without spreadsheets, disconnected chat transcripts, hidden job state, or direct database intervention.

## Positioning

Grey Retention is an operating system for retention campaigns, not a generic AI copy generator. Its distinct mechanism joins brand truth, live retention data, scoped operator knowledge, campaign state, design workflow, and governed AI actions in one tenant-aware record.

## Operating Context

Users work repeatedly throughout a month:

- inspect Klaviyo performance, lists, segments, campaigns, flows, and metrics;
- maintain brand identity, voice, products, offers, holidays, and campaign defaults;
- plan individual days, full months, or multi-day events;
- develop subjects, content, audience, product focus, references, and send timing;
- request and review designer work;
- prepare approved campaign work for Klaviyo;
- monitor sync jobs, AI usage, spend, provider health, and customer support.

Admin and designer applications are separate authorization surfaces within one web product.

## Capabilities and Constraints

- MVP must provide a persisted end-to-end campaign workflow, not static mock screens.
- Client, admin, and designer roles require deny-by-default authorization and tested tenant isolation.
- Klaviyo is the primary retention integration; Shopify is optional.
- Synchronization and AI actions use durable, idempotent queued jobs with explicit state, retries, cursors, and stale-job recovery.
- AI prompts are versioned. Calls record provider, model, prompt version, tokens, cost, latency, status, and tenant.
- Package entitlements, tenant overrides, and spend caps remain separate gates.
- Side-effecting AI or Klaviyo actions require explicit operator confirmation.
- Demo mode must exercise core workflows without external secrets or paid calls.
- Store timestamps in UTC and render in each tenant's IANA timezone.
- Commercial billing collection is deferred; package configuration and entitlement accounting remain in scope.
- Live campaign sending is deferred. MVP may prepare an external draft after confirmation.

## Brand Commitments

- Working and customer-facing name: Grey Retention.
- Product voice: direct, operational, calm, precise, and accountable.
- Product will be white-labelled and sold to multiple customers. Name, logos, palette, typography, domains, email identity, feature availability, and customer-facing copy must be configurable without code forks.
- No logo, final identity assets, testimonials, customer claims, or approved marketing claims have been supplied.
- Existing deployed interface is behavioral evidence, not visual authority. User confirmed an original replacement world rather than preserving the old charcoal/system-blue treatment.

## Evidence on Hand

- `GREY_RETENTION_DISCOVERY.md`: read-only audit of client, super-admin, public-auth, integrations, data contracts, prompts, jobs, and defects.
- `docs/MVP_PLAN.md`: staged delivery scope and gates.
- `docs/ARCHITECTURE_BLUEPRINT.md`: shared technical contracts.
- `docs/PARALLEL_TASKS.md`: dependency-aware autonomous task prompts.
- `docs/BUILD_LEDGER.md`: durable task and integration state.

No source code, official brand assets, customer testimonials, approved benchmarks, or proprietary prompt bodies are available. Future work must not fabricate them.

## Product Principles

1. One campaign record carries strategy, evidence, decisions, production, and outcome.
2. AI proposes and explains; operators confirm consequential actions.
3. Tenant isolation, usage accounting, and job visibility are product features.
4. Integration failures remain recoverable and diagnosable without database access.
5. Dense operational information stays calm, legible, and action-oriented.
6. Shared code and domain contracts remain clean and DRY; white-label differences enter through data and tokens, never duplicated feature implementations.

## Accessibility & Inclusion

Target WCAG 2.2 AA for core journeys. Keyboard operation, visible focus, semantic landmarks, labelled forms, non-color-only status, reduced-motion support, responsive layouts, and assistive-technology-friendly async feedback are required.
