# Old app → new app: 1:1 UI/UX rebuild spec

Source: `demo.gravtyretention.com` (old Grey Retention app), crawled screen by screen on 6 Nov 2026.

**Goal:** rebuild every screen, layout, control, empty state and small interaction below in the new app — **1:1 in structure and behaviour**.

**Do NOT copy branding.** Colours, fonts, logo and icon style come from the new design system (DS-001 tokens, exa.ai-inspired). Where this doc says "black button" or "blue pill", read it as "primary button" / "info pill" in the new tokens. Sizes and spacing in §0 are layout facts, not branding — keep them.

Every `- [ ]` line is an acceptance check. A screen is done when every box on it is ticked.

---

## 0. Layout facts (keep these, restyle the colours)

| Thing           | Old value                                                         |
| --------------- | ----------------------------------------------------------------- |
| Base text       | 17px / 25.5px (body copy in cards mostly 14–15px)                 |
| H1              | 30px, weight 600                                                  |
| Field label     | 11px, weight 600, UPPERCASE, muted colour, letter-spaced          |
| Card            | white, 1px border, radius 20px, no shadow, ~24px padding          |
| Input           | 14px, radius 12px, padding 8px 12px, 1px border                   |
| Button          | 14px weight 500, radius 12px, padding 8px 16px                    |
| Page background | off-white (one step darker than cards)                            |
| Sidebar         | 255px expanded / ~56px collapsed rail                             |
| Icons           | outlined icon set, ~20px (old app used Material Symbols Outlined) |

Pill/status colour roles used everywhere:

- **success** — LIVE, active, Connected, green ✓ tiles
- **warning** — DRAFT, PENDING, Product Intelligence callout
- **danger** — CANCELLED, Delete, Log out, Discard
- **info** — WRITING, DESIGN, Scheduled
- **accent-2** — TEXT type pill, cultural holidays
- **solid / inverted** — SENT, active filter pill

---

## 1. Route map

| Route                                                                                                                                                                | Screen                            | In sidebar       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------- |
| `/dashboard` (`?tab=lists\|segments\|campaigns\|flows\|metrics`, `?attr=klaviyo\|utm`, `?refresh=1`)                                                                 | Dashboard                         | ✔                |
| `/lists/:id`, `/segments/:id`, `/campaigns/klaviyo/:id` (built; was `/campaigns/:id`, which is now this workspace's own campaign page), `/flows/:id`, `/metrics/:id` | Klaviyo object detail pages       | —                |
| `/flow-messages/:id`                                                                                                                                                 | Flow email preview                | —                |
| `/brand` · `/brand/voice` · `/store`                                                                                                                                 | Brand & Store (3 sub-tabs)        | ✔ Brand & Store  |
| `/campaign-agent` (`?m=YYYY-MM`) and `/calendar`                                                                                                                     | Campaign planner (calendar/table) | ✔ Campaign Agent |
| `/campaign-drafts` (`?status=draft\|ready\|pushed`)                                                                                                                  | Drafts list                       | —                |
| `/campaign-drafts/new`                                                                                                                                               | New campaign draft (brief form)   | —                |
| `/campaign-drafts/:id?view=1`                                                                                                                                        | Draft editor                      | —                |
| `/gros`, `/gros/:threadId`                                                                                                                                           | Ask GROS chat                     | ✔                |
| `/library/inspirations`                                                                                                                                              | Competitor Agent                  | ✔                |
| `/support` (`?t=:ticketId`)                                                                                                                                          | Support tickets                   | ✔                |
| `/settings`                                                                                                                                                          | Settings (campaign defaults)      | ✔ Workspace      |
| `/holidays`                                                                                                                                                          | Holidays & Events                 | ✔ Workspace      |
| `/connections`                                                                                                                                                       | Connections                       | ✔ Workspace      |
| `/profile`                                                                                                                                                           | Profile                           | account menu     |

Not crawled (needs a logged-out or admin session): login, signup, onboarding, password reset, admin/designer views. Capture those separately before building them.

---

## 2. App shell

### Sidebar (expanded)

- [x] Top block: square workspace avatar with first letter, workspace name (bold), user name (small, muted) under it, and a `<` collapse button on the right.
- [x] Nav items are icon + label rows. The active item gets a rounded filled background.
  - Dashboard
  - Brand & Store
  - Campaigns (was Campaign Agent: OWNER_JOURNEYS.md §18.2)
  - Ask GROS
  - Inspiration (was Competitor Agent: §18.2)
  - Support
  - Child pages highlight their parent area: detail pages → Dashboard, `/campaign-drafts*` → Campaigns (OWNER_JOURNEYS.md §2 fix).
- [x] Divider after the nav items.
- [x] Collapsible group **Agents** (robot icon, chevron). Its children are disabled, greyed, and each has a `SOON` pill. They are not clickable. Screen readers hear "<name> — Coming soon". Exception: Bill Optimizer links to the fixture optimizer page this app already has.
  - List Health
  - Bill Optimizer
  - Flow Audit
  - Deliverability
  - A/B Test Monitor
- [x] Collapsible group **Workspace** (briefcase icon): Settings, Holidays & Events, Connections, plus Team and Request a Feature (OWNER_JOURNEYS.md §2). Holidays & Events opens `/holidays` (§12, UIR-012). Request a Feature is SOON until `/feedback` exists.
- [x] Each group's open/closed state persists across page loads.
- [x] Bottom account button: round avatar letter, name (bold), email (muted), up/down chevron. Clicking it opens the account menu.
- [x] Account menu is a popover that opens upward:
  - header with name and email
  - 👤 Profile Update → `/profile` (shown as SOON until §14 builds `/profile`)
  - ~~🔗 Connections~~ removed: it is already in Workspace (OWNER_JOURNEYS.md §18.18)
  - divider
  - **Log out** in danger colour
- [x] Account menu closes on Esc or an outside click.

### Sidebar (collapsed)

- [x] `<` collapses the sidebar to an icon rail (~56px). The rail shows the avatar plus a `>` expand button, nav icons only, group icons, and the avatar at the bottom.
- [x] The active icon keeps the filled background.
- [x] **Add tooltips** on hover with the item label. The old app had none; this is a fix, not a change of behaviour.
- [x] Collapsed state persists.

### Page header pattern

- [x] H1 + muted subtitle on the left; optional actions on the right (outline pill button, icon + label).

### Detail-page pattern (all Klaviyo objects)

Built as shared parts in `components/ui/detail-page.tsx` and `lib/brand-time.ts`; the §4 pages use them.

- [x] Narrow centred column, ~1020px wide.
- [x] Top row: `← Back to dashboard` (muted link) on the left, outline `⟳ Refresh` on the right. Back returns to the dashboard tab the owner came from (`?from=campaigns` → `/dashboard?tab=campaigns`, OWNER_JOURNEYS.md Job 5 fix).
- [x] **Hero card:**
  - 44px rounded-square icon tile (inverted colours)
  - tiny uppercase type label: `LIST` / `SEGMENT` / `CAMPAIGN` / `FLOW` / `METRIC`
  - large title
  - status pill underneath, where the object has one
- [x] Then stat cards, plain-English explainer cards, and a **Timeline** card (CREATED / LAST UPDATED).
  - Date format: `Oct 7, 2026 · 10:49 PM`, followed by the one brand timezone, e.g. `(Sydney time)` (OWNER_JOURNEYS.md §18.14)
  - Muted relative time under each date: `4 weeks ago`
- [x] Last card is a collapsible **Advanced details** row (tune icon, object id in mono on the right). When expanded it shows:
  - "All attributes from Klaviyo" as a 2-col key/value grid
  - "Linked resources" (PROFILES / TAGS / FLOW TRIGGERS, showing `none` when empty)

### Shared components to build once

- [x] ~~**Token plan strip**~~ replaced by a small **AI credits** indicator (`components/ui/credits-indicator.tsx`), per OWNER_JOURNEYS.md §18.8: one number of credits left, plan and renewal, and "sample numbers" while data is fake. Was: (used on Dashboard and Brand): bolt icon, "Scale plan · renews in 30 days", and a token-remaining line. On the right, two thin progress bars labelled IN and OUT, each with a %.
- [x] **Email preview card:** (`features/email-generation/preview-card.tsx`; sanitized on the server, links turned off, always in-page: OWNER_JOURNEYS.md §18.19)
  - title "Email preview" + mono pill with the template name
  - right side: `⛶ Fullscreen` (browser Fullscreen API on the iframe) and `⟳ Refresh` (reloads the iframe)
  - body: sandboxed iframe on an inset grey area, fixed height, scrolls inside
  - caption under it: "Rendered preview from Klaviyo's stored template. Some external assets (fonts, tracking pixels) may not load due to sandbox isolation."
- [x] **List/segment picker:** (`components/ui/audience-picker.tsx`)
  - label `SEND TO  N SELECTED` + `Clear` link on the right
  - search box "Search lists & segments..."
  - scrolling checklist: round checkbox + name + small outline tag `LIST` or `SEGMENT` on the right
- [x] **Product radio picker:** (`components/ui/product-picker.tsx`)
  - search box "Search products…"
  - bordered scroll box (~300px)
  - first option italic muted ("— no default (let AI pick) —" or "— let AI pick from broader product focus —")
  - each product shown as `“Name”` + muted `(vendor)`
- [x] **Status pill**, **type pill** (DESIGN / TEXT), and **domain pill** (uppercase domain). Status pills use the one campaign status system from `docs/OWNER_JOURNEYS.md` §18.3 (`lib/campaign-status.ts`).
- [x] **Chat UI:** (`components/ui/chat.tsx`)
  - user bubble on the right, assistant bubble on the left
  - optional tiny caption under each bubble (YOU / GROS)
  - typing indicator (3 animated dots)
  - quick-reply chips
  - composer: `+` attach button, input, round send button
  - auto-scrolls to the newest message
- [x] **Confirm dialog:** (`AlertDialog`)
  - large warning "!" circle icon, bold title, body text
  - secondary + danger buttons (see the multi-day event discard dialog)
- [x] **Modal:** (asks "Discard your answers?" before closing with typed answers: OWNER_JOURNEYS.md §1 fix)
  - optional `STEP 1 OF 2` label + 2-segment progress bar
  - title, subtitle, ✕
  - scrolling body
  - sticky footer: `Cancel` text button on the left, primary button on the right

---

## 3. Dashboard `/dashboard`

- [x] Header "Dashboard" / "Retention health at a glance." ~~+ `⟳ Refresh`~~: no Refresh yet. Sample data has nothing to re-pull and says so plainly; a live re-pull will be a server action with a pending state (OWNER_JOURNEYS.md §3).

### KPI strip

- [x] 8 small cards in one row (they scroll horizontally on narrow screens). Built as **5 real KPIs**: the "Coming soon" tiles are removed (OWNER_JOURNEYS.md §18.7), revenue tiles name their source and period, LIST GROWTH is "Net change", and ACTIVE SUBS is no longer shown twice:

  | Label            | Value  | Caption            |
  | ---------------- | ------ | ------------------ |
  | CLTV             | —      | Coming soon        |
  | LIST GROWTH      | 16.5K  | ↑ 15% vs 30d       |
  | REV (PURCHASERS) | $22.6K | 6 flows · 30d      |
  | REV (NON-PURCH)  | $26.2K | 19 campaigns · 30d |
  | RPR              | —      | Coming soon        |
  | DELIVERABILITY   | —      | Coming soon        |
  | ACTIVE SUBS      | 16.5K  | ↑ 15% vs 30d       |
  | ABANDONED        | 419    | checkouts · 30d    |

- [x] Each card: tiny uppercase label (truncates with …), big value, small caption.
- [x] An up trend shows in the success colour with ↑. A down trend uses the danger colour.
- [ ] ~~A metric that isn't ready yet shows `—`, an ⓘ icon with a tooltip, and "Coming soon".~~ Not built: unready metrics are hidden (§18.7).

### Row 2 (3 cards)

- [x] **Email revenue this month:**
  - small label at the top
  - segmented toggle `Klaviyo | UTM`
    - Klaviyo tooltip: "Klaviyo $flow and $campaign attribution (last 30d, clamped to MTD)"
    - UTM tooltip: "Shopify orders with utm_source=klaviyo or utm_medium=email (month-to-date)"
  - **semicircle gauge** (track + fill = revenue/goal), value `$15,845.99` in the centre, "of $300,000 goal" under it
  - disclosure `▸ Set monthly goal`, which opens a number input (placeholder "e.g. 40000") + Save. **Not built yet**: it needs a migration. The gauge says "No monthly goal set yet."
- [x] **Next campaign countdown:**
  - clock icon
  - countdown to the next scheduled or planned send
  - empty state: "—" + "No scheduled or planned campaigns. Schedule one to see the countdown." + link `Schedule a campaign →` (`/campaign-drafts/new`)
- [x] **Campaign Calendar mini:**
  - header + `View All` (`/calendar`)
  - list of upcoming campaigns
  - empty state: "No upcoming campaigns. [Create one →]"

### Row 3

- [x] **Small card:** medal icon. Instead of the placeholder it shows the campaigns really waiting for the owner (count + up to 3 links).
- [x] **Wide GROS insight card:**
  - inverted pill `✦ GROS` (no live dot: the insight is not live AI)
  - `⟳ Generate` on the right. It writes an insight from the numbers, uses no AI and no tokens, and says so.
  - body: italic muted placeholder "Click "Generate" to get a fresh GROS insight on your retention performance — runs against your current metrics and brand context. Tokens deducted from your active Token Package."
  - after generating, the insight text replaces the placeholder

### Detailed Klaviyo data card

- [x] Header: database icon + "Detailed Klaviyo data", muted "Lists, segments, campaigns, flows, metrics" on the right.
- [x] ~~Token plan strip~~: the **AI credits** indicator, from the workspace's package allowance (owner and admin only, as on Settings), labelled sample.
- [x] **Revenue (Overview tab only):**
  - label "REVENUE · LAST 30 DAYS"
  - huge number `A$70,178`
  - caption "attributed to Klaviyo emails & flows · 30 active days"
  - right side: two mini stat boxes, AVG / DAY and BEST DAY (+ date)
  - 30-bar daily chart; the best day's bar is highlighted in the accent colour; x labels at start / middle / end
  - **Add a hover tooltip per bar** (date + amount). The old app had none.
- [x] **Tabs** (underline style, icon + label + count pill; the active tab's count pill is inverted):
  - Overview
  - Lists 9
  - Segments 21
  - Campaigns 41
  - Flows 7
  - Metrics 60
- [x] Tabs change `?tab=`. The old app reloaded the whole page; client-side switching is fine as long as the URL updates and the back button works.

**Overview tab**

- [x] 6 stat cards:
  - LISTS — "view all"
  - SEGMENTS — "view all"
  - CAMPAIGNS — "view all"
  - FLOWS — "7 live · 0 draft"
  - METRICS — "event types"
  - INDUSTRY — value wraps
- [x] "view all" switches to that tab.
- [x] **Account card:**
  - "Account" title + masked key on the right, in mono (`pk_YxS7U••••••••9de0`)
  - 5 columns: ORGANIZATION / INDUSTRY / TIMEZONE / CURRENCY / LOCALE
- [x] Info bar: "**What's next:** Switch tabs above to drill into lists, segments, campaigns, flows, or metrics. Click any row inside a tab to see full details." Each object word is a link to its tab.

**Lists tab**

- [x] Card header: icon + "Lists" + count pill.
- [x] Columns: NAME / OPT-IN / UPDATED / CREATED.
- [x] Each row has a `›` chevron, the whole row is clickable, and it opens `/lists/:id` (real links, so middle-click works: OWNER_JOURNEYS.md §3 fix). Klaviyo campaigns open `/campaigns/klaviyo/:id`, because `/campaigns/:id` is this workspace's own campaign page.

**Segments tab**

- [x] Columns: NAME / STATE / UPDATED / CREATED.
- [x] Starred segments show an outline star before the name.
- [x] STATE shows an `active` pill in the success colour.

**Campaigns tab**

- [x] Columns: NAME / STATUS / REVENUE (30D) / SEND TIME. Revenue is right-aligned and tabular (`A$372` or `—`).
- [x] Status pills: SENT (solid), CANCELLED (danger), DRAFT (warning).

**Flows tab**

- [x] Header on the right: "30d revenue: **A$22,638** · ● 7 live · ● 0 draft".
- [x] Columns: NAME / TRIGGER (Metric, Added to List) / STATUS (LIVE) / REVENUE (30D), revenue right-aligned.

**Metrics tab**

- [x] Columns: NAME / INTEGRATION (Klaviyo, Shopify) / CATEGORY (Internal, eCommerce) / CREATED.

---

## 4. Klaviyo detail pages

Built from sample Klaviyo data (fake provider), labelled on every page. Words follow the real status: a draft or cancelled campaign never reads "was sent". Not built yet (OWNER_JOURNEYS.md §4 extras): "Open in Klaviyo", opens/clicks/revenue per flow email, and "Use as reference design" on a flow email. Klaviyo campaigns live at `/campaigns/klaviyo/:id` (`/campaigns/:id` is this workspace's own campaign page). "Back to dashboard" returns to the tab the owner came from. There is no Refresh yet: sample data has nothing to re-pull.

### List `/lists/:id`

- [x] Hero (LIST).
- [x] Two cards:
  - **SUBSCRIBERS:** big number + "people on this list"
  - **SIGN-UP METHOD:** "Single opt-in" (not the raw `single_opt_in`: OWNER_JOURNEYS.md §4 fix) + a plain-English line. Single opt-in: "Single opt-in — subscribers are added immediately after signing up. Faster growth, but riskier." Double opt-in needs its own line.
- [x] Timeline card.
- [x] Advanced details (NAME, CREATED, UPDATED, OPT IN PROCESS, PROFILE COUNT + Linked resources).

### Segment `/segments/:id`

- [x] Hero (SEGMENT) + ACTIVE pill.
- [x] Two cards:
  - PROFILES IN SEGMENT: `1,476` "people match"
  - WHAT THIS IS: "A **segment** is a dynamic group — profiles enter and exit automatically based on rules you set up in Klaviyo. Unlike lists (which are static and require explicit sign-up), segments recalculate as your data changes." + Active pill
- [x] "How this segment is defined": the rules as a sentence. The raw JSON moved to Advanced details (OWNER_JOURNEYS.md §4 and §18.9 fix).
- [x] Timeline, Advanced details.

### Campaign `/campaigns/klaviyo/:id`

- [x] Hero (CAMPAIGN) + status pill (DRAFT / SENT …).
- [x] 3 small cards:
  - CHANNEL: ✉ Email
  - SEND TIME: "Not scheduled" or the date
  - CREATED
- [x] **What was sent:**
  - MESSAGE LABEL (INTERNAL)
  - inset email-header box: FROM (name bold + `<email>` muted), SUBJECT, PREVIEW TEXT (italic, in quotes)
- [x] Email preview card (shared component).
- [x] **Who received this** / "The lists and segments this campaign was sent to." INCLUDED chips and EXCLUDED chips, with names (§15 bug 6 fixed). Also new: a **How it did** card for sent campaigns (recipients, open rate, click rate, revenue, orders: OWNER_JOURNEYS.md Job 5 fix).
- [x] **How it was sent:**
  - "Static" + "Sent at a fixed date and time you scheduled."
  - "Scheduled for: Nov 6, 2026 · 4:52 AM"
  - "Sent in each recipient's local timezone" (only when that's on)
- [x] Advanced details.

### Flow `/flows/:id`

- [x] Hero (FLOW) + LIVE pill.
- [x] 3 cards:
  - **REVENUE · 30 DAYS** (highlighted card with an info-tint background): `A$503`, "attributed to this flow"
  - **WHAT TRIGGERS THIS FLOW:** "Metric" + "Triggered when someone performs a specific event (like placing an order)"
  - **STEPS IN THIS FLOW:** `3`, "actions in the sequence"
- [x] **Action sequence** / "The steps Klaviyo runs when this flow triggers." A vertical list where each step has:
  - a numbered filled circle
  - a step card: icon + name (Wait / Send email) + status pill
- [x] Wait step: shown as "Waits 45 minutes · any day". The raw JSON (delay_seconds, days_of_week) is in Advanced details (OWNER_JOURNEYS.md §4 fix).
  - Nice-to-have: also show plain English, e.g. "Waits 45 min, any day".
- [x] Send-email step: inner row with eye icon, subject (bold), "From: Dreams Studio", and `→`. Clicking it opens `/flow-messages/:id`.
- [ ] ~~Card footer: robot icon + "**2** email templates from this flow have been ingested for AI use…" + outline `⟳ Sync templates`.~~ Not built: using flow emails as AI context isn't connected yet, and the page says so.
- [x] Timeline, Advanced details.

### Flow message `/flow-messages/:id`

- [x] `← Back` (history back).
- [x] Header card:
  - `✉ FLOW MESSAGE` label + mono template pill on the right
  - title = subject
  - italic preview text
  - 3 columns: FROM (name + `<email>`) / REPLY TO / TEMPLATE UPDATED
- [x] Email preview card.

### Metric `/metrics/:id`

- [x] Hero (METRIC).
- [x] "What this measures" card with one line (e.g. "A custom event tracked in your Klaviyo account.").
- [x] 3 cards:
  - SOURCE: "Where the events come from"
  - CATEGORY: "Type of integration"
  - TRACKING SINCE: "First event date"
- [x] Advanced details.

---

## 5. Brand & Store

> **As built (UIR-005, cloud lane):** OWNER_JOURNEYS §18 decision 5 merges Brand Truth and Copy & Voice into one editable **Brand profile** at `/brand` (`/brand/voice` opens its Copy & Voice part). The sub-tabs are therefore Brand profile · Store. Every field is editable. Brand name, website, positioning, Do and Don’t are the brand details the AI reads after the owner approves; they are marked “AI reads” and only the owner changes them. The other fields have a per-field lock and are honest notes the AI does not read yet. “Regenerate” is “Redo with AI”: a sample writer that only fills empty fields with text marked “Sample:” and never changes the owner’s words. The muted line says the AI uses the approved version. Store keeps the sub-tabs when Shopify is missing (brief fix). A brand-mismatch banner (decision 6) sits under the header. Still open: the token strip (decision 8 moves it to a small “AI credits” indicator from the shared components) and the connected Store dashboard (next PR).

Shared header:

- [x] Centred column, ~920px.
- [x] Muted line "Auto-generated from your website and Klaviyo data." on the left.
- [x] Right side: muted "Last synced 96 days ago" + primary `✦ Regenerate All`.
- [x] **Add the H1 "Brand & Store"**. The old page had no title; this is a fix.
- [x] Sub-tabs (text with an underline on the active one): Brand Truth `/brand` · Copy & Voice `/brand/voice` · Store `/store`.
- [ ] Token plan strip.
- [x] Section card pattern:
  - title + "Updated 96 days ago" (muted)
  - round `⟳` icon button on the right, tooltip "Regenerate this section", which regenerates that section only
  - fields are tiny uppercase labels + values

### Brand Truth

- [x] **Brand Identity:**
  - 2-col grid: BRAND NAME, NICHE, POSITIONING, GEOGRAPHIC MARKET
  - full-width fields: ORIGIN STORY, TARGET AUDIENCE
- [x] **Product Intelligence:**
  - shows the products when there are any
  - empty/warning state: warning callout (border + tint, ⓘ icon) with:
    - bold "No products extracted"
    - "The website scrape didn't return enough product detail and either Shopify isn't connected, isn't synced yet, or the catalog is empty."
    - "Fixes: [connect Shopify] (we'll use your synced catalog as the source), or set a [Hero Product URL] in Brand settings, then click the refresh icon above."

### Copy & Voice

- [x] **Tone of Voice:**
  - 4 tiles in a row: FORMALITY / ENERGY / WARMTH / ARCHETYPE
  - 2 columns of bullets: `✓ DO` (success colour) and `✕ DON'T` (danger colour)
- [x] **Vocabulary:**
  - PREFERRED: success chips
  - AVOID: danger chips
  - divider
  - BRAND-SPECIFIC TERMS: "**term** — muted definition" lines
  - divider
  - SIGNATURE PHRASES: italic quoted lines. Keep `{{ placeholders }}` verbatim.
- [x] **Sample Copy:** 2×2 groups SUBJECT LINES / OPENING LINES / CTAS / SIGN-OFFS. Each item is a light rounded row.
  - Nice-to-have: copy-on-click.
- [x] **Audience:**
  - PRIMARY PERSONA paragraph + muted "Age range: 16-28"
  - 3 bullet columns: PAIN POINTS / MOTIVATIONS / EMOTIONAL NOTES

### Store

- [ ] When Shopify is connected: a store dashboard with revenue trends, top customers and out-of-stock alerts. No old design exists for this, so design it in the same card language.
- [x] When it isn't connected:
  - the header and tabs are hidden
  - a centred empty card: success-tint tile with a bag icon, bold "Connect Shopify to see Store Intelligence", muted "Once connected, we'll bulk-import your products, orders, and customers, then render a live dashboard with revenue trends, top customers, and out-of-stock alerts.", and primary `🔗 Go to Connections`

---

## 6. Campaign Agent (planner) `/campaign-agent`, `/calendar`

The whole page is one wide card (toolbar + grid), followed by two library cards.

### Toolbar row 1

- [x] Left: round `<`, month label "November 2026" (bold), round `>`. These change `?m=`. A `Today` link shows when another month is open, and a month picker jumps straight to a month (UIR-006).
- [ ] While pulling Klaviyo, show a muted italic "Syncing" next to the month label. (UIR-006: nothing is pulled live yet, so the same spot says plainly where Klaviyo sends come from, e.g. "sample data, not from a real account".)
- [ ] Right side, in order: (UIR-006 part 1: `Holidays & Events` links to `/settings#holidays` until the §6.4 modal; items 3 and 4 live in the one `+ New` menu per OWNER_JOURNEYS.md §18.10 — "Single send" and "Fill the month (sample plan)", renamed "Fill the month with AI" once the AI planner exists; the Report export is still to do.)
  1. `⬇ Report ▾` dropdown: **Excel (.xls)**, **CSV**, **Word (.doc)**, each with a file-type icon. It exports the month's plan.
  2. `🎉 Holidays & Events` (outline): opens the holidays modal (§6.4).
  3. `📅 Launch a multi-day event ✦` (outline, sparkle in the accent colour): opens the multi-day wizard (§6.5).
  4. Primary `📅 Generate Campaign Calendar ✦`: opens the brief wizard (§6.6).

### Toolbar row 2

- [x] Status pill group: **All statuses** / Draft / With designer / Needs your approval / Scheduled / Sent / Missed — the one status system (§18.1, UIR-015). Single select; the active pill is inverted.
- [x] Vertical divider.
- [x] Channel pill group: **All channels** / ✉ Design Email / 📄 Text Email. (SMS is not a channel in this product yet, so it is not offered.)
- [x] Right: segmented `📅 Calendar | ☰ Table`.
- [x] Filters apply to both the calendar and table views, and live in the URL so month changes keep them.

### Calendar grid

- [x] SUN–SAT header (tiny caps), 7 columns, ~110px-tall cells, thin grid lines.
- [x] Day number at the top-left of each cell:
  - past days: muted number + slightly tinted cell background
  - **today**: filled accent circle with the number in contrasting text
- [ ] **Holiday chips** sit to the right of the day number: small tinted pills (civic = info, cultural/religious = accent-2, commercial = danger). (UIR-006: the workspace's own holidays and events show as chips in one tone; holidays have no type yet, and platform holidays come with §12.)
- [x] **Campaign chip:** (colours follow the one status system, and the status is also written on the chip because colours repeat; Klaviyo chips are dashed, say "Klaviyo sample", and open the §4 Klaviyo detail page with Back to the same planner view)
  - full-width rounded pill with a channel/send icon + name
  - colour = status: Sent solid, Scheduled info-tint, Assigned to Designer warning-tint, Draft neutral
  - hover tooltip: "G | Quick eye test · Klaviyo: Sent at 17:11"
  - click opens the campaign: `/campaigns/:id` for synced ones, the draft editor for drafts
- [x] **Hover any cell** → muted "+ plan send" appears bottom-centre. Clicking it opens the plan-send modal for that date (§6.7). (UIR-006 part 1: owners only, today and later; it opens the first-draft page already set to that date until the §6.7 modal exists. Keyboard focus shows it too.)
  - Fix: the old app opened the wrong date when clicked.
- [x] Legend under the grid, one pill per status, plus the timezone every time is shown in.

### Table view

- [x] Same toolbar. Table of the month's campaigns, same data as the calendar (this workspace AND Klaviyo, with a From column).
- [x] Empty state (centred, muted): "☰ No campaigns this month. Plan some on the calendar view, or wait for Klaviyo sends to appear."
- [x] Fix: the old app's table missed campaigns that the calendar showed, and its active Table button rendered blank. (One list feeds both views; the active button is inverted and readable. Klaviyo drafts with no send time get their own "Not scheduled in Klaviyo" row.)

### 6.4 Modal "Your holidays & events" (small, ~520px)

- [ ] Muted intro: "Private to your brand — they appear on your calendar, in the planner wizards, and the AI strategists plan around them. Platform-wide holidays are managed by Grey Retention. [Manage on the Holidays & Events page →]"
- [ ] Form:
  - NAME (placeholder "e.g. Brand anniversary, Summer drop")
  - DATE (date input) + TYPE select (Holiday / Event) side by side
  - checkbox "Repeats annually (same date)"
  - right-aligned primary `Add`
- [ ] Divider + "YOURS (N)" list with a delete option on each row. Empty: "Nothing yet — add your first above."
- [ ] A new entry shows on the calendar immediately.

### 6.5 Modal "Launch a multi-day event" (2-step chat wizard, ~760px)

- [ ] Header:
  - `STEP 1 OF 2` + progress bar
  - title "Lets understand your event first" (fix the typo → "Let's")
  - sub "Tell GROS about the launch — it'll draft the full multi-day sequence."
- [ ] Chat opens with a pre-seeded user bubble: "I want to launch a multi-day event."
- [ ] Scripted questions. Each answer becomes a user bubble, and typing a free answer also works.
  1. "What kind of event are you launching?"
     - chips: Product launch / Flash sale / Restock / Bundle/Collab drop / Site-wide sale
  2. "Which product(s) should this feature? Search and pick, or skip to keep it general."
     - **inline product picker**: search box + scrolling checkbox list (multi-select) + confirm, and a full-width "Skip — no specific product"
     - skip bubble text: "No specific product — keep it general"
  3. "How many sends (separate emails/SMS) do you want for this event? Or type a number."
     - round chips: 1 / 2 / 3 / 5
  4. "How many of each channel for your N sends? They should add up to N."
     - inline form: caption "Distribute N sends across channels · 0/N" turns success colour with "N/N ✓" when the numbers match
     - 3 boxed number inputs: Email Design / Email Text / SMS
     - `Set channels →` stays disabled until the sum matches
     - bubble text: "Use 2 Email Design, 1 SMS."
  5. "What offer should this run? Or type the exact offer, e.g. "20% off for first 10 customers"."
     - chips: Percent off / Free gift / No discount — just hype
  6. "Over how many days should the N sends run? Or type a number of days."
     - chips: 3 days / 5 days / 7 days
  7. Typing indicator, then the AI builds the plan.
     - **Must handle errors:** the old app showed "AI returned an unparseable response. Please try again." with no button. Add a `Retry` button.
- [ ] Composer: `+` attach, "Type your message...", round send button.
- [ ] Footer: `Cancel` on the left, primary `Next →` on the right. Next is disabled until the chat is complete, and leads to step 2 (plan review → create campaigns).
- [ ] **Closing mid-way** (✕ or Cancel) opens the confirm dialog:
  - "!" icon
  - "Discard this event plan?"
  - "**Heads up:** closing now won't save anything — the sequence you've planned with GROS will be lost and no campaigns will be created. You'll have to start over."
  - buttons: `Keep editing` (secondary) / `Discard & close` (danger)
- [ ] Closing before anything has been answered skips the confirm.

### 6.6 Modal "Generate Campaign Calendar" → "Build the brief" (STEP 1 OF 2)

- [ ] Sub "Answer a few questions and the agent drafts your calendar."
- [ ] "HOW MANY OF EACH DO YOU WANT TO SEND THE SELECTED MONTH": 3 stepper boxes, each with label, `−`, big number and `+` (min 0).
  - defaults: Email Design 4, Email Text 0, SMS 0
- [ ] "PRODUCT FOCUS": 3 toggle buttons — Choose a product / **Best Sellers** (on by default) / New Arrivals.
  - **Multi-select:** each button toggles on/off, and several can be on at once.
  - Turning on "Choose a product" reveals a full-width "Select products ▾" multi-select dropdown under the buttons.
- [ ] "HOLIDAYS & EVENTS": stacked full-width selectable rows, one per holiday in that month, all **pre-selected**.
  - selected row = tinted background + accent border + filled check circle
  - clicking a row toggles it
- [ ] Dashed row `+ Custom event` reveals an inline input "Name your event..." + `Add`, which adds a selected row.
- [ ] "ANYTHING ELSE THIS MONTH?" textarea, placeholder "e.g. push the new Hydrate line, retire the Spring SKUs by end of month, lean into UGC…"
- [ ] Footer: Cancel / primary `Continue →`. Step 2 = the AI drafts the month; the user reviews, then the drafts land on the calendar.

### 6.7 Modal "Plan send" (from "+ plan send")

- [ ] `STEP 1 OF 2`, title "What do you wanna send on this day?", sub with the full date ("Saturday, November 7, 2026").
- [ ] Opens with the typing indicator, then GROS asks: "Hi there! What are we looking to send out on Saturday, November 7th?"
- [ ] Free AI chat with the `+` attach button.
- [ ] Footer: Cancel / `Next →`, disabled until the plan is ready.

### 6.8 Competitor Inspirations card (below the calendar)

- [ ] Title + "Real newsletters from the competitors you track — click one to read it, pick it as a Reference Design when drafting." + `Browse library →` on the right.
- [ ] "SHOW" + segmented All / Email Design / Email Text.
- [ ] 5-column grid of tall cards:
  - top: a scaled live render of the email (clipped, ~500px)
  - bottom: type pill (DESIGN / TEXT) + `⤢` expand icon on the right, subject (bold, 1-line truncate), "domain · Nov 6" (small, accent)
- [ ] **Card hover:** accent border + an inverted pill "✦ Use this design" overlaid top-right.
- [ ] `⤢` or a card click opens a large modal:
  - header: ✉ subject, `✦ Use this design`, ✕
  - body: the full email scrolling on a grey background
- [ ] "Use this design" opens a small dialog **"Send on which day?"**:
  - "We will start a campaign for this date using **<subject>** as the reference design."
  - date input (defaults to today)
  - `Cancel` / primary `Continue`, which starts the plan-send flow with that reference attached
- [ ] Centred outline pill `Load more (15 more)`, which pages 15 at a time.

### 6.9 Our Best Picks card

- [ ] Title + "Top-performing templates from the Grey Retention library — pick one when drafting." + `Browse library →`.
- [ ] Same grid as 6.8. Empty: outline star, "No best picks uploaded yet." / "Reach out to your admin — they curate this library."

---

## 7. Campaign drafts

### List `/campaign-drafts`

- [ ] H1 "Campaign Agent" + "AI-drafted campaigns that you can edit, review, then push to Klaviyo." Primary `✦ New campaign` on the right.
- [ ] Status pills with counts: ALL (2) / DRAFTS (2) / READY (0) / PUSHED (0).
- [ ] Table columns:
  - TITLE / SUBJECT (bold title + muted "Subject: …")
  - STATUS (e.g. WRITING, info pill)
  - PLANNED (date)
  - UPDATED (relative)
  - `Open →` (accent)
- [ ] The whole row is clickable.

### New draft `/campaign-drafts/new`

- [ ] `← Back to Campaign Agent`, H1 "New campaign draft", "Give us a brief — we'll draft the subject + body in your brand voice." Column ~800px.
- [ ] Card **What we'll use as context**: 3 success-tint tiles with ✓:
  - Brand Truth "Generated — ready"
  - Copy & Voice "Generated — ready"
  - Email templates "218 ingested from Klaviyo"
  - A missing one should show a warning tile with a fix link.
- [ ] Card **✔ Pre-filled from your brand profile** + tiny caps "NO NEED TO REPEAT IN THE BRIEF":
  - INDUSTRY and SITE
  - footnote "Want to change any of these? Update them on your [brand profile]."
- [ ] Card **Start from…** / "Optional. Pre-fills the brief from an existing source you can then edit." 4 option tiles (icon, title, description):
  - **Recent campaign** — "Copy the brief, subject and structure from one of your past drafts."
    - opens modal "Pick a past campaign": rows with title, 2-line summary, relative time; hover/selected = tint + accent border
  - **Klaviyo template** — "Adapt the tone and structure of an existing template in your Klaviyo account."
    - opens modal "Pick a Klaviyo template": rows with name, "Subject: …", "From: <flow>", and "Flow" + time on the right
  - **Reference design** — "Pick from the curated library of high-quality reference emails — vision-enabled pattern extraction."
    - opens modal "Pick a reference design": rows with 80px thumbnail, name, muted source, "YOURS" pill
  - **Blank** — "Start with a clean slate — fill in the form below yourself."
  - Picking a source closes the modal, marks that tile selected, and pre-fills the form.
- [ ] **Form card:**
  - INTERNAL TITLE (placeholder "e.g. May welcome flow announcement"), help "Just for you — won't be visible to recipients."
  - CAMPAIGN BRIEF: tall textarea with a multi-line example placeholder (3 bullet examples), help "The more specific you are, the better the draft. Mention any codes, deadlines, products, or angles you want included."
  - NUMBER OF SECTIONS (number, default 3), help "Sections like Hero, Product Grid, CTA, Social Proof."
  - EMAIL STRUCTURE: checkbox "Include footer" (checked by default), help "Pre-checked — uncheck if this campaign shouldn't have one."
  - divider, then muted "Takes ~15-30 seconds." on the left and primary `✦ Generate draft` on the right
  - while generating: show a loading state on the button, then go to the editor

### Draft editor `/campaign-drafts/:id` (core screen)

Layout:

- [ ] Left scrolling column (~750px) of section cards.
- [ ] Right **sticky** panel (~360px).
- [ ] **Sticky bottom action bar** floating over the left column (rounded card with shadow): `Cancel` (muted) · outline `💾 Save Changes` · primary `📤 Schedule`.
- [ ] Floating bottom-right pill `✦ Ask GROS`.
- [ ] Unsaved changes: warn before leaving the page. The old app didn't; this is a fix.

Left column cards, in order:

1. - [ ] **Header:** inline-editable title (large, bold); pills WRITING · DRAFT · EMAIL; small select on the right (Draft / Ready).
2. - [ ] **📅 Send Schedule:** DATE · TIME · CHANNEL (Email Design / Email Text / SMS) · WORKFLOW (Draft / Assigned to designer / Pending approval / Scheduled / Sent).
3. - [ ] **🕘 Best Send Time** — "time of day only, AI-suggested on demand":
   - text input showing the recommendation + reason
   - `✦ AI Suggest` (tooltip "Ask AI for a time-of-day recommendation")
   - `→ Use this` (tooltip "Auto-pick a date/time from the recommendation"), which fills TIME
4. - [ ] **Subject Lines** — "pick one or write your own", with `⟳ Regenerate` on the right:
   - 3 radio rows; the selected one is tinted with an accent border; empty rows show italic "(empty — click Regenerate)"
   - divider
   - "OR WRITE YOUR OWN" + live counter `0/60`; input "Custom subject line (overrides the radio above)"
   - "PREVIEW TEXT" + counter `90/120`
5. - [ ] **📄 Campaign Summary:** textarea.
6. - [ ] **📦 Featured Product:** "0 selected" on the right; explainer "Pick the single product this campaign features. The AI body generator and GROS chat both see this — including sales, quantities and recent orders pulled from Shopify — so they can write copy specific to it."; product radio picker; help "Leave "— let AI pick —" selected to give the AI free reign. Hit Save Changes below to apply."
7. - [ ] **👥 Audience** — "pick lists / segments to include + exclude":
   - `⟳ Refresh` on the right
   - caption "9 lists (from live) · 21 segments (from live)."
   - SEND TO picker + DON'T SEND TO picker
   - help "Exclude wins. Anyone in both Send-to and Don't-send-to lists gets skipped."
8. - [ ] **🪪 Sender Name** — "what shows in the recipient's inbox "From" field":
   - input + outline `↺ Use Klaviyo`
   - when overridden, show the note "✎ Override active. Your Klaviyo default is **PHOLOH**. The value above is what gets pushed to Klaviyo as the campaign's From name."
9. - [ ] **🔗 Primary Link** — "destination for hero CTA + body links":
   - mono URL input
   - help "Used for both email (hero button + body links) and SMS (the link inserted in the message). Must start with https://. Leave blank to let the AI pick a relevant destination from your products."
   - validate that it starts with https://
10. - [ ] **Email Settings:** checkbox Include footer + FOOTER SOURCE select ("Use my default setting" + every template), help "Override just this campaign's footer."
11. - [ ] **🏷 Active Offers** — "tick the offers that apply to this campaign":
    - search "Search offers..." + checkbox rows
    - help "Leave all unchecked to apply every active offer (default). Tick specific offers to scope this campaign to just those."
    - input "Add your own offer, e.g. 20% off sitewide this weekend" + `+ Add`
12. - [ ] **🖼 Reference Design:**
    - big thumbnail placeholder on the left
    - on the right: italic "No design selected", "Pick a design from one of three libraries: your team's own templates, competitor inspirations, or admin-curated best picks.", and primary `Choose a Design`
    - **Design picker modal:** "Choose a design for this email" / "GROS will write copy that fits perfectly to the design you select."
      - tab pills with counts: Your Templates N / Competitor Inspirations N / Best Picks N
      - 4-column thumbnail grid; each card has a `⤢` open icon, subject, domain · date
      - empty tab: "No Your Templates uploaded yet." (fix the wording → "No templates uploaded yet.") + "Reach out to your admin — they curate this library."
      - footer: muted "Click a card to pick, or drag it onto the preview slot." + `Done`
      - **drag-and-drop onto the preview** must work
    - **Picking a card** opens the follow-up modal "✦ What do you wanna copy from this design?", with "Source: <subject> (<domain>)" and 3 option rows:
      - ✦ **Copy Everything** — "Full pattern framework — what this email does, how copy is written, section-by-section breakdown, design patterns, replication brief."
      - 💡 **Copy Strategy** — "Strategic framework — emotional journey, hook pattern, urgency drivers, objection overcome, replication brief."
      - ▦ **Copy Design Layout** — "Layout + formatting system — section order, typography, CTA placement, visual hierarchy, Klaviyo-builder spec."
      - muted link "Skip — just keep the design"
13. - [ ] **👤+ Assignment:** "Once the brief is locked, assign this campaign to a designer. They get a 24-hour SLA to deliver the finished email design, then admin reviews before it's ready to use." + primary `👤+ Assign to <designer name>`.

Right panel:

- [ ] Header "👁 Email Preview".
- [ ] Rendered email, scrolling inside the panel.
- [ ] Full-width accent `✦ Regenerate Copy`.
- [ ] Outline `✎ Open Copy Editor` + caption "Copy Editor enables inline editing of the preview. Click Apply to attach your edits to the form, then Save Changes below."
- [ ] Meta: Draft ID #649 · Created · Last edited.
- [ ] **Copy Editor on:**
  - preview gets a 2px accent border
  - header shows an `EDITING` pill + `Cancel` + primary `Apply`
  - preview text becomes editable in place
  - the button changes to `✎ Close Copy Editor`
  - Apply writes the edits into the form; Cancel reverts them
- [ ] **Ask GROS drawer** (replaces the right panel, full height, ~400px):
  - header "✦ GROS" + "Agentic — proposes actions, you confirm." + 🧹 clear + ✕
  - empty state: 👋, "Hi! I'm GROS.", "I can answer questions about this campaign — and take action on your behalf. Try: "Change the subject to: Free shipping today only." or "Schedule this for Friday at 9am.""
  - composer placeholder "Try: change the title to Holiday Sale / Or: schedule this for Friday at 9am."
  - proposed actions render as a confirm card (Apply / Dismiss) **before** anything changes

---

## 8. Ask GROS `/gros`

- [ ] Two panes filling the viewport height; no page scroll.
- [ ] **Left pane (~280px):**
  - header "✦ Ask GROS" + round `+` (New private chat)
  - thread list: the active thread has a tinted background + a left accent bar; each row shows the title (bold) and "🔒 5 msg · 46 days ago" (the lock icon shows only on private threads)
  - muted footer "GROS knows 218 of your email templates."
- [ ] **Right pane header:**
  - thread title as an inline-editable input (rename on blur or Enter)
  - on the right: pill `🔒 PRIVATE` (or SHARED) and text buttons `⟳ Refresh data` (tooltip "Force GROS to re-read your latest Klaviyo + Shopify data."), `👥 Make shared` (toggles to "Make private"), and `🗑 Delete` (danger, asks to confirm)
- [ ] Messages:
  - GROS on the left: light bubble, max ~75% width, renders markdown (lists, bold, line breaks)
  - user on the right: inverted pill bubble
- [ ] The first assistant message in a new thread is a greeting: "Hi <first name> — I'm GROS, your marketing assistant. I've got your store's data in front of me, so I can help you plan campaigns, dig into how things are performing, or just talk through an idea.\n\nWhat's on your mind?"
- [ ] Composer:
  - multi-line textarea with an accent focus ring, placeholder "Ask GROS anything in this thread…"
  - square send button
  - caption "⌘/Ctrl + Enter to send. Tokens deducted from your Token Package."
  - **⌘/Ctrl+Enter sends; Enter adds a new line**
- [ ] While a reply is coming: typing indicator; streaming is preferred.

---

## 9. Competitor Agent `/library/inspirations`

- [x] `← Back to Campaign Agent`.
- [x] H1 "Competitor Inspirations" + "Real newsletters from the competitors you track — browse them here, pick one as a reference design when planning a campaign."
- [x] Big counter on the right: `41` / tiny "EMAILS".
- [x] **Card "🔍 Your competitor domains (6/10)":**
  - explainer "Add a brand you want to learn from. Our system auto subscribes to their newsletter and starts showing you designs once the competitor begins sending us emails — their latest 20 sends show up below and in the Competitor tab of every design picker."
  - on the right: input placeholder "brand.com" + primary `+ Track`
  - domain chips: domain (bold) + status pill (**LIVE** success / **PENDING** warning) + `✕` remove
  - limit 10: disable Track at 10/10
  - validate that the input is a domain
- [x] **Info tip bar:** 💡 "**To build from one of these:** open a draft or the calendar planner and pick it from the _Competitor_ tab — the agent extracts its copy strategy and layout for you." + `Open calendar →` on the right.
- [x] SHOW pills: All / Email Design / Email Text.
- [x] 5-column grid of cards:
  - live render (scrollable inside, ~500px)
  - footer: domain pill (`FITMINT.US`), type pill, date on the right, subject (bold, 2 lines), sender brand name (muted)
  - hover: accent border + "✦ Use this design", which opens the "Send on which day?" dialog (§6.8)
- [x] `Load more (26 more)`.

> **As built (UIR-009 + UIR-022, cloud lane):** `/library/inspirations` is the sidebar's **Inspiration** (the older `/competitor-agent` stays as its advanced page). The back link says "Back to Campaigns" (the planner's new name). The domains card tracks up to 10 domains (the database refuses an 11th), validates the domain, shows LIVE / PENDING / ERROR with "Usually 1–7 days after their next send" for PENDING, and asks "Stop tracking <domain>? Its emails will disappear from your library." before removing one. **Sample mode:** only fictional `.example` domains can be tracked, and their emails are sample emails; the card says so. The library below is the shared **reference library** (UIR-022): tabs **Competitors / Yours / Best picks** with the same counts everywhere, search, SHOW (All / Email Design / Email Text, classified by images per word), "Filter by domain" chips, a responsive grid (1–5 columns) of sandboxed previews with links off, 20 cards per "Load more", and an in-page preview. The render is not a click target; the card footer opens the preview. "✦ Use this design" starts a new draft with the reference chosen (`/first-draft?reference=…`); the planner's "Send on which day?" dialog (§6.8) is the browser lane's and will reuse the same component in pick mode. Best picks are empty until the platform team curates them ("No best picks uploaded yet.").

---

## 10. Support `/support`

- [ ] H1 "Support" + "Talk to an Email Marketing Expert."
- [ ] Two columns: conversation card (~2/3) and ticket list (~1/3).
- [ ] **Conversation:**
  - header: subject (bold) + "Support #7 · opened Jul 5, 2026" (muted), status pill on the right (Open / Closed)
  - user messages: right, inverted pill, time under it ("Jul 5, 2:13 AM")
  - staff messages: left, tiny caps label "SUPPORT · ADMIN" above, light bubble, time under it
  - composer: round `📎` (tooltip "Attach an image or PDF (10 MB max)") + input "Type a message…" + round send button
  - closed tickets: disable the composer, or reopen the ticket on send (decide which)
- [ ] **Ticket list:**
  - full-width primary `+ New Support`
  - search "🔍 Search support requests…" filters as you type
  - ticket cards: subject (bold), status pill, date on the right, last-message preview (muted); the selected card has a strong border; selecting sets `?t=`
- [ ] **New Support modal** (~480px):
  - SUBJECT (placeholder "e.g. Campaign not syncing to Klaviyo")
  - DESCRIBE THE ISSUE textarea ("What's happening?")
  - `📎 Attach image / PDF`
  - full-width primary `Create Support`

---

## 11. Settings `/settings`

- [x] H1 "Settings" + "Set defaults that apply to every campaign you generate. You can still change them on any individual draft." Column ~900px.
- [x] **🕘 Timezone (read-only):**
  - "Campaign send times are scheduled in your brand's timezone, synced from your Klaviyo account. Update it in Klaviyo if it's wrong."
  - BRAND TIMEZONE "US/Pacific (UTC-08:00)" and CURRENT LOCAL TIME "Fri, Nov 6 2026 · 9:07 AM" (live clock)
- [x] **Campaign defaults:** "These pre-fill on every new campaign. Each draft shows the value and lets you override it before sending, and the chosen values are pushed to Klaviyo."
  - underline tabs, switched on the client: Featured Product / Sender Name / Primary Link / Audience / Email Settings
  - **Featured Product:** "The single product new campaigns feature by default. The AI body generator sees its Shopify sales, quantities, and recent orders." + product radio picker
  - **Sender Name:** "The "from" name recipients see. Leave blank to use your Klaviyo account default." + input
  - **Primary Link:** "The destination URL for the main CTA and body links. Leave blank to let the AI choose." + URL input
  - **Audience:** "Default "Send to" and "Don't send to" audiences for new campaigns." + two list/segment pickers
  - **Email Settings:**
    - "Email Settings (default for new campaigns)" + explainer ("New email campaigns start with the footer checked. You can change it per campaign on the draft. The footer is built from your Klaviyo brand settings (organization, mailing address, unsubscribe link) when the campaign is pushed.")
    - checkbox "Include footer" + muted "(logo, unsubscribe link, social icons)"
    - divider
    - FOOTER SOURCE select ("Auto — built from my brand settings" + every Klaviyo template), help "We pull the bottom block (unsubscribe + address) from the chosen email."
    - small muted "Heads up: a Klaviyo template is a whole email, so we extract the footer automatically — give the next test send a quick look to confirm it came through cleanly. If extraction misses, we fall back to the auto-built block."
- [x] One right-aligned primary `Save defaults` under the card. It saves all tabs; show a success toast.

> **As built (UIR-011, cloud lane):** layout as above. The Timezone card shows the workspace timezone, the same one the Dashboard uses (OWNER_JOURNEYS §11 fix), and says it is not read from Klaviyo yet, instead of "synced from your Klaviyo account". The live clock ticks. Defaults are saved for the workspace and the card says plainly that the new campaign editor will be the first screen to read them. Audience pickers show the sample Klaviyo lists and segments (labelled sample); FOOTER SOURCE offers only "Auto" until real Klaviyo templates exist. "Save defaults" saves all tabs and says "Applies to new campaigns only." The success message appears next to the button (no toast component exists yet). Older settings (budget, notifications, holidays, delivery policy) sit below under "More settings".

---

## 12. Holidays & Events `/holidays`

- [x] H1 + "Your brand's own moments — anniversaries, drops, sales windows. They appear on your calendar, in the planner wizards, and the AI strategists plan around them."
- [x] **Left card "Add an entry"** (~360px):
  - NAME ("e.g. Brand anniversary, Summer drop")
  - DATE + TYPE (Holiday / Event)
  - checkbox "Repeats annually (same date)"
  - NOTES FOR THE AI STRATEGIST (optional) textarea ("e.g. Our biggest drop of the year — tease it early.")
  - full-width primary `Add entry`
- [x] **Right card "Yours"** + "N total": list with edit/delete on each row. Empty: "Nothing yet — add your first on the left."
- [x] **Card "Platform holidays & events · next 90 days · managed by Grey Retention":**
  - wrap of chips, each with the date (mono, muted) and the name (bold, coloured by category)
  - order: Nov 11 Veterans Day, Nov 26 Thanksgiving, Nov 27 Black Friday, Nov 30 Cyber Monday, Dec 1 Giving Tuesday, Dec 4 Hanukkah begins, Dec 14 Free Shipping Day, Dec 24 Christmas Eve, Dec 25 Christmas Day, Dec 26 Boxing Day, Dec 31 New Year's Eve

> **As built (UIR-012, cloud lane):** layout as above. The intro says only what is true today: "When the AI strategist plans your campaigns, it plans around the ones in the next 30 days. Showing them on the calendar is coming soon." (the calendar and planner overlays are the browser lane's §6). Each entry in Yours shows its next date (a yearly entry shows this year's or next year's date, never one before its own first date), Holiday or Event, "Every year" and the notes; Edit opens the same fields inline (cursor in Name; back on the Edit button after Save or Cancel) and Delete asks first. "Saved." and "Deleted." show on the Yours card, and after a delete the cursor goes to the "Yours" heading. The platform card follows the brand's country (OWNER_JOURNEYS §18 decision 20): the owner picks United States, United Kingdom (England and Wales), Australia, Canada, New Zealand, India or "Other countries: shopping and gift days" and clicks `Save country`; before that the country is guessed from the workspace timezone and the card says so. "managed by" shows the product's name from the white-label brand presentation. Categories show by colour and by icon, with a key above the chips: public holidays (landmark, brand colour), celebrations (sparkles, accent-2), shopping days (bag, danger colour). Dates are computed, not stored; moon-calendar dates (Hanukkah, Diwali, Holi, Lunar New Year, Matariki) are listed until 2030.

---

## 13. Connections `/connections`

- [x] H1 "Connections" + "Connect your tools to unlock the agents." Two equal cards.
- [x] **Klaviyo card:**
  - tinted tile with a mail icon
  - top-right pill "✔ PULLED 218 TEMPLATES"
  - title
  - "+" benefit list: Unlocks flows & segments / Sync CLTV data / Deliverability insights
  - connected state:
    - full-width accent button "✓ Klaviyo Connected"
    - caption "Dreams Studio · pk_YxS7U••••••••9de0"
    - link `Update API key`, which reveals a password input "pk_…", full-width `Validate & swap key`, and the caption "The new key is validated against Klaviyo before we save. If it fails, your existing key stays in place."
  - disconnected state: key input + Connect
- [x] **Shopify card:**
  - tinted tile with a bag icon
  - "+" list: Products & inventory / Orders & customers / Discount-code creation
  - bottom-aligned primary `Connect Shopify →`, which reveals a full-width card **Connect your Shopify store**:
    - explainer: "Create a Custom App in your Shopify admin, give it read access to **products, orders, customers, and analytics**, then paste the Admin API access token here." + link "How to create a Custom App →"
    - SHOP DOMAIN, help "The `.myshopify.com` address, not your custom domain."
    - ADMIN API ACCESS TOKEN (password field), help "Starts with `shpat_` or `shpca_`. In your Custom App: **Configuration → Install app → API credentials tab → "Admin API access token" section → Reveal token once**."
    - ⚠ warning line: "Not the same as the API secret key (`shpss_…`) or the API key. The access token is shown only ONCE — if you missed it, uninstall and reinstall the app to regenerate."
    - grey box "Required scopes:" with mono chips: read_products, read_orders, read_customers, read_analytics
    - primary `🔗 Verify & connect` on the right
    - divider + collapsible "(?) COMMON ISSUES"
  - add `autocomplete="off"` on the domain field: the browser autofilled an email address there in the old app

---

## 14. Profile `/profile`

- [x] H1 "Profile" + "Update your account information and password." Column ~670px.
- [x] **Card "Account information" / "Name, job title, and contact phone."**:
  - NAME
  - EMAIL 🔒 (disabled), help "Email is locked. Contact support if you need to change it."
  - JOB TITLE
  - PHONE
  - `Save changes`
- [x] **Card "Change password" / "At least 8 characters. We'll verify your current password first."**:
  - CURRENT PASSWORD / NEW PASSWORD / CONFIRM NEW PASSWORD
  - `Update password`
  - inline errors for a mismatch, a password under 8 characters, or a wrong current password

---

## 15. Old-app bugs: fix these, don't copy them

1. Brand & Store had no H1 (§5).
2. "+ plan send" opened the wrong date (§6).
3. Table view missed campaigns the calendar showed. Also, every toggle that becomes active after a click (the Table button, and status pills like "Scheduled") rendered white text on white, so it looked blank. Only the default-active ones looked right (§6).
4. The multi-day wizard died on "AI returned an unparseable response" with no retry (§6.5).
5. "Lets" typo in the wizard title; "No Your Templates uploaded yet." wording (§6.5, §7).
6. Campaign detail showed raw list/segment ids instead of names (§4).
7. No tooltips on the collapsed sidebar or the revenue bars (§2, §3).
8. Shopify domain field accepted browser-autofilled email (§13).
9. Some inspiration thumbnails rendered blank white (lazy iframe never loaded). Show a skeleton, then the render, and fall back to the mail icon (§6.8).

---

## 16. Suggested build order

1. Shell + shared components (§2)
2. Connections (§13): everything else depends on Klaviyo/Shopify
3. Dashboard + detail pages (§3–4)
4. Brand & Store (§5)
5. Settings, Holidays, Profile (§11, 12, 14)
6. Campaign planner + modals (§6)
7. Drafts list, New draft, Draft editor (§7)
8. Ask GROS (§8), Competitor Agent (§9), Support (§10)
