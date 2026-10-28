import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importPastedReference } from './pasted-actions'
import { pastedLimits } from './pasted'
const { requireRequestContext, createClient, rpc, redirect, revalidatePath } =
  vi.hoisted(() => ({
    requireRequestContext: vi.fn(),
    createClient: vi.fn(),
    rpc: vi.fn(),
    redirect: vi.fn(),
    revalidatePath: vi.fn()
  }))
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
    subject: '  Our spring note  ',
    body: '<p>Hello</p>\r\n<script>alert(1)</script><p>Shop the edit</p>',
    sourceDescription: 'A newsletter I liked',
    sourceUrl: 'https://Shop.Example/spring',
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
describe('Pasted reference import command', () => {
  it('saves server-derived readable text for the authorized tenant and opens the rewrite-or-copy choice', async () => {
    const data = form()
    data.set('tenantId', crypto.randomUUID())
    await expect(importPastedReference({}, data)).rejects.toThrow(
      'NEXT_REDIRECT'
    )
    expect(rpc).toHaveBeenCalledWith('import_pasted_reference', {
      t: tenantId,
      request_key: data.get('requestKey'),
      input: {
        subject: 'Our spring note',
        body: '<p>Hello</p>\r\n<script>alert(1)</script><p>Shop the edit</p>',
        readable_text: 'Hello\n\nShop the edit',
        source_description: 'A newsletter I liked',
        source_url: 'https://shop.example/spring'
      }
    })
    expect(redirect).toHaveBeenCalledWith(`/create-email/${referenceId}`)
    expect(revalidatePath).toHaveBeenCalledWith('/get-started')
  })
  it('keeps CRLF in the original, normalizes only the preview and replays identically', async () => {
    const requestKey = crypto.randomUUID()
    const body = 'First line\r\n\r\nSecond line\rThird line\nFourth line'
    for (let attempt = 0; attempt < 2; attempt++)
      await expect(
        importPastedReference({}, form({ requestKey, body }))
      ).rejects.toThrow('NEXT_REDIRECT')
    const [first, second] = rpc.mock.calls.map(
      (call) => call[1].input as Record<string, string>
    )
    expect(first.body).toBe(body)
    expect(first.readable_text).toBe(
      'First line\n\nSecond line\nThird line\nFourth line'
    )
    expect(first.readable_text).not.toContain('\r')
    // Same received payload produces the same command input and request key.
    expect(second).toEqual(first)
    expect(rpc.mock.calls[1][1].request_key).toBe(requestKey)
  })
  it('keeps an emoji at the preview bound whole in the original and never half in the preview', async () => {
    const emoji = String.fromCodePoint(0x1f600)
    const body = `${'a'.repeat(19999)}${emoji}tail`
    await expect(importPastedReference({}, form({ body }))).rejects.toThrow(
      'NEXT_REDIRECT'
    )
    const input = rpc.mock.calls[0][1].input as Record<string, string>
    expect(input.body).toBe(body)
    expect(input.readable_text).toHaveLength(20000)
    expect(input.readable_text.endsWith(String.fromCodePoint(0x2026))).toBe(
      true
    )
    // Lone surrogates cannot be encoded as well-formed UTF-8/JSON text.
    expect(input.readable_text.isWellFormed()).toBe(true)
    expect(JSON.parse(JSON.stringify(input))).toEqual(input)
  })
  it('denies staff before creating a database client', async () => {
    requireRequestContext.mockResolvedValue({ tenantId, tenantRole: 'staff' })
    expect(await importPastedReference({}, form())).toEqual({
      error: 'Ask your workspace owner to add reference emails.'
    })
    expect(createClient).not.toHaveBeenCalled()
  })
  it('rejects oversized, unreadable and unsafe-address input before mutation', async () => {
    expect(
      (
        await importPastedReference(
          {},
          form({ body: 'x'.repeat(pastedLimits.body + 1) })
        )
      ).error
    ).toContain('too long')
    expect(
      (
        await importPastedReference(
          {},
          form({
            body: '<img src="https://tracker.example/p.gif"><style></style>'
          })
        )
      ).error
    ).toContain('readable text')
    expect(
      (
        await importPastedReference(
          {},
          form({ sourceUrl: 'javascript:alert(1)' })
        )
      ).error
    ).toContain('http://')
    expect(
      (await importPastedReference({}, form({ subject: ' ' }))).error
    ).toContain('subject line')
    expect(
      (await importPastedReference({}, form({ requestKey: 'replay' }))).error
    ).toContain('subject line')
    expect(rpc).not.toHaveBeenCalled()
  })
  it('reports conflicting replays and failures without redirecting', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PT409' } })
    expect((await importPastedReference({}, form())).error).toContain(
      'already used to save a different email'
    )
    rpc.mockResolvedValue({ data: null, error: { code: '08006' } })
    expect((await importPastedReference({}, form())).error).toContain(
      'Your text is still here'
    )
    expect(redirect).not.toHaveBeenCalled()
  })
})
