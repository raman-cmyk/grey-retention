# Build brief: start here

**Every coding agent reads this first.** It says what we are building now, which documents win, what is decided, and who builds what. It was last set by the owner (Raman) on 11 November 2026.

> **11 November 2026: the agent plan (v3) is now the build plan.** Read [`AGENT_MAP.md`](AGENT_MAP.md) right after this page. Decisions D16–D24 below override VISION.md, earlier decisions and older lane lists wherever they conflict: no human loop, no weekly approval, the owner starts planning and email creation, multi-label competitor intelligence, a brand-understanding onboarding team, multi-agent strategy, three-layer email build, and a do's/don'ts learning memory.

## 1. What we are building

Read [`VISION.md`](VISION.md) completely. It is the owner's v2 product brief, and **it is the source of truth**. In one line: a small Klaviyo store owner sets a max discount, enters their discount codes and approves one batch of emails a week from their phone, and everything else runs itself, based on what works for brands in their niche.

Work follows VISION.md §6 **steps and gates**. Don't start a step until the previous step's gate has passed; the owner judges each gate.

## 2. Which document wins

1. **Owner instructions in chat**, recorded in §3 below.
2. **[`AGENT_MAP.md`](AGENT_MAP.md)**: the v3 agent architecture (11 Nov 2026).
3. **[`VISION.md`](VISION.md)**: product, rules, steps, gates, operating behaviour (§10), data model (§9).
4. **[`DESIGN_RESET.md`](DESIGN_RESET.md)**: new UI/UX discovery and Figma design brief. Old-app parity and the current visual direction are superseded. The replacement design is not yet approved.
5. **[`OWNER_JOURNEYS.md`](OWNER_JOURNEYS.md)**: useful functional reference, subject to the new design. `UI_REBUILD_SPEC.md` and the previous `DESIGN.md` are historical, not target layout requirements.
6. **[`ARCHITECTURE_BLUEPRINT.md`](ARCHITECTURE_BLUEPRINT.md)** and [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md): how code is structured (tenancy, RLS, jobs, adapters). Still valid.
7. [`feature-register.json`](feature-register.json) and [`ROADMAP.md`](ROADMAP.md): the earlier 620-item plan. **History only.** Use it for detail when VISION.md is silent, never to override it.
8. [`archive/`](archive/): old plans (MVP plan, overnight plan, parallel tasks, earlier reviews). Don't follow them.

## 3. Owner decisions, 7 November 2026 (these refine VISION.md)

| #   | Decision                                                                                                                                                                                                                                                                | Effect                                                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Keep an "Exact" mode.** It means: reproduce a competitor email's **exact layout** (same sections, order, proportions) with **the client's own** logo, colours, fonts, products, prices and newly written copy. Never their words, images or branding (VISION rule 8). | Composer modes: **Exact** (layout 1:1), **Rebrand**, **Adapt**. Rename the old "exact copy" path accordingly.                                                                                                                                                                                                     |
| D2  | **No Shopify.** Klaviyo only (VISION rule 1).                                                                                                                                                                                                                           | Hide Shopify on Connections and everywhere else. No new Shopify code.                                                                                                                                                                                                                                             |
| D3  | **No designer.** The AI builds every email from coded blocks.                                                                                                                                                                                                           | Retire the designer workflow (desk, assignment, design review, "With designer" status). Hide the routes and drop them from status flows. Keep the tables (no destructive migrations). The initial 20 types seed the 2,000+ block library (D10); the owner approves taxonomy changes. The owner scores every gate. |
| D4  | **Inbox = Gmail +aliases for now:** `ramangreyofficial+<brand-slug>@gmail.com`, read over IMAP by the scheduled worker. This overrides VISION Step 2 ("own domain") _for now_.                                                                                          | Build ingestion behind the `InboundCaptureTransport` port, so a catch-all domain can replace Gmail later with no other changes. The alias slug decides the brand; sender domain is the fallback; otherwise the ops queue.                                                                                         |
| D5  | **Cheapest AI: Google Gemini, free tier first.** Flash-Lite for section labelling and classification; Flash for copy.                                                                                                                                                   | Add a Gemini adapter behind the existing provider-neutral AI port (keep the fake as default in tests). Model names are config, not code. Per-client spend cap from day one (VISION §10).                                                                                                                          |
| D6  | **Step 0 (manual proof for Sundari & Co)** is done by the supervising Claude with the owner reviewing.                                                                                                                                                                  | Coding sessions don't wait for it. Its output (brief, 2-week calendar, 3 emails) is saved to `docs/step0/` as the reference target for later gates.                                                                                                                                                               |
| D7  | **Competitor subscriptions:** the owner subscribes by hand. Pre-subscribe ~10 niches now (skincare, supplements, jewelry, pet, home, apparel, fitness, beauty tools, baby, kitchen).                                                                                    | Inbox admin shows each brand's +alias address and its subscription status.                                                                                                                                                                                                                                        |
| D8  | **Repository is public** (for free CI minutes).                                                                                                                                                                                                                         | Never commit secrets, real customer data or client names. Use neutral sample names in fixtures and docs.                                                                                                                                                                                                          |
| D9  | **Database changes deploy automatically:** the Supabase GitHub integration applies migrations merged to `main`.                                                                                                                                                         | Every new migration number must sort after the newest on `main` (`2026091409xxxx`, next free). Both lanes share this sequence; check `main` right before merging.                                                                                                                                                 |

### Further owner decisions — 7 November 2026

- **D10 — 2,000+ blocks.** The first 20 types are a seed. Define type/variant/template counting, provenance, deduplication and quality before reporting scale.
- **D11 — Strategic segmentation.** Add segmentation to strategy, calendar, audience allocation, QA, approval and results. Support 30–35 monthly campaigns across segments as a planning scenario, with roughly 12/customer as an illustrative average. Neither is a hard rule. Define an exposure policy; retain current collision guards until replacement checks are verified.
- **D12 — Conversational segment builder.** Natural language → supported explicit rules → estimated membership, exclusions and overlap preview → refinement → approval.
- **D13 — Central AI workspace.** Highly capable chat connected to brand context, strategy, campaigns, segments and results, with typed proposals, evidence and approval. Model and UI are undecided.
- **D14 — Complete UI/UX reset.** Start from user jobs and information architecture in Figma. The owner selected a calm, minimal light interface; exact layouts and interactions still need review. Stop old-app parity/polish tasks. Retain useful backend functionality. The existing theme, corners, navigation and layouts are not replacement requirements.
- **D15 — One to-do area.** [PROJECT_TODOS.md](PROJECT_TODOS.md) records explicit owner to-dos after discussions and links implementation issues/evidence. Discussion does not mean a feature is built.

These decisions override conflicting instructions below and in historical specs. They describe requirements, not implemented capability.

### Owner decisions — 11 November 2026 (the agent plan, v3)

- **D16 — No human loop.** Every step is an AI agent or code. Agents check each other; when a check keeps failing the system falls back to a safer option (safer block variant, plainer copy, coded layout), logs the reason and writes a "don't". The people ops queue becomes an automatic fallback log that admins can read. This replaces VISION's "3 retries then human" and "2 AI rounds then human".
- **D17 — No weekly approval.** The owner starts work when he wants: **Plan next 15 days** and **Create email**. His only inputs are limits (max discount, real codes) and which offers to run. Supersedes VISION Step 5 and the "mandatory approval" line in PROJECT_TODOS. APR-001/APR-002 code stays but is hidden. Default until the owner says otherwise: a created email lands in Klaviyo as a **draft**, and scheduling is one click.
- **D18 — Multi-label competitor intelligence.** Each competitor email gets email-level labels (industry, email type, offer type, season, angle, brand size) and each section gets several labels (family, layout, purpose, style). The 20 seed types become 20 _families_; a Variant maker turns new sections into reusable block variants (structure only, never competitor words or images), with a duplicate check, so the block library grows into the thousands (refines D10).
- **D19 — Onboarding understands the brand.** A team of agents reads the site, the Klaviyo catalog and history, the brand's ads (D23), reviews and social, then a Brand strategist writes the Brand book. The owner adds only max discount and real codes; everything else is pre-filled. Conflicting sources: use the stricter fact and never state the claim.
- **D20 — Multi-agent 15-day strategy.** Brand pulse → owner picks offers (optional) → Competitor mapper (same-size brands in the industry, last 60–90 days, mapped onto our dates) → Brief writer → Calendar planner → Strategy critic (up to 2 rounds).
- **D21 — Three-layer email build.** Modes **Copy** (D1 Exact), **Remix**, **Scratch**. Layer 1 plan sections and pick block variants; layer 2 lock every fact, write the copy, then a **Brand inspector** and an **Email inspector** check and fix it (up to 3 rewrites, then fallback); layer 3 draw it and a **Visual inspector** checks desktop and 375px screenshots. Before choosing the drawing method, test **A (coded blocks)** against **B (designed hero picture from the real product photo + coded body)**: 10 emails each for one brand. C (full image email) is out of the first test.
- **D22 — Learn do's and don'ts.** After each send, a Performance analyst and a Memory writer turn results, inspector rejections and owner edits into written rules with evidence and confidence, per brand and per industry. Every agent reads them. A rule needs a repeated pattern (3+ sends) and expires if later results disagree.
- **D23 — Ads source: Meta Ad Library** (public, no login). A client ad-account connection can come later.
- **D24 — Migration numbers are chosen at merge time.** No reservations. Right before merging, rename your unmerged migration to the next number after the newest on `main` (then re-run `test:db`). This replaces the reservation notes in the ledger.

## 4. What already exists, and how v2 reuses it

| v2 need                                  | Already on `main`                                                   | v2 change                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Shell, Inspiration/Campaigns names, look | UIR-002, DS-001..006                                                | Functional foundation only; replace the UI through D14                                                              |
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

## 5. Build plan and lanes (v3, 11 November 2026)

Build the agents in [`AGENT_MAP.md`](AGENT_MAP.md). Every agent runs through `runAi` and the agent runtime (MEM-001), on the fake AI in tests. Each lane works one issue per PR, runs `/verify`, uses the code-reviewer (and rls-migration-reviewer for SQL), and merges when green. Migration numbers follow D24.

**Supervisor (this chat):** GEM-002/GEM-003 (live AI metering), **MEM-001 agent runtime and shared memory** (Brand book, do's and don'ts, agent run log, prompt versions, memory injected into prompts), the agent map, and gates.

**Lane B: data and integrations** ("Grey Retention M0 Stabilize" session)

1. Finish KLV-001 (live Klaviyo key check).
2. **CI-001 Email classifier + Section tagger** (D18): email-level and multi-label section tags; replaces the one-of-20 labeller; re-run low confidence on the larger model; "untagged" fallback.
3. **CI-002 Variant maker + duplicate check + library search** (D18): reusable variants from sections, structural fingerprint, search by every label.
4. **ONB-101..105 source readers** (D19): Site reader, Catalog analyst (live Klaviyo catalog), Klaviyo historian, Ads analyst (Meta Ad Library, D23), Reviews + social reader. Each behind a typed adapter with a fake.
5. **LRN-001 Klaviyo sync + results** (status hourly, results for 3 days).

**Lane A: agents and email** ("Grey Retention project setup" session)

1. **RET-002** hide weekly approval (D17) and turn email-build failures into the fallback log (D16).
2. **STR-001..003 strategy agents** (D20): Brand pulse + offer pick, Competitor mapper, Brief writer + Calendar planner + Strategy critic. Start on sample data; wire to real data as lane B's readers land.
3. **EML-001..005 email build** (D21): mode router + Section planner (variant search), Content locker, Brand and Email inspectors (wrapping ASM-002 and QAG-001 with an AI fix loop), Designer A and B + Visual inspector, then the A-vs-B test harness.
4. **ONB-106 Voice + look analyst and Brand strategist** → Brand book (after lane B's readers).
5. **LRN-002 Performance analyst + Memory writer** (D22).

**Order:** lane B starts with CI-001/CI-002 and ONB-101; lane A with RET-002, STR-001..003 and EML-001; the supervisor with GEM-002/003 and MEM-001. Then the remaining readers, email layers 2–3, the A/B test, and learning.

**Gates (owner judges):** tagging agrees with a person on 85% of 50 sections; the Brand book for one brand is right without edits; the 15-day plan is at least as useful as the Step 0 hand-made brief; A vs B test picked; 10 emails for one brand, 7 "would send as-is".

## 6. Definition of done (every PR)

- Behaviour, authorisation, state changes and failure paths are tested; `pnpm verify` passes; SQL passes `supabase:reset` + `test:db`; UI flows pass `test:e2e`.
- The fake provider is the default. Live Klaviyo, Gmail and Gemini calls happen only through adapters, and only where the owner has approved (D4, D5: approved for this build).
- No secrets, client names or customer data in code, fixtures or docs (D8).
- The ledger row and handoff are updated. The issue is closed with one plain-English line saying what Raman will now see.

## 7. Owner setup still needed (the supervisor tracks these)

- Gmail: turn on 2-step verification for `ramangreyofficial@gmail.com`, create an app password, add it to Vercel as `INBOX_IMAP_APP_PASSWORD` (and `INBOX_IMAP_USER`). Never in chat or the repo.
- Gemini: create a Google AI Studio key and add it to Vercel as `GEMINI_API_KEY`.
- Klaviyo: a private API key for Sundari & Co (the test brand), pasted into the app's Connections page when the live adapter lands.
