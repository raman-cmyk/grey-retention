import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '@/lib/branding/presentation'
import {
  colorThemes,
  colorTokenNames,
  contrastRules,
  cssVariableName,
  scaleTokens,
  type ThemeName
} from './tokens'

const css = readFileSync(
  join(import.meta.dirname, '../../app/styles/tokens.css'),
  'utf8'
)

function declarations(selector: string) {
  const start = css.indexOf(`${selector} {`)
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0)
  const block = css.slice(start, css.indexOf('}', start))
  return new Map(
    [...block.matchAll(/(--gr-[a-z0-9-]+):\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2].replace(/\s+/g, ' ').trim()
    ])
  )
}

describe('design tokens', () => {
  it('publishes the owner-approved palette exactly', () => {
    expect(colorThemes.light).toMatchObject({
      canvas: '#faf9f7',
      'canvas-sunken': '#f0ece8',
      surface: '#ffffff',
      ink: '#111111',
      'ink-muted': '#58544e',
      'ink-subtle': '#787572',
      hairline: '#e5e5e5',
      accent: '#1f40ed',
      'accent-strong': '#0d2189',
      'accent-faint': '#e7ebfd'
    })
    expect(colorThemes.dark).toMatchObject({
      canvas: '#0f0f0e',
      surface: '#171717',
      ink: '#f5f5f4',
      hairline: '#262626',
      accent: '#4d6bff'
    })
    expect(scaleTokens['radius-panel']).toBe('20px')
    expect(scaleTokens['radius-control']).toBe('12px')
    expect(scaleTokens['sidebar-width']).toBe('255px')
    expect(scaleTokens['sidebar-rail']).toBe('56px')
    expect(scaleTokens['content-max']).toBe('1280px')
  })

  it('keeps tokens.css identical to the TypeScript tokens', () => {
    const light = declarations(':root')
    const dark = declarations("[data-theme='dark']")
    for (const name of colorTokenNames) {
      expect(light.get(cssVariableName(name)), name).toBe(
        colorThemes.light[name]
      )
      expect(dark.get(cssVariableName(name)), name).toBe(colorThemes.dark[name])
    }
    for (const [name, value] of Object.entries(scaleTokens))
      expect(light.get(`--gr-${name}`), name).toBe(value)
    expect(light.size).toBe(
      colorTokenNames.length + Object.keys(scaleTokens).length
    )
    expect(dark.size).toBe(colorTokenNames.length)
  })

  it.each(['light', 'dark'] as ThemeName[])(
    'meets WCAG 2.2 AA for every allowed pairing in the %s theme',
    (theme) => {
      const colors = colorThemes[theme]
      for (const rule of contrastRules)
        for (const background of rule.backgrounds) {
          const ratio = contrastRatio(
            colors[rule.foreground],
            colors[background]
          )
          expect(
            ratio,
            `${theme}: ${rule.foreground} on ${background} (${rule.use})`
          ).toBeGreaterThanOrEqual(rule.minimum)
        }
    }
  )

  it('documents the pairings that are too weak for small text', () => {
    // These are the reasons behind the usage limits in docs/DESIGN.md.
    expect(
      contrastRatio(colorThemes.light['ink-subtle'], colorThemes.light.canvas)
    ).toBeLessThan(4.5)
    expect(contrastRatio('#ffffff', colorThemes.dark.accent)).toBeLessThan(4.5)
    expect(
      contrastRatio(colorThemes.dark.accent, colorThemes.dark.canvas)
    ).toBeLessThan(4.5)
    expect(
      contrastRatio(colorThemes.light.hairline, colorThemes.light.canvas)
    ).toBeLessThan(3)
  })
})
