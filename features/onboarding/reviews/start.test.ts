// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { startReviewsReading } from './start'

type Db = Parameters<typeof startReviewsReading>[0]
const answering = (answer: {
  data: unknown
  error: { code: string } | null
}) => {
  const rpc = vi.fn(async () => answer)
  return { rpc, db: { rpc } as unknown as Db }
}

describe('startReviewsReading', () => {
  it("starts the owner's reviews read and gives its job", async () => {
    const { db, rpc } = answering({ data: 'job-1', error: null })
    expect(await startReviewsReading(db, 'tenant-1')).toEqual({
      ok: true,
      jobId: 'job-1'
    })
    expect(rpc).toHaveBeenCalledWith('start_reviews_reading', { t: 'tenant-1' })
  })

  it("says the brand's website is needed, the owner only, or try again", async () => {
    for (const [code, said] of [
      ['23514', 'no_website'],
      ['42501', 'access_denied'],
      ['PGRST301', 'unavailable']
    ] as const)
      expect(
        await startReviewsReading(
          answering({ data: null, error: { code } }).db,
          't'
        )
      ).toEqual({ ok: false, code: said })
  })
})
