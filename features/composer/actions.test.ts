import { beforeEach, describe, expect, it, vi } from 'vitest'
import { composeEmail } from './actions'

const { requireRequestContext, createClient, rpc, redirect, revalidatePath } =
  vi.hoisted(() => ({
    requireRequestContext: vi.fn(),
    createClient: vi.fn(),
    rpc: vi.fn(),
    redirect: vi.fn(),
    revalidatePath: vi.fn()
  }))
vi.mock('server-only', () => ({}))
vi.mock('@/features/auth/application/request-context', () => ({
  requireRequestContext
}))
vi.mock('@/lib/supabase/server', () => ({ createClient }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('next/cache', () => ({ revalidatePath }))

const tenantId = crypto.randomUUID()
const referenceId = crypto.randomUUID()
function form(overrides: Record<string, string> = {}) {
  const data = new FormData()
  for (const [key, value] of Object.entries({
    requestKey: crypto.randomUUID(),
    mode: 'rebrand',
    body: '<title>Spring edit</title><p>Shop the new collection</p>',
    ...overrides
  }))
    data.set(key, value)
  return data
}

beforeEach(() => {
  vi.resetAllMocks()
  requireRequestContext.mockResolvedValue({ tenantId, tenantRole: 'owner' })
  createClient.mockResolvedValue({ rpc })
  rpc.mockResolvedValue({ data: referenceId, error: null })
  redirect.mockImplementation(() => {
    throw new Error('NEXT_REDIRECT')
  })
})

describe('composeEmail', () => {
  it('saves the paste and opens the choice page with Rebrand marked', async () => {
    await expect(composeEmail({}, form())).rejects.toThrow('NEXT_REDIRECT')
    expect(rpc).toHaveBeenCalledWith(
      'import_pasted_reference',
      expect.objectContaining({
        t: tenantId,
        input: expect.objectContaining({
          subject: 'Spring edit',
          body: '<title>Spring edit</title><p>Shop the new collection</p>',
          source_description: 'Pasted in the composer',
          source_url: ''
        })
      })
    )
    expect(redirect).toHaveBeenCalledWith(
      `/create-email/${referenceId}?mode=rewrite`
    )
  })

  it('marks Copy for Exact mode', async () => {
    await expect(composeEmail({}, form({ mode: 'exact' }))).rejects.toThrow(
      'NEXT_REDIRECT'
    )
    expect(redirect).toHaveBeenCalledWith(
      `/create-email/${referenceId}?mode=copy`
    )
  })

  it('only lets the workspace owner add emails', async () => {
    requireRequestContext.mockResolvedValue({ tenantId, tenantRole: 'staff' })
    expect(await composeEmail({}, form())).toEqual({
      error: 'Ask your workspace owner to add reference emails.'
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses modes that are not available and empty pastes', async () => {
    expect(await composeEmail({}, form({ mode: 'adapt' }))).toEqual({
      error: 'Choose Exact or Rebrand. Adapt is not available yet.'
    })
    expect(await composeEmail({}, form({ body: '   ' }))).toEqual({
      error: 'Paste an email first.'
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('explains that links cannot be read yet instead of saving them', async () => {
    const result = await composeEmail(
      {},
      form({ body: 'https://brand.example/newsletter' })
    )
    expect(result.error).toMatch(/link is not available yet/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('passes save failures through and keeps the owner on the page', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PT409' } })
    expect(await composeEmail({}, form())).toEqual({
      error:
        'This box was already used to save a different email. Copy your text, reload the page and paste it again.'
    })
    expect(redirect).not.toHaveBeenCalled()
  })

  it('rejects an oversized paste before any parsing', async () => {
    const result = await composeEmail(
      {},
      form({ body: `<title>${'x'.repeat(100_001)}` })
    )
    expect(result.error).toMatch(/too long/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('explains the saved-email limit in composer words', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23514' } })
    const result = await composeEmail({}, form())
    expect(result.error).toMatch(/up to 500 added emails/)
    expect(result.error).not.toMatch(/web address/)
  })
})
