// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }))
vi.mock('next/cache', () => cache)
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const writes = vi.hoisted(() => ({ rewriteBrandBookSoon: vi.fn() }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)
vi.mock('@/features/onboarding/brand-book-writes', () => writes)

import {
  resolveTokens,
  tokenKeys,
  tokenText
} from '@/features/design-engine/tokens'
import type { Correction } from '@/features/onboarding/brand-book-corrections'
import { correctBrandBookDesign } from './book-actions'
import { sourceText, tokenInput, tokenWords } from './book-design'
import { brandBookView, type BookRow } from './book-view'

/**
 * PICK-006: the design tokens in the Brand book: shown with their sources,
 * corrected by the owner (checked against the email-safe range, never
 * changed quietly), an emptied field taking his correction back.
 */
const tenant = '00000000-0000-4000-8000-000000000101'
const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [k, v] of Object.entries(values)) data.set(k, v)
  return data
}
const site = resolveTokens({
  site: { 'radius.button': 4, 'button.style': 'filled', 'type.h1': 36 }
})
const shownTexts = Object.fromEntries(
  tokenKeys.map((k) => [`was_${k}`, tokenText(k, site[k].value)])
)
const typedTexts = Object.fromEntries(
  tokenKeys.map((k) => [k, tokenText(k, site[k].value)])
)

let rpc: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.stubEnv('AUTH_MODE', 'supabase')
  auth.requireRequestContext.mockResolvedValue({
    tenantId: tenant,
    tenantRole: 'owner'
  })
  rpc = vi.fn(async () => ({ data: 1, error: null }))
  supabase.createClient.mockResolvedValue({ rpc })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('tokenInput', () => {
  it('reads the owner’s words as checked values', () => {
    expect(tokenInput('radius.button', ' 12px ')).toEqual({ value: '12' })
    expect(tokenInput('type.lineHeight', '1.6')).toEqual({ value: '1.6' })
    expect(tokenInput('spacing.steps', '16, 8 24')).toEqual({
      value: '8, 16, 24'
    })
    expect(tokenInput('button.case', 'Capitals')).toEqual({
      value: 'uppercase'
    })
    expect(tokenInput('type.headingCase', 'as written')).toEqual({
      value: 'none'
    })
    expect(tokenInput('button.style', 'Outline')).toEqual({ value: 'outline' })
    expect(tokenInput('radius.card', '')).toEqual({ value: null })
  })

  it('refuses a value outside the email-safe range, with the range', () => {
    expect(tokenInput('radius.button', '40')).toEqual({
      error: 'Button corners: whole px from 0 to 24.'
    })
    expect(tokenInput('type.body', '12')).toEqual({
      error: 'Body text: whole px from 14 to 20.'
    })
    expect(tokenInput('button.weight', '650')).toHaveProperty('error')
    expect(tokenInput('button.style', 'ghost')).toHaveProperty('error')
    expect(tokenInput('spacing.steps', '8, 100')).toHaveProperty('error')
    expect(tokenInput('spacing.steps', '8')).toHaveProperty('error')
    expect(tokenInput('type.h1', 'big')).toHaveProperty('error')
  })

  it('says a value and its source in words', () => {
    expect(tokenWords('spacing.steps', [8, 16])).toBe('8, 16 px')
    expect(tokenWords('radius.button', 4)).toBe('4 px')
    expect(tokenWords('type.lineHeight', 1.5)).toBe('1.5')
    expect(tokenWords('button.case', 'uppercase')).toBe('Capitals')
    expect(tokenWords('button.style', 'outline')).toBe('Outline')
    expect(sourceText('site')).toBe('From your website')
    expect(sourceText('default', 'GROS')).toBe('GROS default')
    expect(sourceText('owner')).toBe('Your correction')
  })
})

describe('correctBrandBookDesign', () => {
  it('sends only the tokens he changed, against the version shown', async () => {
    expect(
      await correctBrandBookDesign(
        {},
        form({
          version: '7',
          ...shownTexts,
          ...typedTexts,
          'radius.button': '12',
          'button.style': 'outline'
        })
      )
    ).toEqual({ message: 'Design saved. Rewriting the Brand book.' })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('correct_brand_book_at', {
      t: tenant,
      expected_version: 7,
      corrections: [
        {
          section: 'tokens.radius.button',
          original: null,
          action: 'replace',
          value: '12'
        },
        {
          section: 'tokens.button.style',
          original: null,
          action: 'replace',
          value: 'outline'
        }
      ]
    })
    expect(writes.rewriteBrandBookSoon).toHaveBeenCalledExactlyOnceWith(tenant)
  })

  it('takes his own correction back when he empties its field, and ignores an emptied site value', async () => {
    await correctBrandBookDesign(
      {},
      form({
        version: '7',
        ...shownTexts,
        ...typedTexts,
        'own_radius.button': '1',
        'radius.button': '',
        'type.h1': ''
      })
    )
    expect(rpc.mock.calls[0]![1].corrections).toEqual([
      {
        section: 'tokens.radius.button',
        original: null,
        action: 'remove',
        value: null
      }
    ])
  })

  it('refuses a value outside the range before any write', async () => {
    expect(
      await correctBrandBookDesign(
        {},
        form({ version: '7', ...shownTexts, ...typedTexts, 'type.h1': '90' })
      )
    ).toEqual({ error: 'Headline: whole px from 24 to 48.' })
    expect(
      await correctBrandBookDesign(
        {},
        form({ version: '7', ...shownTexts, ...typedTexts })
      )
    ).toEqual({ error: 'Change a value first.' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('is the owner’s only', async () => {
    auth.requireRequestContext.mockResolvedValue({
      tenantId: tenant,
      tenantRole: 'staff'
    })
    expect(
      await correctBrandBookDesign(
        {},
        form({ version: '7', ...shownTexts, ...typedTexts, 'radius.card': '2' })
      )
    ).toEqual({ error: 'Only the workspace owner can correct the Brand book.' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('says the database’s refusal in words', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'PT409', hint: 'brand_book_changed' }
    })
    expect(
      await correctBrandBookDesign(
        {},
        form({ version: '7', ...shownTexts, ...typedTexts, 'radius.card': '2' })
      )
    ).toEqual({
      error:
        'Your Brand book changed since you opened it. Open it again, then correct it.'
    })
  })
})

describe('the Brand book view of the tokens', () => {
  const row = (content: unknown): BookRow => ({
    version: 3,
    content,
    written_by: 'brand-book@2',
    created_at: '2026-11-27T10:00:00.000Z'
  })

  it('lists every token by group with its source', () => {
    const view = brandBookView(
      row({
        design: resolveTokens({
          site: { 'radius.button': 4 },
          owner: { 'type.h1': 40 }
        })
      })
    )!
    expect(view.design?.map((g) => g.label)).toEqual([
      'Spacing',
      'Type',
      'Corners',
      'Buttons'
    ])
    const lines = view.design!.flatMap((g) => g.lines)
    expect(lines).toHaveLength(tokenKeys.length)
    expect(lines.find((l) => l.key === 'radius.button')).toMatchObject({
      label: 'Button corners',
      value: '4 px',
      source: 'site',
      sourceText: 'From your website'
    })
    expect(lines.find((l) => l.key === 'type.h1')).toMatchObject({
      value: '40 px',
      source: 'owner'
    })
    expect(lines.find((l) => l.key === 'radius.card')?.source).toBe('default')
    expect(view.designTexts['radius.button']).toBe('4')
    expect(view.designOwn).toEqual(['type.h1'])
  })

  it('shows none for a book written before tokens, and drops a value it cannot read', () => {
    const before = brandBookView(row({ facts: {} }))!
    expect(before.design).toBeNull()
    expect(before.designTexts['radius.button']).toBe('')
    const odd = brandBookView(
      row({
        design: {
          'radius.button': { value: 'round', source: 'site' },
          'radius.card': { value: 4, source: 'guess' },
          'radius.image': { value: 6, source: 'site' }
        }
      })
    )!
    expect(odd.design!.flatMap((g) => g.lines).map((l) => l.key)).toEqual([
      'radius.image'
    ])
  })

  it('names the owner’s token corrections in words', () => {
    const corrections: Correction[] = [
      {
        id: 'c1',
        section: 'tokens.radius.button',
        original: null,
        action: 'replace',
        value: '12',
        createdAt: '2026-11-27T09:00:00.000Z'
      },
      {
        id: 'c2',
        section: 'tokens.button.style',
        original: null,
        action: 'remove',
        value: null,
        createdAt: '2026-11-27T11:00:00.000Z'
      }
    ]
    const view = brandBookView(
      row({ design: resolveTokens({}), corrected: ['tokens.radius.button'] }),
      corrections
    )!
    expect(view.corrections).toEqual([
      { id: 'c1', label: 'Button corners', text: '12 px', pending: false },
      {
        id: 'c2',
        label: 'Button style',
        text: 'Back to your website’s value, or the default',
        pending: true
      }
    ])
    expect(view.corrected).toEqual(['Button corners'])
  })
})
