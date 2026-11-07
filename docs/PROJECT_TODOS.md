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
- Klaviyo only, no designer workflow, client-owned content and mandatory approval remain.

## Hard design rules and current scope

[DESIGN_RULES.md](DESIGN_RULES.md) is mandatory. Desktop/laptop first; defer dedicated mobile-layout design. Minimal motion: the owner confirmed the listed animation recipes/effects are unwanted. No decorative gradients/glow, meaningless badges/pills, nested cards, excessive typography/dividers/borders or redundant copy. See the rulebook for the full list.

## To-dos

| ID               | Task                                                                                                          | Status / evidence                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| DOC-OWNER-001    | Reconcile vision, build brief, agent entry points and historical design/roadmap references                    | Documentation prepared in this change; verify merged revision     |
| UX-RESET-001     | Map core user jobs and propose a clean information architecture                                               | Draft in [DESIGN_RESET.md](DESIGN_RESET.md); owner review pending |
| UX-RESET-002     | Explore 2–3 visual directions on the same key screen in Figma                                                 | Not started                                                       |
| UX-RESET-003     | Prototype weekly plan → segment refinement → email review → approval, desktop and phone                       | Not started                                                       |
| UX-RESET-004     | Define tokens, components, states and responsive behavior; map approved Figma components to code              | Not started                                                       |
| BLK-SCALE-001    | Define type/variant/template taxonomy, counting, provenance, deduplication and quality toward 2,000+ blocks   | Not started                                                       |
| SEG-STRATEGY-001 | Define strategic segment rules using supported Klaviyo data, refresh behavior and exclusions                  | Not started                                                       |
| SEG-EXPOSURE-001 | Define frequency window/cap, overlap resolution, priorities and external-send accounting                      | Owner decisions and design required                               |
| SEG-CHAT-001     | Design and build chat → explicit rules → estimated membership/overlap preview → approval                      | Not started                                                       |
| CHAT-CORE-001    | Define central AI workspace context, tools, evidence, permissions and quality evaluation                      | Not started; no model chosen                                      |
| PLAN-SEG-001     | Carry approved audiences and exposure constraints through strategy, calendar, QA, weekly approval and results | Not started                                                       |
| VERIFY-BASE-001  | Reconcile merged code, applied migrations, deployment and live-provider readiness before feature claims       | Not independently verified in this documentation task             |

## Research follow-ups

- [ ] Audit authenticated desktop onboarding and campaign flows in Loops and Omnisend; capture entry, setup, readiness, first draft and review states.
- [ ] Audit Klaviyo campaign/audience flow and text-to-segment review using an existing account and unsent drafts.
- [ ] Audit Milled brand search, brand archive, email detail and saved inspiration; label observed facts separately from interpretations.
- [ ] Compare friction, required fields, defaults, recovery and time to first useful result; turn findings into original journey proposals.
- [ ] Clarify dictated terms “HPicker AI”, “interman serif” and “Fallible one” before assigning a specific component/font meaning.

## Open decisions

- What counts as one reusable block: type, structural variant or template?
- What exposure cap/window and campaign priorities should apply? An average of 12 does not answer this.
- Which segment events/fields are reliably available in the initial Klaviyo integration?
- What belongs in the central chat versus dedicated campaign/audience tools?
- Which layout, component system and navigation best deliver the selected calm, minimal light direction?

## Discussion log

### 7 November 2026

Owner corrected the block target to 2,000+, introduced strategic segmentation and segment-based campaign volume, requested chat-based segmentation and central advanced AI chat, required a complete Figma UI/UX reset and asked for a uniform to-do area. The owner then authorized updating GitHub and moving into design. The owner selected a calm, minimal light interface. No replacement layout, exposure policy or new chat model has been approved.
