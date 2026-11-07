# Research: a clean and distinctive Grey Retention

Date: 7 November 2026. Research synthesis and design proposals, not additional owner-approved bans. Existing hard rules live in [DESIGN_RULES.md](DESIGN_RULES.md). Instrument Serif is explicitly banned.

## Evidence and limits

Read Reddit discussions directly rather than treating promotional “AI slop detector” lists as research. Reddit comments are anecdotal design opinions, not a representative study or a reliable way to identify AI authorship. Several threads contain self-promotion and unsupported claims about model training; those claims are not adopted here.

- [r/webdesign: Why is every AI website designed the same?](https://www.reddit.com/r/webdesign/comments/1m2om61/why_is_every_ai_website_designed_the_same/) — repeated complaints about purple styling, shadows, cards and unmodified templates. Other comments note that familiar patterns can work and distinctiveness can come from careful details.
- [r/UI_Design: AI Fatigue from seeing same designs](https://www.reddit.com/r/UI_Design/comments/1tvb91q/ai_fatigue_from_seeing_same_designs/) — concerns about similar cards/icons/badges, generic prompting and polished-looking interfaces with poor contrast or keyboard behavior. Suggestions include a creative brief, references and deliberate brand decisions.
- [r/SaaS: anyone else notice every AI-built site looks the same now?](https://www.reddit.com/r/SaaS/comments/1wlcl48/anyone_else_notice_every_aibuilt_site_looks_the/) — concerns include excessive badges, formulaic copy, dead controls and default component styling. Comments recommend using real content and making layout decisions before implementation.

These discussions largely concern landing pages. Transfer relevant lessons to the working app, but do not replace useful application tables or forms just to avoid looking familiar. No framework, color or font alone proves AI authorship. The owner banned Instrument Serif; the research does not create an automatic ban on every other common font or on the existing development stack.

## What this adds to the existing rulebook

The rulebook already covers most decorative complaints. Additional design-review questions:

- Could this screen belong to any generic SaaS after changing its title? If yes, strengthen its actual brand-owner task and content.
- Does every visible control work, and does its wording explain what happens?
- Are empty/loading/error/disconnected states as considered as the populated mockup?
- Does removing a label or boundary make an action harder to understand? Minimalism must retain usable controls.
- Are real audience, offer, time, source and approval details visible at the decision point?
- Are spacing, typography and icon treatment consistent across the whole journey?

## Proposed product identity

A calm editorial workspace for getting the next campaign right. “Editorial” here means clear hierarchy and careful arrangement, not a serif typeface, italic styling, eyebrow labels or decorative magazine typography.

Use a small semantic palette, readable sans-serif typography to be selected in context, one consistent icon family and restrained interaction states. Use whitespace/alignment to group information. Preserve necessary focus and control boundaries.

Originality should come from product-specific work surfaces:
- A recognizable, editable brand preview during onboarding.
- Competitor emails as visual evidence, alongside source/date and useful observations.
- Campaign review that brings the email, audience, offer and time together.
- A weekly plan that separates campaign volume from customer exposure.
- Conversational suggestions that become editable rules/proposals beside the work.

Avoid replacing all of this with identical metric cards or an empty “Ask AI” box.

## Proposed desktop journeys

### Onboarding

One focused task area plus a stable brand/email preview. Enter URL → see inferred brand → confirm/edit → connect Klaviyo → verify required facts/products/discount rules → choose relevant competitors → review a useful first week.

Show what is confirmed, what was inferred and what is missing. Preserve answers and allow back/edit/resume. Show an actionable empty-catalog state. Defer optional configuration, not required product checks.

### Competitor discovery

Use a searchable email gallery with restrained filters. Opening an email preserves the search/scroll context. Brand detail connects an observed pattern to its supporting emails; show coverage limitations. Follow, save and use layout are distinct actions.

### Campaign production

Keep the draft and its purpose/audience/offer/time visible in the same review workspace. Put advanced editing and technical diagnostics on demand. A suggested change should reveal its effect before approval.

### Segmentation and central chat

Use familiar explicit conditions and direct controls alongside conversation. Describe an audience → inspect conditions and estimated membership → refine → approve. Show exclusions, freshness and overlap. Chat should reduce effort without requiring owners to remember special prompts.

## Usability grounding

[Nielsen Norman Group: progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) supports keeping common actions readily available and moving less-used complexity to clearly labeled secondary areas.

[NN/g: recognition rather than recall](https://www.nngroup.com/articles/recognition-and-recall/) supports visible choices and contextual cues instead of relying on remembered commands. This is why chat complements direct controls.

## How to validate

Prototype onboarding and the first campaign review using realistic synthetic brand data. Ask brand owners to complete concrete tasks without guidance: correct a brand fact, choose a competitor, explain an audience and review a draft. Observe hesitation, wrong turns, corrections and recovery. Record task success and time to the first useful result. A visually clean screenshot is not sufficient evidence.

Next design work: compare two or three desktop onboarding layouts within the approved calm light direction. Review with actual copy and error/empty states before expanding the system.
