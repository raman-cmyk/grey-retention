import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)

import {
  redoAllBrandSections,
  redoBrandSection,
  saveBrandSection
} from './actions'

const tenant = '00000000-0000-4000-8000-000000000101'
function form(values: Record<string, string | string[]>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(values))
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v)
  return data
}

let rpc: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.stubEnv('AI_DEFAULT_PROVIDER', 'fake')
  vi.stubEnv('AUTH_MODE', 'supabase')
  auth.requireRequestContext.mockResolvedValue({
    tenantId: tenant,
    tenantRole: 'owner',
    tenantName: 'Cedar Lane workspace'
  })
  rpc = vi.fn(async () => ({ data: 2, error: null }))
  const query = (data: unknown) => {
    const chain: Record<string, unknown> = {}
    for (const op of ['select', 'eq', 'order', 'limit']) chain[op] = () => chain
    chain.maybeSingle = async () => ({ data })
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve({
        data: [{ title: 'Field overshirt', url: 'https://x.example/p' }]
      })
    return chain
  }
  supabase.createClient.mockResolvedValue({
    rpc,
    from: (table: string) =>
      query(
        table === 'brand_profiles'
          ? {
              brand_name: 'Cedar Lane',
              domain: 'cedar-lane.example',
              positioning: 'Quiet layers.',
              voice: 'Calm.',
              prohibitions: 'No hype.'
            }
          : null
      )
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('saveBrandSection', () => {
  it('saves the owner’s edit with locks and says when re-approval is needed', async () => {
    const result = await saveBrandSection(
      {},
      form({
        section: 'identity',
        revision: '3',
        brand_name: ' Cedar Lane ',
        niche: 'Outdoor layers',
        lock: ['niche', 'bogus']
      })
    )
    expect(result.message).toBe(
      'Saved. Your brand needs approving again before the AI uses the change.'
    )
    expect(rpc).toHaveBeenCalledWith('save_brand_section', {
      t: tenant,
      section: 'identity',
      expected_revision: 3,
      content: { brand_name: 'Cedar Lane', niche: 'Outdoor layers' },
      locked: ['niche']
    })
  })

  it('does not mention approval for sections the AI does not read directly', async () => {
    const result = await saveBrandSection(
      {},
      form({ section: 'vocabulary', revision: '0', preferred: 'layers' })
    )
    expect(result.message).toBe('Saved.')
  })

  it('refuses staff before reading the form', async () => {
    auth.requireRequestContext.mockResolvedValue({
      tenantId: tenant,
      tenantRole: 'staff',
      tenantName: 'x'
    })
    expect(
      await saveBrandSection({}, form({ section: 'identity', revision: '0' }))
    ).toEqual({
      error: 'Only the workspace owner can change the Brand profile.'
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses unknown sections and too-long fields without saving', async () => {
    expect(
      (await saveBrandSection({}, form({ section: 'pricing', revision: '0' })))
        .error
    ).toBe('Reload the page and try again.')
    expect(
      (
        await saveBrandSection(
          {},
          form({
            section: 'tone',
            revision: '0',
            do: Array(16).fill('x').join('\n')
          })
        )
      ).error
    ).toBe('Do: at most 15 lines.')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('explains a stale edit instead of overwriting it', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PT409' } })
    expect(
      (await saveBrandSection({}, form({ section: 'audience', revision: '1' })))
        .error
    ).toContain('changed in another window')
  })
})

describe('redoBrandSection', () => {
  it('applies a sample suggestion built from saved facts', async () => {
    const result = await redoBrandSection(
      {},
      form({ section: 'tone', revision: '2' })
    )
    expect(result.message).toBe(
      'Sample suggestion applied (not real AI, nothing was spent). Fields you locked were kept.'
    )
    const [name, args] = rpc.mock.calls[0]!
    expect(name).toBe('apply_brand_suggestion')
    expect(args).toMatchObject({
      t: tenant,
      section: 'tone',
      expected_revision: 2
    })
    expect(args.suggestion.do).toEqual(['Calm'])
    expect(args.suggestion.dont).toEqual(['No hype'])
  })

  it('refuses when AI is not on the sample provider', async () => {
    vi.stubEnv('AI_DEFAULT_PROVIDER', 'openai')
    expect(
      (await redoBrandSection({}, form({ section: 'tone', revision: '2' })))
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
      (await redoBrandSection({}, form({ section: 'tone', revision: '2' })))
        .error
    ).toContain('owner')
    expect(rpc).not.toHaveBeenCalled()
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

  it('redoes every section with its own revision', async () => {
    const result = await redoAllBrandSections({}, form(revisions))
    expect(result.message).toContain('every section')
    expect(
      rpc.mock.calls.map(([, a]) => [a.section, a.expected_revision])
    ).toEqual([
      ['identity', 0],
      ['products', 1],
      ['tone', 2],
      ['vocabulary', 3],
      ['sample_copy', 4],
      ['audience', 5]
    ])
  })

  it('stops at the first conflict and says how far it got', async () => {
    rpc
      .mockResolvedValueOnce({ data: 1, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: 'PT409' } })
    const result = await redoAllBrandSections({}, form(revisions))
    expect(result.error).toMatch(
      /^1 of 6 sections updated\. This section changed in another window/
    )
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('needs every revision', async () => {
    expect(
      (await redoAllBrandSections({}, form({ 'revision:identity': '0' }))).error
    ).toBe('Reload the page and try again.')
    expect(rpc).not.toHaveBeenCalled()
  })
})
