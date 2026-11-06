---
name: Grey Retention
description: A quiet, neutral operating workspace for retention teams.
colors:
  workspace: '#f9f9fb'
  panel: '#ffffff'
  panel-hover: '#f5f5f7'
  graphite: '#1d1d1f'
  graphite-muted: '#46464a'
  graphite-faint: '#626267'
  rule: '#e2e2e4'
  rule-strong: '#c7c7cc'
  action: '#1d1d1f'
  action-hover: '#000000'
  interaction-blue: '#0066cc'
  interaction-blue-soft: '#e8f1fb'
  interaction-blue-ink: '#004a94'
typography:
  display:
    fontFamily: 'Inter, sans-serif'
    fontSize: 'clamp(2.25rem, 4vw, 3rem)'
    fontWeight: 700
    lineHeight: 1
    letterSpacing: '-0.035em'
  body:
    fontFamily: 'Inter, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: 'Inter, sans-serif'
    fontSize: '0.68rem'
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: '0.04em'
rounded:
  control: '8px'
  panel: '16px'
  pill: '999px'
spacing:
  xs: '8px'
  sm: '12px'
  md: '16px'
  lg: '24px'
  xl: '32px'
components:
  button-primary:
    backgroundColor: '{colors.action}'
    textColor: '#ffffff'
    rounded: '{rounded.control}'
    padding: '10px 16px'
    height: '40px'
  button-secondary:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.graphite}'
    rounded: '{rounded.control}'
    padding: '10px 16px'
    height: '40px'
---

# Design System: Grey Retention

> **Being replaced.** This describes the theme the live app uses today. The new Grey Retention design language is [`docs/DESIGN.md`](docs/DESIGN.md); milestone M1 (DS-001 to DS-007) moves every screen to it, after which this file is retired.

## Overview

**Creative North Star: “Quiet Operations”**

Grey Retention uses the visual language requested from the reference product: a cool off-white workspace, white navigation and panels, graphite typography, near-black primary actions, blue interaction cues, and restrained borders. The interface should feel like a composed operating tool rather than a decorated marketing surface.

This is a clean-room token implementation. The reference is visual evidence only; components, layout code, and product behavior remain original and white-label-ready.

## Core characteristics

- Cool `#f9f9fb` application field with white navigation and work surfaces.
- Inter throughout for a compact, familiar operational rhythm.
- Near-black buttons for consequential actions; blue is reserved for links, focus, selection, and system cues.
- Pale gray active navigation instead of a dark rail or colored marker.
- One-pixel neutral rules, 8px controls, and 16px containers.
- Tenant identity continues to enter through `BrandPresentation` and semantic CSS variables.

## Color rules

### Neutrals

- **Workspace** (`#f9f9fb`): page background.
- **Panel** (`#ffffff`): navigation, cards, inputs, and raised work areas.
- **Panel hover** (`#f5f5f7`): hover and current navigation state.
- **Graphite** (`#1d1d1f`): headings and primary text.
- **Muted / faint graphite** (`#46464a` / `#626267`): supporting text that remains AA-readable.
- **Rule / strong rule** (`#e2e2e4` / `#c7c7cc`): structural separation and control outlines.

### Actions and interaction

- **Action** (`#1d1d1f`): primary buttons and the default logo tile.
- **Action hover** (`#000000`): primary hover state.
- **Interaction blue** (`#0066cc`): links, keyboard focus, and active system cues.
- **Blue soft / ink** (`#e8f1fb` / `#004a94`): selected and informational states.

**The Black Action Rule.** Primary actions use graphite, not a bright brand fill. Tenant themes may replace the action pair only when the contrast validator accepts them.

**The Blue Interaction Rule.** Blue communicates interaction or system state. It is not background decoration.

## Typography

Inter is the display, body, and data face. Hierarchy comes from size and weight rather than switching to a decorative or monospace face.

- **Display:** 700 weight, tight but never below `-0.04em` tracking.
- **Title:** 600–700 weight at 1–1.25rem.
- **Body:** 400 weight at 0.875–1rem with 1.5 line height.
- **Data label:** 500 weight at 0.68rem with modest uppercase tracking where the label represents state or provenance.

## Layout and surfaces

Desktop keeps a fixed 15.5rem navigation rail and a 4.75rem sticky header. Both are white with neutral rules. Main content sits on the cool workspace field and caps at the established readable widths.

Panels are white and mostly flat. Use either a one-pixel border or a broad, low-opacity shadow when a major working object needs elevation—never both by habit. Mobile navigation uses the same white surface and active-state treatment as desktop.

## Components

### Buttons

- Primary: graphite fill, white label, 8px radius, no colored glow.
- Secondary: white fill with strong neutral inset rule.
- Quiet: transparent with pale gray hover.
- Focus: 2px interaction-blue ring with visible offset.

### Navigation

Navigation defaults to accessible muted graphite. Hover and current routes use `#f5f5f7` with full graphite text. Current state remains visible without relying on color alone through a modest weight increase.

### Inputs

Inputs use white fill, 8px corners, strong neutral outline, readable placeholders, and the shared blue focus ring.

### Status marks

Compact text-first pills may use blue, amber, red, or neutral soft surfaces. Status is never encoded by color alone.

## Accessibility and white-label rules

- Preserve WCAG 2.2 AA contrast for text and focus indicators.
- Keep semantic landmarks, labelled controls, keyboard operation, reduced motion, and text status.
- Project tenant themes through `BrandPresentation`; never fork shared components for a customer palette.
- Reject tenant palettes that fail the shared contrast gate.
- Do not reintroduce orange/coral as the default theme.

## Do / do not

Do keep dense operational information calm and scannable. Do use blue only where interaction or state earns it. Do keep navigation and authentication visually continuous with the workspace.

Do not recreate proprietary source or assets from the reference product. Do not use a dark default sidebar, colored action glows, generic gradient decoration, or low-contrast gray text.

Design seed: `6f728f1c`.
