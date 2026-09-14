---
name: Grey Retention
description: A calm proof table for accountable retention-campaign operations.
colors:
  registration-coral: '#ff5d46'
  registration-coral-strong: '#e84531'
  editorial-violet: '#7c8cff'
  editorial-violet-soft: '#dedffc'
  editorial-violet-ink: '#30366c'
  proof-paper: '#ebe8df'
  raised-proof: '#f8f6ef'
  proof-hover: '#e1ded5'
  rail-ink: '#151513'
  primary-ink: '#1a1a18'
  muted-ink: '#5f5e59'
  faint-ink: '#686660'
  rule: '#cfcbc0'
  rule-strong: '#aaa69b'
  focus: '#4d58d4'
  warning-paper: '#f2dfb8'
  warning-ink: '#664b10'
  danger: '#b3261e'
  danger-strong: '#8e1b15'
  danger-paper: '#f4d5d1'
  danger-ink: '#7d211b'
typography:
  display:
    fontFamily: 'Archivo, sans-serif'
    fontSize: 'clamp(2.25rem, 4vw, 3rem)'
    fontWeight: 700
    lineHeight: 1
    letterSpacing: '-0.035em'
  body:
    fontFamily: 'Archivo, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: 'Fragment Mono, monospace'
    fontSize: '0.68rem'
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: '0.06em'
rounded:
  control: '10px'
  panel: '14px'
  pill: '999px'
spacing:
  xs: '8px'
  sm: '12px'
  md: '16px'
  lg: '24px'
  xl: '32px'
components:
  button-primary:
    backgroundColor: '{colors.registration-coral}'
    textColor: '{colors.primary-ink}'
    rounded: '{rounded.control}'
    padding: '10px 16px'
    height: '40px'
  button-secondary:
    backgroundColor: '{colors.raised-proof}'
    textColor: '{colors.primary-ink}'
    rounded: '{rounded.control}'
    padding: '10px 16px'
    height: '40px'
  status-warning:
    backgroundColor: '{colors.warning-paper}'
    textColor: '{colors.warning-ink}'
    typography: '{typography.data}'
    rounded: '{rounded.pill}'
    padding: '6px 10px'
---

# Design System: Grey Retention

## Overview

**Creative North Star: "The Proof Table"**

Campaign work appears as evidence under review, not as a generic analytics dashboard. Warm proof paper, ink-dark rails, one-pixel rules, registration coral, and editorial violet create a calm operational surface where sources, notes, state, and next action remain physically connected.

The system is dense but never frantic. Hierarchy comes from scale, ruling, tonal layers, and attached annotations rather than card proliferation. Tenant identity enters through one validated presentation object and CSS variables; product behavior never forks with the theme.

**Key Characteristics:**

- Warm paper field with a fixed dark operational rail.
- Campaign rows carry proof IDs, sources, notes, audience, date, and text status.
- Coral registers the active artifact and consequential action; violet supports secondary active state.
- Mobile becomes action-first: review rail, proofs, then compact metrics.
- White-label themes fail safely to the accessible default palette.

## Colors

The palette behaves like marked-up editorial proof: mostly paper and ink, with accents used as registration signals rather than decoration.

### Primary

- **Registration Coral** (`#ff5d46`): Primary actions, active proof registration, and attention marks.
- **Coral Strong** (`#e84531`): Primary hover state.

### Secondary

- **Editorial Violet** (`#7c8cff`): Secondary active state and notification cues.
- **Violet Proof / Ink** (`#dedffc` / `#30366c`): Accessible paired treatment for active status.

### Neutral

- **Proof Paper** (`#ebe8df`): Application field.
- **Raised Proof** (`#f8f6ef`): Campaign artifacts and controls.
- **Rail Ink** (`#151513`): Persistent navigation and high-leverage review surfaces.
- **Primary / Muted / Faint Ink** (`#1a1a18`, `#5f5e59`, `#686660`): Ordered text hierarchy. Faint ink remains WCAG AA for normal text on both paper surfaces.
- **Rule / Strong Rule** (`#cfcbc0`, `#aaa69b`): Structural separation.

**The Registration Rule.** Coral identifies the current consequence or next action. Do not scatter it across passive decoration.

**The Contrast Gate Rule.** Tenant palettes must pass the semantic contrast validator. Unsafe primary, hover, danger, focus, or text pairs fall back to the default presentation.

## Typography

**Display Font:** Archivo with sans-serif fallback  
**Body Font:** Archivo with sans-serif fallback  
**Label/Mono Font:** Fragment Mono with monospace fallback

**Character:** Archivo gives headings and controls direct operational weight. Fragment Mono makes dates, proof IDs, evidence counts, and uppercase labels feel registered and inspectable.

### Hierarchy

- **Display** (700, `clamp(2.25rem, 4vw, 3rem)`, 1): Page thesis and primary artifact title.
- **Title** (700, 1–1.25rem): Proof names and review actions.
- **Body** (400, 0.875–1rem, 1.5): Explanations and audience context; keep long copy near 65 characters.
- **Data label** (400, 0.6–0.68rem, 0.04–0.08em, uppercase): Dates, IDs, evidence, state, and provenance.

**The Evidence Type Rule.** Mono type is for traceable operational data, never for long prose or personality styling.

## Layout

Desktop uses a `15.5rem` fixed navigation rail, a `4.75rem` sticky header, a wide proof workspace, and a `22rem` sticky review rail. The campaign date strip spans the workspace before the active-proof grid. Main content caps at `92rem`.

Panels use 20–24px internal spacing and 20px major gaps. One-pixel rules carry alignment through headers, rows, evidence, and metrics. At mobile widths the date strip scrolls horizontally, the review action moves before the proof list, proof statuses remain textual, and metrics stay in one compact three-column strip.

## Elevation & Depth

The system is flat by default. Tonal contrast and rules create structure; broad low-opacity shadows lift only major working artifacts and the dark review rail. Primary buttons receive a restrained coral glow to emphasize action.

### Shadow Vocabulary

- **Proof lift** (`0 22px 60px -45px rgba(31,29,24,.65)`): Main proof container.
- **Rail lift** (`0 22px 60px -45px rgba(0,0,0,.9)`): Dark review rail.
- **Action glow** (`0 8px 20px -12px var(--brand-primary)`): Primary button only.

**The Flat-by-Default Rule.** Add shadows only when an artifact must sit above the working field; never shadow every container.

## Shapes

Controls use 10px corners, panels use 14px corners, and statuses use full pills. One-pixel rules and square internal row intersections keep the rounded outer shells from becoming soft card stacks. The active proof gains a straight coral registration rule on its leading edge.

## Components

### Buttons

- **Shape:** 10px radius; minimum height 40px.
- **Primary:** Registration coral with accessible dark text; strong coral on hover.
- **Focus:** Two-pixel validated focus ring with paper offset.
- **Secondary / Quiet:** Raised proof or transparent treatment; hierarchy stays below primary action.
- **Danger:** Configurable danger and on-danger tokens; both resting and hover pairs require AA contrast.

### Status marks

Compact mono uppercase pills combine text and tone. Never represent campaign state with color alone.

### Proof table

Each row binds date, title, audience, proof ID, note count, source count, state, and registration marker. The selected row receives a coral leading rule and connects to the review rail's evidence summary and action.

### Cards / Containers

Use raised proof for the active artifact, rail ink for the focused review surface, 14px outer radius, and strong internal rules. Avoid unrelated equal-weight cards.

### Inputs / Fields

Fields use raised proof, 10px corners, a strong inset rule, and the shared validated focus color. Placeholder text uses faint ink and must retain AA contrast.

### Navigation

Desktop navigation is a fixed ink rail with muted default links and a tonal active row. All links use the shared validated focus token. Mobile navigation is a labelled button with real `aria-expanded` state and a dismissing popover.

## Do's and Don'ts

### Do:

- **Do** attach evidence, provenance, status, and action to the campaign artifact they describe.
- **Do** preserve action-first ordering on mobile.
- **Do** keep tenant identity in `BrandPresentation`, project it through CSS variables, and run contrast validation.
- **Do** use semantic landmarks, visible focus, labelled controls, text status, and reduced-motion behavior.
- **Do** use the design seed `0a100401` when extending this visual lineage.

### Don't:

- **Don't** regress into a generic KPI-card dashboard or disconnected recommendation cards.
- **Don't** fork code for tenant branding or hardcode customer identity inside reusable components.
- **Don't** use faint text below 4.5:1, invisible focus below 3:1, or fixed foreground colors over tenant-controlled backgrounds.
- **Don't** let secondary metrics appear before the highest-leverage action on mobile.
- **Don't** use color-only state or decorative accents without operational meaning.
