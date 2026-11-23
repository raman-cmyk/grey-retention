import { describe, expect, it } from 'vitest'
import { defaultExposurePolicy } from './exposure'
import { exposurePolicy } from './exposure-policy'

describe('exposurePolicy (SEG-EXP-a2)', () => {
  const db = (answer: { data: unknown; error: unknown }) => {
    const eq: unknown[][] = []
    const client = {
      from: () => {
        const chain = {
          select: () => chain,
          eq: (...args: unknown[]) => (eq.push(args), chain),
          maybeSingle: async () => answer
        }
        return chain
      }
    }
    return { client: client as never, eq }
  }

  it('reads the saved policy for the workspace, or the defaults', async () => {
    const saved = db({
      data: {
        window_days: 14,
        max_marketing: 4,
        priority: ['SEGvip'],
        revision: 3
      },
      error: null
    })
    expect(await exposurePolicy(saved.client, 'tenant-1')).toEqual({
      policy: { windowDays: 14, maxMarketing: 4, priority: ['SEGvip'] },
      revision: 3,
      saved: true
    })
    expect(saved.eq).toEqual([['tenant_id', 'tenant-1']])
    expect(
      await exposurePolicy(db({ data: null, error: null }).client, 't')
    ).toEqual({
      policy: defaultExposurePolicy,
      revision: 0,
      saved: false
    })
  })

  it('throws when it cannot be read', async () => {
    await expect(
      exposurePolicy(db({ data: null, error: { code: '42501' } }).client, 't')
    ).rejects.toEqual({ code: '42501' })
    await expect(
      exposurePolicy(
        db({
          data: { window_days: 0, max_marketing: 3, priority: [], revision: 1 },
          error: null
        }).client,
        't'
      )
    ).rejects.toThrow()
  })
})
