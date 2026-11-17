# Project to-dos and owner decisions

Updated: 7 November 2026. Canonical owner follow-up record for future project discussions. Technical implementation and verification history stays in [BUILD_LEDGER.md](BUILD_LEDGER.md).

## How to use

After each discussion, capture explicit owner to-dos here, deduplicate, and preserve unresolved questions. Label proposed details as proposals. Add an issue/PR link when work is assigned; record verification before marking done. Do not claim live provider health from a conversational decision.

## Confirmed direction

- Grow toward 2,000+ useful reusable email blocks. The first 20 types are the seed.
- Gmail plus-addresses are the agreed initial competitor collection approach. The owner considers that choice done; ingestion health is a separate check.
- Add strategic segmentation, a conversational segment builder and a highly capable central AI workspace.
- Support segment-specific planning at higher brand volume: 30–35 campaigns/month and roughly 12 per customer average are illustrative, not quotas or a settled cap.
- Visual direction selected: **calm, minimal light interface**. Layouts and interaction details still need design review.
- Completely rethink UI/UX in Figma. Supersede current UI and old-app parity; preserve useful underlying functionality.
- Klaviyo only, no designer workflow and client-owned content remain. **Superseded 11 Nov 2026:** no weekly approval and no human loop (D16, D17); the owner starts planning and email creation, and created emails land in Klaviyo as drafts.
- 11 Nov 2026: the agent plan v3 in [AGENT_MAP.md](AGENT_MAP.md) is the build plan (decisions D16–D24 in BUILD_BRIEF.md).
- 15 Nov 2026: design quality is the moat. Designed emails go through a design studio (designed in web code, rendered to images, interactive parts live); text emails are their own format (D25, D26 in AGENT_MAP.md). Next: a design proof of 5 rebuilt Inspiration emails before the A vs B test.
- 15 Nov 2026: after the test run, the owner picked 61 of 128 proposed additions (D27). The full list, by stage, is in [AGENT_MAP.md](AGENT_MAP.md#owner-picked-additions-15-november-2026-d27).
- 15 Nov 2026: **the owner's GROS brand guidelines are approved and must be kept intact.** They are the owner's Design System on claude.ai (draft 1, 15 November; the owner and the supervisor hold the link): a brand book (README), Rules, tokens (Urbanist 400/500/600; lime, forest, mist, white, ink, stone, signal), the mark, and ten components (Button, Input, Nav, Card, ListRow, Status, DayStrip, StepCard, Progress, EmptyState). Every app screen is built from it exactly: its tokens, its words and its components only. Nothing in it is changed, added or invented without the owner ("If a screen needs something that is not here, ask design"). A store's own colors and fonts stay inside email previews. Where older design docs disagree, these guidelines win.
- 16 Nov 2026: the owner asked to build a basic working UI now with the tokens and components in `docs/design/BRAND.md`; polish comes at the end. Lane B builds Onboarding, Home, Settings, Inspiration, Audiences and Learned. Verified so far: the tokens and the first components (UI-DS-a).
- Open questions for design (16 Nov 2026, UI-DS-b; built as noted until decided): (1) BRAND.md's DayStrip note asks for 12 px day letters but rule 12 allows nothing under 14 px: built 14 px. (2) The day strip below about 600 px wide: 15 cells get too narrow for two-digit days. (3) Planned and No email days differ by color only: a second cue? (4) Looks BRAND.md does not give, chosen for now: a failed Progress step (signal-soft row, 44 px mark, the step and its reason, one Try again), the legend's No email dot (mist with a forest ring), the step number at 15 px, the Ask GROS button (white pill, chat icon), cards side by side from 1024 px. (The step cards' radius is BRAND's own `radius-md`.)
- Open question for design (16 Nov 2026, UI-INSa; built as noted until decided): a suggested brand on Inspiration has two buttons, Follow and Hide, where BRAND.md says one action per row. Hide is the owner's rule of 16 November, so both stay for now: Follow as an outline button, Hide as a quiet one. A hidden brand cannot be shown again from the screen yet; following a sample brand by its website brings it back (real brands with REAL-01b).
- Open question for design (17 Nov 2026, UI-SETb; built as noted until decided): on Settings' Team card an invite's row has two buttons, Resend (outline) and Cancel invite (quiet), where BRAND.md says one action per row. BRAND.md has no select, so the role at invite is two buttons, Invite as Staff (main) and Invite as Manager (outline).

## Hard design rules and current scope

[DESIGN_RULES.md](DESIGN_RULES.md) is mandatory. Desktop/laptop first; defer dedicated mobile-layout design. Minimal motion: the owner confirmed the listed animation recipes/effects are unwanted. No decorative gradients/glow, meaningless badges/pills, nested cards, excessive typography/dividers/borders or redundant copy. See the rulebook for the full list.

## To-dos

| ID               | Task                                                                                                              | Status / evidence                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| DOC-OWNER-001    | Reconcile vision, build brief, agent entry points and historical design/roadmap references                        | Documentation prepared in this change; verify merged revision     |
| UX-RESET-001     | Map core user jobs and propose a clean information architecture                                                   | Draft in [DESIGN_RESET.md](DESIGN_RESET.md); owner review pending |
| UX-RESET-002     | Explore 2–3 visual directions on the same key screen in Figma                                                     | Not started                                                       |
| UX-RESET-003     | Prototype weekly plan → segment refinement → email review → approval, desktop and phone                           | Not started                                                       |
| UX-RESET-004     | Define tokens, components, states and responsive behavior; map approved Figma components to code                  | Not started                                                       |
| BLK-SCALE-001    | Define type/variant/template taxonomy, counting, provenance, deduplication and quality toward 2,000+ blocks       | Taxonomy and count proposed (#440); owner to confirm the rule     |
| SEG-STRATEGY-001 | Define strategic segment rules using supported Klaviyo data, refresh behavior and exclusions                      | Rule set proposed (#427); Klaviyo mapping is SEG-STRATEGY-001b    |
| SEG-EXPOSURE-001 | Define frequency window/cap, overlap resolution, priorities and external-send accounting                          | Owner decisions and design required                               |
| SEG-CHAT-001     | Design and build chat → explicit rules → estimated membership/overlap preview → approval                          | Not started                                                       |
| CHAT-CORE-001    | Define central AI workspace context, tools, evidence, permissions and quality evaluation                          | Not started; no model chosen                                      |
| PLAN-SEG-001     | Carry approved audiences and exposure constraints through strategy, calendar, QA, weekly approval and results     | Not started                                                       |
| VERIFY-BASE-001  | Reconcile merged code, applied migrations, deployment and live-provider readiness before feature claims           | Not independently verified in this documentation task             |
| AGENT-V3-001     | Agent plan v3 (AGENT_MAP.md): competitor tagging, brand onboarding team, 15-day strategy, 3-layer email, learning | Plan written 11 Nov; lanes restarted on it                        |
| EML-AB-001       | Test layer 3: A coded blocks vs B designed sections (design studio), one Klaviyo draft per email with A and B     | Not started; owner picks the default                              |
| PICKS-1115       | Build the 61 owner-picked additions (AGENT_MAP.md, D27), plus the resumable build job (#81) they need             | Approved 15 Nov; not started                                      |
| MEM-DONT-001     | Do's and don'ts memory from results, inspector rejections and owner edits                                         | Not started                                                       |

## Research follow-ups

- [ ] Audit authenticated desktop onboarding and campaign flows in Loops and Omnisend; capture entry, setup, readiness, first draft and review states.
- [ ] Audit Klaviyo campaign/audience flow and text-to-segment review using an existing account and unsent drafts.
- [ ] Audit Milled brand search, brand archive, email detail and saved inspiration; label observed facts separately from interpretations.
- [ ] Compare friction, required fields, defaults, recovery and time to first useful result; turn findings into original journey proposals.
- [x] Clarify the font reference: Instrument Serif is explicitly banned in DESIGN_RULES.
- “HPicker AI” is unidentified; the owner does not know the intended reference. Do not invent a component ban. “Fallible one” remains unclear.
- [x] Research Reddit complaints about generic AI-looking interfaces; findings and proposals are in [CLEAN_APP_DESIGN_RESEARCH.md](CLEAN_APP_DESIGN_RESEARCH.md).
- [ ] Compare desktop onboarding layouts using actual copy and complete states; validate with brand-owner tasks, as proposed in the research.

## Open decisions

- What counts as one reusable block: type, structural variant or template?
- What exposure cap/window and campaign priorities should apply? An average of 12 does not answer this.
- Which segment events/fields are reliably available in the initial Klaviyo integration?
- What belongs in the central chat versus dedicated campaign/audience tools?
- Which layout, component system and navigation best deliver the selected calm, minimal light direction?
- Design (proposal, UI-RES-b, 16 Nov): BRAND.md has four statuses. A Results row for a deleted or not-sent email fits none, so it shows no pill for now; and a sample draft shows Planned on Home, Plan and Results though BRAND.md's Planned means "not created yet". Does either need a fifth look?

## Discussion log

### 7 November 2026

Owner corrected the block target to 2,000+, introduced strategic segmentation and segment-based campaign volume, requested chat-based segmentation and central advanced AI chat, required a complete Figma UI/UX reset and asked for a uniform to-do area. The owner then authorized updating GitHub and moving into design. The owner selected a calm, minimal light interface. No replacement layout, exposure policy or new chat model has been approved.

### 15 November 2026 (UI direction)

Owner rejected the first black-and-white minimal UI prototype. Owner decisions: (1) brand guidelines come first, then pages are designed one at a time in Claude Design before any page is built in code; (2) the look follows his three references: soft rounded white cards on a light grey page, lime green accent with deep green, big numbers, pill navigation, a split onboarding screen with step cards and a sidebar AI workspace; (3) every page is crafted with care, not batch-produced. Proposal, not yet approved: brand guidelines draft 1 (lime `#B9F26C`, forest `#14401F`, Urbanist), Onboarding step 1 and Home. This direction uses pills, tinted cards and one decorative shape per lime card, which `docs/DESIGN_RULES.md` currently forbids; update that file once the owner approves the brand sheet. Not done: the Pinterest inspiration sweep the owner asked for.
