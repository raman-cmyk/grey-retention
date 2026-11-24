# Agent map (v3)

Set by the owner (Raman) on 11 November 2026 after reviewing the first agent map; section 4 rebuilt on 15 November 2026 around a design studio and text emails, plus 61 owner-picked additions (D25–D27 below). This is the target architecture for the AI team. It refines [`VISION.md`](VISION.md) and wins where they conflict (see decisions D16–D24 in [`BUILD_BRIEF.md`](BUILD_BRIEF.md)). A visual version is kept as an artifact by the supervisor.

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

Put it together: **Voice + look analyst** (AI, Flash + images; also collects the brand's real web fonts and cuts products out of their photos) → **Brand strategist** (AI, plan tier; ONB-106c: code writes the Brand book from the findings, the strategist adds its `strategy`, checked by code) writes the Brand book → owner adds max discount and real codes → Brand book (memory).

Loop: when sources disagree, the strategist uses the stricter fact, never states the claim, and records the conflict.

## 3. Strategy: the next 15 days (owner clicks "Plan next 15 days")

**Brand pulse** (AI, Flash): live offers, launches, stock, last results, dates → owner picks offers (optional) → **Competitor mapper** (AI, Flash): what same-size brands in the industry sent in the last 60–90 days, mapped onto our dates → **Brief writer** (AI, 3.8 Flash): calendar actions with evidence → **Calendar planner** (AI, 3.8 Flash): email type, angle, products, offer, audience, send time and format (designed or text) → Calendar rules (code, built) → **Strategy critic** (AI, Flash) against do's, don'ts and rules.

Loop: up to 2 critic rounds; slots that still fail are dropped.

## 4. Build each email (owner clicks "Create email" on a slot)

Format (planner, owner can switch; D26): **Designed** or **Text**. Mode for designed emails (owner): **Copy** (rebuild a competitor email for this brand; D1 "Exact"), **Remix** (keep the idea, new layout), **Scratch** (design from nothing).

- **Layer 1, plan:** Section planner (AI, Flash) picks the sequence and a block variant per section from the library, filtered by industry, email type and results. In Copy mode the reference email's sections become the plan one to one. Text emails skip this layer.
- **Layer 2, lock the content:** Content locker (AI + code): products, prices, offer, code, end date, images, links → Copywriter (AI, Flash): section by section, or one letter for a text email → **Brand inspector** (AI, Flash + copy check code) → **Email inspector** (AI, Flash-Lite + launch check code). Both fix what they find.
- **Layer 3, design studio (designed emails; D25):**
  1. **Art director** (AI, 3.8 Flash + reference screenshots): storyboards the whole 600 px email, about 1,800 to 2,400 px tall: section order, light/dark rhythm, white space, one focus per section, product placement. In Copy mode it starts from the reference's design DNA.
  2. **Section designer** (AI, 3.8 Flash): designs each section freely in HTML/CSS, like a Figma designer: the brand's real fonts, overlaps, gradients, product cut-outs. All words, prices and codes come from layer 2.
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

Klaviyo sync (code): status hourly, opens, clicks and revenue for 3 days → **Performance analyst** (AI, Flash): what worked by variant, email type, offer, send time, audience → **Memory writer** (AI, Flash): do's and don'ts with evidence, also from inspector rejections and owner edits → memory. LRN-002a (24 Nov): the analyst and the writer run as code after the hourly sync, by email type, unsubscribes (#76) and the top section; a model's reading, send time, offers, inspector rejections and owner edits come next.

Loop: a rule is written only when a pattern repeats (3+ sends). Weak rules carry low confidence and expire if later results disagree. Industry-wide rules outweigh one small brand's noise.

## Harness around every AI call

Every agent call goes through `runAi` (GEM-001): model from settings (only priced models), worst-case cost reserved from the client's allowance (or the platform's daily budget for competitor work, GEM-003) before sending, strict JSON answer shape, timeouts and rate limits handled, real cost recorded once. The agent runtime (MEM-001) adds: prompt versions, the brand book and do's/don'ts injected into each prompt, and a run log of every agent step (inputs, outputs, cost, verdict).

## Models

| Agent                                            | Model                                   |
| ------------------------------------------------ | --------------------------------------- |
| Email classifier, Section tagger                 | Gemini 2.5 Flash-Lite (with screenshot) |
| Variant maker                                    | Gemini 3.5 Flash-Lite                   |
| Onboarding readers and analysts                  | Gemini 3.5 Flash-Lite                   |
| Brand strategist, Brief writer, Calendar planner | Gemini 3.8 Flash                        |
| Brand pulse, Competitor mapper, Strategy critic  | Gemini 3.5 Flash-Lite                   |
| Section planner, Content locker, Copywriter      | Gemini 3.5 Flash-Lite                   |
| Brand inspector, Design critic                   | Gemini 3.5 Flash-Lite                   |
| Art director, Section designer                   | Gemini 3.8 Flash                        |
| Letter writer                                    | Gemini 3.5 Flash-Lite                   |
| Email inspector                                  | Gemini 2.5 Flash-Lite                   |
| Image studio (backdrops only)                    | Gemini 2.5 Flash Image                  |
| Performance analyst, Memory writer               | Gemini 3.5 Flash-Lite                   |

Model names stay in settings, not code (D5). AI-MDL-001 (24 November 2026): Google closed 2.5 Flash and 2.5 Pro to new users and shuts both down on 1 December 2026, so the defaults moved to the replacements Google names (3.5 Flash-Lite for Flash work, 3.8 Flash for the plan tier); 2.5 Flash-Lite stays for labels. Gemini 3.x models get a thinking level from each agent's effort instead of a thinking budget. Flash Image must be added to the price table before use.

## What changes in what is built

- BLK-003 section labeller → Section tagger (multi-label) plus the new Email classifier and Variant maker.
- The 20 blocks → 20 families and the first 20 variants; the renderer gains "draw any saved variant".
- ASM-002 copy check and QAG-001 launch check stay as code inside the Brand and Email inspectors.
- APR-001/APR-002 weekly approval: no longer used. Hide it; keep the code.
- The people ops queue → an automatic fallback log (admins can read it).
- Onboarding → the brand-understanding team above.
- Designer B (one designed hero, then coded blocks) → the design studio (D25). The visual inspector → the design critic.
- New: text emails as their own format (D26).

## Owner-picked additions (15 November 2026, D27)

After a test run of the system (15 Nov, main at #377), the supervisor proposed 128 ideas and the owner picked these 61 to add. They are part of the plan. Numbers are the idea numbers on the owner's idea picker page; build order is set in BUILD_BRIEF §5 and the ledger, smallest dependencies first.

Required to make the picks work (supervisor note, not on the owner's list): a step-by-step, resumable build job (idea #81), because the design studio and the connected email agents (#80) take minutes and background jobs run in 60 seconds; and logging every dropped offer, product or past date (#84), found in the test run.

### Design studio (§4 layer 3)

| #   | Addition                              | What it does                                                                                                         | Impact | Effort |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| 3   | Capture the brand's real fonts        | Download the web fonts from the brand's site and render headlines in them, so designed sections look on-brand.       | High   | Medium |
| 4   | Product cut-outs in the brand kit     | Remove backgrounds from product photos once and store them, so designs can place products on any backdrop.           | High   | Medium |
| 5   | Render sections to sharp images       | A browser renders each designed section at 1,200 px wide; buttons, product grid, key text and footer stay live.      | High   | Medium |
| 6   | Design tokens per brand               | Spacing scale, type scale, corner radius and button style taken from the brand's site, used by every section.        | High   | Medium |
| 7   | Art director storyboard               | Plan the whole email first: section order, light and dark rhythm, white space and one focus per section.             | High   | Medium |
| 8   | Fixed design checklist for the critic | Score hierarchy, spacing, contrast, alignment, product prominence, button and phone readability 1 to 10, every time. | High   | Small  |
| 10  | Taste library from top brands         | 200 strong emails from top brands, scored by the Grey design team, for the critic to compare against.                | High   | Medium |
| 11  | Typography rules in code              | At most three type sizes per section and length limits on headlines, checked automatically.                          | Medium | Small  |
| 12  | Smart crop                            | Crop photos around the product or face so a crop never cuts the product off.                                         | Medium | Medium |
| 13  | Stay on palette                       | Accent colours come from the brand palette; off-palette colours are flagged and fixed.                               | Medium | Small  |
| 14  | Subtle animated hero                  | A light GIF hero option for launches, kept small enough to load fast.                                                | Medium | Medium |
| 15  | Dark-mode-safe pictures               | Transparent product pictures get a backplate or outline so they still read in dark mode.                             | Medium | Medium |
| 16  | Phone first                           | Every section is checked at 375 px wide; text smaller than 14 px on a phone fails.                                   | High   | Small  |
| 20  | Copy must fit the design              | When a headline does not fit its box, shorten the words instead of shrinking the font.                               | High   | Small  |

### Copy and text emails (§4 layer 2 / text)

| #   | Addition                              | What it does                                                                                       | Impact | Effort |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------------------- | ------ | ------ |
| 23  | Founder voice profile                 | Learn the owner's real voice from their emails and Instagram captions for text emails.             | High   | Medium |
| 24  | Library of text email types           | Founder note, quick question, "we miss you", launch teaser and thank-you, each with its own rules. | Medium | Small  |
| 26  | Subject line lab                      | Write 10 subjects, score them against past results and keep the best two for an A/B test.          | High   | Small  |
| 27  | Preview text that adds something      | Preview text always pairs with the subject and never repeats it.                                   | Medium | Small  |
| 28  | Length and reading level per industry | Targets for words per section and reading level, tuned by industry.                                | Low    | Small  |
| 29  | Words this brand never uses           | A banned-phrase list per brand, learned from the owner's edits.                                    | Medium | Small  |

### Strategy and planning (§3)

| #   | Addition                  | What it does                                                                                 | Impact | Effort |
| --- | ------------------------- | -------------------------------------------------------------------------------------------- | ------ | ------ |
| 33  | Revenue goal input        | The owner types "$20k this month" and the planner works backwards to the emails and offers.  | High   | Medium |
| 34  | Calendar of key dates     | World and industry dates per country (Black Friday, Mother's Day, EOFY) built into planning. | High   | Small  |
| 37  | Balanced email mix        | A learned ratio of offer, story and education emails over 15 days, per brand.                | Medium | Small  |
| 39  | Margin floor on discounts | The owner sets a margin floor; the planner never suggests a discount that breaks it.         | High   | Medium |
| 40  | Offer ladder              | Start a sale at 10% and step up over the window instead of the max on day one.               | Medium | Small  |

### Competitor intelligence and blocks (§1)

| #   | Addition                | What it does                                                                       | Impact | Effort |
| --- | ----------------------- | ---------------------------------------------------------------------------------- | ------ | ------ |
| 45  | Grow the inbox fast     | Sign up 200+ brands per industry with plus-addresses so the library fills quickly. | High   | Medium |
| 47  | Spot competitor winners | Layouts a brand sends again and again are probably working; mark them as winners.  | High   | Medium |
| 48  | Send-time map           | When and how often each competitor sends.                                          | Medium | Small  |
| 49  | Offer tracker           | Which discounts competitors run, week by week.                                     | Medium | Small  |

### Onboarding and brand understanding (§2)

| #   | Addition                   | What it does                                                                                   | Impact | Effort |
| --- | -------------------------- | ---------------------------------------------------------------------------------------------- | ------ | ------ |
| 57  | Use what onboarding learns | Feed the site, catalog and Klaviyo findings into plans and emails instead of the sample store. | High   | Medium |
| 58  | Brand book review page     | The owner sees what the AI believes about the brand and corrects any line.                     | High   | Small  |
| 59  | Photo library              | Pull every product and lifestyle photo from the site and Klaviyo, tagged for reuse.            | High   | Medium |
| 60  | Light and dark logos       | Find both logo versions so headers work on light and dark sections.                            | Medium | Small  |
| 61  | Customer words             | Phrases customers use in reviews, reused in copy.                                              | Medium | Small  |
| 62  | Claims safety list         | Words to avoid by industry, such as health claims for skincare and supplements.                | High   | Small  |
| 63  | Currency and price check   | Detect the store currency and catch prices that look wrong.                                    | Medium | Small  |
| 65  | Suggested competitors      | Pick 10 similar brands for the inbox automatically during onboarding.                          | Medium | Medium |
| 66  | Ten-minute onboarding      | A clear progress screen and a target of ten minutes from sign-up to first plan.                | Medium | Medium |

### Learning from results (§5)

| #   | Addition                        | What it does                                                                | Impact | Effort |
| --- | ------------------------------- | --------------------------------------------------------------------------- | ------ | ------ |
| 74  | Weekly learning report          | "3 new do's, 1 retired" in plain words.                                     | Medium | Small  |
| 75  | Self-tuning tests               | Shift traffic toward the winning subject or send time as results come in.   | Medium | Medium |
| 76  | Unsubscribes and spam as signal | An email that causes unsubscribes teaches a "don't", even if it got clicks. | High   | Small  |

### Agent reliability (Harness)

| #   | Addition                 | What it does                                                                               | Impact | Effort |
| --- | ------------------------ | ------------------------------------------------------------------------------------------ | ------ | ------ |
| 80  | Connect the email agents | Put the planner, copywriter, inspectors and designers into "Create email" behind a switch. | High   | Medium |
| 82  | Second AI provider       | A backup model from another company for outages and retired models.                        | High   | Medium |
| 83  | Model retirement watch   | A warning weeks before a model we use is shut down.                                        | Medium | Small  |

### Deliverability and Klaviyo (§4 into Klaviyo)

| #   | Addition                   | What it does                                                                           | Impact | Effort |
| --- | -------------------------- | -------------------------------------------------------------------------------------- | ------ | ------ |
| 92  | Real inbox previews        | Screenshots in Gmail, Outlook, Apple Mail, phone and dark mode before any push.        | High   | Medium |
| 93  | Spam score check           | Run common spam-filter rules before the push.                                          | Medium | Small  |
| 96  | Accessibility              | Alt text, real headings and readable contrast on every email.                          | Medium | Small  |
| 97  | Best send time per segment | Use Klaviyo history to pick the time each segment opens most.                          | Medium | Medium |
| 99  | Draft status sync          | Know when the owner edits, schedules or deletes a draft in Klaviyo.                    | Medium | Medium |
| 100 | Test send to seed inboxes  | Send to test Gmail, Outlook and Yahoo inboxes before scheduling (with the owner's OK). | Medium | Medium |
| 101 | List hygiene               | Leave bounced and long-unengaged people out of audiences automatically.                | Medium | Medium |

### Owner experience (Owner screens)

| #   | Addition                | What it does                                                                | Impact | Effort |
| --- | ----------------------- | --------------------------------------------------------------------------- | ------ | ------ |
| 102 | Create all 15 at once   | One click builds every email in the plan, with progress.                    | Medium | Small  |
| 103 | Preview gallery         | Desktop, phone and dark mode side by side for every email.                  | High   | Small  |
| 104 | One-line design reasons | "The hero uses your bestseller because it drove 40% of last month's sales." | Medium | Small  |
| 105 | Edit by chat            | "Make the headline shorter" applies the change and re-runs the checks.      | High   | Medium |
| 106 | Version history         | Every version of an email, with undo.                                       | Medium | Medium |
| 107 | Notifications           | Plan ready, drafts ready, results in.                                       | Medium | Small  |
| 110 | Weekly results email    | A plain-words summary of what was sent and what it earned.                  | Medium | Small  |

### Agency business (Agency)

| #   | Addition                   | What it does                                                             | Impact | Effort |
| --- | -------------------------- | ------------------------------------------------------------------------ | ------ | ------ |
| 125 | Case studies from results  | Turn strong results into short case studies automatically.               | Low    | Small  |
| 127 | Internal block marketplace | The best-performing blocks, ready to reuse across Grey's clients.        | Low    | Large  |
| 128 | Free "email score" tool    | Prospects paste an email and get a design score, a lead magnet for Grey. | Medium | Medium |

## Decisions added 15 November 2026

- **D25. Design studio.** Designed emails are designed in HTML/CSS and rendered to images by a browser; image AI is used for backdrops only; interactive parts stay live. Owner direction: "for agencies like us the moat is designs… we need to crack that first."
- **D26. Text emails.** Text (letter) emails are their own format, chosen per slot by the calendar planner and switchable by the owner.
- **D27. Owner-picked additions.** The 61 additions above are approved scope. Ideas the owner did not pick (for example the design proof #1, the golden test set #77 and the memory guard #90) stay proposals until he picks them.
