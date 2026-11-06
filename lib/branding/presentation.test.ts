import { describe, expect, it } from 'vitest'
import { colorThemes, scaleTokens } from '@/lib/design/tokens'
import {
  brandCssVariables,
  contrastRatio,
  defaultBrandPresentation,
  hasAccessibleBrandContrast,
  resolveAccessibleBrandPresentation
} from './presentation'

describe('brand presentation contrast', () => {
  it('keeps the default semantic palette above WCAG AA normal-text contrast', () => {
    expect(hasAccessibleBrandContrast(defaultBrandPresentation)).toBe(true)
    expect(
      contrastRatio(
        defaultBrandPresentation.theme.textFaint,
        defaultBrandPresentation.theme.surfaceRaised
      )
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('falls back when a tenant theme creates unreadable branded controls', () => {
    const unsafeBrand = {
      ...defaultBrandPresentation,
      theme: {
        ...defaultBrandPresentation.theme,
        primary: '#111111',
        onBrand: '#111111'
      }
    }

    expect(hasAccessibleBrandContrast(unsafeBrand)).toBe(false)
    expect(resolveAccessibleBrandPresentation(unsafeBrand)).toBe(
      defaultBrandPresentation
    )
  })

  it('rejects invisible focus and danger control treatments', () => {
    const invisibleFocus = {
      ...defaultBrandPresentation,
      theme: {
        ...defaultBrandPresentation.theme,
        focus: defaultBrandPresentation.theme.surface
      }
    }
    const unreadableDanger = {
      ...defaultBrandPresentation,
      theme: {
        ...defaultBrandPresentation.theme,
        danger: '#ffffff',
        dangerStrong: '#ffffff'
      }
    }

    expect(hasAccessibleBrandContrast(invisibleFocus)).toBe(false)
    expect(hasAccessibleBrandContrast(unreadableDanger)).toBe(false)
  })

  it('requires the shared focus token to remain visible on the navigation', () => {
    const invisibleRailFocus = {
      ...defaultBrandPresentation,
      theme: {
        ...defaultBrandPresentation.theme,
        focus: defaultBrandPresentation.theme.nav
      }
    }

    expect(hasAccessibleBrandContrast(invisibleRailFocus)).toBe(false)
  })
})

describe('default theme follows the design language', () => {
  it('builds the default white-label theme from the design tokens', () => {
    const { theme, fonts } = defaultBrandPresentation
    const light = colorThemes.light
    expect(theme).toMatchObject({
      surface: light.canvas,
      surfaceRaised: light.surface,
      surfaceHover: light['canvas-sunken'],
      text: light.ink,
      textMuted: light['ink-muted'],
      line: light.hairline,
      lineStrong: light['hairline-strong'],
      primary: light.ink,
      onBrand: light['on-ink'],
      secondary: light.accent,
      soft: light['accent-faint'],
      focus: light.accent,
      danger: light.danger
    })
    expect(fonts).toEqual({
      display: scaleTokens['font-display'],
      body: scaleTokens['font-ui'],
      data: scaleTokens['font-mono']
    })
  })

  it('never uses the too-light subtle ink for small faint text on the canvas', () => {
    const { theme } = defaultBrandPresentation
    expect(theme.textFaint).not.toBe(colorThemes.light['ink-subtle'])
    expect(
      contrastRatio(theme.textFaint, theme.surface)
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('publishes the semantic variables that components read', () => {
    const variables = brandCssVariables(defaultBrandPresentation)
    expect(variables['--surface']).toBe('#faf9f7')
    expect(variables['--brand-secondary']).toBe('#1f40ed')
    expect(variables['--font-display']).toContain('--font-newsreader')
    expect(variables['--font-data']).toContain('--font-geist-mono')
  })
})

describe('contrast gate covers the roles the design system exposes', () => {
  it.each([
    ['accent links', { secondary: '#ffd400' }],
    ['error text on the page', { danger: '#ff8a80', onDanger: '#000000' }],
    ['warning text on white', { warningInk: '#f0c000' }],
    ['control outlines', { lineStrong: '#f2f2f2' }]
  ])('rejects a tenant theme with unreadable %s', (_, override) => {
    const brand = {
      ...defaultBrandPresentation,
      theme: { ...defaultBrandPresentation.theme, ...override }
    }
    expect(hasAccessibleBrandContrast(brand)).toBe(false)
    expect(resolveAccessibleBrandPresentation(brand)).toBe(
      defaultBrandPresentation
    )
  })
})

describe('key action colours', () => {
  it('publishes readable text for the blue key action', () => {
    const { theme } = defaultBrandPresentation
    expect(
      contrastRatio(theme.onSecondary, theme.secondary)
    ).toBeGreaterThanOrEqual(4.5)
    expect(
      brandCssVariables(defaultBrandPresentation)['--on-brand-secondary']
    ).toBe('#ffffff')
  })

  it('rejects a tenant key action whose label is unreadable', () => {
    const brand = {
      ...defaultBrandPresentation,
      theme: { ...defaultBrandPresentation.theme, onSecondary: '#3355ff' }
    }
    expect(hasAccessibleBrandContrast(brand)).toBe(false)
  })
})

describe('secondary and selected control colours', () => {
  it.each([
    ['selected segment label', { soft: '#3355ff' }],
    ['secondary button fill', { surfaceHover: '#333333' }],
    ['secondary button hover', { line: '#222222' }],
    ['key action hover', { ink: '#9aa8ff' }]
  ])('rejects a tenant theme with an unreadable %s', (_, override) => {
    const brand = {
      ...defaultBrandPresentation,
      theme: { ...defaultBrandPresentation.theme, ...override }
    }
    expect(hasAccessibleBrandContrast(brand)).toBe(false)
  })
})
