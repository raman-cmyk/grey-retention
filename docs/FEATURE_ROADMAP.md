# Feature delivery order

The user authorized continued sequential implementation on October 28, 2026. The [feature register](feature-register.json) contains all 620 clean-room requirements from the planning checklist. Existing legacy capabilities are inventory evidence, not verified implementation of this repository. No legacy source, prompts, credentials or customer content is imported.

Feature IDs refer to requirements; task IDs in [BUILD_LEDGER](BUILD_LEDGER.md) refer to code changes. Similar prefixes do not mean the numbering is interchangeable. A partial feature keeps its missing acceptance conditions visible.

## Current delivery

| Order | Work                                                                          | Task / status                                | Completion boundary                                                                                                      |
| ----- | ----------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1     | Simple authentication, workspace creation and setup guide                     | ONB-001 · PR #2 in review                    | Saved brand basics and resumable record-derived guidance; no website extraction or generated-email claim.                |
| 2     | Dedicated first-draft composer, source preview, local date/time, retry safety | DRF-001 · local acceptance passed; in review | Original/authorized structural draft becomes a saved unapproved campaign. Approval and generation remain separate.       |
| 3     | Reference intake without waiting for a subscription                           | REF-002 · paste slice in review              | Pasted subject/text or HTML source with plain-text preview and provenance. File/EML upload and processing remain.        |
| 4     | First useful copy/design result and contextual product mapping                | AI-002 + REP-001 · local acceptance; review  | Rewrite (OpenAI, server-only) or exact copy → saved editable versions. Live model acceptance needs server configuration. |
| 5     | Merchant URL discovery and confirmation                                       | Planned                                      | Bounded public-site reads through typed adapters, factual suggestions, correction and honest fallback.                   |
| 6     | Competitor watchlist and collection                                           | Planned                                      | One brand initially; accessible archive or collecting/pending state; authorized ingestion and source provenance.         |
| 7     | Reconstruction modes and fidelity review                                      | Planned                                      | Original-reference comparison, adaptation versus explicit reconstruction, assets/links and email compatibility checks.   |
| 8     | Store products, running offers and active ads                                 | Planned                                      | Authorized sources, freshness, correction and mapping into drafts.                                                       |
| 9     | Just-in-time Klaviyo/Shopify and reusable settings                            | Planned                                      | Verified scopes, account-specific footer/audience IDs, preview/export acceptance and reconnect behavior.                 |
| 10    | Sequence/calendar operations, collaboration, MCP and learning                 | Planned                                      | Complete remaining register items one at a time with permissions, evidence and recovery tests.                           |

The order follows activation needs rather than numeric IDs. Supporting security and data correctness ship with each feature. Live connections, sending, paid AI, production deployment and production automation require their own explicit authorization. Those gates do not prevent local implementation and fixture acceptance.

## Status rules

- `planned`: not yet accepted in the new product.
- `unverified`: a legacy capability exists in the inventory and requires an explicit implementation/audit decision.
- `in_progress`: a bounded task owns active work.
- `partial`: an implemented portion is tested; remaining conditions are listed under `remaining`.
- `verified_fixture`: every listed acceptance condition passed for fixtures; live/production acceptance is still separate.

Update the register and ledger at every handoff. Never mark all 620 complete because scaffolding, a route, or a fake adapter exists. User usability observation and live-provider acceptance remain explicit when a requirement calls for them.

DRF-001 acceptance: 107 unit tests, 352 database assertions, 56 desktop/mobile journeys and 12 concurrent idempotent requests. This accepts a saved brief/structure, not a finished generated email.

REF-002 adds owner-pasted reference emails: tenant-private, labelled as owner imports, saved exactly as received (up to 100,000 characters), shown only as extracted plain text (preview bounded at 20,000 characters with a visible notice) and usable as a paragraph-outline starting point in the composer. It does not analyze, rewrite or reconstruct the email. Acceptance: 130 unit tests, 393 database assertions and a full fresh browser run of 64/64 desktop/mobile journeys, after test-only fixes for a planning approval race and a statistics worker-batch drain, followed by a Unicode-safe preview fix verified with all 8 pasted-reference journeys (history in the ledger). HTML/EML file upload, screenshot import and recoverable background processing remain for the next intake slice; the first useful generated result (order 4) follows.

AI-002 and REP-001 make the paste flow produce a real result: after pasting, the owner chooses **Rewrite for my brand** (OpenAI Responses API behind the typed AI port, server-only worker, bounded reservations, strict schema, untrusted-source handling) or **Copy this email** (separate immutable source copy, byte-identical download). Results are versioned, editable as text blocks/links/main button (or raw HTML for very large emails), previewed in an opaque sandbox and handed to the existing owner approval. Local acceptance used an explicit loopback OpenAI test double; no paid request was made. Live acceptance, real-model quality, cross-client rendering, image/asset handling and live packages remain open (see `docs/AI_REWRITE_RUNBOOK.md`). Next order: (1) configure the server key and service credential and run the bounded live checklist; (2) file/EML upload and larger sources; (3) image/asset replacement and remaining-link reporting for copies; (4) merchant URL discovery (order 5).
