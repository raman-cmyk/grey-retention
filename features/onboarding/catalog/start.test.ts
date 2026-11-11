// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { startCatalogReading } from './start'

type Db = Parameters<typeof startCatalogReading>[0]
const answering = (answer: {
  data: unknown
  error: { code: string } | null
}) => {
  const rpc = vi.fn(async () => answer)
  return { rpc, db: { rpc } as unknown as Db }
}

describe('startCatalogReading', () => {
  it("starts the owner's catalog read and gives its job", async () => {
    const { db, rpc } = answering({ data: 'job-1', error: null })
    expect(await startCatalogReading(db, 'tenant-1')).toEqual({
      ok: true,
      jobId: 'job-1'
    })
    expect(rpc).toHaveBeenCalledWith('start_catalog_reading', { t: 'tenant-1' })
  })

  it('says Klaviyo must be connected, the owner only, or try again', async () => {
    for (const [code, said] of [
      ['23514', 'connect_klaviyo'],
      ['42501', 'access_denied'],
      ['PGRST301', 'unavailable']
    ] as const)
      expect(
        await startCatalogReading(
          answering({ data: null, error: { code } }).db,
          't'
        )
      ).toEqual({
        ok: false,
        code: said
      })
  })
})
