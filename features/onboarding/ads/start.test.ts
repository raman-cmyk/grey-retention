// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { startAdsReading } from './start'

type Db = Parameters<typeof startAdsReading>[0]
const answering = (answer: {
  data: unknown
  error: { code: string } | null
}) => {
  const rpc = vi.fn(async () => answer)
  return { rpc, db: { rpc } as unknown as Db }
}

describe('startAdsReading', () => {
  it("starts the owner's ads read and gives its job", async () => {
    const { db, rpc } = answering({ data: 'job-1', error: null })
    expect(await startAdsReading(db, 'tenant-1')).toEqual({
      ok: true,
      jobId: 'job-1'
    })
    expect(rpc).toHaveBeenCalledWith('start_ads_reading', { t: 'tenant-1' })
  })

  it("says the brand's website is needed, the owner only, or try again", async () => {
    for (const [code, said] of [
      ['23514', 'no_website'],
      ['42501', 'access_denied'],
      ['PGRST301', 'unavailable']
    ] as const)
      expect(
        await startAdsReading(
          answering({ data: null, error: { code } }).db,
          't'
        )
      ).toEqual({ ok: false, code: said })
  })
})
