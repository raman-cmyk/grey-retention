# Feature delivery order

The user authorized continued sequential implementation on October 28, 2026. The [feature register](feature-register.json) contains all 620 clean-room requirements from the planning checklist. Existing legacy capabilities are inventory evidence, not verified implementation of this repository. No legacy source, prompts, credentials or customer content is imported.

Feature IDs refer to requirements; task IDs in [BUILD_LEDGER](BUILD_LEDGER.md) refer to code changes. Similar prefixes do not mean the numbering is interchangeable. A partial feature keeps its missing acceptance conditions visible.

## Current delivery

| Order | Work                                                                          | Task / status                                | Completion boundary                                                                                                    |
| ----- | ----------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1     | Simple authentication, workspace creation and setup guide                     | ONB-001 · PR #2 in review                    | Saved brand basics and resumable record-derived guidance; no website extraction or generated-email claim.              |
| 2     | Dedicated first-draft composer, source preview, local date/time, retry safety | DRF-001 · local acceptance passed; in review | Original/authorized structural draft becomes a saved unapproved campaign. Approval and generation remain separate.     |
| 3     | Reference intake without waiting for a subscription                           | Next                                         | Upload/paste supported email content with safe preview, provenance and processing failure recovery.                    |
| 4     | First useful copy/design result and contextual product mapping                | Planned                                      | Real persisted work state, recoverable generation and editable output; distinguish fixture from live quality.          |
| 5     | Merchant URL discovery and confirmation                                       | Planned                                      | Bounded public-site reads through typed adapters, factual suggestions, correction and honest fallback.                 |
| 6     | Competitor watchlist and collection                                           | Planned                                      | One brand initially; accessible archive or collecting/pending state; authorized ingestion and source provenance.       |
| 7     | Reconstruction modes and fidelity review                                      | Planned                                      | Original-reference comparison, adaptation versus explicit reconstruction, assets/links and email compatibility checks. |
| 8     | Store products, running offers and active ads                                 | Planned                                      | Authorized sources, freshness, correction and mapping into drafts.                                                     |
| 9     | Just-in-time Klaviyo/Shopify and reusable settings                            | Planned                                      | Verified scopes, account-specific footer/audience IDs, preview/export acceptance and reconnect behavior.               |
| 10    | Sequence/calendar operations, collaboration, MCP and learning                 | Planned                                      | Complete remaining register items one at a time with permissions, evidence and recovery tests.                         |

The order follows activation needs rather than numeric IDs. Supporting security and data correctness ship with each feature. Live connections, sending, paid AI, production deployment and production automation require their own explicit authorization. Those gates do not prevent local implementation and fixture acceptance.

## Status rules

- `planned`: not yet accepted in the new product.
- `unverified`: a legacy capability exists in the inventory and requires an explicit implementation/audit decision.
- `in_progress`: a bounded task owns active work.
- `partial`: an implemented portion is tested; remaining conditions are listed under `remaining`.
- `verified_fixture`: every listed acceptance condition passed for fixtures; live/production acceptance is still separate.

Update the register and ledger at every handoff. Never mark all 620 complete because scaffolding, a route, or a fake adapter exists. User usability observation and live-provider acceptance remain explicit when a requirement calls for them.

DRF-001 acceptance: 107 unit tests, 352 database assertions, 56 desktop/mobile journeys and 12 concurrent idempotent requests. This accepts a saved brief/structure, not a finished generated email. The next build item is safe reference intake without waiting for a competitor subscription.
