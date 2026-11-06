import { colorThemes, scaleTokens } from '@/lib/design/tokens'

export type BrandPresentation = Readonly<{
  productName: string
  productDescription: string
  workspaceName: string
  assistantName: string
  demoLabel: string
  demoDescription: string
  userName: string
  userInitials: string
  logo: Readonly<{
    src: string | null
    alt: string
  }>
  fonts: Readonly<{
    display: string
    body: string
    data: string
  }>
  theme: Readonly<{
    surface: string
    surfaceRaised: string
    surfaceHover: string
    nav: string
    navText: string
    navMuted: string
    text: string
    textMuted: string
    textFaint: string
    line: string
    lineStrong: string
    primary: string
    primaryStrong: string
    secondary: string
    soft: string
    ink: string
    onBrand: string
    focus: string
    danger: string
    dangerStrong: string
    onDanger: string
    dangerSoft: string
    dangerInk: string
    warningSoft: string
    warningInk: string
  }>
}>

const light = colorThemes.light

export const defaultBrandPresentation: BrandPresentation = {
  productName: 'Grey Retention',
  productDescription: 'Retention campaign operating system',
  workspaceName: 'Northstar Goods',
  assistantName: 'GROS',
  demoLabel: 'Demo workspace',
  demoDescription: 'Synthetic data only',
  userName: 'Alex North',
  userInitials: 'AN',
  logo: {
    src: null,
    alt: 'Grey Retention'
  },
  fonts: {
    display: scaleTokens['font-display'],
    body: scaleTokens['font-ui'],
    data: scaleTokens['font-mono']
  },
  // The default theme is the Grey Retention design language (docs/DESIGN.md).
  // Values come from lib/design/tokens.ts so the two can never drift.
  theme: {
    surface: light.canvas,
    surfaceRaised: light.surface,
    surfaceHover: light['canvas-sunken'],
    nav: light.canvas,
    navText: light.ink,
    navMuted: light['ink-muted'],
    text: light.ink,
    textMuted: light['ink-muted'],
    // `ink-subtle` is below 4.5:1 on the canvas, so small faint text uses
    // `ink-muted` (see the accessibility limits in docs/DESIGN.md).
    textFaint: light['ink-muted'],
    line: light.hairline,
    lineStrong: light['hairline-strong'],
    primary: light.ink,
    primaryStrong: light['ink-strong'],
    secondary: light.accent,
    soft: light['accent-faint'],
    ink: light['accent-strong'],
    onBrand: light['on-ink'],
    focus: light.accent,
    danger: light.danger,
    dangerStrong: light['danger-strong'],
    onDanger: light['on-danger'],
    dangerSoft: light['danger-faint'],
    dangerInk: light.danger,
    warningSoft: light['warning-faint'],
    warningInk: light.warning
  }
}

export function brandCssVariables(brand: BrandPresentation) {
  return {
    '--font-display': brand.fonts.display,
    '--font-body': brand.fonts.body,
    '--font-data': brand.fonts.data,
    '--surface': brand.theme.surface,
    '--surface-raised': brand.theme.surfaceRaised,
    '--surface-hover': brand.theme.surfaceHover,
    '--nav': brand.theme.nav,
    '--nav-text': brand.theme.navText,
    '--nav-muted': brand.theme.navMuted,
    '--text': brand.theme.text,
    '--text-muted': brand.theme.textMuted,
    '--text-faint': brand.theme.textFaint,
    '--line': brand.theme.line,
    '--line-strong': brand.theme.lineStrong,
    '--brand-primary': brand.theme.primary,
    '--brand-primary-strong': brand.theme.primaryStrong,
    '--brand-secondary': brand.theme.secondary,
    '--brand-soft': brand.theme.soft,
    '--brand-ink': brand.theme.ink,
    '--on-brand': brand.theme.onBrand,
    '--focus': brand.theme.focus,
    '--danger': brand.theme.danger,
    '--danger-strong': brand.theme.dangerStrong,
    '--on-danger': brand.theme.onDanger,
    '--danger-soft': brand.theme.dangerSoft,
    '--danger-ink': brand.theme.dangerInk,
    '--warning-soft': brand.theme.warningSoft,
    '--warning-ink': brand.theme.warningInk
  }
}

function relativeLuminance(hex: string) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null

  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4)
  })

  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

export function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground)
  const backgroundLuminance = relativeLuminance(background)

  if (foregroundLuminance === null || backgroundLuminance === null) return 0

  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

export function hasAccessibleBrandContrast(brand: BrandPresentation) {
  const { theme } = brand
  const normalTextPairs = [
    [theme.text, theme.surface],
    [theme.textMuted, theme.surface],
    [theme.textFaint, theme.surface],
    [theme.textFaint, theme.surfaceRaised],
    [theme.navText, theme.nav],
    [theme.navMuted, theme.nav],
    [theme.textMuted, theme.surfaceRaised],
    [theme.onBrand, theme.primary],
    [theme.onBrand, theme.primaryStrong],
    [theme.onDanger, theme.danger],
    [theme.onDanger, theme.dangerStrong],
    [theme.ink, theme.soft],
    [theme.dangerInk, theme.dangerSoft],
    [theme.warningInk, theme.warningSoft],
    // Accent links, error text and warning text appear directly on the page
    // and on white panels (`text-accent`, `text-danger`, `text-warning`).
    [theme.secondary, theme.surface],
    [theme.secondary, theme.surfaceRaised],
    [theme.danger, theme.surface],
    [theme.danger, theme.surfaceRaised],
    [theme.dangerInk, theme.surfaceRaised],
    [theme.warningInk, theme.surface],
    [theme.warningInk, theme.surfaceRaised]
  ] as const

  const nonTextPairs = [
    // Input, checkbox and toggle outlines must be visible (WCAG 1.4.11).
    [theme.lineStrong, theme.surface],
    [theme.lineStrong, theme.surfaceRaised],
    [theme.focus, theme.surface],
    [theme.focus, theme.surfaceRaised],
    [theme.focus, theme.surfaceHover],
    [theme.focus, theme.soft],
    [theme.focus, theme.nav]
  ] as const

  return (
    normalTextPairs.every(
      ([foreground, background]) => contrastRatio(foreground, background) >= 4.5
    ) &&
    nonTextPairs.every(
      ([foreground, background]) => contrastRatio(foreground, background) >= 3
    )
  )
}

export function resolveAccessibleBrandPresentation(
  brand: BrandPresentation
): BrandPresentation {
  return hasAccessibleBrandContrast(brand) ? brand : defaultBrandPresentation
}
