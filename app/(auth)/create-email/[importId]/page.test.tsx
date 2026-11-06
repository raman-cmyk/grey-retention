import { beforeEach, describe, expect, it, vi } from 'vitest'
import CreateEmailPage from './page'

const { redirect, notFound, requireRequestContext, ChooseOutcome } = vi.hoisted(
  () => ({
    redirect: vi.fn(),
    notFound: vi.fn(),
    requireRequestContext: vi.fn(),
    ChooseOutcome: vi.fn(() => null)
  })
)
vi.mock('next/navigation', () => ({ redirect, notFound }))
vi.mock('@/features/auth/application/request-context', () => ({
  requireRequestContext
}))
vi.mock('@/features/email-generation/choose', () => ({ ChooseOutcome }))

const importId = '00000000-0000-4000-8000-000000000002'
const attempt = '00000000-0000-4000-8000-000000000003'

beforeEach(() => {
  vi.resetAllMocks()
  redirect.mockImplementation(() => {
    throw new Error('NEXT_REDIRECT')
  })
  requireRequestContext.mockResolvedValue({
    tenantId: 't',
    tenantRole: 'owner'
  })
})

function open(search: Record<string, string>) {
  return CreateEmailPage({
    params: Promise.resolve({ importId }),
    searchParams: Promise.resolve(search)
  })
}

describe('/create-email/[importId]', () => {
  it('keeps the composer mode when it adds a retry key', async () => {
    await expect(open({ mode: 'copy' })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(
          `^/create-email/${importId}\\?attempt=[0-9a-f-]{36}&mode=copy$`
        )
      )
    )
  })

  it('ignores unknown mode values', async () => {
    await expect(open({ mode: 'https://evil.example' })).rejects.toThrow(
      'NEXT_REDIRECT'
    )
    expect(redirect.mock.calls[0][0]).not.toContain('mode=')
  })

  it('passes a valid mode through as the marked choice', async () => {
    const page = await open({ attempt, mode: 'rewrite' })
    expect(page.props).toMatchObject({ preferred: 'rewrite', attempt })
    const none = await open({ attempt })
    expect(none.props.preferred).toBeUndefined()
  })
})
