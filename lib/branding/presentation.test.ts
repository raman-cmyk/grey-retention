import { describe, expect, it } from 'vitest'
import {
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

  it('requires the shared focus token to remain visible on the dark rail', () => {
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
