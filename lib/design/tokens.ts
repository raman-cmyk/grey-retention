/**
 * Grey Retention design tokens (docs/DESIGN.md).
 *
 * `app/styles/tokens.css` publishes the same values as `--gr-*` CSS custom
 * properties; `tokens.test.ts` keeps both files identical and checks every
 * documented colour pairing against WCAG 2.2 AA. `app/globals.css` imports the
 * CSS file and `lib/branding/presentation.ts` builds the default white-label
 * theme from `colorThemes.light`.
 */

export const colorTokenNames = [
  'canvas',
  'canvas-sunken',
  'surface',
  'ink',
  'ink-strong',
  'ink-muted',
  'ink-subtle',
  'hairline',
  'hairline-strong',
  'accent',
  'accent-strong',
  'accent-faint',
  'accent-text',
  'on-accent',
  'on-ink',
  'inverse',
  'on-inverse',
  'on-inverse-muted',
  'inverse-hairline',
  'success',
  'success-faint',
  'warning',
  'warning-faint',
  'danger',
  'danger-faint',
  'danger-strong',
  'on-danger'
] as const

export type ColorTokenName = (typeof colorTokenNames)[number]
export type ThemeName = 'light' | 'dark'
export type ColorTheme = Readonly<Record<ColorTokenName, string>>

export const colorThemes: Readonly<Record<ThemeName, ColorTheme>> = {
  light: {
    canvas: '#faf9f7',
    'canvas-sunken': '#f0ece8',
    surface: '#ffffff',
    ink: '#111111',
    'ink-strong': '#000000',
    'ink-muted': '#58544e',
    'ink-subtle': '#787572',
    hairline: '#e5e5e5',
    'hairline-strong': '#8a8580',
    accent: '#1f40ed',
    'accent-strong': '#0d2189',
    'accent-faint': '#e7ebfd',
    'accent-text': '#1f40ed',
    'on-accent': '#ffffff',
    'on-ink': '#ffffff',
    inverse: '#111111',
    'on-inverse': '#f5f5f4',
    'on-inverse-muted': '#a8a29e',
    'inverse-hairline': '#2a2a2a',
    success: '#2f6b4f',
    'success-faint': '#e8f1ec',
    warning: '#7a5300',
    'warning-faint': '#f6eedb',
    danger: '#a3352b',
    'danger-faint': '#f8e8e5',
    'danger-strong': '#842a22',
    'on-danger': '#ffffff'
  },
  dark: {
    canvas: '#0f0f0e',
    'canvas-sunken': '#0a0a09',
    surface: '#171717',
    ink: '#f5f5f4',
    'ink-strong': '#ffffff',
    'ink-muted': '#a8a29e',
    'ink-subtle': '#8a8580',
    hairline: '#262626',
    'hairline-strong': '#6b6762',
    accent: '#4d6bff',
    'accent-strong': '#8ea0ff',
    'accent-faint': '#161c3d',
    'accent-text': '#8ea0ff',
    'on-accent': '#000000',
    'on-ink': '#0f0f0e',
    inverse: '#1f1f1e',
    'on-inverse': '#f5f5f4',
    'on-inverse-muted': '#a8a29e',
    'inverse-hairline': '#333333',
    success: '#86c4a1',
    'success-faint': '#14231b',
    warning: '#d9b062',
    'warning-faint': '#2a2213',
    danger: '#ec9a90',
    'danger-faint': '#2c1816',
    'danger-strong': '#f4b4ac',
    'on-danger': '#000000'
  }
}

/** Theme-independent tokens. Values are CSS strings. */
export const scaleTokens = {
  'font-display': "var(--font-newsreader, 'Newsreader'), Georgia, serif",
  'font-ui':
    "var(--font-geist, 'Geist'), ui-sans-serif, system-ui, -apple-system, sans-serif",
  'font-mono': "var(--font-geist-mono, 'Geist Mono'), ui-monospace, monospace",
  'weight-display': '400',
  'weight-ui': '400',
  'weight-ui-strong': '500',
  'tracking-display': '-0.03em',
  'tracking-label': '0.08em',
  'text-label': '0.6875rem',
  'text-small': '0.8125rem',
  'text-body': '0.9375rem',
  'text-lead': '1.125rem',
  'text-title': '1.75rem',
  'text-stat': 'clamp(2rem, 1.5rem + 2vw, 3rem)',
  'text-display': 'clamp(2.5rem, 1.75rem + 3.5vw, 4.25rem)',
  'leading-tight': '1.05',
  'leading-body': '1.55',
  radius: '4px',
  'border-width': '1px',
  'space-1': '4px',
  'space-2': '8px',
  'space-3': '12px',
  'space-4': '16px',
  'space-6': '24px',
  'space-8': '32px',
  'space-12': '48px',
  'space-16': '64px',
  'space-24': '96px',
  'content-max': '1280px',
  'reading-max': '720px',
  'gutter-mobile': '16px',
  'gutter-desktop': '32px',
  'focus-width': '2px',
  'focus-offset': '2px',
  'duration-fast': '120ms',
  'duration-base': '180ms',
  ease: 'cubic-bezier(0.2, 0, 0, 1)'
} as const

export type ScaleTokenName = keyof typeof scaleTokens

/**
 * Every foreground/background pairing the design allows, with the WCAG 2.2
 * minimum it must meet in BOTH themes: 4.5 for normal text, 3 for large text
 * (24px+, or 18.66px+ at 500 weight), focus rings and control outlines.
 * Pairs not listed here are not allowed (for example `ink-subtle` on
 * `canvas-sunken`, or `accent` as small text in dark mode — use `accent-text`).
 */
export const contrastRules: ReadonlyArray<{
  foreground: ColorTokenName
  backgrounds: readonly ColorTokenName[]
  minimum: 4.5 | 3
  use: string
}> = [
  {
    foreground: 'ink',
    backgrounds: ['canvas', 'canvas-sunken', 'surface', 'accent-faint'],
    minimum: 4.5,
    use: 'body text and headings'
  },
  {
    foreground: 'ink-muted',
    backgrounds: ['canvas', 'canvas-sunken', 'surface', 'accent-faint'],
    minimum: 4.5,
    use: 'secondary text, captions, mono labels'
  },
  {
    foreground: 'ink-subtle',
    backgrounds: ['surface'],
    minimum: 4.5,
    use: 'small meta text, only on white surfaces'
  },
  {
    foreground: 'ink-subtle',
    backgrounds: ['canvas', 'canvas-sunken'],
    minimum: 3,
    use: 'large text, icons and disabled hints on the canvas'
  },
  {
    foreground: 'accent-text',
    backgrounds: ['canvas', 'surface', 'accent-faint'],
    minimum: 4.5,
    use: 'links and selected mono labels'
  },
  {
    foreground: 'on-accent',
    backgrounds: ['accent', 'accent-strong'],
    minimum: 4.5,
    use: 'label on the single blue key action (rest and hover)'
  },
  {
    foreground: 'on-ink',
    backgrounds: ['ink', 'ink-strong'],
    minimum: 4.5,
    use: 'label on the solid primary button (rest and hover)'
  },
  {
    foreground: 'on-inverse',
    backgrounds: ['inverse'],
    minimum: 4.5,
    use: 'text on the dark panel of split sections'
  },
  {
    foreground: 'on-inverse-muted',
    backgrounds: ['inverse'],
    minimum: 4.5,
    use: 'secondary text on the dark panel'
  },
  {
    foreground: 'accent',
    backgrounds: ['canvas', 'surface'],
    minimum: 3,
    use: 'focus ring, selected outline, data highlight'
  },
  {
    foreground: 'hairline-strong',
    backgrounds: ['canvas', 'canvas-sunken', 'surface'],
    minimum: 3,
    use: 'input, checkbox and toggle outlines'
  },
  {
    foreground: 'success',
    backgrounds: ['success-faint', 'canvas', 'surface'],
    minimum: 4.5,
    use: 'success status text'
  },
  {
    foreground: 'warning',
    backgrounds: ['warning-faint', 'canvas', 'surface'],
    minimum: 4.5,
    use: 'warning status text'
  },
  {
    foreground: 'danger',
    backgrounds: ['danger-faint', 'canvas', 'surface'],
    minimum: 4.5,
    use: 'error text'
  },
  {
    foreground: 'on-danger',
    backgrounds: ['danger', 'danger-strong'],
    minimum: 4.5,
    use: 'label on a destructive button (rest and hover)'
  }
]

export function cssVariableName(token: ColorTokenName | ScaleTokenName) {
  return `--gr-${token}`
}
