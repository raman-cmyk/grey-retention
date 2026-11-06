import { describe, expect, it, vi } from 'vitest'

const redirect = vi.fn((to: string) => {
  throw new Error(`redirect:${to}`)
})
vi.mock('next/navigation', () => ({ redirect }))
const { default: DraftsPage } =
  await import('@/app/(client)/campaign-drafts/page')
const { default: NewDraftPage } =
  await import('@/app/(client)/campaign-drafts/new/page')
const { default: DraftPage } =
  await import('@/app/(client)/campaign-drafts/[draftId]/page')

describe('old campaign drafts links (UIR-017)', () => {
  it('open the Campaigns table and keep the status filter', async () => {
    await expect(
      DraftsPage({ searchParams: Promise.resolve({ status: 'ready' }) })
    ).rejects.toThrow(
      'redirect:/campaign-agent?view=table&status=needs_approval'
    )
    await expect(
      DraftsPage({ searchParams: Promise.resolve({}) })
    ).rejects.toThrow('redirect:/campaign-agent?view=table')
    await expect(
      DraftsPage({ searchParams: Promise.resolve({ status: ['pushed'] }) })
    ).rejects.toThrow('redirect:/campaign-agent?view=table&status=scheduled')
  })

  it('send New to the first draft and a draft to its campaign page', async () => {
    expect(() => NewDraftPage()).toThrow('redirect:/first-draft')
    await expect(
      DraftPage({ params: Promise.resolve({ draftId: 'a/b' }) })
    ).rejects.toThrow('redirect:/campaigns/a%2Fb')
  })
})
