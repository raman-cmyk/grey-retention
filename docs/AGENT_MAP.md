# Agent map (v3)

Set by the owner (Raman) on 11 November 2026 after reviewing the first agent map; section 4 rebuilt on 15 November 2026 around a design studio and text emails (D25, D26 below). This is the target architecture for the AI team. It refines [`VISION.md`](VISION.md) and wins where they conflict (see decisions D16–D24 in [`BUILD_BRIEF.md`](BUILD_BRIEF.md)). A visual version is kept as an artifact by the supervisor.

## Principles

1. **No human loop.** Agents check each other. When a check keeps failing, the system falls back to a safer option, logs why, and turns the failure into a "don't". Nothing waits for a person.
2. **The owner starts things.** No weekly approval. The owner clicks **Plan next 15 days** or **Create email** when he wants. His only other inputs are limits (max discount, real codes) and which offers to run.
3. **Thousands of blocks.** The 20 seed types become 20 _families_. Every new competitor section can become a reusable _block variant_, so the library grows into the thousands.
4. **Learns do's and don'ts.** Results, inspector rejections and owner edits become written rules with evidence. Every agent reads them before it works.
5. **Design is the moat.** Designed emails are made the way a Figma designer works: free web design, rendered into sharp images, with buttons, products, key text and footer kept live. Text, prices and codes are written by the browser from locked content, never drawn by an image model.

Legend: **AI** = an agent (model in brackets), **code** = rules, data or rendering, **owner** = a choice, never a gate, **memory** = shared store.

## 0. Shared memory

| Store              | What it holds                                                                                                                                                   | Main labels                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Brand book         | Products, prices, offers, voice, look, customers, true facts (shipping, returns, guarantee); brand kit with real font files, logo, colours and product cut-outs | facts, voice, brand kit, fonts, cut-outs, offers            |
| Competitor library | Every competitor email, split into sections and tagged                                                                                                          | industry, email type, offer type, season, angle, brand size |
| Block library      | Reusable section designs (variants), with family, layout, design DNA and results                                                                                | family, layout, design DNA, image use, style, results       |
| Do's and don'ts    | Rules learned from results, inspector rejections and owner edits, per brand and per industry                                                                    | do / don't, why, evidence, confidence, expiry               |
| Results            | Opens, clicks and revenue per email, section, offer, send time and audience                                                                                     | per email, per section, per offer                           |

## 1. Competitor intelligence (always running, platform budget)

Inbox capture (code, built) → Section splitter (code, built) → **Email classifier** (AI, Flash-Lite + screenshot): industry, email type, offer, season, angle → **Section tagger** (AI, Flash-Lite + screenshot): several labels per section (family, layout, purpose, style); replaces the one-of-20 labeller → **Variant maker** (AI, Flash + screenshot): turns a new section into a reusable block variant, structure only, never the competitor's words or images, and records its design DNA (grid, spacing, type sizes, colour balance, photo crop) → Duplicate check (code) → Competitor + block library (memory).

Loop: a low-confidence tag is re-run with the screenshot on the larger model; if still unsure, the section is stored as "untagged" and left out of search.

## 2. Onboarding: understand the brand (once, refreshed monthly)

Read the sources (all AI, Flash): **Site reader** (home, product, about, shipping, returns, FAQ), **Catalog analyst** (Klaviyo catalog: duplicates, bestsellers, new arrivals, price bands), **Klaviyo historian** (past campaigns, flows, segments, what made money), **Ads analyst** (Meta Ad Library, public: live offers, angles, creatives; D23), **Reviews + social reader**.

Put it together: **Voice + look analyst** (AI, Flash + images; also collects the brand's real web fonts and cuts products out of their photos) → **Brand strategist** (AI, 2.5 Pro) writes the Brand book → owner adds max discount and real codes → Brand book (memory).

Loop: when sources disagree, the strategist uses the stricter fact, never states the claim, and records the conflict.

## 3. Strategy: the next 15 days (owner clicks "Plan next 15 days")

**Brand pulse** (AI, Flash): live offers, launches, stock, last results, dates → owner picks offers (optional) → **Competitor mapper** (AI, Flash): what same-size brands in the industry sent in the last 60–90 days, mapped onto our dates → **Brief writer** (AI, 2.5 Pro): calendar actions with evidence → **Calendar planner** (AI, 2.5 Pro): email type, angle, products, offer, audience, send time and format (designed or text) → Calendar rules (code, built) → **Strategy critic** (AI, Flash) against do's, don'ts and rules.

Loop: up to 2 critic rounds; slots that still fail are dropped.

## 4. Build each email (owner clicks "Create email" on a slot)

Format (planner, owner can switch; D26): **Designed** or **Text**. Mode for designed emails (owner): **Copy** (rebuild a competitor email for this brand; D1 "Exact"), **Remix** (keep the idea, new layout), **Scratch** (design from nothing).

- **Layer 1, plan:** Section planner (AI, Flash) picks the sequence and a block variant per section from the library, filtered by industry, email type and results. In Copy mode the reference email's sections become the plan one to one. Text emails skip this layer.
- **Layer 2, lock the content:** Content locker (AI + code): products, prices, offer, code, end date, images, links → Copywriter (AI, Flash): section by section, or one letter for a text email → **Brand inspector** (AI, Flash + copy check code) → **Email inspector** (AI, Flash-Lite + launch check code). Both fix what they find.
- **Layer 3, design studio (designed emails; D25):**
  1. **Art director** (AI, 2.5 Pro + reference screenshots): storyboards the whole 600 px email, about 1,800 to 2,400 px tall: section order, light/dark rhythm, white space, one focus per section, product placement. In Copy mode it starts from the reference's design DNA.
  2. **Section designer** (AI, 2.5 Pro): designs each section freely in HTML/CSS, like a Figma designer: the brand's real fonts, overlaps, gradients, product cut-outs. All words, prices and codes come from layer 2.
  3. **Image studio** (AI, Flash Image): backdrops only (lifestyle scenes, textures, props) behind the real product photo. Never text, never an invented product.
  4. **Renderer** (code, headless browser): renders each designed section to an image at 1,200 px wide, shown at 600. Buttons, product grid, key text (headline, offer, code as live text or alt text) and footer stay live HTML from block variants.
  5. **Match score** (code, Copy mode): perceptual similarity of each rendered section to the reference section.
  6. **Design critic** (AI, Flash + screenshots): scores the full email and each section 1–10 on a fixed checklist (hierarchy, spacing, contrast, alignment, product prominence, button, phone readability), side by side with the reference, with exact fixes.
  7. **Hard design checks** (code): readable text at 375 px, contrast, total image weight, height, alt text on every image, dark mode, HTML under Gmail's 102 KB clip.
  8. **Inbox preview** (code): screenshots in Gmail, Outlook, Apple Mail, phone and dark mode before the push. Provider to be chosen.
- **Text emails (letter; D26):** Letter writer (AI, Flash): one idea, 80–250 words, one or two links in the text, signature and P.S. → Letter renderer (code): plain personal-looking HTML (16 px system font, left aligned, no banners, optional small logo or signature) plus a real plain-text part → Text checks (code): length, at most 2 links, no images, spam words, a real reply-to inbox.
- **Into Klaviyo:** Launch check + push (code): links, size, images uploaded to Klaviyo, real footer tags, audience; a draft only, never scheduled or sent (D17).

Loops: design rounds, up to 3 per section, until every checklist item scores 8+ (and, in Copy mode, the match score reaches its target); a section that still fails becomes its coded block (approach A), and an email that still fails is sent fully coded, logged, and written as a design "don't". Text emails get up to 3 rewrites, then a shorter, plainer letter. Blind scores from the Grey design team, the owner's optional stars and clicks per design feed design do's and don'ts.

### How an email gets drawn (D21, D25, D26)

| Format                      | Description                                                                                                                           | Role            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| B. Designed sections        | Sections designed in HTML/CSS with the brand's real fonts and product cut-outs, rendered to sharp images; interactive parts stay live | Default to test |
| A. Coded blocks             | Every section is live HTML from a block variant                                                                                       | Fallback        |
| Text email                  | A short personal letter; plain HTML plus plain text                                                                                   | Its own format  |
| Image model draws the email | One AI-made picture of the whole email                                                                                                | Not used        |

Before the A vs B test: a **design proof**. Five emails from the Inspiration inbox are rebuilt for the test brand and shown next to the originals with their match scores. Then the test: 10 emails, each one Klaviyo draft with A and B as variations, half the audience each; scored on looks (critic score, blind design-team scores, optional owner stars), deliverability and clicks. The owner picks the default.

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
| Brand inspector, Design critic                   | Gemini 2.5 Flash                        |
| Art director, Section designer                   | Gemini 2.5 Pro                          |
| Letter writer                                    | Gemini 2.5 Flash                        |
| Email inspector                                  | Gemini 2.5 Flash-Lite                   |
| Image studio (backdrops only)                    | Gemini 2.5 Flash Image                  |
| Performance analyst, Memory writer               | Gemini 2.5 Flash                        |

Model names stay in settings, not code (D5). 2.5 Pro and Flash Image must be added to the price table before use.

## What changes in what is built

- BLK-003 section labeller → Section tagger (multi-label) plus the new Email classifier and Variant maker.
- The 20 blocks → 20 families and the first 20 variants; the renderer gains "draw any saved variant".
- ASM-002 copy check and QAG-001 launch check stay as code inside the Brand and Email inspectors.
- APR-001/APR-002 weekly approval: no longer used. Hide it; keep the code.
- The people ops queue → an automatic fallback log (admins can read it).
- Onboarding → the brand-understanding team above.
- Designer B (one designed hero, then coded blocks) → the design studio (D25). The visual inspector → the design critic.
- New: text emails as their own format (D26).

## Decisions added 15 November 2026

- **D25. Design studio.** Designed emails are designed in HTML/CSS and rendered to images by a browser; image AI is used for backdrops only; interactive parts stay live. Owner direction: "for agencies like us the moat is designs… we need to crack that first."
- **D26. Text emails.** Text (letter) emails are their own format, chosen per slot by the calendar planner and switchable by the owner.
