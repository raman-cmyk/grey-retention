# Build brief: start here

**Every coding agent reads this first.** It says what we are building now, which documents win, what is decided, and who builds what. It was last set by the owner (Raman) on 7 November 2026.

## 1. What we are building

Read [`VISION.md`](VISION.md) completely. It is the owner's v2 product brief, and **it is the source of truth**. In one line: a small Klaviyo store owner sets a max discount, enters their discount codes and approves one batch of emails a week from their phone, and everything else runs itself, based on what works for brands in their niche.

Work follows VISION.md §6 **steps and gates**. Don't start a step until the previous step's gate has passed; the owner judges each gate.

## 2. Which document wins

1. **Owner instructions in chat**, recorded in §3 below.
2. **[`VISION.md`](VISION.md)**: product, rules, steps, gates, operating behaviour (§10), data model (§9).
3. **[`UI_REBUILD_SPEC.md`](UI_REBUILD_SPEC.md)**: layout of the screens we keep (the old app 1:1 in structure; Exa-style branding from [`DESIGN.md`](DESIGN.md)).
4. **[`OWNER_JOURNEYS.md`](OWNER_JOURNEYS.md)**: screen behaviour, wording and the §18 simplifications (one status system, sandboxed previews, one brand timezone).
5. **[`ARCHITECTURE_BLUEPRINT.md`](ARCHITECTURE_BLUEPRINT.md)** and [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md): how code is structured (tenancy, RLS, jobs, adapters). Still valid.
6. [`feature-register.json`](feature-register.json) and [`ROADMAP.md`](ROADMAP.md): the earlier 620-item plan. **History only.** Use it for detail when VISION.md is silent, never to override it.
7. [`archive/`](archive/): old plans (MVP plan, overnight plan, parallel tasks, earlier reviews). Don't follow them.

## 3. Owner decisions, 7 November 2026 (these refine VISION.md)

| #   | Decision                                                                                                                                                                                                                                                                | Effect                                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Keep an "Exact" mode.** It means: reproduce a competitor email's **exact layout** (same sections, order, proportions) with **the client's own** logo, colours, fonts, products, prices and newly written copy. Never their words, images or branding (VISION rule 8). | Composer modes: **Exact** (layout 1:1), **Rebrand**, **Adapt**. Rename the old "exact copy" path accordingly.                                                                                                                                                                                                                           |
| D2  | **No Shopify.** Klaviyo only (VISION rule 1).                                                                                                                                                                                                                           | Hide Shopify on Connections and everywhere else. No new Shopify code.                                                                                                                                                                                                                                                                   |
| D3  | **No designer.** The AI builds every email from coded blocks.                                                                                                                                                                                                           | Retire the designer workflow (desk, assignment, design review, "With designer" status). Hide the routes and drop them from status flows. Keep the tables (no destructive migrations). The 20 block types (VISION Step 1) are defined by Claude from email-marketing practice; the owner approves the list. The owner scores every gate. |
| D4  | **Inbox = Gmail +aliases for now:** `ramangreyofficial+<brand-slug>@gmail.com`, read over IMAP by the scheduled worker. This overrides VISION Step 2 ("own domain") _for now_.                                                                                          | Build ingestion behind the `InboundCaptureTransport` port, so a catch-all domain can replace Gmail later with no other changes. The alias slug decides the brand; sender domain is the fallback; otherwise the ops queue.                                                                                                               |
| D5  | **Cheapest AI: Google Gemini, free tier first.** Flash-Lite for section labelling and classification; Flash for copy.                                                                                                                                                   | Add a Gemini adapter behind the existing provider-neutral AI port (keep the fake as default in tests). Model names are config, not code. Per-client spend cap from day one (VISION §10).                                                                                                                                                |
| D6  | **Step 0 (manual proof for Sundari & Co)** is done by the supervising Claude with the owner reviewing.                                                                                                                                                                  | Coding sessions don't wait for it. Its output (brief, 2-week calendar, 3 emails) is saved to `docs/step0/` as the reference target for later gates.                                                                                                                                                                                     |
| D7  | **Competitor subscriptions:** the owner subscribes by hand. Pre-subscribe ~10 niches now (skincare, supplements, jewelry, pet, home, apparel, fitness, beauty tools, baby, kitchen).                                                                                    | Inbox admin shows each brand's +alias address and its subscription status.                                                                                                                                                                                                                                                              |
| D8  | **Repository is public** (for free CI minutes).                                                                                                                                                                                                                         | Never commit secrets, real customer data or client names. Use neutral sample names in fixtures and docs.                                                                                                                                                                                                                                |
| D9  | **Database changes deploy automatically:** the Supabase GitHub integration applies migrations merged to `main`.                                                                                                                                                         | Every new migration number must sort after the newest on `main` (`2026091409xxxx`, next free). Both lanes share this sequence; check `main` right before merging.                                                                                                                                                                       |

## 4. What already exists, and how v2 reuses it

| v2 need                                  | Already on `main`                                                   | v2 change                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Shell, Inspiration/Campaigns names, look | UIR-002, DS-001..006                                                | Keep                                                                                                                |
| Onboarding                               | ONB-001, composer (DS-006)                                          | Rebuild as the VISION §5 wizard (most important screen)                                                             |
| Klaviyo key                              | Connections UIR-013 (format check, masked hint)                     | Live key and scope check, catalog-empty block, timezone/currency read                                               |
| Klaviyo data                             | `klaviyo-read` port + fake; Dashboard UIR-003; detail pages UIR-004 | Live adapter and sync job: catalog, Placed Order → bestsellers (weekly), scheduled campaigns, reports               |
| Store timezone                           | UIR-023                                                             | Keep                                                                                                                |
| Blackout dates                           | Holidays & Events UIR-012                                           | Add a "blackout" type, enforced by QA                                                                               |
| Brand facts                              | Brand profile UIR-005, mismatch guard UIR-021                       | Add the VISION facts sheet (shipping, returns, guarantees, banned words/claims, tone = 3 chips), scraped pre-fill   |
| Brand kit                                | Assets, white-label theme tokens                                    | Logo, 3 colours, font, with visual confirmation                                                                     |
| Campaign defaults                        | Settings UIR-011                                                    | Add max discount %, discount codes (code, %, expiry), send frequency 2/3/4                                          |
| Jobs                                     | STAB-001 leased jobs + scheduler                                    | Post-onboarding chain (VISION §10); 3 retries, then the ops queue                                                   |
| Status                                   | UIR-015 one status                                                  | Map to VISION §9: generated, qa_failed, pending_approval, approved, scheduled, sent, externally_modified, cancelled |
| Approval                                 | UIR-016 (in progress)                                               | Weekly batch approval: signed single-use 7-day links, Approve all / Change, plus in-app                             |
| Founder inputs                           | Ask GROS (UIR-008)                                                  | GROS becomes the founder-input box: input → calendar rebuild with a diff (Removed / Added / Moved)                  |
| Competitor inbox                         | `competitor_*` tables (fixture-only), `email-import` MIME parser    | Real ingestion (D4); images downloaded at once; 600px screenshot; process once                                      |
| Rendering                                | `rendering`, sandboxed preview card                                 | Block renderer; 375px and 600px screenshots for QA and approval                                                     |
| Copy                                     | `email-generation`                                                  | Copy into blocks through the AI port (D5)                                                                           |
| Delivery                                 | `delivery` packages (fake)                                          | Live push: images → Klaviyo, template → campaign → segment → draft, then schedule after Step 5                      |
| Results                                  | `reporting`, `results_learning`                                     | Daily report pull for 3 days; "% approved without edits"                                                            |
| Spend cap                                | `packages_usage`                                                    | Per-client LLM cap                                                                                                  |
| Ops                                      | Operations admin panels                                             | VISION §10 ops dashboard and ops queue (built alongside Step 4)                                                     |

**Retire or park:** the designer workflow (D3); Shopify (D2); the Agents "soon" items; the Support, Team and Feedback pages stay as built (no new work).

## 5. Build plan and lanes

Two Claude Code sessions build in parallel. Each claims GitHub issues (label `wip` plus a claim comment), works one issue per PR, runs `/verify`, uses the code-reviewer (and rls-migration-reviewer for SQL), and merges when green.

**Lane A: "Grey Retention project setup" session**

1. Finish in-flight PRs (status system, planner, drafts, approve step), then stop the old-app UI work.
2. **V2-S1 Block library:** 20 block types (no countdown); brand-aware email-safe HTML (600px, web-safe font stack, tested at 375px); footer with Klaviyo-required tags (unsubscribe, address, view in browser, organisation); block gallery in Inspiration. Then the labelling harness: given a section image or HTML, the model picks one of the 20 types. Gate: ≥85% agreement on 50 hand-labelled sections.
3. **V2-S3b Assembly:** brief → block sequence → featurable products → copy → HTML; copy QA (facts sheet, banned words, discount regex, code list); Exact/Rebrand/Adapt modes (D1). Gate: 10 Sundari emails, ≥7 "would send as-is".
4. **V2-S5 Weekly approval** UI and emails.

**Lane B: "Grey Retention M0 Stabilize" session**

1. Finish in-flight PRs (Inspiration, Ask GROS, store dashboard), then stop the old-app UI work.
2. **V2-S2 Inspiration inbox:** Gmail IMAP transport (D4); raw HTML and images stored; screenshot; HTML-structure sections; text/design per section; micro and macro facts; repetition weighting; inbox ops queue (unknown sender, opt-in confirmations, unsubscribed). Gate: 200 emails correctly assigned and labelled, plus a per-brand summary the owner agrees with.
3. **V2-S3a Onboarding wizard** (VISION §5 + §10 onboarding behaviour) and the **live Klaviyo adapter**: key scopes, catalog cache and cleaning, bestsellers, scheduled campaigns, Engaged-90/180 segment.
4. **V2-S4 Klaviyo push + full QA** (VISION Step 4 list) and the **ops dashboard**.

Then together: **V2-S6** brief and calendar automation, and **V2-S7** three real clients.

## 6. Definition of done (every PR)

- Behaviour, authorisation, state changes and failure paths are tested; `pnpm verify` passes; SQL passes `supabase:reset` + `test:db`; UI flows pass `test:e2e`.
- The fake provider is the default. Live Klaviyo, Gmail and Gemini calls happen only through adapters, and only where the owner has approved (D4, D5: approved for this build).
- No secrets, client names or customer data in code, fixtures or docs (D8).
- The ledger row and handoff are updated. The issue is closed with one plain-English line saying what Raman will now see.

## 7. Owner setup still needed (the supervisor tracks these)

- Gmail: turn on 2-step verification for `ramangreyofficial@gmail.com`, create an app password, add it to Vercel as `INBOX_IMAP_APP_PASSWORD` (and `INBOX_IMAP_USER`). Never in chat or the repo.
- Gemini: create a Google AI Studio key and add it to Vercel as `GEMINI_API_KEY`.
- Klaviyo: a private API key for Sundari & Co (the test brand), pasted into the app's Connections page when the live adapter lands.
