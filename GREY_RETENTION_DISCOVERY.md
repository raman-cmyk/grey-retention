# Grey Retention — Product and Backend Discovery

Audit dates: 2026-09-13–2026-09-14  
Target: `https://demo.gravtyretention.com`  
Scope: authenticated client workspace, super-admin console, and public/auth surfaces, explored read-only with credentials supplied by the workspace owner.

No credentials, CSRF values, API keys or suffixes, Shopify tokens, session cookies, raw support conversations, private Admin's Take text, or raw private customer records are stored in this document.

## Executive model

Grey Retention is a server-rendered, multi-tenant retention-marketing operations product. It combines:

- Klaviyo analytics and resource browsing;
- brand and copy intelligence generated from store/email context;
- AI-assisted campaign planning and content generation;
- campaign workflow, scheduling, audience selection, and design handoff;
- competitor newsletter collection and reference-pattern extraction;
- Shopify catalog/order/customer integration;
- tenant team, support, feature-request, profile, and integration administration.

A separate super-admin application operates the platform itself: tenant onboarding and integration oversight, prompt and model governance, spend controls, knowledge injection, global templates and competitor-email curation, package management, designer operations, support, reporting, provider settings, and cron/job diagnostics.

The central object is a campaign draft. Calendar planners create drafts; brand/store/Klaviyo data supplies context; competitor and curated references shape the creative; GROS assists with strategy and edits; designers can be assigned; approved work is scheduled or pushed toward Klaviyo.

## Architecture observed from the deployed application

- Server: LiteSpeed.
- Rendering: server-rendered HTML with inline JavaScript; this is not a conventional SPA.
- Backend style: a custom PHP view layer is confirmed by deployed source comments naming `views/client/campaigns/show.php`, `views/client/calendar/index.php`, and the `_campaign_modal.php` partial. Laravel-like conventions are still suggested by `_token` CSRF fields, route structure, redirects, session-authenticated forms, and same-origin AJAX, but the exact routing/framework package cannot be proven from the frontend.
- Authentication: cookie/session based. Authenticated AJAX uses `credentials: same-origin` and CSRF form data. Client and admin authentication use separate cookies: `gr_client_sid` and `gr_admin_sid`. Both were issued with `Path=/`, `HttpOnly`, `Secure`, `SameSite=Lax`, and a 7,200-second maximum age; cookie values were not retained.
- Every observed POST form across client auth, admin auth, tenant settings, integrations, team, support-related screens, campaign drafts, brand regeneration, competitor tracking, and flow-template syncing included an `_token` CSRF field.
- Response caching: authenticated pages and all sampled JSON endpoints return `no-store, no-cache, must-revalidate`, legacy expired `Expires`, and `Pragma: no-cache`, with no ETag, Last-Modified, Age, or external-cache header. Any speed-up is therefore internal application/server caching rather than browser or intermediary caching. A repeated month-intake request dropped from roughly 214 ms to 55 ms during the audit; the Klaviyo-month endpoint repeatedly returned in roughly 50–60 ms, matching the deployed cache comments.
- UI stack:
  - an internally named “Ethos Minimal” visual system described in the HTML as Apple-inspired charcoal plus system blue;
  - local compiled Tailwind asset: `/assets/tailwind.min.css?v=b15199`;
  - Inter and Material Symbols from Google Fonts;
  - SweetAlert2 from jsDelivr;
  - extensive page-specific inline JavaScript.
- External runtime/resource inventory across 13 representative authenticated screens found no analytics, error-monitoring, or telemetry script. The only external executable script was SweetAlert2 from jsDelivr; Google Fonts supplies Inter and Material Symbols. Campaign/reference imagery is loaded from Klaviyo’s CloudFront host, Iterable’s public email library, and `data.getredo.com`, in addition to the tenant’s own storefront links.
- Browser persistence: no application keys were populated in the inspected session, but deployed code uses `localStorage` for `gr-sidebar-collapsed`, per-navigation-group expansion under `gr-nav-{group}`, and per-draft GROS transcripts under `gros-chat:{draft_id}`. The GROS transcript is capped at 30 turns locally.
- No cookies were readable through `document.cookie` in the authenticated context, matching the confirmed HttpOnly configuration.
- AJAX styles:
  - JSON GET endpoints for planner intake, calendar sync, cards, libraries, and support polling;
  - CSRF-protected `POST` requests using `FormData` or URL-encoded bodies;
  - JSON response envelopes commonly use `ok`, `message`/`error`, and domain payload fields.
- Calendar/Klaviyo loading is intentionally nonblocking: the controller renders the calendar without a synchronous Klaviyo call, then the client requests `/campaign-agent/klaviyo-month.json`. Deployed comments describe roughly 50 ms cache hits, server-side completion on misses, a loading indicator after 600 ms, and a 12-second client abort that leaves the calendar usable.
- The heaviest screens ship most application logic inline rather than in versioned application bundles. Approximate rendered HTML payloads observed:
  - Campaign Agent: 686 KB HTML, including about 380 KB of inline JavaScript and 96 KB of inline CSS;
  - campaign draft editor: 350 KB HTML, including about 76 KB of inline JavaScript;
  - competitor library: 132 KB HTML;
  - settings: 114 KB HTML.
- Admin/client separation: `/admin/templates` redirects the client session to `/admin/login`; client credentials do not authenticate there. A separately supplied super-admin account authenticated successfully and was used for the admin-console portion of this read-only audit. The client and admin sessions remained independently scoped.
- Transport/deployment: the origin serves HTTP/2 and advertises HTTP/3/QUIC through `Alt-Svc`. Public DNS resolved to `190.92.174.128` during the audit. TLS used a Let’s Encrypt YR1 certificate covering both `demo.gravtyretention.com` and `www.demo.gravtyretention.com`, valid from 2026-07-18 through 2026-10-16.
- Method dispatch is strict but non-self-describing: `HEAD` on sampled working GET pages and `OPTIONS` on all 86 concrete route contracts tested returned the product’s HTML 404 response, with no `Allow` header. Accordingly, ordinary GET probes—not HEAD—are required for health checks, and the deployment does not expose CORS/preflight metadata on these same-origin routes.
- Unauthenticated requests to protected HTML and JSON paths redirect to an HTML login page, including when `Accept: application/json` is sent. Client routes redirect to `/login`, admin routes to `/admin/login`, and designer routes to `/designer/login`. API-style callers must detect the redirect/final content type rather than expecting a JSON `401` envelope.
- No standalone public API root was exposed: authenticated and unauthenticated GETs to `/api` and `/api/v1` returned the same HTML 404 response. The observed JSON endpoints live inside the ordinary authenticated web-route families.

## Product navigation

### Main client navigation

- Dashboard
- Brand & Store
- Campaign Agent
- Ask GROS
- Competitor Agent
- Support
- Settings
- Holidays & Events
- Connections
- Team
- Request a Feature
- Profile (account menu)

### Announced but unavailable agents

These appear in the Agents menu as “Soon” and have no client links:

- List Health
- Bill Optimizer
- Flow Audit
- Deliverability
- A/B Test Monitor

## Public and authentication routes

| Method | Route | Purpose / result |
|---|---|---|
| GET | `/` | Redirects unauthenticated users to `/login`. |
| GET/POST | `/login` | Client email/password login. |
| GET/POST | `/forgot-password` | Email-based reset-link request. |
| GET/POST | `/signup` | Two-step onboarding; observed step 1 captures account/profile fields. |
| GET/POST | `/admin/login` | Separate admin-console authentication. |
| GET/POST | `/designer/login` | Separate designer authentication. |
| GET | `/designer/dashboard` | Protected designer workspace; redirects unauthenticated users to `/designer/login`. |
| POST | `/logout` | Client logout. |

Signup step 1 fields: name, optional job title, email, optional phone, password, password confirmation, and “how did you hear about us?” source. The page advertises step 1 of 2; step 2 is only reachable after creating an account, which was not done during this read-only audit.

Observed public placeholders/broken routes:

- `/register` returns 404; the real registration route is `/signup`.
- `/privacy` returns 404.
- `/terms` returns 404.
- `/favicon.ico` returns 404.
- Designer-login Privacy and Terms links are literal `#` placeholders rather than deployed legal pages.
- Footer “Privacy” and “Terms” items therefore do not currently resolve to deployed pages.

## Dashboard and Klaviyo explorer

### Routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/dashboard` | KPI overview and resource explorer. |
| GET | `/dashboard?tab=overview` | Overview tab. |
| GET | `/dashboard?tab=lists` | Klaviyo lists. |
| GET | `/dashboard?tab=segments` | Klaviyo segments. |
| GET | `/dashboard?tab=campaigns` | Klaviyo campaigns. |
| GET | `/dashboard?tab=flows` | Klaviyo flows. |
| GET | `/dashboard?tab=metrics` | Klaviyo metrics/events. |
| GET | `/dashboard?attr=klaviyo` | Klaviyo campaign/flow revenue attribution mode. |
| GET | `/dashboard?attr=utm` | Shopify UTM/email attribution mode. |
| GET | `/dashboard?refresh=1` | Refreshes synced dashboard data. This was identified but not invoked. |
| POST | `/dashboard/settings/email-revenue-goal` | Saves a monthly email-revenue goal. |
| POST | `/dashboard/insight/refresh` | Generates/regenerates a GROS dashboard insight and consumes tokens. |

### Overview behavior

- KPI cards: CLTV, list growth, purchaser revenue, non-purchaser revenue, RPR, deliverability, active subscribers, and abandoned checkouts.
- CLTV and RPR are unavailable while Shopify is disconnected.
- “List Growth” currently displays the active-subscriber total plus its change versus the previous 30-day period, rather than a separate net-new-list-growth count. “Active Subs” repeats the same total and percentage.
- “Rev (Purchasers)” is presently a proxy: Klaviyo-attributed flow revenue over 30 days, with the contributing flow count. The tooltip explicitly says true purchaser segmentation still requires joining Klaviyo recipients to Shopify customer history.
- “Rev (Non-Purch)” is likewise a proxy: Klaviyo-attributed campaign revenue over 30 days, with the campaign count; true non-purchaser segmentation is not implemented.
- Deliverability is unavailable. The UI says real inbox placement requires GlockApps, Litmus, or Klaviyo Deliverability Hub and correctly rejects open rate as an adequate proxy.
- Abandoned checkouts is a rolling 30-day checkout count.
- Month-to-date email revenue has a configurable goal and Klaviyo-vs-UTM attribution switch.
- Klaviyo attribution sums flow and campaign attribution over the last 30 days, clamped to month-to-date account revenue. UTM attribution instead counts Shopify orders where `utm_source=klaviyo` or `utm_medium=email`, month to date; the disconnected workspace reports zero and “attribution not enabled.”
- Displays time to next planned email and a compact campaign calendar.
- GROS dashboard insight generation is explicitly token-metered.
- Shows package/token consumption and renewal timing.
- Shows a separate last-30-day Klaviyo email/flow revenue graph, number of active-revenue days, daily average, and best day.

### Observed tenant data summary

- Workspace/organization: DS Dreams.
- Brand shown in brand intelligence: Pholo / PHOLOH.
- Account currency: AUD.
- Dashboard brand timezone: Australia/Melbourne.
- Campaign-default timezone display: US/Pacific, indicating a data-consistency issue between surfaces.
- Package: Scale; the page showed a renewal in 10 days.
- Synced objects: 7 lists, 20 segments, 21 campaigns, 7 flows, and 60 metrics.
- Dashboard showed roughly 12.1K active subscribers and a 61% 30-day list-growth increase.

### Detail route families

| Method | Route family | Purpose |
|---|---|---|
| GET | `/lists/{klaviyo_list_id}` | List count, opt-in mode, dates, raw Klaviyo attributes, linked resources. |
| GET | `/lists/{id}?refresh=1` | Refresh one list. |
| GET | `/segments/{klaviyo_segment_id}` | Segment count/state, full rule definition, dates, raw attributes. |
| GET | `/segments/{id}?refresh=1` | Refresh one segment. |
| GET | `/campaigns/{klaviyo_campaign_id}` | Campaign send metadata, subject/preview, audience, scheduling, tracking options, message preview. |
| GET | `/campaigns/{id}?refresh=1` | Refresh one Klaviyo campaign. |
| GET | `/flows/{klaviyo_flow_id}` | Trigger, action sequence, status, dates, template-ingestion state. |
| GET | `/flows/{id}?refresh=1` | Refresh one flow. |
| POST | `/flows/{id}/sync-templates` | Ingest the flow’s templates for AI/brand-voice context. |
| GET | `/flow-messages/{klaviyo_message_id}` | Sandboxed stored-template preview with subject/from/preview metadata. |
| GET | `/flow-messages/{id}?refresh=1` | Refresh one flow message/template. |
| GET | `/metrics/{klaviyo_metric_id}` | Metric source, integration/category, tracking dates, and linked flow triggers. |
| GET | `/metrics/{id}?refresh=1` | Refresh one metric. |

Representative pages confirmed that segment definitions are rendered from the real nested Klaviyo condition JSON, campaign pages expose included/excluded audience IDs and send/tracking options, and flow pages expose ordered delay/email actions.

### Full synced-resource coverage

A second read-only sweep fetched every currently linked detail record rather than relying only on representatives:

- all 7 lists: 5 use `double_opt_in`, 2 use `single_opt_in`;
- all 20 segments: all are active; observed rule/filter `type` values include `profile-marketing-consent`, `profile-metric`, `profile-property`, `date`, and `numeric`; operators include `alltime`, `at-least`, `equals`, `greater-than`, `greater-than-or-equal`, and `in-the-last`;
- all 21 real campaigns: 18 Sent, 1 Scheduled, and 2 Cancelled; the two cancelled campaigns are marked archived, while the remaining sampled raw records are not archived;
- observed campaign send strategies include `static` and `ab_test_campaign`;
- all 21 campaigns are email-channel campaigns in the current dataset;
- observed campaign delivery/tracking fields include smart-sending, unsubscribe behavior, tracking-parameter behavior, click/open tracking, recipient-local scheduling, and immediate handling of past recipients;
- all 7 flows: all are live, all use Metric triggers, and their observed action vocabulary is Wait plus Send email;
- 20 flow-message routes exist across those flows; every one returned 200 and used one `sandbox="allow-same-origin"` preview iframe with an individual refresh route;
- all 60 metrics: 45 Klaviyo/Internal, 10 Shopify/eCommerce, and 5 API/API.

The dashboard HTML also contains a non-data string `/campaigns/show`; fetching it does not render a campaign detail. It is not included in the 21-campaign count.

## Brand & Store intelligence

### Routes and writes

| Method | Route | Purpose |
|---|---|---|
| GET | `/brand` | Brand truth/identity and product intelligence. |
| POST | `/brand/regenerate` | Regenerate all brand intelligence. |
| POST | `/brand/regenerate/identity` | Regenerate identity only. |
| POST | `/brand/regenerate/products` | Regenerate product intelligence only. |
| GET | `/brand/voice` | Copy/voice intelligence. |
| POST | `/brand/voice/regenerate` | Regenerate all voice intelligence. |
| POST | `/brand/voice/regenerate/tone` | Tone only. |
| POST | `/brand/voice/regenerate/vocabulary` | Vocabulary only. |
| POST | `/brand/voice/regenerate/examples` | Examples only. |
| POST | `/brand/voice/regenerate/audience` | Audience only. |
| GET | `/store` | Store intelligence dashboard or connection gate. |

### Brand truth

The identity model contains brand name, niche, positioning, geographic market, origin story, and target audience. Product intelligence is intended to come from a website scrape, Shopify, or a “Hero Product URL.” In this workspace, identity exists but the product-intelligence panel reports that no products were extracted.

`/brand?tab=settings` currently renders the same content as `/brand`; the “Hero Product URL” link does not expose a distinct settings UI in the observed deployment.

### Copy & Voice

The copy profile contains:

- formality, energy, warmth, and brand archetype;
- explicit “do” and “don’t” writing rules;
- preferred/avoided words;
- brand terms and signature phrases;
- sample subject lines, openings, CTAs, and sign-offs;
- primary audience persona and related audience intelligence.

Each section can be independently regenerated and appears to be included in AI campaign context.

### Store intelligence

The store screen is gated because Shopify is not connected. It promises:

- product/catalog import;
- order and customer import;
- revenue trends;
- top customers;
- out-of-stock alerts.

Planner intake nevertheless returns product choices (20 in monthly/day intake and up to 200 in event intake), so product context may also be available from an earlier sync or from Klaviyo catalog/template data. Shopify connection status and planner product availability should not be treated as the same flag.

## Connections

| Method | Route | Purpose |
|---|---|---|
| GET | `/connections` | Integration status and credential forms. |
| POST | `/connections/klaviyo/reconnect` | Validates and swaps the private Klaviyo API key. |
| POST | `/connections/shopify/save` | Verifies and saves Shopify domain and Admin API token. |

Klaviyo is connected and the current page reported 188 pulled templates. Its advertised uses include flows/segments, CLTV, and deliverability. The reconnect flow validates a replacement key before overwriting the current one.

Shopify is disconnected. The requested scopes/read capabilities include products, orders, customers, and analytics; it is also described as enabling discount-code creation.

## Campaign Agent and calendar

### AI package and quota behavior

The Scale package maintains separate input- and output-token balances and exposes renewal timing. Planner intake treats quota exhaustion as backend state rather than merely presentation: month and day intake can return `out_of_tokens`, with `cycle_ends_at` used to render the renewal message. Generation code also anticipates an HTTP 402-style exhausted-balance failure and an `{ok:false, message|error}` JSON envelope.

Brand Truth and Copy/Voice full regeneration warn that they replace all four generated cards, take roughly 20–40 seconds, and deduct from the active package. Design-pattern analysis advertises roughly 5–15 seconds. The UI discloses that tokens will be deducted but does not show an operation-specific estimate or dry-run price before execution.

### Primary screens and exports

| Method | Route | Purpose |
|---|---|---|
| GET | `/campaign-agent` | Calendar/planner UI. |
| GET | `/campaign-agent?m=YYYY-MM` | Month navigation. |
| GET | `/campaign-agent?use_inspiration={id}` | Opens Campaign Agent with a competitor inspiration deep-linked/preselected. |
| GET | `/campaign-agent?use_template={id}` | Opens Campaign Agent with a reference/template deep-linked/preselected. |
| GET | `/calendar` | Alias/entry point rendering the same Campaign Agent UI. |
| GET | `/campaign-agent/report.xls` | Excel-format report export. |
| GET | `/campaign-agent/report.csv` | CSV report export. |
| GET | `/campaign-agent/report.xls?as=doc` | Word-format report export. |

Calendar capabilities:

- calendar and table views;
- filters for Draft, Assigned, Scheduled, and Sent;
- channel filters for design email, text email, and SMS;
- drag/reschedule behavior;
- per-day planning;
- month-plan generation;
- multi-day event planning;
- competitor and curated-reference pickers;
- holidays/events surfaced in planning;
- Klaviyo sends injected into the calendar;
- report export.

Export implementation details:

- all three formats contain Sales Summary, Campaign Performance, and Top Sold Products (last 90 days);
- campaign columns are Campaign, Sent, Open rate, Click rate, Revenue, and Recipients;
- product columns are Product, Units, and Revenue;
- CSV is genuine UTF-8 comma-separated text;
- the `.xls` and `.doc` downloads are the same HTML document served with different legacy Excel/Word MIME types and filenames, not native XLS/DOC binaries;
- in the observed export, campaign data was marked temporarily unavailable from Klaviyo and product sales data was empty, even though the dashboard could enumerate 21 campaigns and displayed attributed revenue. The export and dashboard therefore do not currently share a consistent data-availability path.

### Monthly planner backend

| Method | Route | Purpose |
|---|---|---|
| GET | `/campaign-agent/plan-month/intake.json?m=YYYY-MM` | Loads month, holidays, offers, products, references, connection/context flags, and token state. |
| POST | `/campaign-agent/plan-chat/message` | Conversational month-planning turn using history, brief, and current calendar. |
| POST | `/campaign-agent/plan-update` | Persists date/time/topic/offer/reference edits to a planned draft. |
| POST | `/campaign-agent/plan-add` | Adds one or more AI-planned drafts. |
| POST | `/campaign-agent/plan-month` | Generates a proposed month plan. |
| POST | `/campaign-agent/plan-commit` | Commits the reviewed month plan into campaign drafts. |

Observed request fields:

- plan chat: `history`, `brief`, `calendar`;
- draft update: `draft_id`, `discount_code`, `title`, `planned_date`, `planned_time`, `directive` (the same endpoint is also used for smaller single-field updates);
- add campaigns: `channel`, `count`, `year`, `month`, optional `offer`;
- generate month: `year`, `month`, `email_count`, `email_text_count`, `sms_count`, `product_focus`, `selected_product_ids[]`, `holiday_ids[]`, `offer_labels[]`, `focus_this_month`;
- commit month: `year`, `month`, serialized `rows`.

Observed monthly intake schema includes:

- `month`, `month_label`;
- holidays;
- active offer labels;
- up to 20 product options;
- 47 reference records in the observed workspace;
- `has_shopify`, `has_brand_truth`;
- `out_of_tokens`, `cycle_ends_at`.

The month-chat response contract includes `ok`, `message`, optional structured `blocks`, `ready_to_generate`, `strategy_summary`, `offer_labels`, `calendar`, `codes_needed`, structured `actions`, legacy `options`, and `recommended_value`. Calendar rows carry `row_id`, date/time, channel, topic, angle, offer, code requirements/value, and an offer-rationale tag. Supported server-suggested action types visible in the client are `add_campaigns`, `delete_campaign`, `set_discount`, `rename_campaign`, `reschedule_campaign`, and `set_directive`; destructive or additive proposals render explicit confirmation controls.

Across planner chats, structured UI actions can be `options`, `multi_select`, or `product_select`, with option labels/values/hints/recommendation flags and optional prompt/submit labels. Legacy flat `options` remain supported for backward compatibility.

### Day planner backend

| Method | Route | Purpose |
|---|---|---|
| GET | `/campaign-agent/plan-day/intake.json?date=YYYY-MM-DD` | Loads day-specific holidays plus products, templates, inspirations, references, best picks, and token/context flags. |
| POST | `/campaign-agent/plan-day/chat` | Conversational day-planning turn. |
| POST | `/campaign-agent/plan-day` | Creates a campaign draft from the day plan. |

Day-chat requests submit the target `date` and serialized `history`. Draft creation can submit `send_date`, `channel`, `product_focus`, `focus_today`, `title`, `discount_code`, `planned_time`, selected product IDs, holiday ID, offer labels, reference ID/kind, and copy mode.

Observed day intake contained 20 products, 41 competitor inspirations, 47 references, no tenant templates, and no best picks.

The day-chat response uses `ok`, `message`, optional `blocks`, `fields_known`, structured/legacy choices, `recommended_value`, and `ready_to_plan`. `fields_known` can settle the normalized channel (`email`, `email_text`, or `sms`), product focus (`top_performers`, `new_arrivals`, or `clearance`), offer, brief, and a specifically named catalog product. When launched from a competitor inspiration, the client injects its analysis into the first assistant turn and carries that design into the first generated row unless the operator replaces it.

### Multi-day event planner backend

| Method | Route | Purpose |
|---|---|---|
| GET | `/campaign-agent/event-chat/intake.json` | Loads product options and Shopify status. |
| POST | `/campaign-agent/event-chat/message` | Conversational sequence planning/editing. |
| POST | `/campaign-agent/event-chat/generate` | Commits/generates the multi-day event campaign sequence. |

The event intake exposed up to 200 product records in the observed workspace.

The event chat submits serialized `history` and `sequence`; final generation additionally submits `event_name`.

Each event-sequence row sent back to the agent includes ID, date/time, server and display channel, topic/type, offer, strategic note, discount code, reference URL/ID/kind, and a `design_selected` flag. Responses use `ok`, `message`, optional `blocks`, `fields_known`, options/actions, `sequence`, `action_taken`, and `ready_to_generate`. Recognized sequence-changing `action_taken` values are `propose`, `generate`, `add`, `remove`, `edit`, and `regenerate`. The client trusts the returned sequence as authoritative; for multi-send plans it renders a channel-mix form whose design-email, text-email, and SMS counts must sum to the AI-set send count.

### Calendar synchronization and related actions

| Method | Route | Purpose |
|---|---|---|
| GET | `/campaign-agent/klaviyo-month.json?m=YYYY-MM` | Returns Klaviyo campaigns grouped by date, status, time, edit URL, and external-opening behavior. |
| POST | `/campaign-agent/reference-upload` | Uploads a reference design image. |
| POST | `/campaign-agent/inspiration-analysis` | AI-extracts strategy/analysis from a competitor inspiration. |
| POST | `/campaign-agent/holidays` | Adds a planner-visible holiday/event via AJAX. |
| POST | `/campaign-agent/holidays/{id}/delete` | Removes a planner-created holiday/event. |

## Campaign draft workspace

### Main route and data model

| Method | Route | Purpose |
|---|---|---|
| GET | `/campaign-drafts/{draft_id}` | Full campaign authoring/review workspace. |
| POST | `/campaign-drafts/{draft_id}` | Saves campaign metadata, audience, creative settings, and content. |
| GET | `/campaign-drafts/{draft_id}/card.json` | Compact workflow/card state used by the calendar dialogs. |
| POST | `/campaign-drafts/{draft_id}/delete` | Deletes a draft. |

The main save payload can include:

- title, status, channel, workflow stage;
- planned date/time and combined send timestamp;
- AI-suggested best-send-time note;
- selected/custom subject and preview text;
- campaign brief;
- featured product;
- included and excluded segment labels;
- sender label and primary URL;
- footer inclusion and source template;
- active offer labels;
- ordered AI email sections;
- reference design ID;
- HTML body;
- schedule-after-save intent.

The draft has two related state fields:

- editable content status: `draft` or `ready`;
- workflow stage: `draft`, `assigned_to_designer`, `pending_approval`, `scheduled`, or `sent`.

The card API also derives a separate presentation state, `display_stage`. Values proven from current data and deployed branching logic are `writing`, `assigned_to_designer`, `needs_redesign`, `design_ready`, and `scheduled_in_klaviyo`. These are not interchangeable with the stored workflow-stage values.

Observed channel values are `email` (Email Design), `email_text` (Email Text), and `sms`.

### AI, reference, audience, and content actions

| Method | Route family | Purpose |
|---|---|---|
| POST | `/campaign-drafts/{id}/best-send-time-suggest` | AI-suggests time of day and rationale. |
| POST | `/campaign-drafts/{id}/regenerate-subjects` | Generates subject options. |
| POST | `/campaign-drafts/{id}/generate-copy` | Generates or regenerates campaign body copy. |
| POST | `/campaign-drafts/{id}/ask-gros` | One-off GROS question about the draft. |
| POST | `/campaign-drafts/{id}/gros-chat` | Multi-turn structured GROS editor chat. |
| POST | `/campaign-drafts/{id}/gros-action` | Applies a structured GROS edit/action. |
| POST | `/campaign-drafts/{id}/suggest-references` | Requests GROS-ranked reference/template suggestions for this draft. |
| POST | `/campaign-drafts/{id}/apply-reference` | Attaches or clears a template/inspiration reference and copy mode. |
| POST | `/campaign-drafts/extract-patterns` | Extracts layout/copy strategy patterns from a reference source. |
| GET | `/campaign-drafts/copy-source/inspiration?type=design|text` | Competitor reference library JSON. |
| GET | `/campaign-drafts/copy-source/reference` | Tenant/global reference library JSON. |
| GET | `/campaign-drafts/copy-source/inspiration/{id}/preview` | Raw/sandboxable competitor-email preview. |
| POST | `/campaign-drafts/{id}/refresh-audience` | Recalculates/refreshes audience selection. |
| POST | `/campaign-drafts/{id}/confirm-audience-send` | Confirms audience for sending. |

The embedded draft GROS client keeps up to 30 local transcript turns but sends only the latest 10 `{role,text}` turns with each request. `/gros-chat` returns an `ok` result, reply text, and optionally a `proposed_action`; proposed actions have an ID, `kind`, and JSON `params` and require explicit Confirm or Skip interaction. Confirmed actions are POSTed to `/gros-action`. Its response can provide `message`/`error`, surgical `updates` for the current form, and a `reload` flag for changes that affect rendered cards, assignments, body, status, or schedule. This embedded transcript is client-local and distinct from the separate persistent `/gros` chat feature.

The reference picker invokes `/suggest-references` once per draft-card opening. The client accepts `{ok, ranked}` where `ranked` is an ordered array keyed by reference `kind` and `id`; GROS-ranked candidates are pinned above locally scored matches. Deployed comments state that the server caches the ranking on the draft, making later openings a cache read. The audit did not invoke this action because its first call can consume AI resources or persist that cache.

Other draft workflow actions referenced by the calendar/card client:

- `/campaign-drafts/{id}/reschedule`
- `/campaign-drafts/{id}/finalize-copy`
- `/campaign-drafts/{id}/save-copy`
- `/campaign-drafts/{id}/upload-final`
- `/campaign-drafts/{id}/fix-design`
- `/campaign-drafts/{id}/cancel-assignment`
- `/campaign-drafts/{id}/approve-schedule`
- `/campaign-drafts/{id}/cancel-campaign`

These are invoked through a shared CSRF-protected draft action helper.

### Draft workflow transition model

- `writing` begins on the Copy step. `/save-copy` accepts `body_plaintext` and, for text-email editing, an optional `subject`.
- `/finalize-copy` persists `action=set`; returning to Copy uses `action=clear`. A finalized draft moves to the Design chooser unless a self-uploaded or designer-delivered final already exists, in which case it opens review.
- The Design chooser either assigns a designer or accepts `final_design` as multipart upload. `/upload-final` returns `{ok, final, slices}`; the server slices the image into email strips and applies the campaign’s primary link to each strip. The same endpoint accepts `action=delete` to remove the upload.
- `assigned_to_designer` and `needs_redesign` lock campaign editing while the designer holds the work. `design_ready` exposes review. A fix/reassign request requires substantive `fix_notes` (the client enforces at least five characters).
- Assignment cancellation sends `assignment_id` plus a required reason; the UI distinguishes a pending assignment from work already in progress and warns that the designer will be notified and asked to stop.
- Approval requires a second confirmation and calls `/approve-schedule`; the client treats token balance and Klaviyo connectivity as likely scheduling failure causes. Success advances the card to `scheduled_in_klaviyo`.
- Once scheduled in Klaviyo, the date controls are locked. Only unscheduled drafts are draggable on the calendar, and the client blocks drops into dates before the brand-timezone “today.”
- `/cancel-campaign` removes the scheduled send and is presented as irreversible; the UI promises that the selected audience will not receive it.

### Designer workflow

| Method | Route | Purpose |
|---|---|---|
| POST | `/campaign-drafts/{id}/assign-designer` | Assigns/reassigns a designer with optional owner notes. |
| POST | `/campaign-drafts/{id}/reject-design` | Rejects submitted design with required feedback. |
| POST | `/campaign-drafts/{id}/fix-design` | Requests corrections/reassignment from the calendar card workflow. |

The observed tenant had one selectable designer. The UI supports assignment notes, uploaded/final design state, approval, rejection feedback, and eventual scheduling.

### Card JSON contract

`/campaign-drafts/{id}/card.json` returns:

- draft identity, title, status, display stage/label, channel, and variant;
- subject, date/time, and human-readable schedule;
- `has_copy`, `copy_generating`, `copy_finalized`, plaintext and HTML body;
- uploaded final design metadata;
- current designer plus selectable designers and automatic designer ID;
- reference URL/kind/ID/copy mode and pattern-readiness;
- edit URL.

### Existing-draft coverage

Thirty-seven calendar months (18 before through 18 after September 2026) were scanned without mutation. Only two Grey Retention draft records were discoverable, in August and October 2026. Both returned valid card JSON and shared these traits:

- `status=draft`, display stage `writing`;
- email/design variant;
- generated copy present and not currently generating;
- copy not finalized;
- HTML reference attached with extracted patterns ready;
- no designer currently assigned, with one available designer option.

One of the two drafts has a final uploaded design; the other does not.

## Competitor Agent and reference libraries

### Routes and writes

| Method | Route | Purpose |
|---|---|---|
| GET | `/library/inspirations` | Competitor domains and captured emails. |
| POST | `/library/inspirations/domains` | Adds a competitor domain. |
| POST | `/library/inspirations/domains/{id}/delete` | Stops/removes tracking for a domain. |
| GET | `/library/best-picks` | Admin-curated drag/drop templates. |
| GET | `/campaign-agent/templates/{id}/preview` | Renders the selected Best Pick/template in the preview modal. |

Observed state:

- 6 of 10 competitor-domain slots used;
- five domains marked Live and one Pending;
- 41 captured emails: 29 design emails and 12 text emails;
- each captured item has ID, subject/name, description, domain/from name, date, type, optional image, and preview URL;
- six reference-library records were returned by the reference endpoint;
- all six returned reference records are tenant `client-upload` items with `is_global=false` and image assets;
- zero Best Picks and zero tenant templates in the visible picker.

The library supports filtering design vs text emails, viewing a rendered/raw preview, attaching a design to a campaign, and AI extracting the hook, tone, strategy, layout, or full replication pattern.

`/library/best-picks` explicitly states that admins curate templates through `/admin/templates`; accessing that route with the client session redirects to `/admin/login`. The template-preview route family is present in the deployed client, but the current tenant has no Best Picks, so no valid record could be exercised; tenant-upload reference IDs correctly returned 404 when tried against this different route family.

## Ask GROS

| Method | Route | Purpose |
|---|---|---|
| GET | `/gros` | GROS chat list/start screen. |
| GET | `/gros/new` | Dedicated new-chat screen with private/shared creation forms. |
| POST | `/gros/new` | Creates a private or tenant-shared chat. |

The workspace has no existing GROS chats. A chat can be Private (only the current user) or Shared (tenant-wide). The dedicated new-chat screen says GROS knows the brand, voice, recent emails, and 188 email templates, matching the current Connections count, and can advise on retention strategy, subject lines, segmentation, and drafting.

The post-creation chat route and message endpoints were not observable without creating a persistent chat record, so they remain the main client-side route gap.

## Settings

| Method | Route | Purpose |
|---|---|---|
| GET | `/settings` | Campaign defaults and timezone display. |
| POST | `/settings/campaign-defaults` | Saves defaults applied to new campaign drafts. |

Defaults include featured product, sender name, primary link, included/excluded audience segments, footer inclusion, and footer-source template. The timezone is described as synced from Klaviyo and not editable in Grey Retention.

## Holidays & Events

| Method | Route | Purpose |
|---|---|---|
| GET | `/holidays` | Tenant moments plus platform calendar. |
| POST | `/holidays` | Adds a tenant holiday/event. |

Fields: name, date, kind (holiday/event), annual recurrence, and notes for the AI strategist. Tenant entries appear in the calendar and planner wizards. The page also shows upcoming platform-managed events such as Halloween, Veterans Day, Thanksgiving, Black Friday, Cyber Monday, Giving Tuesday, and Hanukkah.

## Team and permissions

| Method | Route | Purpose |
|---|---|---|
| GET | `/team` | Tenant member list and invitation UI. |
| POST | `/team/invite` | Invites a user with Staff or Admin role. |
| POST | `/team/{member_id}/role` | Changes a member’s role. |
| POST | `/team/{member_id}/deactivate` | Activates/deactivates a member. |

Role model observed:

- Owner
- Admin — can manage team and all other tenant areas
- Staff — standard access without team management

The current workspace showed two members: one Owner and one active non-owner Admin.

## Support

### Routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/support` | Ticket list and active conversation. |
| GET | `/support?t={ticket_id}` | Opens one ticket. |
| POST | `/support/tickets` | Creates a ticket with optional attachment. |
| POST | `/support/send` | Sends a ticket message with optional attachment. |
| GET | `/support/poll?t={id}&after={message_id}` | Polls for new messages and status every five seconds. |
| POST | `/support/tickets/{id}/close` | Resolves/closes a ticket. |

The UI accepts image/PDF attachments, performs optimistic message rendering, and uses periodic polling rather than WebSockets. One historical closed ticket with two messages was present.

Ticket creation submits `subject`, `body`, and optional `attachment`; replies submit `ticket_id`, `body`, and optional `attachment`. Polling returns `{ok, messages, status}`. Each message object contains numeric `id`, boolean `mine`, `kind`, sender `name`, `body`, optional `attachment`, and display timestamp `at`. The existing thread’s two messages were schema-inspected without retaining their contents.

## Feature requests

| Method | Route | Purpose |
|---|---|---|
| GET | `/feedback` | Request list and status filters. |
| POST | `/feedback` | Submits feedback. |

Request types: Feature Request, Improve Existing, Bug, and General Feedback. Status filters: All, Open, Planned, and Done. Submission fields are `kind`, `subject`, and `body`; the subject is capped at 200 characters, and the client mirrors server rules by enabling submission only at four or more subject characters and ten or more body characters. No requests were present in the observed workspace.

## Profile

| Method | Route | Purpose |
|---|---|---|
| GET | `/profile` | Account information and password management. |
| POST | `/profile` | Updates name, job title, and phone. |
| POST | `/profile/password` | Validates current password and sets a new password. |

Email is locked and must be changed through support.

## Admin console and operational backend

The admin application is a separate super-admin surface, not merely an elevated client navigation. Its main routes are:

| Area | Primary route(s) | Purpose |
|---|---|---|
| Overview | `/admin/dashboard` | Tenant, user, package, MRR, provider, AI-usage, and SMTP summary. |
| Clients | `/admin/clients`, `/admin/clients/{tenant_id}` | Tenant roster, onboarding, integrations, classification, team, content state, AI activity, and token package. |
| Designers | `/admin/designers`, `/admin/designers/oversight` | Designer accounts, tenant access, assignments, SLA review, and notification delivery. |
| Prompt engine | `/admin/prompts` | Versioned prompt contracts, generation/revision, model settings, tests, healing, reset, and delete. |
| LLM controls | `/admin/llm-controls` | Per-tenant provider/model/token overrides and spend caps. |
| Email Knowledge | `/admin/email-knowledge` | Global rule/play/craft entries injected by tenant classification and AI scope. |
| Competitor inbox | `/admin/competitor-inspirations` | IMAP collection, sender mapping, classification, curation, and client windows. |
| Template library | `/admin/templates`, `/admin/templates/categories` | Uploads, best picks, library filters, and a three-level industry taxonomy. |
| Global holidays | `/admin/holidays` | Platform events inherited by every tenant. |
| Reporting | `/admin/reports` | AI calls, tokens, cost, errors, timeouts, and projections by tenant/engine/provider. |
| Packages | `/admin/packages` | Token entitlements, prices, billing-cycle duration, default package, and assignments. |
| Settings | `/admin/settings` | Site, signup, SMTP, and AI-provider configuration. |
| Operations | `/admin/operations` | Admin accounts, roles, notifications, and Klaviyo connection tests. |
| Cron monitor | `/admin/cron-jobs` | Job definitions, recent executions, output, manual test-run controls, and queue actions. |
| Feedback | `/admin/feedback` | Cross-tenant feature-request triage. |
| Support | `/admin/support` | Cross-tenant ticket queue and live polling/replies. |
| Account | `/admin/profile` | Admin profile and password management. |

“Campaign Tracker” and “Messages” are announced as Soon and expose no working admin destinations.

### Admin dashboard and tenant operations

The dashboard reported four active tenants, five client users, four active token packages, estimated MRR of $399, SMTP configured, and no AI calls or cost in the current-month reporting window. Three providers were considered usable: Anthropic, Google, and DeepSeek.

The four tenant workspaces were GOALPINE, PHOLOH, Corvidae, and HeavenTallow. All were active and Klaviyo-verified. PHOLOH showed 100% onboarding and a Scale package; the other three showed 90% and Trial. Across their tenant-detail pages Grey Retention had ingested 444 Klaviyo templates: 26, 188, 63, and 167 respectively.

`/admin/clients` supports search plus all/active/incomplete/paused filters. `/admin/clients/{id}` combines:

- package and separate input/output token balances;
- team membership and onboarding completion;
- masked Klaviyo/Shopify connection state;
- Brand Truth section status and recent Klaviyo templates;
- recent AI calls and costs;
- brand type and shared-industry classification;
- Shopify sync controls and job history where connected;
- a per-tenant Klaviyo diagnostic view at `/admin/clients/{id}/klaviyo-debug`, including an `errors_only=1` filter.

Brand classification writes to `POST /admin/clients/{id}/brand-classification` with `industry_id` and `brand_type`. The seven brand types are impulse, drop/hype, replenishable, high-AOV, subscription, gifting, and dropship. Industry is selected from the shared template-category taxonomy and stored on the brand profile; the UI says free-text industry can be synchronized to that classification.

Corvidae was the only Shopify-connected tenant. Its connection reported API version 2026-04, Basic plan, USD currency, 52 products, no orders, and two customers. Its initial sync remained labelled “running” after roughly 102 days, while recent bulk-product, bulk-order, bulk-customer, and REST-prime jobs were failed; an earlier bulk-product job had completed and produced the 52 products. Admin controls include:

| Method | Route | Payload / effect |
|---|---|---|
| POST | `/admin/clients/{id}/shopify/sync-depth` | `sync_depth`: all, last 365 days, or last 90 days. |
| POST | `/admin/clients/{id}/shopify/trigger-sync` | Starts a Shopify synchronization. Not invoked. |
| POST | `/admin/clients/{id}/brand-classification` | Saves shared industry and brand type. Not invoked. |

HeavenTallow was marked grandfathered with Shopify optional. The other unconnected tenants simply showed no Shopify connection.

### Klaviyo diagnostics

The per-tenant debug screens expose the last 100 calls, one-hour and 24-hour counts, success rate, average latency, failed endpoints, sanitized parameters, and response excerpts. At observation time:

| Tenant | Calls in 24h | Failed | Success | Average latency |
|---|---:|---:|---:|---:|
| HeavenTallow | 85,919 | 480 | 99.4% | 586 ms |
| Corvidae | 54,720 | 480 | 99.1% | 591 ms |
| PHOLOH | 23,575 | 491 | 97.9% | 553 ms |
| GOALPINE | 22,057 | 480 | 97.8% | 634 ms |

All four tenants repeatedly failed the same request: `GET campaigns/` with email-channel filtering and `page[size]=50`. Klaviyo returned HTTP 400 because `page_size` is not valid for the campaign resource. Roughly 480 failures per tenant/day equals one failure every three minutes; that matches the observed real template-sync cadence, so the template sweep is the likely caller. That caller attribution is an evidence-based inference, not a server-source confirmation.

Successful diagnostic records also showed flow, flow-action, flow-message, and template retrieval families. Credentials and masked key suffixes were deliberately not retained.

### Admin's Take and prompt injection

Each tenant has private operator guidance at `/admin/clients/{id}/admin-takes`. The action family is:

| Method | Route | Purpose |
|---|---|---|
| GET | `/admin/clients/{id}/admin-takes` | Lists private prompt guidance. |
| GET | `/admin/clients/{id}/admin-takes/new` | New-entry form. |
| POST | `/admin/clients/{id}/admin-takes/create` | Creates an entry from `category`, `body`, `is_active`, and `sort_order`. |
| GET | `/admin/clients/{id}/admin-takes/{take_id}/edit` | Edit form. |
| POST | `/admin/clients/{id}/admin-takes/{take_id}/update` | Updates an entry. |
| POST | `/admin/clients/{id}/admin-takes/{take_id}/delete` | Deletes an entry. |

The eight categories are campaign direction, copy voice, product focus, segment and audience, offer and promo posture, deliverability status, flow notes, and what has proven effective. PHOLOH had one active entry in each category; the other three tenants had none. The private bodies were not retained.

The application injects these entries verbatim through `PromptInjection::forTenant()`. `/admin/prompts/inject-preview` explains why knowledge entries match or are excluded and displays the exact composed Email Knowledge and Admin's Take blocks for three scopes:

- `calendar_build`;
- `campaign_draft`;
- `gros_chat`.

PHOLOH's eight Admin's Take entries appeared in all three scopes. The sole global Email Knowledge entry matched `calendar_build` only and was excluded from the other two. Matching considers brand type, shared industry, active state, and scope.

### Prompt engine and model governance

The prompt registry contained 34 active, healthy contracts. The exposed runtime symbol is `PromptRunner::run`. A prompt record carries key, label, description, system prompt, user template, declared variables, provider, model, temperature, maximum output tokens, active state, JSON/text expectation, and version history. Observed versions ranged from v1 through v36.

The 34 keys were:

```text
admin.prompt_generate                 admin.prompt_revise
brand_truth.identity                  brand_truth.offers
brand_truth.products                  brand_truth.social_proof
brand_voice.audience                  brand_voice.examples
brand_voice.tone                      brand_voice.vocabulary
campaign.ask_gros_inline              campaign.best_send_time
campaign.draft                        campaign.event_chat
campaign.event_generate               campaign.extract_everything
campaign.extract_layout               campaign.extract_strategy
campaign.generate_body                campaign.gros_chat_action
campaign.gros_copy_edit               campaign.inspiration_analyze
campaign.learn_layout                 campaign.learn_strategy
campaign.plan_chat                    campaign.plan_day
campaign.plan_day_chat                campaign.plan_month
campaign.reference_suggest            campaign.regenerate_subjects
campaign.revise                       dashboard.insight
gros.chat                             gros.chat.v1
```

Thirty expect JSON. The four text contracts are `campaign.ask_gros_inline`, `dashboard.insight`, `gros.chat`, and `gros.chat.v1`. All except `campaign.inspiration_analyze` were configured for Google Gemini 2.5 Pro, temperature 0.4, and a 50,000-token maximum. Inspiration analysis used Anthropic Claude Sonnet 4.6 with a 1,400-token maximum.

Prompt administration exposes:

| Method | Route | Behavior |
|---|---|---|
| GET/POST | `/admin/prompts` | Registry, create form, filters, and selected prompt editor. |
| GET | `/admin/prompts?key={key}` | Opens one contract. |
| POST | `/admin/prompts/{key}` | Saves a new version. |
| POST | `/admin/prompts/{key}/reset` | Restores the shipped default, including text/model/settings. |
| POST | `/admin/prompts/{key}/delete` | Deletes a contract; UI warns wired agents will break. |
| POST | `/admin/prompts/{key}/test` | Executes with supplied variable values and returns provider/model, tokens, latency, and JSON/text or an error. Not invoked. |
| POST | `/admin/prompts/{key}/heal` | Synchronizes declared variables with placeholders found in the prompt. |
| POST | `/admin/prompts/generate` | AI-generates label, description, system/user prompts, and variables from `intent`, `key_name`, and `expects_json`. Not invoked. |
| POST | `/admin/prompts/revise` | AI-revises a contract from `key_name` and `instruction`, reporting dropped variables. Not invoked. |
| POST | `/admin/prompts/bulk-llm` | Version-bumps selected `keys[]` with provider, model, temperature, and max-token settings. |
| GET | `/admin/prompts/inject-preview` | Composes and diagnoses tenant/scope knowledge blocks. |

Tenant-level controls live under `/admin/llm-controls/{tenant_id}` with a corresponding clear action. Fields are `provider_override`, `model_override`, `max_tokens_override`, daily and monthly USD spend caps, and an operator note. Overrides apply to every AI call for the tenant. Effective maximum output is the lower of the prompt and tenant limits; token-package balances remain an independent gate. Spend caps reset at UTC midnight and month boundary.

All four tenants were pinned to Google Gemini 2.5 Flash-Lite. Max-token overrides were 200,000 for Corvidae and GOALPINE, 5,000 for HeavenTallow, and 600,000 for PHOLOH. Because nearly all prompt contracts cap at 50,000, the three higher tenant values do not increase those prompts; only HeavenTallow's 5,000 value constrains them. PHOLOH's configured daily cap exceeded its monthly cap.

Global provider settings cover Anthropic, OpenAI, Google, xAI, and DeepSeek, including model catalogs and input/output pricing per million tokens. Stored keys existed for Anthropic, Google, and DeepSeek. OpenAI and xAI were marked active in the form but had no stored key, explaining why the dashboard counted three usable providers. Defaults were Claude Sonnet 4.5, GPT-4o, Gemini 2.5 Pro, Grok 4.3, and DeepSeek Reasoner respectively. DeepSeek's most recent verification, roughly 96 days old, failed with HTTP 402 for insufficient balance even though the provider remained active and counted.

`POST /admin/settings/test-provider` accepts a provider and returns success, model, reply, input/output tokens, or error. It was not invoked. `POST /admin/settings` also governs site name, support email, logo, global 50 MB upload maximum, Klaviyo-required/Shopify-optional signup rules, and SMTP. SMTP was configured for TLS on port 587; secrets were not inspected or retained.

### Email Knowledge, templates, and taxonomy

Email Knowledge had one active Play entry, classified to a streetwear industry and the `calendar_build` scope. Records can be Play, Craft, or Rule and include title, body, brand-type filters, industry filters, `when_to_use[]` scopes, active state, and sort order. The new/create/edit/update/delete family is rooted at `/admin/email-knowledge`; update additionally asks for confirmation. Seven brand types, 184 industries, and the three injection scopes are selectable.

The separate global library at `/admin/templates` had zero uploaded Templates, zero library-class Competitor Inspirations, and zero Best Picks. This is distinct from the 444 Klaviyo templates ingested into tenant data and the 355 emails in the competitor inbox. Upload uses `POST /admin/templates/upload` with library kind, title, category IDs, description, best-pick flag, and file. It accepts PDF, JPEG, PNG, GIF, and HTML up to 10 MB; the first category determines the primary storage folder, and Best Pick boosts client suggestions. Query filters include library tab, search, category, sender, and show count.

`/admin/templates/categories` manages a three-level, 184-entry active taxonomy with create, update, and delete actions. Category fields are name, parent, description, sort order, and active state. The 12 roots are Apparel & Fashion, Beauty & Cosmetics, Books & Media, Electronics, Food & Beverage, Health & Wellness, Home & Garden, Jewelry & Accessories, Others, Pet Supplies, Sporting Goods, and Toys & Games. Four exact leaf-name duplicates were present: Hair Care Brand – Specialty, Smart Home Brand, Event & Experience Brand, and Cycling Brand.

### Competitor-inspiration collection

The admin competitor inbox is backed by a shared Gmail/IMAP collector using an app password. At audit time it had processed through UID 369 and stored 355 inspirations, 24 sender identities, 11 tenant-domain requests, and 20 active sender/domain mappings. The configured client window was 20, with an allowed range of 10–50. The collection credential was not exposed or retained.

The interface loads 60 records at a time, sorts design-led versus text-led email, allows manual correction, and provides a curator description capped at 1,000 characters. GROS uses that description to match inspiration to campaign title/goals. The first sender mapping activates a tenant request and notifies the client. PHOLOH's client library showed 41 mapped items, demonstrating that the 355-message inbox is global while the client view is mapping-constrained.

| Method | Route | Purpose |
|---|---|---|
| POST | `/admin/inspirations/sync` | Runs collector ingestion. Not invoked. |
| POST | `/admin/inspirations/settings` | Saves collector email, app password, and client window. |
| POST | `/admin/inspirations/map` | Maps a sender to a requested tenant domain. |
| POST | `/admin/inspirations/unmap` | Removes that mapping. |
| POST | `/admin/inspirations/reclassify` | Re-runs classification. Not invoked. |
| POST | `/admin/inspirations/{id}/type` | Sets email type. |
| POST | `/admin/inspirations/{id}/description` | Saves curator guidance. |
| POST | `/admin/inspirations/{id}/delete` | Deletes an inspiration. |
| GET | `/admin/inspirations/{id}/preview` | Renders the collected raw-email HTML. |

### Holidays, packages, and reporting

The admin calendar contained 27 global events inherited by every client; tenants can add private events separately. `/admin/holidays` supports create and `/{id}/delete`. Fields are name, actual date, kind (cultural/holiday, event, retail, or civic), recurring flag, and notes. The supplied global set is largely US, UK, and Commonwealth oriented.

Four active packages existed:

| Package | Input tokens | Output tokens | Price/cycle | Assigned tenants |
|---|---:|---:|---:|---:|
| Trial | 200,000,000 | 500,000 | Free / 14 days | 3 |
| Starter | 2,000,000 | 500,000 | $49 / 30 days | 0 |
| Growth | 8,000,000 | 2,000,000 | $149 / 30 days | 0 |
| Scale | 25,000,000 | 6,000,000 | $399 / 30 days | 1 |

Package create/edit/default/delete actions are rooted at `/admin/packages`. Records contain name, description, input/output tokens, price in cents, currency, cycle days, sort order, and active state. Supported currencies are USD, EUR, GBP, AUD, CAD, INR, and NPR. Editing a package does not rebill currently assigned tenants until the next cycle. The Trial input allowance is 8× Scale and 100× Starter, almost certainly a configuration error rather than an intentional paid-tier progression.

`/admin/reports` supports today, yesterday, last week, this month, last month, and custom `from`/`to` ranges. Tabs cover overview, tenants, engines, and providers. It reads recorded model calls and reports call count, input/output tokens, cost, failures, timeouts, daily trend, tenant/prompt/provider splits, a 14-day average, and a 30-day linear projection with a ±25% range. The current-month view contained no calls.

### Designer operations

Two designer accounts existed: one active with three tenant assignments and one open assignment, and one disabled with one tenant and no recorded login. Designer creation accepts name, email, and `client_tenant_ids[]`; an activation email lets the recipient set a password. Admins can resend activation, toggle the account, and edit client access.

`/admin/designers/oversight` showed ten campaign assignments: one pending, two submitted, one approved, one tenant-rejected, and five cancelled. One breached its SLA and two awaited admin action. Filters cover unassigned, pending, in-progress, submitted, revisions requested, approved, rejected, tenant rejected, and cancelled.

Submitted work is served from `/designer-submissions/{id}`; the two sampled artifacts were JPEG images. Admin review posts to `/admin/designers/assignments/{id}/admin-approve` or `/admin/designers/assignments/{id}/admin-reject`, the latter with `rejection_reason`. The notification-delivery audit recorded 346 sent, two queued, and zero failed.

The authenticated designer workspace could not be audited without a designer credential. Publicly, `/designer/login` accepts email/password, `/designer/dashboard` is protected, and `/designer` plus `/designers/login` return 404.

### Admin accounts, support, and feedback

The current account was `super_admin`; the second recognized role is `admin`. `/admin/operations` supports inviting an operator by email and role, generating a seven-day acceptance link, enabling/disabling an admin, testing a tenant's Klaviyo connection, and setting notifications for new clients, Klaviyo errors, low token balance, and completed Brand Truth. A regular-admin credential was unavailable, so role differences could not be verified.

Admin support uses an incrementally loaded cross-tenant queue:

| Method | Route | Contract |
|---|---|---|
| GET | `/admin/support` | Search, status filters, list, and selected conversation. |
| GET | `/admin/support/list?offset={n}&status={status}&q={query}` | `{ok, tickets, has_more}`. |
| GET | `/admin/clients/{tenant}/support/poll?t={ticket}&after={message}` | `{ok, messages, status}`; UI polls every 20 seconds. |
| POST | `/admin/clients/{tenant}/support/send` | `ticket_id`, `body`, optional attachment. |
| POST | `/admin/clients/{tenant}/support/tickets/{ticket}/status` | Sets open, awaiting, progress, answered, or closed. |

One closed ticket existed and its schema was inspected without retaining subject, message bodies, attachments, or personal names. `/admin/feedback` supports open, triaged, in-progress, done, and won't-fix filters, but contained no records; record-level update routes therefore could not be discovered from rendered controls.

Admin profile routes are `GET/POST /admin/profile` and `POST /admin/profile/password`; email is locked, role is displayed, and password change requires current/new/confirmation fields. Admin logout is a POST.

### Cron jobs and executable topology

The cron monitor exposes five jobs and recent execution history:

| Job | Advertised cadence | Entrypoint | Function |
|---|---|---|---|
| `sync_shopify` | Every 5–15 min | `cli/sync_shopify.php` | Polls Shopify bulk operations and performs incremental REST pulls. |
| `sync_templates` | Daily 03:00 | `cli/sync_templates.php` | Sweeps Klaviyo flows/campaigns and ingests templates. |
| `warm_dashboards` | Every 5 min | `cli/warm_dashboards.php` | Prewarms active-tenant dashboards. |
| `gros_actions` | Every minute | `bin/cron.php gros_actions` | Drains operator-confirmed actions such as `push_to_klaviyo`. |
| `inspirations_sync` | Every 10 min | `bin/cron.php inspirations_sync` | Runs the IMAP inspiration collector and mapping workflow. |

`gros_actions` documents multi-worker-safe atomic compare-and-set claiming. Its Klaviyo side effect creates a campaign as Draft; the operator must finalize it in Klaviyo. Recent successful action kinds included `best_send_time` and `generate_copy`.

Actual execution history materially disagreed with the displayed schedule:

- `sync_templates` ran about every three minutes, each run taking about 4.7–4.8 minutes, so executions overlapped or remained incomplete; recent runs ended partial with four per-template errors each;
- `inspirations_sync` ran approximately every minute instead of every ten;
- `warm_dashboards` matched its five-minute claim and took about 1.4–1.9 minutes; its latest summary warmed four tenants with no failures, averaging about 21.3 seconds per tenant and peaking at 31.55 seconds;
- `sync_shopify` ran every five minutes and most recently reported zero eligible tenants;
- `gros_actions` ran every minute and usually found no work.

The page showed 50 recent cron executions and 25 recent GROS actions. `POST /admin/cron-jobs/clear` clears history; `POST /admin/cron-jobs/test-run/{job}` runs a job manually and was not invoked. Its frontend response contract includes `ok`, exit code, elapsed milliseconds, timeout usage, PHP binary, script, error, output, and optional error-log tail. The manual runner uses a 60-second timeout.

Deployment evidence identifies PHP 8.2.33 under LiteSpeed/cPanel. Exact hosting-account paths were not retained. Together with the prompt symbols, the observed backend topology includes `PromptInjection::forTenant()`, `PromptRunner::run`, the three `cli/` workers, the shared `bin/cron.php` dispatcher, an atomic GROS action queue, a Notifier delivery/audit service, synchronous authenticated controllers, and JSON helper endpoints inside the same PHP application.

## Domain model inferred from routes and payloads

Core entities:

- tenant/workspace/organization;
- user, tenant member, invite, role, active state;
- package/subscription cycle and separate input/output token balances;
- integration connection and credentials;
- brand identity, product intelligence, voice profile, audience profile;
- product/catalog item and offer label;
- holiday/event (tenant or platform managed);
- Klaviyo list, segment, campaign, campaign message, flow, flow action, metric, template;
- campaign draft, schedule, audience selection, body copy, subject option, featured product, footer source;
- design reference, competitor inspiration, pattern extraction, final design upload;
- designer assignment, owner notes, rejection/fix feedback, approval state;
- competitor tracking domain and captured newsletter;
- GROS chat/thread/message/action;
- support ticket/message/attachment/status;
- feature request/type/status/reply.
- admin account/invite/role/notification preference;
- prompt contract/version/placeholder/JSON expectation and provider-model binding;
- recorded AI call/token/cost/error/timeout and per-tenant spend cap/override;
- Email Knowledge entry, brand/industry/scope matcher, and private Admin's Take entry;
- global template/library item, best-pick flag, and three-level industry category;
- competitor collector, sender identity, tenant-domain request, and sender/domain mapping;
- token package/default/tenant assignment and billing cycle;
- Shopify bulk/incremental sync job and remote operation state;
- cron definition/run/output, GROS action/claim state, and notification delivery audit.

Identifier patterns show that Grey Retention stores both its own numeric IDs (campaign drafts, inspirations, team members, tickets, references) and external Klaviyo string IDs (lists, segments, campaigns, flows, metrics, flow messages).

## Important workflow map

1. Connect Klaviyo and optionally Shopify.
2. Sync lists, segments, campaigns, flows, metrics, templates, products, orders, and customers.
3. Generate brand identity and copy/voice context.
4. Add holidays, offers, campaign defaults, and competitor domains.
5. Use day, month, or multi-day-event planner to create proposed campaigns.
6. Select products, audiences, references, layout/copy modes, offers, send dates, and channels.
7. Use GROS to suggest strategy, subject lines, send time, structure, and copy.
8. Save a draft; optionally assign it to a designer.
9. Upload/review/fix/reject/approve the final design.
10. Confirm audience and schedule/send through the Klaviyo-connected workflow.
11. Observe campaign/flow revenue and other retention data on the dashboard.

At platform level, admins classify tenants, govern prompt/provider/cost policy, inject scoped operator knowledge, curate global assets and competitor senders, monitor integrations/jobs, manage designers/packages/admins, and operate cross-tenant support and reporting.

## Product inconsistencies and likely defects found

- Dashboard timezone says Australia/Melbourne while Settings says US/Pacific and claims the value is synced from Klaviyo.
- Brand “Hero Product URL” points to `/brand?tab=settings`, but that query renders the normal Brand Truth page; no settings UI appears.
- Store says Shopify is disconnected, while campaign intake still exposes substantial product lists. This may be valid cached/Klaviyo data, but the source is unclear to the operator.
- Privacy and Terms footer destinations are not deployed.
- `/register` is not deployed even though signup exists at `/signup` (the rendered “Create one” link correctly uses `/signup`).
- Favicon is missing.
- `/robots.txt`, `/sitemap.xml`, and `/.well-known/security.txt` all return the product’s HTML 404 page.
- No explicit CSP, HSTS, frame-options, content-type-options, referrer-policy, or permissions-policy headers were visible on sampled login/dashboard responses. This is an observation from the client-visible response, not a complete security assessment.
- Dashboard’s “Campaign approval workflow not yet built” message conflicts with the campaign-draft UI, which already exposes assignment, pending approval, rejection, and approval/schedule actions. The dashboard copy appears stale.
- “List Growth” and “Active Subs” currently render the same subscriber total and the same 30-day percentage change, so one of the KPI labels or backing calculations is misleading.
- “Rev (Purchasers)” and “Rev (Non-Purch)” are labeled as customer-history segments but are actually flow-vs-campaign revenue proxies until the Shopify recipient/customer join exists.
- Performance exports reported Klaviyo campaign data as temporarily unavailable and no product-sales rows even while the dashboard listed synced campaigns and revenue, indicating a separate or stale export data path.
- Excel and Word exports are MIME-labeled HTML rather than native Office files; this works with permissive desktop clients but may trigger format warnings or fail stricter downstream ingestion.
- The campaign draft HTML contains internal implementation/deployment comments and hardcoded release-ticket references in inline CSS/JS. These are not normally user-visible, but they increase payload size and disclose implementation history.
- Campaign Agent is a roughly 686 KB monolithic server response with several very large inline scripts (the largest observed block was about 100 KB). This creates avoidable transfer, parse, caching, testing, and maintainability costs; shared/versioned JS and CSS bundles would substantially reduce duplication.
- SweetAlert2 is loaded as `sweetalert2@11` from jsDelivr without an exact patch pin or Subresource Integrity metadata on every sampled authenticated page, creating avoidable third-party runtime drift/supply-chain exposure.
- Several AI and refresh actions consume tokens or perform potentially expensive syncs without a dry-run endpoint.
- Token-consuming actions disclose that a deduction will occur but do not show an operation-specific token estimate before confirmation.
- The reference endpoint returns six tenant-uploaded images, but visible campaign pickers report “Your Templates 0,” and deployed picker code filters non-global reference records from several views. Tenant-owned uploads therefore appear unreachable from places where the label suggests they should be available.
- Klaviyo campaign sweeps use an invalid `page[size]=50` parameter for the campaign resource, producing roughly 480 HTTP-400 failures per tenant per day. The synchronized three-minute cadence strongly implicates `sync_templates`; fixing the request should eliminate about 1,900 predictable failures every 24 hours across the current four tenants.
- The displayed cron schedules do not match execution reality. The template job advertised as daily runs about every three minutes and takes longer than its interval, while the inspiration job advertised every ten minutes runs every minute. This creates overlap, excess API traffic, and confusing operator diagnostics.
- Corvidae's Shopify initial sync remains “running” after roughly 102 days despite a series of failed bulk/REST jobs. The state machine appears unable to reconcile or terminate a stale remote operation.
- The Trial package grants 200 million input tokens, versus 25 million for Scale and two million for Starter. That inversion makes the free tier substantially larger than every paid tier and is likely a configuration mistake.
- Four industry leaves are exact duplicates in the active template taxonomy, making classification and filtering ambiguous: Hair Care Brand – Specialty, Smart Home Brand, Event & Experience Brand, and Cycling Brand.
- Three tenant max-token overrides exceed the prompt contracts' 50,000-token cap, so they are operationally ineffective; the UI does not make the resulting minimum clear. PHOLOH also has a daily spend cap greater than its monthly cap.
- DeepSeek remains active and counted as usable even though its most recent verification failed with HTTP 402 insufficient balance roughly 96 days earlier. Provider health is therefore stale and can overstate availability.
- Tenant detail calls itself a “Read-only view” while exposing brand-classification and Shopify sync mutation controls. The label understates the consequences of actions on that page.
- OpenAI and xAI can be checked active without a stored key. The dashboard's smaller “active providers” count is defensible, but the settings state is internally contradictory and should distinguish enabled from usable.
- The designer login's Privacy and Terms links are `#` placeholders, compounding the missing client legal pages.
- Admin, client, and designer samples share no-store behavior but expose no CSP, HSTS, frame-options, content-type-options, referrer-policy, or permissions-policy headers. The broader sampling strengthens the original response-hardening observation; it is still not a penetration-test conclusion.

## Coverage and remaining blind spots

Confirmed in this audit:

- every client navigation destination;
- a mechanical anchor/form/iframe/fetch/XHR/inline-route scan across 27 representative authenticated pages, reconciled against this route map;
- all dashboard tabs and every currently linked Klaviyo detail record: 7 lists, 20 segments, 21 campaigns, 7 flows, 20 flow messages, and 60 metrics;
- a 37-month campaign-calendar sweep, which found and inspected the two existing Grey Retention drafts;
- campaign calendar, draft editor, designer workflow, reference picker, and planner request routes;
- JSON shapes for planner intake, Klaviyo month sync, campaign cards, reference/inspiration libraries, and support polling;
- AI quota/error handling plus the embedded GROS transcript, proposal, confirmation, and action-response contracts;
- all visible account/workspace administration forms;
- public signup/login/reset pages;
- separate client, admin, and designer authentication boundaries;
- server-method behavior across 86 concrete route contracts, plus client/admin cookie isolation and unauthenticated redirect behavior;
- representative message and competitor-email preview pages;
- export content types for Excel, CSV, and Word;
- every main admin navigation destination and a mechanical route/control scan across 36 main and nested admin pages;
- all four tenant detail and Klaviyo-debug views, Shopify job history for the connected tenant, and tenant classification/injection controls;
- all 34 prompt contracts, their variable/JSON/model settings, versioning actions, injection preview, tenant LLM overrides, provider catalog, spend caps, and settings contracts;
- the full 355-record competitor-inspiration collection through its six pagination windows, its sender/domain mapping model, and all visible curator action routes;
- the 184-category, three-level shared taxonomy, all global holidays, all packages, and the currently empty global template library;
- designer roster, all ten assignments in oversight, sampled submission assets, and notification delivery audit;
- admin AI reports, admin/operator account controls, cross-tenant support queue/polling contracts, and feedback filters;
- all five cron definitions, 50 recent runs, 25 recent GROS actions, manual-run response contract, worker entrypoints, and observed-versus-advertised cadence;
- no-store response behavior on client/admin HTML, client/admin JSON, and designer login pages.

Remaining blind spots after both client and super-admin access:

- post-signup onboarding step 2 without creating a new account;
- post-creation GROS chat routes without creating a persistent chat;
- success/error payloads for mutation, sync, prompt-test, provider-test, and AI-generation actions, because the audit intentionally did not change data, trigger workers, call providers, or consume tokens;
- server source code, exact routing/controller implementation, database schema/migrations, provider SDK versions, environment configuration, and infrastructure beyond what the rendered deployment, diagnostics, and executable names disclose;
- authenticated designer-dashboard routes and permissions, because no designer credential was supplied;
- `admin` versus `super_admin` authorization differences, because only a super-admin session was available;
- record-level admin feedback actions, because no feedback records exist;
- edit/delete routes for an existing global template-library item, because that library is empty;
- permission differences under a Staff or tenant Admin session;
- Shopify-connected client Store Intelligence screens, because the client credential belongs to a tenant with Shopify disconnected; the admin-side connected-tenant state and job controls were still inspected.

Closing those gaps requires source/database access, an authenticated designer or lower-role account, and a disposable test tenant where writes, syncs, and paid AI/provider calls are explicitly allowed. No authorization bypass, credential extraction, destructive testing, data mutation, test email, synchronization, or paid AI call was attempted.

A targeted public search for first-party Grey Retention documentation, an indexed source repository, or additional indexed pages produced no relevant results, so deployed behavior remains the primary evidence source.

## Audit helpers

The `.audit/` directory contains the read-only browser evaluation scripts used to inventory routes, UI controls, forms, inline request endpoints, headers, JSON response shapes, and representative client/admin detail pages. They intentionally contain no credentials or saved response bodies.
