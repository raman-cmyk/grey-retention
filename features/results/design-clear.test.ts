// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { clearDesignChange } from './design-clear'

const build = '00000000-0000-4000-8000-00000000b301'
const db = (error: { code: string } | null) => {
  const rpc = vi.fn(async () => ({ data: null, error }))
  return { db: { rpc } as never, rpc }
}

describe('an operator clears a design change seen in error (PICK-99)', () => {
  it('asks the database with the build and the reason, trimmed', async () => {
    const { db: client, rpc } = db(null)
    expect(
      await clearDesignChange(client, {
        buildId: build,
        reason: '  Klaviyo re-saved our HTML  '
      })
    ).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('clear_klaviyo_design_change', {
      build,
      reason: 'Klaviyo re-saved our HTML'
    })
  })

  it('refuses bad input before the database', async () => {
    const { db: client, rpc } = db(null)
    for (const raw of [
      { buildId: 'b1', reason: 'A reason' },
      { buildId: build, reason: 'no' },
      { buildId: build, reason: 'x'.repeat(501) },
      null
    ])
      expect(await clearDesignChange(client, raw)).toEqual({
        ok: false,
        code: 'invalid'
      })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('says why the database refused: not an operator, a check holds it, or else', async () => {
    for (const [code, out] of [
      ['42501', 'denied'],
      ['PT409', 'busy'],
      ['23514', 'invalid'],
      ['PGRST000', 'failed']
    ] as const)
      expect(
        await clearDesignChange(db({ code }).db, {
          buildId: build,
          reason: 'A reason'
        })
      ).toEqual({ ok: false, code: out })
  })
})
