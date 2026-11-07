# Design rules

Owner requirements recorded 7 November 2026. Applies to the Grey Retention product UI, Figma work, prototypes and implementation. Overrides earlier visual/motion suggestions. This records design requirements, not a completed redesign.

## Direction and scope

- Calm, minimal light interface. Desktop/laptop first for the current design phase.
- Defer a dedicated mobile app-layout design pass. This does not remove accessibility, email rendering checks or the existing phone-approval product capability.
- Start from brand-owner jobs: onboarding, understanding the business, selecting competitors, browsing emails, understanding competitor patterns, planning/building/reviewing campaigns and choosing audiences.
- Smooth means clear decisions, fast feedback, preserved work and little friction. It does not mean decorative motion.
- Keep app branding clear and consistent. Keep the app identity distinct from the client's brand kit used inside generated emails. Final fonts, accent palette and logo treatment are not yet selected.

## Hard visual and writing rules

Do not use:

- Decorative gradients, glow or gradient backgrounds.
- Emoji in place of real interface icons. Use one consistent icon family and accessible labels.
- Meaningless badges, decorative pills or labels, or redundant status tags.
- **Instrument Serif** (explicitly banned by the owner). Do not use it in the app, prototypes or proposed brand typography.
- Excessive italic emphasis, decorative serif styling, negative kerning, excessive monospace or all-caps subtitles.
- Overly detailed interfaces or diagrams; decorative section numbering, eyebrow labels, code breadcrumbs, dithering, ASCII art or squiggles.
- Excessive dividers, bordered content containers, card-inside-card layouts, or a proliferation of near-identical colors/opacities.
- Verbose or redundant copy. Product titles have no terminal periods.
- Unnecessary visual separation of related content. Group by spacing/alignment. Flatten nested cards.
- Inconsistent nested corner treatment. Where nesting is actually necessary, align curves with the inset/gap rather than blindly assigning identical numeric radii.

Use borders only where needed to make controls, focus or genuine information boundaries understandable; no decorative boxes around every section. Preserve contrast, visible keyboard focus, labels and error clarity.

The owner clarified that “interman serif” meant **Instrument Serif**, which is banned. “HPicker AI” remains unidentified (the owner does not know the intended reference); “Fallible one” is also unclear. Do not invent a specific component ban from those unidentified phrases.

## Hard motion rules

The owner explicitly confirmed the opening animation list was a list of unwanted effects. Do not interpret it as an animation specification.

- Minimal motion. No infinite decorative loops, spring bounce, staggered rows or staggered settling.
- No 0.97 button-press scaling, 12% knob stretching, arc movement, success pulses, popover scale entrances, blur/scale icon crossfades or rubber-band drag effects.
- Do not add shared-layout/morphing effects merely because a library supports shared layout IDs.
- Do not adopt the dictated ease-out/ease-in-out, 150–250 ms dropdown, trigger-origin entrance/exit, 20%-shorter exit, simultaneous state choreography, mask reveal/color transition, or handheld tween rules as requirements.
- Do not replace these with a different decorative animation recipe. Start with immediate state changes; add only purposeful, unobtrusive motion after a specific need is established, with reduced-motion support.
- Confirm success with clear text/icon/state, not a pulse. Show genuine progress without theatrical delays.

## Journey rules

- Ask for data only when it is needed. Prefill what can be reliably obtained, then let the owner confirm/edit it.
- Explain each integration's purpose and show actual readiness; don't make uncertainty look verified.
- Autosave/resume setup, show useful progress and let nonessential setup wait.
- Keep required safety checks intact: valid catalog, confirmed facts, discount rules, audience eligibility and owner approval.
- Give each screen one clear primary action and an obvious way back without losing work.
- Put explanations beside the relevant decision, with deeper detail available on demand.
- Keep observed competitor facts distinct from our interpretations. Never imply access to their opens, conversions or revenue.
- Chat must produce editable, inspectable results. It must not be the only way to perform a core job.

## Design review checklist

- [ ] Current desktop journey has a clear goal and next action
- [ ] No prohibited decoration, writing or motion
- [ ] No meaningless badges, nested cards or redundant copy
- [ ] Brand identity and client email branding are distinct
- [ ] Drafts and setup progress survive navigation
- [ ] Missing data, errors and blocked states explain the next step
- [ ] Audience, offer, send time and approval state are clear
- [ ] Keyboard access, focus, contrast and reduced-motion behavior are checked
