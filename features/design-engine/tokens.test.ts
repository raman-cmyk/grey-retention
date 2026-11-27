import { describe, expect, it } from 'vitest'
import {
  clampToken,
  clampTokens,
  designTokensSchema,
  givenTokens,
  resolveTokens,
  snapTo,
  stepsOf,
  tokenDefaults,
  tokenFromText,
  tokenKeys,
  tokenLimits,
  tokenText,
  tokenValues
} from './tokens'

describe('design tokens (PICK-006)', () => {
  it('has a default for every token, each inside its own limits', () => {
    for (const key of tokenKeys) {
      expect(tokenDefaults[key]).toBeDefined()
      expect(clampToken(key, tokenDefaults[key])).toEqual(tokenDefaults[key])
    }
  })

  it('gives the defaults, marked default, when the site gives nothing', () => {
    const t = resolveTokens({})
    for (const key of tokenKeys) {
      expect(t[key].source).toBe('default')
      expect(t[key].value).toEqual(tokenDefaults[key])
    }
    expect(givenTokens(t)).toEqual({})
    expect(tokenValues(t)).toEqual(tokenDefaults)
    expect(designTokensSchema.safeParse(t).success).toBe(true)
  })

  it('takes the site’s values, marked site, the rest default', () => {
    const t = resolveTokens({
      site: { 'radius.button': 4, 'button.style': 'outline' }
    })
    expect(t['radius.button']).toEqual({ value: 4, source: 'site' })
    expect(t['button.style']).toEqual({ value: 'outline', source: 'site' })
    expect(t['radius.card']).toEqual({ value: 8, source: 'default' })
    expect(givenTokens(t)).toEqual({
      'radius.button': 4,
      'button.style': 'outline'
    })
  })

  it('lets the owner’s edits win over the site’s values', () => {
    const t = resolveTokens({
      site: { 'radius.button': 4, 'type.h1': 40 },
      owner: { 'radius.button': 12 }
    })
    expect(t['radius.button']).toEqual({ value: 12, source: 'owner' })
    expect(t['type.h1']).toEqual({ value: 40, source: 'site' })
  })

  it('clamps every value to the email-safe range, and drops what is not a token', () => {
    expect(clampToken('type.body', 9)).toBe(tokenLimits['type.body'].min)
    expect(clampToken('type.h1', 120)).toBe(48)
    expect(clampToken('radius.button', 999)).toBe(24)
    expect(clampToken('radius.card', -3)).toBe(0)
    expect(clampToken('button.weight', 650)).toBe(700)
    expect(clampToken('type.lineHeight', 1.33)).toBe(1.35)
    expect(clampToken('type.lineHeight', 3)).toBe(1.8)
    expect(clampToken('button.style', 'ghost')).toBeUndefined()
    expect(clampToken('type.body', '16')).toBeUndefined()
    expect(clampToken('type.body', Number.NaN)).toBeUndefined()
    expect(clampToken('spacing.steps', [32, 8, 8, 200, 4])).toEqual([
      4, 8, 32, 64
    ])
    expect(clampToken('spacing.steps', [8])).toBeUndefined()
    expect(
      clampTokens({ 'type.body': 15, nope: 3, 'radius.card': 'x' })
    ).toEqual({ 'type.body': 15 })
  })

  it('never has a heading smaller than the text below it', () => {
    const t = resolveTokens({
      site: { 'type.body': 18, 'type.h3': 16, 'type.h2': 18, 'type.h1': 24 }
    })
    expect(t['type.h3'].value).toBe(18)
    expect(t['type.h2'].value).toBe(18)
    expect(t['type.h1'].value).toBe(24)
  })

  it('derives the spaces from a unit the site gave without a scale', () => {
    expect(stepsOf(6)).toEqual([6, 12, 18, 24, 36, 48])
    const t = resolveTokens({ site: { 'spacing.base': 6 } })
    expect(t['spacing.steps'].value).toEqual([6, 12, 18, 24, 36, 48])
    expect(t['spacing.steps'].source).toBe('default')
  })

  it('snaps to the nearest step', () => {
    expect(snapTo(27, [8, 16, 24, 32])).toBe(24)
    expect(snapTo(29, [8, 16, 24, 32])).toBe(32)
    expect(snapTo(20, [8, 16, 24, 32])).toBe(16)
  })

  it('reads and writes the owner’s typed values', () => {
    expect(tokenFromText('radius.button', ' 12 ')).toBe(12)
    expect(tokenFromText('radius.button', '40')).toBe(24)
    expect(tokenFromText('type.lineHeight', '1.6')).toBe(1.6)
    expect(tokenFromText('spacing.steps', '4, 8,16 , 24')).toEqual([
      4, 8, 16, 24
    ])
    expect(tokenFromText('button.style', 'Outline')).toBe('outline')
    expect(tokenFromText('button.case', 'uppercase')).toBe('uppercase')
    expect(tokenFromText('button.style', 'ghost')).toBeUndefined()
    expect(tokenFromText('type.body', '16px')).toBeUndefined()
    expect(tokenFromText('type.body', '')).toBeUndefined()
    expect(tokenFromText('spacing.steps', '8')).toBeUndefined()
    expect(tokenText('spacing.steps', [4, 8, 16])).toBe('4, 8, 16')
    expect(tokenText('type.lineHeight', 1.5)).toBe('1.5')
    expect(tokenText('button.style', 'filled')).toBe('filled')
  })

  it('refuses tokens outside the limits in a copy’s input', () => {
    const t = resolveTokens({})
    expect(
      designTokensSchema.safeParse({
        ...t,
        'radius.button': { value: 80, source: 'site' }
      }).success
    ).toBe(false)
    expect(
      designTokensSchema.safeParse({
        ...t,
        extra: { value: 1, source: 'site' }
      }).success
    ).toBe(false)
  })
})
