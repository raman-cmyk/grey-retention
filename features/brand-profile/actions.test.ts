import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const env = vi.hoisted(() => ({
  values: { AUTH_MODE: 'supabase', AI_DEFAULT_PROVIDER: 'fake' }
}))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)
vi.mock('@/lib/env/server', () => ({ getServerEnvironment: () => env.values }))

import {
  redoAllBrandSections,
  redoBrandSection,
  saveBrandSection
} from './actions'
import { SampleBrandProfileWriter } from './writer'

const tenant = '00000000-0000-4000-8000-000000000101'
function form(values: Record<string, string | string[]>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(values))
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v)
  return data
}

let rpc: ReturnType<typeof vi.fn>
let sectionRows: { section: string; content: object; locked: string[] }[]
beforeEach(() => {
  env.values = { AUTH_MODE: 'supabase', AI_DEFAULT_PROVIDER: 'fake' }
  auth.requireRequestContext.mockResolvedValue({
    tenantId: tenant,
    tenantRole: 'owner',
    tenantName: 'Cedar Lane workspace'
  })
  rpc = vi.fn(async () => ({
    data: { revision: 4, brand_changed: false },
    error: null
  }))
  sectionRows = []
  const query = (table: string) => {
    const chain: Record<string, unknown> = {}
    for (const op of ['select', 'eq', 'order', 'limit']) chain[op] = () => chain
    chain.maybeSingle = async () => ({ data: { brand_name: 'Cedar Lane' } })
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve(
        table === 'products'
          ? { data: [{ title: 'Field overshirt', url: 'https://x.example/p' }] }
          : { data: sectionRows, error: null }
      )
    return chain
  }
  supabase.createClient.mockResolvedValue({ rpc, from: query })
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('saveBrandSection', () => {
  it('saves notes, locks and brand facts with both revisions', async () => {
    const result = await saveBrandSection(
      {},
      form({
        section: 'identity',
        revision: '3',
        brand_revision: '7',
        brand_name: ' Cedar Lane ',
        website: 'cedar-lane.example',
        positioning: 'Quiet layers.\r\nFor weekends.',
        niche: 'Outdoor layers',
        lock: ['niche', 'bogus', 'positioning']
      })
    )
    expect(result).toEqual({ message: 'Saved.' })
    expect(rpc).toHaveBeenCalledWith('save_brand_section', {
      t: tenant,
      section: 'identity',
      expected_revision: 3,
      content: { niche: 'Outdoor layers' },
      locked: ['niche'],
      facts: {
        brand_name: 'Cedar Lane',
        domain: 'cedar-lane.example',
        positioning: 'Quiet layers.\nFor weekends.'
      },
      expected_brand_revision: 7
    })
  })

  it('says approval is needed only when brand facts really changed', async () => {
    rpc.mockResolvedValue({
      data: { revision: 2, brand_changed: true },
      error: null
    })
    const result = await saveBrandSection(
      {},
      form({
        section: 'tone',
        revision: '1',
        brand_revision: '7',
        do: 'Be brief',
        dont: ''
      })
    )
    expect(result.message).toBe(
      'Saved. Your brand details changed: approve the brand again before the AI uses them. Campaigns not sent yet went back to draft.'
    )
  })

  it('sends no brand facts for sections without them', async () => {
    await saveBrandSection(
      {},
      form({ section: 'vocabulary', revision: '0', preferred: 'layers' })
    )
    expect(rpc).toHaveBeenCalledWith('save_brand_section', {
      t: tenant,
      section: 'vocabulary',
      expected_revision: 0,
      content: { preferred: ['layers'] },
      locked: []
    })
  })

  it('refuses staff and demo sessions before reading the form', async () => {
    auth.requireRequestContext.mockResolvedValue({
      tenantId: tenant,
      tenantRole: 'staff',
      tenantName: 'x'
    })
    const staffForm = form({ section: 'identity', revision: '0' })
    const read = vi.spyOn(staffForm, 'get')
    expect(await saveBrandSection({}, staffForm)).toEqual({
      error: 'Only the workspace owner can change the Brand profile.'
    })
    expect(read).not.toHaveBeenCalled()
    auth.requireRequestContext.mockResolvedValue({
      tenantId: tenant,
      tenantRole: 'owner',
      tenantName: 'x'
    })
    env.values = { ...env.values, AUTH_MODE: 'demo' }
    expect(
      (await saveBrandSection({}, form({ section: 'audience', revision: '0' })))
        .error
    ).toBe('Please sign in again. Your changes are still here.')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses bad input without saving', async () => {
    const tries = [
      [{ section: 'pricing', revision: '0' }, 'Reload the page and try again.'],
      [
        { section: 'identity', revision: '1', brand_name: 'Cedar' },
        'Reload the page and try again.'
      ],
      [
        {
          section: 'identity',
          revision: '1',
          brand_revision: '2',
          brand_name: 'C'
        },
        'Brand name: at least 2 characters.'
      ],
      [
        {
          section: 'vocabulary',
          revision: '0',
          avoid: Array(16).fill('x').join('\n')
        },
        'Avoid: at most 15 lines.'
      ]
    ] as const
    for (const [values, error] of tries)
      expect((await saveBrandSection({}, form(values))).error).toBe(error)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('explains each refusal in plain words', async () => {
    const cases = [
      [
        { code: 'PT409', message: 'This section changed in another window' },
        'This section changed in another window. Reload the page to see the latest version.'
      ],
      [
        { code: 'PT409', message: 'Brand details changed in another window' },
        'Your brand details were changed somewhere else (for example on Get started). Reload the page to see them, then edit again.'
      ],
      [
        {
          code: '23514',
          message:
            'Cancel or reconcile active delivery before correcting brand facts'
        },
        'A campaign is on its way to Klaviyo right now. Wait until it is scheduled, or cancel it, before changing the brand details.'
      ],
      [
        { code: '23514', message: 'Save the Brand Identity first' },
        'Save the Brand Identity first (it needs a brand name).'
      ],
      [
        { code: '23514', message: 'Check the section fields' },
        'Check the fields and try again.'
      ],
      [
        { code: '42501', message: 'Access denied' },
        'Only the workspace owner can change the Brand profile.'
      ],
      [
        { code: 'XX000', message: 'boom' },
        'We could not save this section. Nothing was changed. Try again.'
      ]
    ] as const
    for (const [error, text] of cases) {
      rpc.mockResolvedValueOnce({ data: null, error })
      expect(
        (
          await saveBrandSection(
            {},
            form({
              section: 'tone',
              revision: '1',
              brand_revision: '2',
              do: 'x'
            })
          )
        ).error
      ).toBe(text)
    }
  })
})

describe('redoBrandSection', () => {
  it('fills only empty fields, from the saved section', async () => {
    sectionRows = [
      {
        section: 'identity',
        content: { niche: 'Outdoor layers', origin_story: '' },
        locked: ['target_audience']
      }
    ]
    rpc.mockResolvedValue({ data: 3, error: null })
    const result = await redoBrandSection(
      {},
      form({ section: 'identity', revision: '2' })
    )
    expect(result.message).toBe(
      'Sample text added to 2 empty fields (not real AI, nothing was spent). Your own words and locked fields were kept.'
    )
    expect(rpc).toHaveBeenCalledWith('apply_brand_suggestion', {
      t: tenant,
      section: 'identity',
      expected_revision: 2,
      suggestion: {
        geographic_market:
          'Sample: add the country or region you sell to here.',
        origin_story:
          'Sample: add how the brand started, in your own words here.'
      }
    })
  })

  it('never sends an empty value, so a suggestion cannot blank a field', async () => {
    vi.spyOn(
      SampleBrandProfileWriter.prototype,
      'suggest'
    ).mockResolvedValueOnce({
      primary_persona: '',
      pain_points: [],
      age_range: 'Sample: add an age range here.'
    })
    rpc.mockResolvedValue({ data: 2, error: null })
    await redoBrandSection({}, form({ section: 'audience', revision: '1' }))
    expect(rpc).toHaveBeenCalledWith(
      'apply_brand_suggestion',
      expect.objectContaining({
        suggestion: { age_range: 'Sample: add an age range here.' }
      })
    )
  })

  it('changes nothing when there is nothing to fill', async () => {
    const result = await redoBrandSection(
      {},
      form({ section: 'tone', revision: '2' })
    )
    expect(result.message).toMatch(/^Nothing to add/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses when AI is not on the sample provider', async () => {
    env.values = { ...env.values, AI_DEFAULT_PROVIDER: 'openai' }
    expect(
      (await redoBrandSection({}, form({ section: 'audience', revision: '2' })))
        .error
    ).toBe('AI suggestions are not switched on yet. Nothing was changed.')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses staff', async () => {
    auth.requireRequestContext.mockResolvedValue({
      tenantId: tenant,
      tenantRole: 'staff',
      tenantName: 'x'
    })
    expect(
      (await redoBrandSection({}, form({ section: 'audience', revision: '2' })))
        .error
    ).toContain('owner')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('explains a stale redo', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'PT409',
        message: 'This section changed in another window'
      }
    })
    expect(
      (await redoBrandSection({}, form({ section: 'audience', revision: '1' })))
        .error
    ).toContain('changed in another window')
  })
})

describe('redoAllBrandSections', () => {
  const revisions = Object.fromEntries(
    [
      'identity',
      'products',
      'tone',
      'vocabulary',
      'sample_copy',
      'audience'
    ].map((k, i) => [`revision:${k}`, String(i)])
  )

  it('fills every section that has empty fields, each with its revision', async () => {
    rpc.mockResolvedValue({ data: 1, error: null })
    const result = await redoAllBrandSections({}, form(revisions))
    expect(result.message).toMatch(
      /^Sample text added to \d+ empty fields across the profile/
    )
    // Tone has no sample text to add (no facts to guess from).
    expect(
      rpc.mock.calls.map(([, a]) => [a.section, a.expected_revision])
    ).toEqual([
      ['identity', 0],
      ['products', 1],
      ['vocabulary', 3],
      ['sample_copy', 4],
      ['audience', 5]
    ])
  })

  it('stops at the first conflict and says how far it got', async () => {
    rpc.mockResolvedValueOnce({ data: 1, error: null }).mockResolvedValueOnce({
      data: null,
      error: {
        code: 'PT409',
        message: 'This section changed in another window'
      }
    })
    const result = await redoAllBrandSections({}, form(revisions))
    expect(result.error).toMatch(
      /^Sample text added to 4 empty fields before this stopped\. This section changed in another window/
    )
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('needs every revision, and the owner, and the sample writer', async () => {
    expect(
      (await redoAllBrandSections({}, form({ 'revision:identity': '0' }))).error
    ).toBe('Reload the page and try again.')
    env.values = { ...env.values, AI_DEFAULT_PROVIDER: 'openai' }
    expect((await redoAllBrandSections({}, form(revisions))).error).toBe(
      'AI suggestions are not switched on yet. Nothing was changed.'
    )
    auth.requireRequestContext.mockResolvedValue({
      tenantId: tenant,
      tenantRole: 'staff',
      tenantName: 'x'
    })
    expect((await redoAllBrandSections({}, form(revisions))).error).toContain(
      'owner'
    )
    expect(rpc).not.toHaveBeenCalled()
  })
})
