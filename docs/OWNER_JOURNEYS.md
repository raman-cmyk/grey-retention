# Owner journeys and behaviour brief: old Grey Retention app

Source: read-only walk through `demo.gravtyretention.com` on 6 Nov 2026, logged in as the brand owner of the "Dreams Studio" workspace (real Klaviyo account connected, Shopify not connected).

Companion to `docs/UI_REBUILD_SPEC.md`. That spec covers layout, components and most labels. This brief covers what it misses: **behaviour, journeys, links between screens, real wording, edge cases, bugs and data problems.** It does not repeat layout facts.

Privacy: customer names, emails, campaign copy, product names and exact revenue are described generically on purpose.

How to read the checks:

- `- [ ]` = an acceptance check an engineer can test.
- **(fix)** = the old app does this wrong. Build the corrected version.
- **(keep)** = odd but intended. Copy it.
- **(new)** = not in `UI_REBUILD_SPEC.md`.

---

## 0. Biggest findings (read first)

1. **The AI context belongs to a different brand.** Brand Truth, Copy & Voice, the "Pre-filled from your brand profile" site URL, the product catalogue in every product picker, the Klaviyo "From" default and both existing drafts all describe a different business: another niche, another country, another product line. The real workspace sells something else in another country, in another currency. Every AI feature (drafts, GROS chat, calendar generation) is fed the wrong brand. The owner **cannot edit any brand field by hand**. The only tool is "Regenerate". This is the most damaging problem for an owner.
2. **There is no real owner approval step.** The dashboard card says "Campaign approval workflow not yet built". In the draft editor, "Pending approval" is just a value in a WORKFLOW dropdown that anyone can pick. The owner's only real "yes" is the **Schedule** button. There is no preview-and-approve screen and no test send.
3. **Three status systems overlap on one draft.** A pill (WRITING), a pill (DRAFT), a header select (Draft / Ready) and a WORKFLOW select (Draft / Assigned to designer / Pending approval / Scheduled / Sent). The list filters use a fourth vocabulary (DRAFTS / READY / PUSHED). The calendar legend uses a fifth (Sent / Scheduled / Assigned to Designer / Draft).
4. **Timezones disagree.** The Klaviyo account card shows an Australian timezone and AUD. Settings says "US/Pacific (UTC-08:00)" and claims it is "synced from your Klaviyo account". The planner table header says "WHEN · US/PACIFIC". Every calendar tooltip says "Sent at 17:11", whatever the real send time was, while the detail page shows a different time.
5. **The planner only half-shows Klaviyo.** The calendar shows synced Klaviyo sends. The Table view shows **only** local drafts. Klaviyo campaigns with status DRAFT (no send time) appear nowhere in the planner. The dashboard says "No upcoming campaigns" while a Klaviyo draft exists.
6. **Campaign drafts has no sidebar entry.** `/campaign-drafts` is reachable only from "Back to Campaign Agent" on the New draft page and the editor. Its H1 is also "Campaign Agent", the same as the planner.
7. **Klaviyo object pages explain but don't report.** A sent campaign's detail page has no opens, clicks, revenue or recipients. Revenue exists in the dashboard table but not on the detail page. Segment rules are raw JSON with metric ids.
8. **The sidebar has two Workspace items the spec misses:** **Team** (`/team`) and **Request a Feature** (`/feedback`). (new)
9. **Hidden owner-side design review exists:** a "Reject design & ask designer to redo" form sits in the editor DOM, plus an "uploaded final design" mode that replaces the preview. (new)
10. **Inspiration previews keep live links.** Opening a competitor email from Competitor Agent opens a raw page in a new browser tab with working links, **including the competitor's unsubscribe link**. One owner click could unsubscribe the tracking inbox.

---

## 1. Top 5 owner jobs (end-to-end journeys)

### Job 1: "Plan next month's campaigns"

Old path today (7–10 clicks plus AI waits):

1. Owner opens **Campaign Agent** from the sidebar. It lands on the current month. A muted "Syncing" label turns into a green italic "Loaded" next to the month name.
2. Owner clicks `>` to go to next month. The URL becomes `?m=YYYY-MM` and a "Today" link appears to jump back.
3. Optional: **Holidays & Events** → adds a brand moment (name, date, type, repeats yearly) → it shows on the calendar.
4. Owner clicks **Generate Campaign Calendar** → "Build the brief" (step 1 of 2):
   - sets counts with steppers (defaults: 4 design emails, 0 text, 0 SMS)
   - picks a product focus (Best Sellers is on by default)
   - keeps or unticks the month's holidays (all pre-ticked)
   - adds a custom event if needed
   - types any extra notes
5. **Continue** → step 2: the AI drafts the month (not explored: it spends tokens). Drafts land on the calendar as Draft chips.
6. Owner drags a draft chip to another day to reschedule it (the chip tooltip says "drag to reschedule"). (new)

Checks:

- [ ] Brief modal pre-ticks only the holidays that fall in the **viewed** month, not today's month.
- [ ] Owner can't generate drafts for days that have already passed without a warning. **(fix)** The old brief includes holidays earlier in the current month, and past cells still offer "+ plan send".
- [ ] After generation, the new drafts appear on the calendar **and** in the Table view **and** in Campaign drafts as DRAFT.
- [ ] Escape or clicking outside the brief modal does **not** silently throw away the answers. **(fix)** The old app closed on Escape with no confirm and reset every field (for example the "Choose a product" toggle) the next time it opened.

### Job 2: "Make one email for a specific day"

Three entry points lead to the same result: a draft with a date.

- A. Calendar cell hover → **+ plan send** → chat with GROS ("What do you wanna send on this day?") → Next → draft.
- B. Competitor card → **Use this design** → "Send on which day?" (date defaults to today) → Continue → plan-send flow with the design attached as reference.
- C. Dashboard "Schedule a campaign →" / "Create one →", or Campaign drafts **New campaign** → `/campaign-drafts/new` → brief form → **Generate draft** (~15–30 s) → editor.

Checks:

- [ ] Path C has no date field. The draft gets its date later in the editor's Send Schedule card. The dashboard link text "Schedule a campaign →" promises more than it does. **(fix: rename it "Create a campaign" or ask for a date)**
- [ ] All three paths land in the same editor and the draft appears on the calendar on its date.
- [ ] "Use this design" pre-fills the reference design on the resulting draft.

### Job 3: "Review the copy and design, then hand to a designer"

1. Owner opens the draft from the calendar chip or Campaign drafts → editor.
2. Owner checks the right-hand preview and does one of these:
   - picks or writes a subject (counter 0/60, preview text n/120)
   - clicks **Regenerate** (subjects) or **Regenerate Copy** (body), which costs tokens
   - opens **Copy Editor** to edit text in the preview → **Apply** → **Save Changes**
3. Owner sets audience (Send to / Don't send to), sender name, primary link, featured product, offers and footer.
4. Owner picks a **Reference Design** (Your Templates / Competitor Inspirations / Best Picks) → "What do you wanna copy from this design?" (Copy Everything / Copy Strategy / Copy Design Layout / Skip).
5. Owner clicks **Assign to <designer>** → modal "Assign this campaign to a designer":
   - "They deliver a finished design within 24h. Admin reviews before it's ready."
   - warning: "Please do not regenerate the campaign or modify it after assigning the designer."
   - radio list of designers ("These designers are assigned to your account by an admin."), each with an "N open" workload count
   - optional notes textarea
   - Cancel / Assign
6. When the design comes back, the preview switches to the uploaded design. The banner reads: "Your uploaded final design — every strip links to <url>. This exact version is what pushes to Klaviyo."
7. If the design is wrong, the owner uses **"Reject design & ask designer to redo"**:
   - field "What needs to change?" (minimum 10 characters)
   - note: "This text goes directly to the designer."
   - buttons: Cancel / **Reject & notify**
   - "The admin also sees this rejection…"

Checks:

- [ ] After assignment, Regenerate / Regenerate Copy are disabled or need a confirm, because the warning says not to change the brief. **(fix)** The old app still showed Regenerate Copy on a draft that had an uploaded final design.
- [ ] Status pills change when the design is assigned or delivered. **(fix)** The old draft with an uploaded final design still showed WRITING · DRAFT.
- [ ] The owner sees an explicit **Approve design** action next to Reject. The old app had only the reject form, and approval was left to an admin. **(fix, product rule: owner approval is required)**

### Job 4: "Approve and send to Klaviyo"

1. Owner sets DATE and TIME (optionally **AI Suggest** → **Use this** fills the time).
2. Owner clicks **Schedule** in the sticky bar. This is the only action that pushes to Klaviyo.
3. The draft moves to Scheduled. The calendar chip becomes info-tinted, and later it shows as Sent once Klaviyo reports it.

Checks:

- [ ] Schedule asks for confirmation and shows a summary first: subject, from name, audience counts, date/time **with timezone**. The old app's Schedule is a bare submit button.
- [ ] Schedule is blocked when the date/time is in the past. **(fix)** The old draft dated in August showed an enabled Schedule button in November.
- [ ] Schedule is blocked when Send to is empty. The old drafts had 0 selected in Send to.
- [ ] "Pending approval" is a real state: only the owner can move a campaign out of it. Staff or admins can't skip it. **(fix)**

### Job 5: "See how my email is doing"

1. Owner opens **Dashboard**:
   - KPI strip
   - "Email revenue this month" gauge vs goal (Klaviyo or UTM attribution)
   - 30-day revenue bars
2. Owner switches to the **Campaigns** tab → sees status + 30-day revenue per campaign → clicks a row → campaign detail.
3. Owner goes to **Flows** → revenue per flow → flow detail → clicks a "Send email" step → flow message preview.

Checks:

- [ ] Campaign detail shows performance: recipients, open rate, click rate, revenue, orders. **(fix)** The old page showed none of these.
- [ ] "Back" from a detail page returns to the tab the owner came from (`?tab=campaigns`). **(fix)** The old link always went to `/dashboard` Overview.
- [ ] Revenue numbers agree across cards (see Dashboard friction).

---

## 2. App shell and navigation

**Purpose:** move between areas. Show the workspace and who is logged in.

**How the owner uses it:** clicks sidebar items. Uses the account menu only for Profile or Log out.

Controls:

- [ ] Workspace group contains **Settings, Holidays & Events, Connections, Team, Request a Feature**. (new: Team, Request a Feature)
- [ ] Agents group items (List Health, Bill Optimizer, Flow Audit, Deliverability, A/B Test Monitor) are non-interactive, with an accessible label "<name> — Coming soon".
- [ ] Collapse toggle (`Toggle sidebar`) switches to the icon rail and stays that way after a reload.
- [ ] Account menu items: "Profile Update" → `/profile`, "Connections" → `/connections`, "Log out" (danger). Escape closes the menu.
- [ ] Sidebar highlights the parent area on child pages: Dashboard on `/lists/:id`, `/campaigns/:id`, `/flows/:id`, `/flow-messages/:id`, `/metrics/:id`, `/segments/:id`, and Campaign Agent on `/campaign-drafts*`. **(fix)** The old app highlighted nothing on these pages.
- [ ] A floating round widget (bottom-right, all pages) is a third-party browser extension, **not** part of the app. Don't rebuild it.

Friction:

- Campaign drafts has no nav entry (see 0.6).
- "Connections" appears twice (Workspace group and account menu).
- The word "Admin" means two things: a Team role, and the platform staff who review designs.

Simplify:

- Add "Campaigns" (the drafts list) under Campaign Agent, or merge it into the planner as a tab.
- Drop the duplicate Connections from the account menu.
- Hide the Agents "SOON" group behind a single "Coming soon" row, or remove it until the agents exist.

---

## 3. Dashboard `/dashboard`

**Purpose:** "How is my email and SMS making money this month, and what's next?"

**How the owner uses it:** opens it daily. Reads the KPI strip and the revenue gauge. Glances at the next campaign. Sometimes drills into Campaigns or Flows tabs.

Controls and behaviour:

- [ ] `Refresh` is a link to `/dashboard?refresh=1`, which re-pulls Klaviyo. Show a loading state and a "last synced" time. The old app showed neither on the dashboard.
- [ ] Attribution toggle links `?attr=klaviyo` / `?attr=utm`. The choice changes **only** the gauge card.
- [ ] UTM state with no Shopify (seen):
  - value `$0`
  - caption "of $<goal> goal · attribution not enabled"
  - info line "No Klaviyo-tagged orders this month."
  - The UTM option should say it needs Shopify and link to Connections. **(fix)** The old app showed $0 with no next step.
- [ ] "Set monthly goal" is a `<details>` disclosure: number input "e.g. 40000" + Save. The goal is shared by both attribution modes.
- [ ] Tabs are links `?tab=lists|segments|campaigns|flows|metrics`.
  - The revenue chart and Account card show **only** on Overview.
  - Other tabs show the KPI strip + row cards + token strip + that tab's table.
- [ ] Campaigns tab header: "30d revenue: <total>".
  - Rows are clickable but are not `<a>` elements (no middle-click or new tab). **(fix: make them real links)**
  - Rows are not in date order: the old list mixed Oct 16 / Oct 18 / Oct 27 / Oct 25. Sort by send time, newest first. **(fix)**
- [ ] Flows tab TRIGGER shows only "Metric" or "Added to List". Show which metric or list. **(fix)**
- [ ] Segments tab has no profile count column. Add one so the owner doesn't have to open each segment. **(fix)**
- [ ] Next-campaign countdown and Campaign Calendar mini read local drafts **and** Klaviyo scheduled campaigns. **(fix)** The old app said "No upcoming campaigns" even with a Klaviyo draft and local drafts present.
- [ ] GROS insight "Generate" spends tokens (tooltip "Regenerate insight (consumes tokens from your package)"). Not clicked.

States seen:

- KPI "Coming soon" ×3 (CLTV, RPR, DELIVERABILITY)
- approval card "Campaign approval workflow not yet built"
- countdown empty "No scheduled or planned campaigns. Schedule one to see the countdown."
- mini calendar empty "No upcoming campaigns. Create one →"

Friction:

- **Currencies mix.** The KPI strip and gauge use `$`, while the Klaviyo data card uses `A$` for the same account. **(fix: one currency from the Klaviyo account)**
- **Revenue numbers don't reconcile.** "REV (NON-PURCH) · 19 campaigns · 30d" shows a value several times larger than the Campaigns tab's "30d revenue", and the flows KPI and flows tab totals differ slightly. The owner can't tell which number is true. Label each number with its source and period, or show one.
- Half the top row is placeholders ("Coming soon" ×3 plus the approval placeholder).
- The token strip ("Scale plan · renews in 30 days", input/output token counts, IN/OUT %) is technical for an owner.

Simplify:

- One revenue headline (this month vs goal) + one 30-day chart + one "Next send" card.
- Hide "Coming soon" KPIs.
- Move the token usage strip to a billing/usage area and show it as "AI credits left: 99%".
- Move the five Klaviyo tabs under a "Klaviyo data" sub-page or a collapsible section.

---

## 4. Klaviyo detail pages

Shared behaviour:

- [x] Each page has `Refresh` → `?refresh=1` (re-pulls this object) and "Back to dashboard" → `/dashboard`. **(fix: back to the originating tab)** (UIR-004: Back returns to the dashboard tab, or to the exact Campaigns view; no Refresh while the data is sample.)
- [x] "Advanced details" is a `<details>` disclosure. Linked resources list item counts ("FLOW ACTIONS 3 items", "TAGS 0 items").
- [x] Relative times are grammatical: "1 month ago", not "1 months ago". **(fix)**

### Campaign `/campaigns/:id`

- **Purpose:** "What exactly did we send, to whom, and when?"
- [x] "Who received this" shows list and segment **names**. **(fix: the old page showed 6-character ids)**
- [ ] A cancelled campaign's calendar tooltip says "(click to edit in Klaviyo)". The detail page should offer the same "Open in Klaviyo" link. (new)
- [x] The send time shown on the detail page matches the calendar tooltip. **(fix: see 0.4)** (Both use the one brand timezone and name it.)
- [x] Add a performance block (Job 5). **(fix)** ("How it did", for sent campaigns.)
- [x] "How it was sent" also states the timezone used for "Scheduled for".

### Flow `/flows/:id`

- **Purpose:** "Is this automation live, and what does it send?"
- [x] The flow shows LIVE while one of its email steps shows DRAFT. Explain this in a line ("1 of 2 emails is not live"), because the owner reads LIVE as "everything is on". **(fix)**
- [x] The Wait step's Settings disclosure shows JSON (`delay_seconds`, `days_of_week`). Show "Waits 45 minutes · any day" as the main text and keep the JSON in Advanced. **(fix)**
- [ ] The "Sync templates" button (submit) re-ingests this flow's templates for AI. Not clicked.
- [ ] Each send-email step links to `/flow-messages/:id`. No per-step performance is shown. **(fix: add opens, clicks and revenue per email if Klaviyo provides them)**

### Flow message `/flow-messages/:id`

- [x] "Back" is history back (keep). (With a fallback link when the page was opened in a new tab.)
- [x] An empty REPLY TO shows "—". **(fix: the old page left it blank)**
- [ ] Add "Use as reference design" here. The owner's own best flow emails are natural references. (simplification)

### List `/lists/:id`

- [x] Opt-in shows the raw value `single_opt_in` plus a plain line. Show only "Single opt-in" plus the line. **(fix)**

### Segment `/segments/:id`

- [x] A "⭐ Starred" pill shows for starred segments. (new)
- [x] The rules are raw JSON that refers to metrics by id. Translate them to a sentence, e.g. "Can receive email AND did <metric name> more than 3 times, all time." Keep the JSON in Advanced. **(fix)**

### Metric `/metrics/:id`

- [x] The "What this measures" line is plain English (e.g. "Someone completed a purchase").
- [x] No event counts or trend are shown. Low owner value. Add "events last 30 days" or drop the page from the owner view. (simplification) (Events in the last 30 days are shown.)

---

## 5. Brand & Store `/brand`, `/brand/voice`, `/store`

**Purpose:** "What does the AI believe about my brand?"

**How the owner uses it:** reads it once after onboarding. Should correct it when it's wrong. Today they can only regenerate.

Controls:

- [ ] `Regenerate All` (submit, spends tokens) and a per-section round `⟳` "Regenerate this section" (submit, spends tokens). Not clicked.
- [ ] Sub-tab links: Brand Truth `/brand`, Copy & Voice `/brand/voice`, Store `/store`. Page `<title>`s: "Brand Intelligence" (both brand tabs) and "Store Intelligence".
- [ ] The token strip here uses a longer format: "Input: N left of M · Output: N left of M". The dashboard version says "N input · N output tokens remaining". Use one format. **(fix)**
- [ ] **Every field is editable by the owner** (inline edit + Save), and the AI regenerate never overwrites a field the owner has locked. **(fix: the old app had no edit at all)**
- [ ] Brand Truth's "No products extracted" callout has real links:
  - "connect Shopify" → `/connections`
  - "Hero Product URL in Brand settings" → a real field
  - **(fix)** In the old app both were plain text, and no "Brand settings" page with a Hero Product URL exists.
- [ ] Store tab without Shopify hides the header and sub-tabs, so the owner can't click back to Brand Truth except via the sidebar. Keep the sub-tabs visible. **(fix)**

States seen:

- "Last synced 96 days ago" / "Updated 96 days ago" on every section
- Product Intelligence empty-warning callout
- Store empty state with "Go to Connections"

Friction:

- **Wrong brand** (0.1): name, niche, market and audience describe another business. The site URL shown on New draft is another domain.
- **Contradiction:** Product Intelligence says "No products extracted", yet every product picker in the app lists ~50 products, all from the other brand.
- **Skewed voice:** Copy & Voice was learned from transactional and abandoned-cart flow templates. "PREFERRED" vocabulary includes order-confirmation phrases, and sample CTAs are checkout prompts. Owners won't spot this.
- 96 days stale, with no nudge to refresh and no auto-refresh.

Simplify:

- Merge Brand Truth and Copy & Voice into one "Brand profile" page with editable sections and a per-section "Ask AI to redo" button.
- Show a big banner when the brand profile's domain doesn't match the connected Klaviyo account's website or organisation name.
- Make Store part of Dashboard once Shopify exists.

---

## 6. Campaign Agent planner `/campaign-agent`

**Purpose:** "My month at a glance: what's sent, scheduled and planned."

**How the owner uses it:** opens it weekly, flips months, opens chips, adds sends, generates a month.

Controls and behaviour:

- [ ] Month arrows are links `?m=YYYY-MM`. A "Today" link appears only when viewing another month. (new)
- [ ] The sync label next to the month reads "Syncing", then a green italic "Loaded". (new: the "Loaded" state)
- [ ] **Report ▾** has links, not buttons:
  - Excel → `/campaign-agent/report.xls`
  - CSV → `/campaign-agent/report.csv`
  - Word → `/campaign-agent/report.xls?as=doc`
  - None of them carry `?m=`, so they likely export a fixed period, not the viewed month. **(fix: export the viewed month and say which month in the file name)**
  - Not downloaded.
- [ ] Status filter (All / Draft / Assigned / Scheduled / Sent) and channel filter (All / Design / Text / SMS) **combine (AND)**.
  - A `✕ Reset` button appears once any filter is not "All". (new)
  - Filters are not saved in the URL. Save them, so links and Back keep them. **(fix)**
  - When no chip matches, show an empty message on the calendar. **(fix: the old grid just went blank)**
- [ ] Active filter and view pills keep a readable label. **(fix: white-on-white bug, confirmed on Draft, Text Email and Table)**
- [ ] Holiday chips stay visible whatever the filter (keep).
- [ ] Synced Klaviyo chips:
  - link to `/campaigns/:id`
  - tooltip "<name> · Klaviyo: Sent at HH:MM" or "· Klaviyo: Cancelled at HH:MM (click to edit in Klaviyo)"
  - **(fix)** HH:MM was "17:11" on every chip. Show the real send time with timezone.
- [ ] Local draft chips:
  - link to `/campaign-drafts/:id?from=YYYY-MM`
  - tooltip "<title> · drag to reschedule"
  - dragging moves the draft to the target day and saves it (new; not tried because it writes)
  - after a drag, show a toast with Undo
- [ ] A cell that holds a local draft does not show "+ plan send" (seen on the draft's day). Allow several sends per day, or explain the limit. (new)
- [ ] Past days still offer "+ plan send". Block it or ask "This day has passed. Plan anyway?" **(fix)**
- [ ] A draft dated in the past that was never sent is flagged as "Missed" or "Overdue". **(fix: the old app kept it as a normal grey Draft)**
- [ ] Klaviyo campaigns with status DRAFT (no send time) appear somewhere, e.g. an "Unscheduled" tray under the calendar. **(fix: they appeared nowhere)**
- [ ] Table view columns: **WHEN · <TZ>** / TITLE / CHANNEL / OFFER / DISCOUNT CODE / STATUS (lowercase pill, e.g. "draft") / actions **Open** · **Delete** (danger).
  - Delete must confirm.
  - The table must include synced Klaviyo sends, like the calendar. **(fix: the old table showed only local drafts)** (new: exact columns and the Delete action)
- [ ] View toggle (Calendar / Table) is client-side and not in the URL. Save it per viewer. (minor)
- [ ] Platform holidays are US-centric (Veterans Day, Thanksgiving…) for a brand outside the US. Pick the holiday set by the brand's country or let the owner choose. **(fix)**

Modals (behaviour beyond the spec):

- [ ] **Your holidays & events** has no Notes field, while the full page does. Add notes to the modal, or link to the page for notes. Date input uses the browser locale (dd/mm/yyyy was seen).
- [ ] **Launch a multi-day event** opens with the pre-seeded user bubble and question 1 chips.
  - Cancel with nothing answered closes with no confirm (verified).
  - The scripted questions never ask for a **start date**. Ask "When does it start?" or use the viewed month or clicked date. **(fix, or confirm that step 2 asks)**
- [ ] **Build the brief:**
  - the "Choose a product" toggle reveals "Select products ▾", a searchable multi-select of the catalogue (wrong-brand catalogue today)
  - toggles are independent (Choose a product + Best Sellers can both be on)
  - Continue (step 2) not explored
- [ ] **Plan send** (from "+ plan send"): not opened, because the greeting may be AI-generated and spend tokens. Behaviour per spec §6.7.
- [ ] **Competitor card ⤢** opens an in-page large preview with "Use this design". Clicking "Use this design" closes the preview and opens "Send on which day?" with the date defaulting to today. Cancel returns to the planner with no preview open.

Friction:

- The toolbar has four big actions with similar wording ("Holidays & Events", "Launch a multi-day event", "Generate Campaign Calendar", "+ plan send").
- Two libraries (Competitor Inspirations, Our Best Picks) sit under the calendar and make the page very long. Best Picks is empty for this account.

Simplify:

- One primary "+ New" menu: Single send / Multi-day event / Fill the month with AI. Keep Holidays as a small calendar-header link.
- Move the inspiration grids off the planner. They already live in Competitor Agent and the design picker.
- Merge Campaign drafts into the planner as the Table view, with status filters (see §7).

---

## 7. Campaign drafts `/campaign-drafts`, `/campaign-drafts/new`, editor

### 7.1 List

- **Purpose:** "All my AI-drafted campaigns and their status."
- [ ] Filter links: `?status=draft|ready|pushed`. Counts show in every pill (ALL (2) / DRAFTS (2) / READY (0) / PUSHED (0)).
- [ ] An empty filtered view says "No <status> campaigns." **(fix)** The old app showed the first-run text "No campaign drafts yet — Click New campaign, give us a brief like 'Welcome new customers with a 10% off code'…" even though 2 drafts existed.
- [ ] The STATUS column shows the same status vocabulary as the filters. **(fix: the old column showed WRITING under the DRAFTS filter)**
- [ ] UPDATED uses the same relative format as the "Pick a past campaign" modal. **(fix: the list said "122 days ago", the modal "4mo ago")**
- [ ] Rows link to `/campaign-drafts/:id?view=1`. `?view=1` changes nothing visible. Drop it, or make it a real read-only mode.

### 7.2 New draft

- [ ] "Back to Campaign Agent" goes to `/campaign-drafts` (the list), not the planner. Rename it "Back to campaigns". **(fix)**
- [ ] "What we'll use as context" tiles show the template count ("219 ingested from Klaviyo"). It changed from 218 to 219 during the day, so it's live.
- [ ] "Pre-filled from your brand profile" shows INDUSTRY and SITE. The "your brand profile" link goes to `/brand`, where neither can be edited: a dead end. **(fix with editable brand fields)**
- [ ] **Recent campaign** picker lists **only local drafts** (2 rows: title, 2-line summary, "Nmo ago"), not past Klaviyo campaigns. Include sent Klaviyo campaigns. **(fix)**
- [ ] **Klaviyo template** picker:
  - lists ~219 templates, mostly named "<date time> Untitled email template"
  - each row shows "Subject: …", "From: <flow name>" and "Flow" + age
  - no search, no thumbnail
  - **(fix: add search and thumbnails, group by flow/campaign)**
- [ ] **Reference design** picker shows only "YOURS / client-upload" items (file-like names, mostly blank thumbnails).
  - The editor's design picker shows "Your Templates 0" and has competitor and best-pick tabs.
  - **(fix: one library, same tabs and same counts in both places)**
- [ ] The form has no date, channel, audience or product. Those are set in the editor. Optionally add Date + Channel here when arriving from a calendar date.
- [ ] Generate draft spends tokens (~15–30 s). Not clicked.

### 7.3 Editor `/campaign-drafts/:id`

- **Purpose:** "Finish this campaign: copy, audience, design, time. Then send it to Klaviyo."

Controls and behaviour (beyond the spec):

- [ ] Sticky bar: **Cancel** is a link to `/campaign-agent` (the planner) and does not warn about unsaved edits. **(fix: warn)**
- [ ] **Schedule** is a submit that pushes to Klaviyo (not clicked). See the Job 4 checks.
- [ ] Hidden modals present in the DOM:
  - "Assign this campaign to a designer" (full text in Job 3)
  - "Reject design & ask designer to redo" (Job 3)
  - two unlabelled confirm forms (purpose unknown; likely Schedule or Delete confirms)
- [ ] Audience card caption has two variants:
  - "9 lists (from live) · 21 segments (from live)."
  - "9 lists (from cache) · 21 segments (from cache). Click Refresh above to pull live." (new)
- [ ] Audience pickers list suppression lists first. Duplicate names appear (two segments with the same name). Show the profile count next to each and sort useful audiences first. **(fix)**
- [ ] "DON'T SEND TO" was pre-selected (1) while "SEND TO" was 0. Settings defaults apply to **new** drafts only. Make that clear ("Using your defaults from Settings").
- [ ] Featured Product shows "0 selected" while the radio "— let AI pick from broader product focus —" is selected. Say "AI picks" instead of "0 selected". **(fix)**
- [ ] FOOTER SOURCE dropdown lists ~45 Klaviyo templates and campaigns with near-identical names ("Untitled email template" ×20, repeated "Email #2/#4"). Unusable. **(fix: search plus names with the flow or campaign context)**
- [ ] Reference Design empty slot is labelled "COMPETITOR EMAIL" even when nothing is selected. **(fix: label it "No design")**
- [ ] Copy Editor:
  - turning it on puts an EDITING pill + Cancel + Apply in the preview header and changes the button to "Close Copy Editor"
  - Cancel reverts the edits (verified, nothing saved)
- [ ] Ask GROS drawer:
  - opens over the right panel, empty state "Hi! I'm GROS."
  - the conversation is not shown again on reopen (history isn't visible per draft)
  - ✕ closes it
- [ ] Best Send Time input shows "<time> — <reason>" text. "Use this" fills TIME only, not DATE.
- [ ] When an uploaded final design exists:
  - the preview shows image strips plus the green "verified" banner
  - copy fields still look editable, which is confusing because they no longer change what pushes
  - **(fix: lock the copy fields or explain "Copy is now inside the design")**

Friction:

- 13 stacked cards. The owner must scroll past long audience and product lists (all ~50 products and 30 audiences render expanded).
- Three status controls (0.3).
- The past date isn't flagged.
- Brand-wrong copy and products (0.1).

Simplify:

- Split the editor into 3 steps or tabs: **Content** (subject, preview, body, product, offers, link) → **Design** (reference, designer, review) → **Send** (audience, sender, footer, date and time, approve and schedule).
- One status chip driven by the system. Remove the manual WORKFLOW and Draft/Ready selects.
- Collapse product and audience lists to a search-and-select field showing chips of the current choices.

---

## 8. Ask GROS `/gros`

- **Purpose:** "Ask questions about my store and campaigns in plain language."
- **How the owner uses it:** opens it, sees the latest thread, types a question, reads the answer.

Controls and behaviour:

- [ ] `/gros` auto-opens the most recent thread. The empty state only shows for a workspace with no threads (not seen).
- [ ] Thread rows link to `/gros/:id` and show "🔒 N msg · N days ago".
- [ ] `+` "New private chat" is a submit that creates a thread on the server immediately (not clicked). An empty thread should not be saved until the first message. **(fix)**
- [ ] Thread title is an editable text field (rename on blur/Enter). Not edited.
- [ ] "Refresh data" (tooltip "Force GROS to re-read your latest Klaviyo + Shopify data."), "Make shared" and "Delete" are all submits. Not clicked. Delete must confirm.
- [ ] Footer "GROS knows 219 of your email templates." (live count).

Friction:

- **Wrong answers from wrong data.** In the existing thread, "show me the last campaign" was answered with a months-old **flow template**, not the most recent sent campaign. The greeting reply also named the other brand. GROS mixes up templates and campaigns, and its context is stale. **(fix: give GROS a "last sent campaigns" tool with real send dates)**
- "Private / Shared" only matters with Team members. Explain who can see a shared thread.

Simplify:

- Keep one GROS (the page) and the same GROS in the editor drawer, with the same history.
- Show suggested starter questions in the empty thread: "How did last week's emails do?", "Plan 4 emails for Black Friday".

---

## 9. Competitor Agent `/library/inspirations`

- **Purpose:** "Learn from competitors' emails and borrow ideas."
- **How the owner uses it:**
  1. adds a competitor domain → waits for it to go LIVE
  2. browses emails
  3. picks one as a reference for a campaign

Controls and behaviour:

- [ ] "Back to Campaign Agent" → `/campaign-agent` (the planner; this one is correct).
- [ ] Track input "brand.com" + Track (submit). Each domain chip has a `✕` "Remove" submit with **no confirm**. Add a confirm: "Stop tracking <domain>? Its emails will disappear from your library." **(fix)**
- [ ] Counter "41 EMAILS" in the header. With a SHOW filter on, a "28 emails" count appears next to the pills. (new)
- [ ] SHOW filter is client-side, and its active pill has the same white-on-white bug. **(fix)**
- [ ] DESIGN vs TEXT classification is unreliable: a heavily designed, image-rich email was tagged TEXT. **(fix: classify by image/HTML ratio, let the owner re-tag)**
- [ ] Clicking a card's footer opens `/campaign-drafts/copy-source/inspiration/:id/preview` in a **new browser tab**: a raw page with live links, including the competitor's unsubscribe link.
  - Campaign Agent opens the same emails in an in-page modal instead.
  - **(fix: always use the in-page preview, sandbox it, and disable links, at least unsubscribe)** (new)
- [ ] Clicking inside a card's live render does not open the email, and one render broke to a broken-image icon after a click. **(fix: one click target per card, skeleton then fallback)**
- [ ] The domain pill and the sender name can differ: one tracked domain showed emails from several different senders. Either the inbound mapping is wrong, or the pill should show the sender. **(fix: verify the mapping)**
- [ ] There is no filter by competitor and no search. Add "Filter by domain" chips (reuse the tracked-domain chips as toggles). **(fix)**
- [ ] The PENDING state has no explanation of how long it takes. Add "Usually 1–7 days after their next send".

Simplify:

- Make this the single "Inspiration library" (competitor + best picks + your uploads as tabs).
- The planner and the design picker link here instead of re-rendering grids.

---

## 10. Support `/support`

- **Purpose:** "Ask a human expert for help."
- **How the owner uses it:** clicks New Support → subject + description (+ attachment) → Create Support. Then chats in the thread.

Checks:

- [ ] Ticket cards link to `/support?t=:id`. The latest ticket is selected by default.
- [ ] Search filters as you type. The no-match state reads "No support requests match." (new)
- [ ] A **closed** ticket's composer stays enabled in the old app. Decide: disable it with "This ticket is closed — [Reopen]", or reopen it on send. **(fix)**
- [ ] The New Support modal closes with ✕ and nothing is saved (verified).
- [ ] "Create Support" stays disabled until subject and description are filled. (The old button looked enabled while empty. Not submitted.)

Friction:

- Overlap with **Request a Feature** (which has a "Bug" type).
- The button wording "Create Support" / "New Support" is odd.

Simplify:

- Rename the buttons "New request" / "Send request".
- Merge Feature Requests into Support as a request type, or keep them separate but cross-link them ("Is this a bug? Open a support ticket").

---

## 11. Settings `/settings`

- **Purpose:** "Defaults for every new campaign."

Checks:

- [x] The page opened on the **Audience** tab, so the last-used tab may be remembered. Confirm: open on Featured Product, or remember per viewer. (new)
- [x] The Timezone card shows the **same** timezone as the Klaviyo account card on the Dashboard. **(fix: the old app showed US/Pacific in Settings and an Australian zone on the Dashboard, and both claim to come from Klaviyo)** Dashboard label pending: after the owner picks another zone, the Dashboard's Klaviyo "Account" box still calls the brand zone the account's (browser lane).
- [x] The live clock ticks.
- [x] Defaults show the "1 SELECTED" counts. **Save defaults** saves every tab at once. Not clicked.
- [x] Changing a default does not change existing drafts. Say so under the Save button: "Applies to new campaigns only."

> **As built (UIR-011):** the page always opens on **Featured Product** (nothing is remembered). The clock moves on each new minute. Each audience picker shows "N selected"; **Save defaults** saves all five tabs in one go and says "Applies to new campaigns only." Defaults are stored apart from drafts, so saving never changes an existing draft. UIR-023: the brand timezone now comes from the connected Klaviyo account (with today's sample connection, the account reports the workspace timezone) and the owner can change it on this card; the card says where it came from ("From your Klaviyo account", "Chosen by you" or "Set when the workspace was created"). Settings and the Dashboard both use this one brand timezone. If the owner picks another zone, the card shows Klaviyo's and offers "Use Klaviyo's timezone". Saving the zone the brand already has changes nothing. While GROS is making a plan, the timezone cannot change (the owner is told to try again when the plan is ready). Campaigns already planned still send at the same moment. Two open windows cannot overwrite each other: the second one is told to reload.

Simplify:

- Merge Settings defaults into the editor's "Send" step as "Save as default" checkboxes. Keep this page for review.

---

## 12. Holidays & Events `/holidays`

- **Purpose:** "My brand's own dates, so the AI plans around them."

Checks:

- [ ] "Yours · 0 total" empty: "Nothing yet — add your first on the left."
- [ ] Platform list shows the next 90 days only. The heading includes "managed by Grey Retention" (white-label: show the agency's brand name, not a fixed one). **(fix for white-label)**
- [ ] The platform list matches the brand's country (see §6). **(fix)**
- [ ] An entry added here appears in the planner modal's "YOURS (N)" list and in the brief's holiday rows for its month.

Simplify:

- Keep the page, but the planner modal and this page should be the same component (same fields, including notes).

---

## 13. Connections `/connections`

- **Purpose:** "Plug in Klaviyo and Shopify."

Checks:

- [ ] Klaviyo card badge "PULLED N TEMPLATES" is a live count.
- [ ] "Klaviyo Connected" is a `button` but does nothing visible. Make it a status, not a button, or a menu with "Disconnect" behind a confirm. Not clicked.
- [ ] "Update API key" is a disclosure: password input "pk_…" + "Validate & swap key" (submit). Not used.
- [ ] Shopify "Connect Shopify →" reveals the custom-app token form (per spec). Not opened beyond the button.
- [ ] Missing Shopify breaks UTM attribution, Store and the product catalogue. Show these consequences on the card: "Without Shopify: no Store page, no UTM revenue, product list may be outdated."

Simplify:

- Replace the paste-a-token flow with Shopify OAuth if possible. The current steps are very technical for an owner.

---

## 14. Team `/team` (new: not in spec)

- **Purpose:** "Let my staff log in."

Behaviour seen:

- H1 "Team" / "Invite teammates and manage their access to your account."
- Card **Invite a teammate**:
  - "They will get an email with a link to set their password and join."
  - EMAIL (placeholder "teammate@company.com") + ROLE select (**Staff** = value `member`, **Admin** = value `manager`) + **Send invite** (submit)
  - help: "**Admin** can manage the team and everything else. **Staff** has standard access but cannot manage the team."
- Card **Members (N)**:
  - rows with avatar letter, name ("(you)" suffix for self), email
  - right side: an OWNER pill for the owner, or for others a role select + **Deactivate** (danger, submit)

Checks:

- [ ] Invite validates the email format and blocks duplicates.
- [ ] Changing a member's role select asks before saving (unknown whether the old app auto-saves on change; not touched).
- [ ] Deactivate asks for confirmation.
- [ ] The owner row can't be changed or deactivated.
- [ ] Pending invites are listed with Resend / Cancel (not seen, add).
- [ ] Rename the "Admin" role to "Manager" to avoid clashing with platform admins (the value is already `manager`). **(fix)**

---

## 15. Request a Feature `/feedback` (new: not in spec)

- **Purpose:** "Tell the agency what I want and see replies."

Behaviour seen:

- H1 "Feature Requests" / "Track what you've asked for and see replies from the team."
- Primary `+ Request a Feature`.
- Search "Search your requests…".
- Filter pills with counts: All 0 / Open 0 / Planned 0 / Done 0.
- Empty state: lightbulb, "Nothing here yet", "Ask for what would make your day — we read every request."
- Modal **Request a Feature**:
  - sub "Tell us what you'd love to see, what's broken, or what would make your day."
  - TYPE: 4 radio cards — Feature Request (default) / Improve Existing / Bug / General Feedback
  - SUBJECT (placeholder "e.g. Add a 'duplicate campaign' button")
  - DETAILS (placeholder "What were you trying to do, and what would help? The more context, the better.")
  - Cancel / **Submit**, which stays disabled until filled

Checks:

- [ ] Submit stays disabled until subject and details are filled.
- [ ] Cancel closes with nothing saved (verified).
- [ ] Requests show their status (Open / Planned / Done) and team replies.

---

## 16. Profile `/profile`

- Same as the spec.
- [x] Inline errors for a wrong current password, a mismatch, or a password under 8 characters. Not tested: it would submit.
- [x] The email field is locked, with "Contact support if you need to change it." Link "support" to `/support`. **(fix)**

> **As built (UIR-014):** each error shows under its own field: wrong current password, "The new passwords do not match.", and a too-short password. The minimum is **12** characters, the same as the password-reset form (one rule for both forms). "Too many attempts" and "too easy to guess" have their own messages. The locked email links "support" to `/support`.

---

## 17. How screens connect (data flow map)

| From                                               | Action              | To / effect                                                                       |
| -------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------- |
| Dashboard "Schedule a campaign →" / "Create one →" | click               | `/campaign-drafts/new` (no date carried)                                          |
| Dashboard "View All"                               | click               | `/calendar` (= planner)                                                           |
| Dashboard tab row                                  | click               | Klaviyo detail page. Back → `/dashboard` (tab lost)                               |
| Flow detail email step                             | click               | `/flow-messages/:id`. Back = history                                              |
| Planner Klaviyo chip                               | click               | `/campaigns/:id`                                                                  |
| Planner draft chip                                 | click / drag        | `/campaign-drafts/:id?from=YYYY-MM` / reschedule                                  |
| Planner "+ plan send"                              | click               | Plan-send chat → new draft on that date                                           |
| Planner "Generate Campaign Calendar"               | brief → Continue    | Many drafts on the viewed month                                                   |
| Planner "Holidays & Events" modal                  | Add                 | Calendar chip + brief holiday row + `/holidays` "Yours"                           |
| Competitor card (planner)                          | ⤢ / Use this design | In-page preview / "Send on which day?" → plan-send with reference                 |
| Competitor card (Competitor Agent)                 | click               | **New browser tab** raw preview (inconsistent)                                    |
| New draft "Back to Campaign Agent"                 | click               | `/campaign-drafts` (list)                                                         |
| Editor "Cancel"                                    | click               | `/campaign-agent` (planner)                                                       |
| Editor "Assign to <designer>"                      | Assign              | Designer gets the job (24 h). Admin reviews. Uploaded design replaces the preview |
| Editor "Schedule"                                  | submit              | Pushes to Klaviyo → calendar chip Scheduled → later Sent (synced)                 |
| Settings defaults                                  | Save                | Pre-fill new drafts only                                                          |
| Brand & Store                                      | Regenerate          | Context for drafts, GROS, calendar generation                                     |
| Connections Shopify                                | connect             | Enables Store, UTM attribution, real product catalogue                            |
| Store empty "Go to Connections"                    | click               | `/connections`                                                                    |
| New draft "your brand profile"                     | click               | `/brand` (read-only: dead end)                                                    |

---

## 18. Simplification decisions

1. **Merge** Campaign drafts list into Campaign Agent as its Table view (calendar | list). One place for every campaign, local or Klaviyo, with one set of status filters. Reason: the drafts list has no nav entry and the same H1, and the table showed only half the data.
2. **Rename** "Campaign Agent" in the sidebar to "Campaigns", and "Competitor Agent" to "Inspiration". Reason: owners think in campaigns, not agents. "Agent" is also used for the SOON items.
3. **Replace** the three or four overlapping status controls with **one system-driven status**: Draft → With designer → Needs your approval → Scheduled → Sent (+ Cancelled, Missed). Reason: removes WRITING / Draft / Ready / WORKFLOW confusion and makes owner approval real.
4. **Add** an explicit owner **Approve** step (copy, then design) before Schedule, with a summary confirm. Reason: product rule "owner approval is sacred". The old app had a placeholder card instead.
5. **Make** Brand Truth and Copy & Voice **editable** and merge them into one "Brand profile" page with per-section "Redo with AI". Reason: the AI profile was wrong and the owner had no way to fix it.
6. **Add** a brand-mismatch guard: warn when the brand profile, site URL or catalogue doesn't match the connected Klaviyo organisation. Reason: the old workspace ran on another brand's data unnoticed for months.
   > **As built (UIR-021):** when Klaviyo or Shopify is connected, the account reports what business it belongs to (Klaviyo: name, website, currency, country; Shopify: currency and country). The Brand page then shows "This profile may belong to a different brand" with what does not match (for example the profile says juniper-field.example but Klaviyo is Northwind Outdoor (sample) at northwind-outdoor.example). Ask GROS shows a "Brand check" note before GROS answers, with a link to the Brand profile. When more than half of the catalogue's product links point to another website, that is flagged too (only when the profile has a website). Countries are named in words ("Germany", not "DE"). Today's connections are samples: a Klaviyo key or Shopify token ending in 0000 connects another brand's sample account, so the warning can be tried; it does not change the brand timezone. The matching sample account reports no website, so correcting the profile's website never raises a false warning.
7. **Remove** "Coming soon" KPIs and the "approval workflow not yet built" card from the dashboard. Reason: half the first screen was placeholders.
8. **Move** the token strip to a small "AI credits" indicator plus a usage page. Reason: input/output token counts mean nothing to an owner.
9. **Keep** the Klaviyo detail pages but **add performance** (opens, clicks, revenue) and plain-English rules. Move JSON into Advanced. Reason: owners open them to judge results.
10. **Merge** the three "make a campaign" entry points into one "+ New" menu (Single send / Multi-day event / Fill the month with AI). Keep "+ plan send" on cells as a shortcut. Reason: four similar toolbar buttons.
11. **Remove** the inspiration and best-picks grids from the planner page. Link to the library instead. Reason: page length, duplicated UI, and an empty Best Picks card.
12. **Merge** the reference-design sources into one library component used in New draft, the editor picker and the Inspiration page, with identical tabs and counts. Reason: the old pickers disagreed (YOURS items in one, "0" in another).
13. **Split** the draft editor into Content / Design / Send steps. Collapse long lists into search-select chips. Reason: 13 stacked cards with ~80 expanded rows.
14. **Unify** timezone handling: one brand timezone from Klaviyo, shown next to every time (calendar, table, detail, schedule). Reason: three different timezones appeared on one account.
15. **Keep** drag-to-reschedule on the calendar, and add Undo. Reason: fast and owner-friendly, but it currently saves silently.
16. **Keep** Support and Feature Requests as separate pages, but **rename** "New Support / Create Support" to "New request / Send". Reason: odd wording.
17. **Rename** the Team role "Admin" to "Manager". Reason: it clashes with the platform admins who review designs.
18. **Remove** the duplicate "Connections" item from the account menu. Reason: it's already in Workspace.
19. **Sandbox** all email previews and disable links (especially unsubscribe). Always preview in-page. Reason: the Competitor Agent new-tab preview had live links.
20. **Make** platform holidays country-aware, or let the owner pick a country set. Reason: US-only holidays for a non-US brand.

---

## 19. Not explored and why

- **Any AI or token action:** Generate (GROS insight), Regenerate All / per section, Generate Campaign Calendar step 2, multi-day wizard answers and step 2, Plan send chat (opening it may call the AI for the greeting), AI Suggest, Regenerate subjects, Regenerate Copy, Generate draft, sending in Ask GROS or the editor drawer. Reason: they spend tokens or write data.
- **Any write or sync:** Refresh (dashboard and detail pages), Sync templates, Save monthly goal, Save Changes, Schedule, Assign, Reject & notify, Track or Remove competitor, Add holiday, Save defaults, Validate & swap key, Connect Shopify / Verify & connect, Send invite, member role change, Deactivate, Create Support, Submit feature request, Save profile / Update password, New private chat, Make shared, Delete thread, Delete draft, drag-to-reschedule, Report downloads, Log out.
- **Picking a source in New draft** (it pre-fills the form; picking itself may call the server) and **picking a design** in the editor (it opens the "What do you wanna copy" step, which runs vision analysis).
- **Shopify connect form** contents beyond the button (covered in the spec).
- **Ask GROS empty state:** this workspace already has a thread, and creating one writes data.
- **Designer delivered / review state** on a live draft: no draft was in "with designer" state. Behaviour was inferred from hidden forms and the uploaded-design banner.
- **Admin, designer, login, signup, onboarding and password-reset screens:** outside the owner session.
- **Mobile layout:** not checked in this pass.

Side effects of this session: none intended. The sidebar was collapsed and expanded again (it persists). One preview tab opened by a card click was closed. A test search in Support ("zzz") was typed and is client-side only.
