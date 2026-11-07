# Grey Retention design language

> **Superseded design/planning direction — 7 November 2026.** The owner requires a fresh UI/UX process in Figma. The older layouts, theme, milestones and parity checkboxes below are history, not replacement acceptance criteria. Current scope includes 2,000+ blocks, strategic segmentation, per-customer exposure, conversational segmentation and central AI chat. Start with [BUILD_BRIEF.md](BUILD_BRIEF.md), [DESIGN_RESET.md](DESIGN_RESET.md) and [PROJECT_TODOS.md](PROJECT_TODOS.md).


Status: **foundation applied (DS-001), layout facts updated for M1.5.** Fonts, colours and the §0 shapes (20px cards, 12px controls) are live on every screen through [`lib/design/tokens.ts`](../lib/design/tokens.ts), [`app/styles/tokens.css`](../app/styles/tokens.css) and the default white-label theme. The remaining M1 issues (DS-002 to DS-007) rebuild the shell, components and states to the patterns below.

## In plain words

Grey Retention should feel like a calm research tool, not a busy dashboard. Think of a good printed magazine: warm off-white paper, black ink, big quiet headlines, small precise labels. One electric-blue colour is used only where it matters: the one main button on a screen, the keyboard focus ring, and highlighted data. Cards have soft 20px corners and controls 12px, as in the old app. Boxes are separated by thin grey lines, not shadows. The signature element is one big **composer box** where an owner pastes a competitor email and picks **EXACT**, **REBRAND** or **ADAPT**.

Example: on the dashboard the owner sees a large serif title "Watch, learn, send.", a row of four stat tiles (`7` watched brands, `126` emails, …) in a thin-lined grid, and the composer box with one blue arrow button. Everything else is black, white and grey.

## Inspiration and clean-room rule

The feel is deeply inspired by exa.ai: editorial, research-grade, generous whitespace, serif display type with mono labels, hairline grids and a single electric accent. We take the **feel only**. Never copy Exa's logo, wordmark, copy, illustrations, images, icons or code. All Grey Retention components, words and assets are original. (The exa.ai site was not reachable from the build environment when this was written; this document follows the owner's written brief.)

## Principles

1. **Calm over clever.** Few colours, few weights, lots of space. A screen has one obvious next action.
2. **Editorial hierarchy.** Big serif titles for orientation, clean sans for work, mono for facts (labels, numbers, IDs, dates).
3. **Lines, not shadows.** Structure comes from 1px hairlines and grids. No drop shadows, no gradients, no glows.
4. **One accent, used sparingly.** Electric blue means "this is the key action", "you are focused here" or "this number matters". Never decoration.
5. **Honest states.** Every empty, loading, waiting and failed state says what is true and what to do next.
6. **Accessible by default.** WCAG 2.2 AA contrast, visible focus, full keyboard use, works at 375px.

## Colour

Use tokens, never raw hex values. In components use the Tailwind names (`bg-surface`, `text-accent`, `border-hairline-strong`) or the semantic variables (`var(--brand-secondary)`); both follow a customer's white-label theme. The raw `--gr-*` variables and `colorThemes` in `lib/design/tokens.ts` are the defaults only and must not be used directly in components.

### Light theme (default)

| Token                 | Value                 | Use                                                             |
| --------------------- | --------------------- | --------------------------------------------------------------- |
| `canvas`              | `#faf9f7`             | Page background (warm off-white)                                |
| `canvas-sunken`       | `#f0ece8`             | Recessed areas: composer tray, code/preview wells, table header |
| `surface`             | `#ffffff`             | Cards, panels, inputs, menus                                    |
| `ink`                 | `#111111`             | Headings, body text, primary button fill                        |
| `ink-strong`          | `#000000`             | Hover/pressed state of the black primary button                 |
| `ink-muted`           | `#58544e`             | Secondary text, captions, mono labels                           |
| `ink-subtle`          | `#787572`             | Small meta text **on white only**; icons; disabled hints        |
| `hairline`            | `#e5e5e5`             | Dividers, card borders, grid lines (decorative)                 |
| `hairline-strong`     | `#8a8580`             | Outlines of inputs, checkboxes, toggles (must be visible)       |
| `accent`              | `#1f40ed`             | The single key action, focus ring, data highlight               |
| `accent-strong`       | `#0d2189`             | Hover/pressed state of the key action                           |
| `accent-faint`        | `#e7ebfd`             | Selected row, selected chip background, info note               |
| `accent-text`         | `#1f40ed`             | Links and accent-coloured text                                  |
| `on-accent`           | `#ffffff`             | Text on `accent` and `accent-strong`                            |
| `on-ink`              | `#ffffff`             | Text on the black primary button                                |
| `inverse`             | `#111111`             | Dark panel of split report sections                             |
| `on-inverse`          | `#f5f5f4`             | Text on the dark panel                                          |
| `on-inverse-muted`    | `#a8a29e`             | Secondary text on the dark panel                                |
| `inverse-hairline`    | `#2a2a2a`             | Lines inside the dark panel                                     |
| `accent-2` / `-faint` | `#6b3fa0` / `#f1ebf8` | Second accent role: TEXT type pill, cultural holidays           |
| `success` / `-faint`  | `#2f6b4f` / `#e8f1ec` | Muted green status                                              |
| `warning` / `-faint`  | `#7a5300` / `#f6eedb` | Muted amber status                                              |
| `danger` / `-faint`   | `#a3352b` / `#f8e8e5` | Muted red status and errors                                     |
| `danger-strong`       | `#842a22`             | Hover/pressed state of a destructive button                     |
| `on-danger`           | `#ffffff`             | Text on a destructive button                                    |

### Dark theme

Applied with `data-theme="dark"` on `<html>`. Canvas `#0f0f0e`, sunken `#0a0a09`, surface `#171717`, ink `#f5f5f4`, ink-muted `#a8a29e`, ink-subtle `#8a8580`, hairline `#262626`, hairline-strong `#6b6762`, accent `#4d6bff`, accent-strong `#8ea0ff`, accent-faint `#161c3d`, accent-text `#8ea0ff`, on-accent `#000000`, on-ink `#0f0f0e`, inverse `#1f1f1e`. Semantic colours: success `#86c4a1`, warning `#d9b062`, danger `#ec9a90` (each with a deep `-faint` background). Whether dark mode follows the system setting is decided in DS-001.

### Accessibility limits we found (enforced by `lib/design/tokens.test.ts`)

The owner's palette is kept exactly. Three combinations are too weak for small text, so the design limits where they are used:

- `ink-subtle` (#787572) on the off-white `canvas` is 4.35:1 (AA needs 4.5). Use it for small text only on white `surface` (4.58:1). On the canvas use `ink-muted` for small text; `ink-subtle` is fine there for large text, icons and disabled hints.
- White text on the dark-theme accent `#4d6bff` is 4.32:1. In dark mode the blue button uses **black** text (`on-accent` = `#000000`, 4.86:1), and accent-coloured text uses the lighter `accent-text` `#8ea0ff` (7.87:1).
- The `hairline` grey is decorative (1.2:1). Anything the user must see to operate — input borders, checkboxes, toggles — uses `hairline-strong` (≥ 3:1).

The full list of allowed pairs lives in `contrastRules` in `lib/design/tokens.ts`. If a pair is not listed, it is not allowed.

### Accent rules

- At most **one** blue button per screen: the key action (for example the composer's submit arrow, "Approve and schedule"). All other primary buttons are black.
- Blue is also the focus ring, the selected state of chips/toggles (as `accent-faint` fill + `accent-text` label) and highlighted numbers in charts.
- Never use blue for headings, backgrounds of large areas, icons for decoration or borders of ordinary cards.

## Typography

| Role      | Font                   | Weight  | Details                                                                   |
| --------- | ---------------------- | ------- | ------------------------------------------------------------------------- |
| Display   | **Newsreader** (serif) | 400     | Page titles and hero lines. Tracking `-0.03em`, line height 1.05.         |
| UI / body | **Geist** (sans)       | 400/500 | Everything you read and click. 15px body, 13px small.                     |
| Labels    | **Geist Mono**         | 400/500 | UPPERCASE, tracking `0.08em`, 11px. Section labels, chips, table headers. |
| Numbers   | **Geist Mono**         | 400     | Counts, stats, prices, dates in tables. Big stats use `text-stat`.        |

All three are free fonts loaded with `next/font` (Newsreader and Geist from Google Fonts; Geist Mono likewise), self-hosted at build time, no runtime font requests. Newsreader was chosen over Instrument Serif because it has more weights and optical sizes for long titles.

Scale tokens: `text-label` 11px · `text-small` 14px · `text-body` 17px · `text-lead` 18px · `text-title` 30px · `text-stat` 32–48px fluid · `text-display` 40–68px fluid.

Rules: one display title per page; never bold the serif; never set paragraphs in mono; mono labels are short (one to three words) and always uppercase; numbers that line up in tables use `font-variant-numeric: tabular-nums`.

## Shape, lines and space

> **Layout facts from the old app win (M1.5).** On Raman's instruction the app is rebuilt 1:1 from [`UI_REBUILD_SPEC.md`](UI_REBUILD_SPEC.md). Its §0 layout facts override this document where they differ; colours, fonts and icons stay from these tokens.

- **Radii:** cards and modals 20px (`--gr-radius-panel`, Tailwind `rounded-xl` and up); inputs and buttons 12px (`--gr-radius-control`, `rounded-md`/`rounded-lg`); small chips 8px (`rounded`/`rounded-sm`); pills and avatars fully round.
- **Cards:** white surface, 1px hairline border, no shadow, 24px padding.
- **Controls:** inputs 14px text with 8px × 12px padding; buttons 14px, weight 500, 8px × 16px padding.
- **Lines, not shadows.** Structure comes from 1px hairlines. The only shadow allowed is the floating action bar and popovers that sit over content (§7 draft editor).
- **Grids with visible dividers** for equal items (stat tiles, logo walls).
- **Spacing** on a 4px base: 4, 8, 12, 16, 24, 32, 48, 64, 96.
- **Layout:** sidebar 255px expanded, 56px collapsed rail; content max width 1280px; Klaviyo detail pages use a ~1020px centred column (`--gr-detail-max`); gutters 16px on mobile, 32px on desktop.
- **Icons:** one outlined icon set (Lucide), about 20px (`--gr-icon-size`).

## Components

### Buttons and links

| Kind        | Look                                                              | When                                            |
| ----------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| Primary     | Solid `ink` fill, `on-ink` label, 12px radius, 40px tall          | Main action of a section ("Save", "Continue")   |
| Key action  | Solid `accent` fill, `on-accent` label; hover `accent-strong`     | The one most important action on the screen     |
| Secondary   | `canvas-sunken` fill, `ink` label, no border                      | Alternatives ("Cancel", "Preview")              |
| Tertiary    | Text link in `ink` with a trailing arrow `→`, underline on hover  | Navigation-like actions ("View all captures →") |
| Destructive | `danger` fill, `on-danger` label; always confirms the exact scope | Delete, untrack, cancel send (see UX-021)       |

Disabled buttons keep their shape, drop to `ink-subtle` text and explain why nearby. Loading buttons keep their width and show a small spinner plus the label ("Saving…").

In code: `Button` from `components/ui/button.tsx` with `variant="primary" | "accent" | "secondary" | "quiet" | "danger"` (`SubmitButton` takes the same variants), and `TextLink` from `components/ui/text-link.tsx` for the tertiary arrow link.

### Segmented toggle and chips

A row of joined segments (12px outer radius) with hairline dividers. Labels are mono uppercase (`EXACT`, `REBRAND`, `ADAPT`; `DESKTOP`, `MOBILE`). Selected: `accent-faint` fill and `accent-text` label plus a 1px `accent` outline; unselected: `surface` with `ink-muted` label. Keyboard focus is a 2px ink outline inside the segment, so it is distinct from selection. It is a radio group for keyboard and screen readers (arrow keys move, one selected). Unavailable options stay visible, disabled, with their reason written underneath.

In code: `SegmentedControl` from `components/ui/segmented-control.tsx` (a native radio group with a legend; options may carry a description and a `disabledReason`).

### Form controls

Inputs, selects and text areas: `surface` fill, 1px `hairline-strong` outline, 12px radius, 40px tall (text areas grow), 14px Geist text with 8px × 12px padding. Labels sit above: 11px mono, weight 600, uppercase, letter-spaced, `ink-muted`; help text below in `ink-muted`; errors in `danger` with an icon and text (never colour alone). Focus: the outline turns `accent` and gains a 1px `accent` ring (2px of blue in total). Dates and times always use pickers in the workspace timezone and display readable local text ("Tue 12 Nov, 9:00 am"), never ISO strings.

In code: `controlClass` from `components/ui/control.ts` for every native input, select and text area, `TextField` for inputs, and `Field` from `components/ui/workspace.tsx` for the label. Checkboxes and radios use the ink colour by default.

### Cards and panels

`surface`, 1px `hairline`, 20px radius, 24px padding. A card title is 18px Geist 500; an optional mono label sits above it. No shadows; hover on clickable cards changes the border to `hairline-strong`.

### Stat tiles

A grid of cells with shared hairlines. Each tile: big mono number (`text-stat`), small caption in `ink-muted` below ("Emails captured this month"), optional mono delta. Unknown values show `—` with a caption that says why ("Not connected yet"), never `0`.

### Tables

Hairline row dividers, no zebra stripes, mono uppercase headers in `ink-muted` on `canvas-sunken`, numbers right-aligned in mono, row hover `canvas-sunken`. On narrow screens tables become stacked cards rather than scrolling sideways.

### Split section (reports)

Two columns: left an `inverse` (dark) panel with a serif headline and the one-sentence takeaway; right a light data panel with stat tiles, a table or a chart. Stacks vertically below 768px.

### Status marks

Text first, colour second: a small mono uppercase label with a 6px square dot (`COLLECTING`, `NEEDS SETUP`, `SCHEDULED`, `FAILED`). Colours: neutral `ink-muted`, info `accent-text`, success, warning, danger. The words and meanings come from one shared list (UX-012).

### Empty, loading and error states

- **Empty:** one serif line, one plain sentence, one action. Example: "No competitors yet. Add one brand to start collecting its emails. [Add a competitor]".
- **Loading:** hairline skeleton blocks in `canvas-sunken`, no spinners for whole pages, no fake progress.
- **Error:** what happened, what was kept, what to do: "We could not reach this website. Your URL is saved. [Try again] or [Set up manually]".

### Navigation shell

Warm `canvas` background, hairline-separated sidebar on desktop with mono uppercase group labels, the selected store always visible at the top (UX-002), five primary destinations (UX-004). Mobile uses a top bar and a full-height drawer. Current page: `ink` text with a 2px `ink` bar, not a coloured background.

## Signature pattern: the composer

The composer is to Grey Retention what a search box is to a search engine. It appears on onboarding and the dashboard (DS-006).

```text
┌──────────────────────────────────────────────────────────────┐
│ Paste a competitor email, or a link to one                   │
│                                                              │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ [ EXACT | REBRAND | ADAPT ]                             [→]  │
│ BRAND  Northwind ▾   PRODUCTS  Auto-match ▾   FOOTER  Mine ▾ │
└──────────────────────────────────────────────────────────────┘
```

- One large text area (`surface`, 1px `hairline-strong`, 20px radius). Placeholder in `ink-muted`.
- A tray below it in `canvas-sunken`: the mode toggle on the left, the **only blue button** (an arrow, labelled "Create my version" for screen readers) on the right.
- Small mono option groups underneath: BRAND, PRODUCTS, FOOTER, each a compact menu showing the current choice.
- Modes: **EXACT** keeps the email as it is; **REBRAND** keeps the layout and swaps in the owner's brand, products, links and footer; **ADAPT** keeps the strategy and writes new content. A one-line description of the selected mode sits under the toggle. Modes that are not built yet are shown as unavailable with a short reason, never faked.
- Keyboard: Tab order text → mode → options → submit; ⌘/Ctrl+Enter submits. At 375px the tray wraps: toggle full-width, options stacked, arrow stays bottom-right.

## Copy tone

Short, confident, plain. Speak to the owner as "you". Prefer verbs ("Add a competitor") over nouns ("Competitor addition").

| Never show owners      | Say instead                                     |
| ---------------------- | ----------------------------------------------- |
| fixture, synthetic     | sample, example (or remove)                     |
| tenant                 | workspace, store, brand                         |
| `2026-11-01T10:00:00Z` | Sat 1 Nov, 10:00 am (in the workspace timezone) |
| job, lease, dispatch   | working on it, queued, done, failed             |
| provider, adapter      | Klaviyo, Shopify (the real name)                |

Technical words may appear in admin-only screens and developer tools. DS-007 adds a test that guards owner screens.

## Accessibility checklist

- Text contrast ≥ 4.5:1 (large text ≥ 3:1); control outlines and focus rings ≥ 3:1 — enforced for tokens by `lib/design/tokens.test.ts`.
- Visible 2px focus ring on every interactive element; never remove outlines without a replacement.
- Everything works with a keyboard; toggles are radio groups; menus follow the ARIA menu/listbox patterns.
- Status and errors use words and icons, not colour alone.
- Layouts work from 375px wide to 1440px+, with no horizontal page scroll and text zoom to 200%.
- Respect `prefers-reduced-motion`; motion is short (120–180ms) and never required to understand a change.

## White-label

Grey Retention is sold white-label (`PRODUCT.md`): name, logo, palette, typography, domains and customer-facing copy must be configurable without code changes. This document is the **default** theme. A customer theme is data passed through the existing `BrandPresentation` contract (`lib/branding/presentation.ts`): it may replace the colours of its `theme` and the three font roles. `hasAccessibleBrandContrast` checks text, muted and faint text, accent links, error and warning text, button labels and control outlines against the page and white panels; a theme that fails any pair is rejected and the default is used. Success colours are not tenant-themable yet. Layout, spacing, the §0 shapes, hairline structure and components are shared; they are never forked per customer.

## Implementation notes

- Tokens: `lib/design/tokens.ts` (source of truth) and `app/styles/tokens.css` (`--gr-*` custom properties, light on `:root`, dark on `[data-theme='dark']`). The test fails if the two differ.
- `app/globals.css` imports `tokens.css`. The older semantic variables that components already use (`--surface`, `--text`, `--line`, `--brand-primary`, `--brand-secondary`, …) now point at the tokens, and `lib/branding/presentation.ts` builds the default white-label theme from `colorThemes.light`, so there is one source for every value.
- Tailwind names (Tailwind 4 `@theme`): colours `canvas`, `canvas-sunken`, `surface`, `ink`, `ink-strong`, `ink-muted`, `hairline`, `hairline-strong`, `accent`, `accent-strong`, `accent-faint`, `danger`, `warning`, `success` (+ `-faint`); fonts `font-serif` (display), `font-sans` (UI), `font-mono` (labels/numbers); tracking `tracking-display`, `tracking-label`. `rounded`/`rounded-sm` are 8px, `rounded-md`/`rounded-lg` 12px (controls), `rounded-xl` and up 20px (cards); `rounded-full` remains for avatars and pills. New colour names: `accent-2` (+ `-faint`). New code uses these names, for example `bg-surface border border-hairline text-ink`.
- Fonts load with `next/font/google` in `app/layout.tsx` as `--font-newsreader`, `--font-geist` and `--font-geist-mono`; they are self-hosted at build time.
- Dark mode is defined in tokens but not switched on: the white-label theme is applied inline on `<body>`, so dark mode needs a dark `BrandPresentation` variant first. Until then the app is light only.
- Naming trap: Tailwind `bg-surface` is the white panel (`--surface-raised`), while the older variable `var(--surface)` is the page canvas; `text-ink` is near-black, while the older `--brand-ink` is dark blue. When replacing `bg-[var(--surface)]`, use `bg-canvas`.
- Replace the old root `DESIGN.md` once DS-002 to DS-007 are done.

## Do and don't

Do: lots of whitespace · one serif title per page · mono for facts · hairline grids · one blue key action · honest empty states · plain words.

Don't: shadows, gradients or glows · pill buttons (the one exception is the outline pill for page-header actions, `variant="outline" shape="pill"`, from UI_REBUILD_SPEC.md §2) · more than one blue button per screen · blue headings or backgrounds · ISO timestamps or developer words on owner screens · copied third-party logos, copy or images.
