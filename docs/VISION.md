# Grey Retention — Product Vision & Build Brief (v2)

> For Claude Code. Read fully before touching the codebase. First inspect the repo and Supabase, map what exists against this brief, and reuse working parts. Build in the step order below. **Do not start a step until the previous step's gate has passed.** Fix broken things first, merge and deploy each finished feature. Only stop for a real product decision.

---

## 1. Vision

A small store owner sets their max discount, enters their discount codes, and approves one batch of emails a week from their phone. Everything else (strategy, calendar, copy, design, scheduling) runs itself, based on what works for brands in their niche.

## 2. Customer

- **Yes:** dropshipping and small-to-mid Shopify stores on Klaviyo. 2k–50k subscribers. No designer, no agency.
- **No:** large brands, multi-store, legal review.
- **Pricing:** flat monthly fee. Not performance-based (lists are too small).

## 3. Hard rules (decided, don't revisit)

1. **Klaviyo only. No Shopify connection.** Products, images, prices, orders, bestsellers come from the Klaviyo API.
2. **No own sending infrastructure.** Campaigns are created in the client's Klaviyo account.
3. **Every campaign defaults to an "Engaged 90 days" segment** that the app creates at onboarding. Never "All subscribers." Client can widen it manually.
4. **Before scheduling anything, read the client's existing scheduled Klaviyo campaigns.** Those days are occupied. Never double-send.
5. **Approval is mandatory and weekly.** One approval covers the week's batch. After 4 clean weeks, offer auto-approve with a 24h veto.
6. **Max discount is enforced by QA**, by regex over every % and $ in subject, preview and body.
7. **Discount codes come only from a list the client enters at onboarding** (code + % + expiry). The AI never invents a code.
8. **Copy layouts, never pixels.** Competitor emails teach structure and strategy. Never reuse their images, copy, or branding.
9. **Product images are always real catalog photos.** AI never generates the product.
10. **No text inside AI images.** All text is HTML.
11. **Images are hosted in Klaviyo** (upload via API), not on our server.
12. **Send times are in the store's timezone**, stored per client.
13. **"Change" requests get 2 AI rounds max**, then route to a human.

## 4. App sections

- **Inspiration** — competitor inbox + analysis + block library
- **Campaigns** — brief, calendar, generated emails, approvals

UI/UX: copy the old demo app 1:1 (including small functionality), not its branding. Branding inspiration: exa.ai. Onboarding is the most important screen.

## 5. Onboarding (what we collect, and why)

| Input                                                                                         | Why                                                         |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Klaviyo API key                                                                               | Everything                                                  |
| Max discount %                                                                                | Guardrail                                                   |
| Discount codes list (code, %, expiry)                                                         | AI can only use these                                       |
| Blackout dates                                                                                | Guardrail                                                   |
| Store timezone + currency                                                                     | Send times, prices                                          |
| Brand kit (logo, 3 colors, font) — scraped, then **shown visually for confirmation**          | Scraping gets it wrong (black/white/favicon)                |
| Brand facts sheet: shipping policy, returns, guarantees, banned words/claims, tone in 3 words | Stops the AI inventing free shipping or "clinically proven" |
| Featurable products (client ticks which catalog items can be featured)                        | Catalog data is messy                                       |
| 5–10 competitors — **suggested by niche and similar size**, not just big names                | Gymshark's strategy doesn't transfer to a 5k-list store     |

At onboarding the app also: creates the Engaged-90-days segment, computes bestsellers from Placed Order events (cached weekly), reads existing scheduled campaigns.

---

## 6. Build steps with gates

### Step 0 — Manual proof (no code, 1 week)

Do the whole flow by hand for Sundari & Co: pull 6 competitors' last 30 days, write a one-page brief, a 2-week calendar, build 3 emails, push to Klaviyo. Save all of it as the reference target. If the manual brief isn't clearly better than generic advice, the AI brief won't be either.

### Step 1 — Block library (designer-defined, model-classified)

- Designer defines ~20 block types from experience (hero, offer banner, product grid 2-col, product grid 3-col, single product feature, review strip, founder note, before/after, UGC grid, FAQ, free-shipping bar, category tiles, footer, etc.). **No countdown timer in v1.**
- Code each as a brand-aware, email-safe HTML template: pulls logo/colors/fonts from brand kit, web-safe font fallback stack, mobile-first at 600px, tested at 375px.
- Vision model's only job: given a section, pick which of the 20 types it is. Fixed list, not open categories.

**Gate:** 50 hand-labeled competitor sections, model agrees ≥ 85%.

### Step 2 — Inspiration inbox + extraction

- **Catch-all inbox on our own domain:** `brandname@inbox.<ourdomain>`, one address per competitor. Brand assignment comes from the address. (Do not rely on one Gmail address.)
- On arrival: store raw HTML, **download every image immediately** (tracking URLs expire), screenshot at 600px.
- **Section boundaries from HTML structure first** (each table row / `<img>` slice is usually a section). Vision model only labels, it does not find boundaries.
- Classify **per section** as text or design; the email gets a ratio.
- Per email (micro): subject, preview, offer, angle, CTA, send day/time, block sequence.
- Per brand (macro): frequency, campaign-type mix, discount depth/pattern, text:design ratio.
- Repetition = "it works" signal. One-offs get low weight.
- Process each email once, store labels, never reprocess.

**Gate:** 200 emails ingested, auto-assigned to the right brand, sectioned and labeled, with a per-brand summary that a human reads and agrees with.

### Step 3 — Brand kit + email assembly (the real risk test)

- Onboarding flow from section 5.
- Catalog cleaning: strip variant suffixes from titles, dedupe variants into products, verify currency, require image.
- Given a **hand-written brief** (from Step 0), the AI: picks block sequence → fills product blocks from featurable products → writes copy → renders HTML.
- Copy QA against brand facts sheet, banned words, discount regex, code list.

**Gate:** 10 emails for Sundari. Designer scores "would send as-is." Need ≥ 7/10. **Do not proceed below this.**

### Step 4 — Klaviyo push + full QA

QA (hard block on fail):

- Every link returns 200 and matches the intended product
- Discount code is in the client's list, not expired, ≤ max
- Not a blackout date, not an occupied date
- All featured products exist and are featurable
- HTML < 102KB (Gmail clipping)
- Mobile screenshot at 375px renders cleanly (this screenshot is reused for approval)
- Copy passes facts sheet + banned words
- Audience = Engaged-90 segment
- Send time converted from store timezone

Then: upload images to Klaviyo → create template → create campaign → assign segment → create as **draft** (scheduling only after Step 5 proves approval).

Note: API-pushed HTML templates aren't editable in Klaviyo's drag-and-drop editor. Tell clients at onboarding; edits go through Change.

**Gate:** 10/10 drafts land in Klaviyo with zero manual fixes.

### Step 5 — Weekly approval

- Sunday: client gets one email (from a verified sending domain) with the week's campaigns: mobile screenshot, date, offer, segment. Two buttons: **Approve all** / **Change**.
- Change = one text field per email. 2 AI rounds, then human.
- Approved → campaigns scheduled in Klaviyo.
- Track **% approved without edits** from the first client.

**Gate:** a real client (not Sundari) approves 3 weeks through it without messaging you.

### Step 6 — Brief + calendar automation

Only now. Rules for the brief:

- Every line cites evidence ("4 of 6 competitors send a review email on Thursday").
- Every line is a calendar action, not advice.
- Weights same-scale competitors higher than big brands.
- Crosses with the client's own Klaviyo results (last 90 days: which campaign types made money).
- First briefs use last 60–90 days of competitor data + a standard ecom seasonal calendar; history improves over time.
- Founder inputs ("launching X on dates Y–Z") rebuild the calendar around them.
- Calendar respects: max discount, blackout dates, occupied dates, send frequency cap.

**Gate:** AI brief for Sundari read side-by-side with the Step 0 manual brief. Must be at least as useful.

### Step 7 — 3 real clients, 1 month

Track one number: **% of emails approved without edits.** ≥ 70% = product. Below = fix the step causing the Change clicks.

---

## 7. Later (not until Step 7 passes)

- Feedback loop: results update strategy. Only on patterns across 10+ sends; niche-wide data outweighs one small client's.
- Image pipeline: hero/lifestyle backgrounds via style references (5–10 brand photos). Per-brand LoRA only if references keep failing.
- Countdown timers (third-party service).
- Competitor ads monitoring (Meta Ad Library API covers EU/political only; US needs scraping).
- Flow fixes via Claude.
- Other email platforms via a connector layer.
- Push/SMS approval fallback.
- Self-serve signup.

## 8. Not building

- Own sending infrastructure
- Freeform AI design editor
- Custom image model training (until proven necessary)
- Shopify connection
- Large-brand features

## 10. Operating flow and rules (how the product behaves day to day)

### Onboarding behaviour

- Verify the Klaviyo key's scopes on paste; show exact scopes needed and a screenshot guide.
- If the Klaviyo catalog is empty (no Shopify integration in Klaviyo), block with a clear message. Nothing works without it.
- Pre-tick featurable products: top 20 bestsellers + anything added in last 30 days.
- Pre-fill the brand facts sheet by scraping shipping / returns / FAQ / about pages. Tone = tappable chips.
- Allow finishing onboarding with zero discount codes; calendar uses non-discount campaigns until codes exist.
- Engaged segment: engaged-90. If < 1,000 profiles or < 20% of list → engaged-180.
- Timezone + currency from Klaviyo account settings. Client picks send frequency (2 / 3 / 4 per week).
- Check for a dedicated sending domain; flag, don't block.
- Competitors: suggest by niche + similar size from brands already in our inbox. If none exist for the niche: brief runs in **cold-start mode** (niche-wide library + standard ecom calendar, stated plainly to the client) and a backend task "subscribe to these brands" is created.
- **Week 1 is generated immediately after onboarding.** Show progress; approval email within ~10 minutes.

### Post-onboarding job pipeline

cache catalog → compute bestsellers → read existing scheduled campaigns → brief v1 → 2-week calendar → generate week 1 → QA → approval email. Each job retries 3×, then goes to the ops queue.

### Block templates must include Klaviyo required tags

Unsubscribe link, physical address, view-in-browser, organization name. Bake into the footer block.

### Approval behaviour

- "Send test to me" button (Klaviyo preview send) on every email.
- Per-campaign audience override (e.g. whole list for a launch) with a warning.
- Approval links: signed, single-use, expire in 7 days.
- Replies to approval emails land in the app as founder inputs (AI parses → calendar note → one-line confirmation back). **No no-reply addresses.**

### Sync with Klaviyo

- Poll campaign status hourly. If a campaign is edited or deleted outside the app → mark "externally modified", notify, never overwrite.
- Pull campaign reports daily for 3 days after send, then stop.
- Before editing any scheduled campaign, check its status (already sent = too late).

### Founder inputs and calendar changes

- Launch form for products not in catalog: name, price, photos, URL. Link QA for launch products runs 24h before send; still 404 → hold and notify.
- Rebuild only unapproved future slots. Conflicts with approved campaigns are proposed in the next approval, never applied silently.
- Every rebuild shows a diff (Removed / Added / Moved).
- **Kill switch:** "pause everything" cancels all scheduled campaigns in Klaviyo. Exists from day one.
- Discount change on a scheduled campaign → regenerate → QA → update template in place.
- New blackout date → cancel conflicting send, reschedule, notify.
- "Remove product X" → unfeaturable + regenerate all unsent campaigns containing it. The founder is the stock signal.
- Max discount lowered → re-QA all unsent.

### Ops queue (reviewed daily by a human)

- Inbox: unknown sender, parse failure, double-opt-in confirmations (auto-click links matching "confirm"), brands that unsubscribed us (resubscribe task), pending competitor subscriptions.
- Low-confidence vision labels → human label → feeds back into prompt.
- Copy QA failed 3 regenerations → human.
- Change requests past 2 rounds → human.
- Klaviyo API errors (expired / revoked key, rate limit) → client notified, generation paused.
- Per-client LLM spend cap.
- **Ops dashboard:** every client with next send, approval status, QA fails, last results, days since competitor data refreshed.

### Scale rules

- Clients in the same niche get varied block sequences; copy is never reused across clients.
- Open rate drops ≥ 30% over 3 sends → auto-reduce frequency, notify.
- BFCM calendars generated and approved by mid-October.
- Cancellation → stop generating, leave approved scheduled sends, delete key.
- Monthly report separates "campaigns we sent" from the client's own sends.

## 9. Data model (minimum)

`competitors` (incl. subscription status), `competitor_emails` (raw html, images, screenshot, labels), `email_sections`, `block_types`, `block_templates`, `clients`, `brand_kits`, `brand_facts`, `discount_codes`, `products` (cleaned catalog cache, featurable flag), `launch_products`, `founder_inputs`, `briefs`, `calendar_slots`, `campaigns` (status: generated / qa_failed / pending_approval / approved / scheduled / sent / externally_modified / cancelled), `approvals` (tokens), `change_requests` (round count), `qa_results`, `campaign_results`, `ops_tasks`, `jobs`.
