# Agent map (v3)

Set by the owner (Raman) on 11 November 2026 after reviewing the first agent map. This is the target architecture for the AI team. It refines [`VISION.md`](VISION.md) and wins where they conflict (see decisions D16–D24 in [`BUILD_BRIEF.md`](BUILD_BRIEF.md)). A visual version is kept as an artifact by the supervisor.

## Principles

1. **No human loop.** Agents check each other. When a check keeps failing, the system falls back to a safer option, logs why, and turns the failure into a "don't". Nothing waits for a person.
2. **The owner starts things.** No weekly approval. The owner clicks **Plan next 15 days** or **Create email** when he wants. His only other inputs are limits (max discount, real codes) and which offers to run.
3. **Thousands of blocks.** The 20 seed types become 20 _families_. Every new competitor section can become a reusable _block variant_, so the library grows into the thousands.
4. **Learns do's and don'ts.** Results, inspector rejections and owner edits become written rules with evidence. Every agent reads them before it works.

Legend: **AI** = an agent (model in brackets), **code** = rules, data or rendering, **owner** = a choice, never a gate, **memory** = shared store.

## 0. Shared memory

| Store              | What it holds                                                                                | Main labels                                                 |
| ------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Brand book         | Products, prices, offers, voice, look, customers, true facts (shipping, returns, guarantee)  | facts, voice, brand kit, offers                             |
| Competitor library | Every competitor email, split into sections and tagged                                       | industry, email type, offer type, season, angle, brand size |
| Block library      | Reusable section designs (variants), with family, layout and results                         | family, layout, columns, image use, style, results          |
| Do's and don'ts    | Rules learned from results, inspector rejections and owner edits, per brand and per industry | do / don't, why, evidence, confidence, expiry               |
| Results            | Opens, clicks and revenue per email, section, offer, send time and audience                  | per email, per section, per offer                           |

## 1. Competitor intelligence (always running, platform budget)

Inbox capture (code, built) → Section splitter (code, built) → **Email classifier** (AI, Flash-Lite + screenshot): industry, email type, offer, season, angle → **Section tagger** (AI, Flash-Lite + screenshot): several labels per section (family, layout, purpose, style); replaces the one-of-20 labeller → **Variant maker** (AI, Flash): turns a new section into a reusable block variant, structure only, never the competitor's words or images → Duplicate check (code) → Competitor + block library (memory).

Loop: a low-confidence tag is re-run with the screenshot on the larger model; if still unsure, the section is stored as "untagged" and left out of search.

## 2. Onboarding: understand the brand (once, refreshed monthly)

Read the sources (all AI, Flash): **Site reader** (home, product, about, shipping, returns, FAQ), **Catalog analyst** (Klaviyo catalog: duplicates, bestsellers, new arrivals, price bands), **Klaviyo historian** (past campaigns, flows, segments, what made money), **Ads analyst** (Meta Ad Library, public: live offers, angles, creatives; D23), **Reviews + social reader**.

Put it together: **Voice + look analyst** (AI, Flash + images) → **Brand strategist** (AI, 2.5 Pro) writes the Brand book → owner adds max discount and real codes → Brand book (memory).

Loop: when sources disagree, the strategist uses the stricter fact, never states the claim, and records the conflict.

## 3. Strategy: the next 15 days (owner clicks "Plan next 15 days")

**Brand pulse** (AI, Flash): live offers, launches, stock, last results, dates → owner picks offers (optional) → **Competitor mapper** (AI, Flash): what same-size brands in the industry sent in the last 60–90 days, mapped onto our dates → **Brief writer** (AI, 2.5 Pro): calendar actions with evidence → **Calendar planner** (AI, 2.5 Pro): email type, angle, products, offer, audience, send time → Calendar rules (code, built) → **Strategy critic** (AI, Flash) against do's, don'ts and rules.

Loop: up to 2 critic rounds; slots that still fail are dropped.

## 4. Build each email (owner clicks "Create email" on a slot)

Mode (owner): **Copy** (a competitor email's layout, our content; D1 "Exact"), **Remix** (keep the idea, change the layout), **Scratch** (design from nothing).

- **Layer 1, plan:** Section planner (AI, Flash) picks the sequence and a block variant per section from the library, filtered by industry, email type and results. In Copy mode the competitor's tagged sections become the plan one to one (code).
- **Layer 2, lock the content:** Content locker (AI + code): products, prices, offer, code, end date, images, links → Copywriter (AI, Flash, built) → **Brand inspector** (AI, Flash + copy check code): voice, facts, claims, discounts, codes, do's and don'ts; fixes what it finds → **Email inspector** (AI, Flash-Lite + launch check code): subject, preview, length, one clear action, spam words, links, accessibility; fixes what it finds.
- **Layer 3, draw it:** Designer (code + Flash Image for approach B) → **Visual inspector** (AI, Flash + desktop and 375px screenshots) → Launch check + push (code, built).

Loops: up to 3 rewrite tries with the inspectors' exact reasons; then fall back to a safer variant (approach A, plainer copy), log the reason, and write a "don't".

### Layer 3 approaches (test before choosing; D21)

| Approach                      | Description                                                                    | Role                  |
| ----------------------------- | ------------------------------------------------------------------------------ | --------------------- |
| A. Coded blocks               | Every section is HTML from a block variant in the brand kit                    | Fallback              |
| B. Designed hero + coded body | Top section is a designed picture from the real product photo; text stays real | Default to test       |
| C. Full designed image        | Whole email as pictures                                                        | Not in the first test |

Test: 10 emails each with A and B for one brand, scored on looks, deliverability and clicks. The owner picks the default.

## 5. Send and learn (after every send)

Klaviyo sync (code): status hourly, opens, clicks and revenue for 3 days → **Performance analyst** (AI, Flash): what worked by variant, email type, offer, send time, audience → **Memory writer** (AI, Flash): do's and don'ts with evidence, also from inspector rejections and owner edits → memory.

Loop: a rule is written only when a pattern repeats (3+ sends). Weak rules carry low confidence and expire if later results disagree. Industry-wide rules outweigh one small brand's noise.

## Harness around every AI call

Every agent call goes through `runAi` (GEM-001): model from settings (only priced models), worst-case cost reserved from the client's allowance (or the platform's daily budget for competitor work, GEM-003) before sending, strict JSON answer shape, timeouts and rate limits handled, real cost recorded once. The agent runtime (MEM-001) adds: prompt versions, the brand book and do's/don'ts injected into each prompt, and a run log of every agent step (inputs, outputs, cost, verdict).

## Models

| Agent                                            | Model                                   |
| ------------------------------------------------ | --------------------------------------- |
| Email classifier, Section tagger                 | Gemini 2.5 Flash-Lite (with screenshot) |
| Variant maker                                    | Gemini 2.5 Flash                        |
| Onboarding readers and analysts                  | Gemini 2.5 Flash                        |
| Brand strategist, Brief writer, Calendar planner | Gemini 2.5 Pro                          |
| Brand pulse, Competitor mapper, Strategy critic  | Gemini 2.5 Flash                        |
| Section planner, Content locker, Copywriter      | Gemini 2.5 Flash                        |
| Brand inspector, Visual inspector                | Gemini 2.5 Flash                        |
| Email inspector                                  | Gemini 2.5 Flash-Lite                   |
| Designer (hero picture, approach B)              | Gemini 2.5 Flash Image                  |
| Performance analyst, Memory writer               | Gemini 2.5 Flash                        |

Model names stay in settings, not code (D5). 2.5 Pro and Flash Image must be added to the price table before use.

## What changes in what is built

- BLK-003 section labeller → Section tagger (multi-label) plus the new Email classifier and Variant maker.
- The 20 blocks → 20 families and the first 20 variants; the renderer gains "draw any saved variant".
- ASM-002 copy check and QAG-001 launch check stay as code inside the Brand and Email inspectors.
- APR-001/APR-002 weekly approval: no longer used. Hide it; keep the code.
- The people ops queue → an automatic fallback log (admins can read it).
- Onboarding → the brand-understanding team above.
