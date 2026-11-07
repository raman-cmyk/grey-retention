# UI/UX reset — design kickoff

Status: **owner-authorized reset; design proposals below need review.** Updated 7 November 2026.

The owner wants a super-clean product, rethought from scratch in Figma. Current layouts, old-app parity, sidebar, Exa theme, fonts and corner values are not target requirements. Keep useful product behavior, contracts and safeguards. This is a design brief, not a claim that a Figma file or redesigned UI exists.

## Mandatory design rules

Read [DESIGN_RULES.md](DESIGN_RULES.md) before any design or UI work. The owner banned decorative motion/effects and the listed generic AI design patterns. **Desktop/laptop is the current design scope; defer a dedicated mobile-layout design pass.** Preserve existing phone approval and mobile email QA capabilities.

## Owner-selected visual direction

**Calm, minimal light interface** (selected 7 November 2026). Use this direction for the first concepts. Exact layout, navigation, typography, accent palette and interaction patterns remain subject to design review; this does not restore the old Exa theme.

## Product jobs to design around

1. Set up a trustworthy brand: connect Klaviyo, confirm facts/products, set offers and audience constraints.
2. Understand the upcoming week: what is proposed, who receives each email, why and what needs attention.
3. Describe an audience in chat, inspect explicit rules and estimated membership, refine and approve it.
4. Review one email and its audience, request changes, approve the exact revision from a phone.
5. Find inspiration and useful blocks within a growing 2,000+ library.
6. Ask the central AI workspace questions and receive evidence-backed proposals connected to the same brand, campaigns, audiences and results.

## Proposed information architecture — not final navigation

- **Overview:** next actions, approval queue, next sends and exceptions.
- **Campaigns:** weekly plan, campaign review, audience allocation and approval.
- **Audiences:** strategic segments, rule builder, overlap and exposure.
- **Inspiration:** competitor emails, patterns and searchable block library.
- **AI workspace:** central conversation with contextual tools and previews.
- Brand, Connections and Settings are supporting setup areas.

Test whether AI workspace deserves a primary destination or a persistent contextual panel. Do not assume every AI feature needs its own page.

## First prototype

Use synthetic data. A founder opens next week's plan, sees total brand campaign count separately from expected per-customer exposure, asks for a lapsed-buyer segment, inspects rules and estimated membership, assigns it to a campaign, sees overlap warnings, reviews the email on a phone and approves the exact version. Show a failure/change path too.

The 30–35 monthly campaign and roughly 12/customer examples explain the problem; actual exposure rules are still undecided.

## Efficient design and AI build sequence — proposed workflow

1. Agree user jobs, information architecture and the first prototype story.
2. Explore 2–3 visual directions on the same weekly-plan screen; choose one before expanding.
3. Build a clickable Figma prototype of the core journey, including empty/loading/error states; dedicated mobile-layout design is deferred.
4. Define reusable components, semantic tokens, auto layout, states and readable layer names. These interface components are separate from the email block library.
5. Implement one working journey against existing typed services and fake providers. Compare the implementation visually and behaviorally with the approved design.
6. Expand feature by feature using the same components, acceptance criteria and evidence.

Avoid generating the whole app repeatedly. Give AI one bounded job, relevant context, owned paths and a clear acceptance check. Review integration points before splitting work. Model selection should follow quality/cost evaluations; a highly capable central chat does not mean every background task needs the most expensive model.

Figma implementation reference: [Structure your Figma file for better code](https://developers.figma.com/docs/figma-mcp-server/structure-figma-file/).

## Design acceptance criteria

- One obvious next action; progressive disclosure keeps advanced controls available without crowding.
- Campaign volume, unique audience reach, overlap and per-customer exposure are distinct quantities.
- Segment builder shows supported rules, estimated count, freshness and exclusions before approval.
- AI proposals state what changes and why; chat cannot silently send or widen audiences.
- Approval is tied to the email revision and audience the owner actually reviewed.
- The block library remains searchable/filterable at 2,000+ items; do not require browsing all items.
- Desktop planning and phone approval work with keyboard access, visible focus and readable contrast.
- A complete synthetic-data prototype is reviewed before broad UI implementation.

## Definition of ready for implementation

Owner-approved flow and visual direction; linked Figma frames/components; copy and states; responsive rules; service contracts; audience/exposure assumptions; acceptance checks. Until then, backend work can continue under the current product gates, but old-app UI polish should not consume new effort.
