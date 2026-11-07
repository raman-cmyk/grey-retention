// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import type { KeyCheck } from '@/lib/providers/klaviyo/check-key'
import { klaviyoClient } from '@/lib/providers/klaviyo/client'
import { probeKlaviyoKey } from '@/lib/providers/klaviyo/check-key'
import { recordedTransport } from '@/lib/providers/klaviyo/recorded'
import { connectLiveKlaviyo, klaviyoMode, refusalWords } from './live-klaviyo'

afterEach(() => vi.unstubAllEnvs())

const key = 'pk_SAMPLE0123456789abcdefghij'
const hint = 'pk_SAMPL••••••••ghij'
const input = { tenantId: 't1', apiKey: key, hint, brandName: 'Cedar' }
const database = (
  errors: Record<string, { code: string } | undefined> = {}
) => {
  const rpc = vi.fn(async (name: string) => ({
    data: 1,
    error: errors[name] ?? null
  }))
  return { rpc } as unknown as Parameters<typeof connectLiveKlaviyo>[0] & {
    rpc: typeof rpc
  }
}
const recordedCheck =
  (scenario: Parameters<typeof recordedTransport>[0] = {}) =>
  (apiKey: string) =>
    probeKlaviyoKey(
      klaviyoClient(apiKey, {
        transport: recordedTransport(scenario),
        wait: async () => {}
      })
    )
const facts = {
  accountId: 'A1',
  organization: null,
  website: null,
  timezone: null,
  currency: null,
  country: null
}

describe('klaviyoMode', () => {
  it('is live only when KLAVIYO_MODE is exactly live', () => {
    expect(klaviyoMode({ KLAVIYO_MODE: 'live' })).toBe('live')
    for (const env of [
      {},
      { KLAVIYO_MODE: 'fake' },
      { KLAVIYO_MODE: 'LIVE ' },
      { KLAVIYO_MODE: 'real' },
      { NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co' }
    ])
      expect(klaviyoMode(env), JSON.stringify(env)).toBe('sample')
  })
})

describe('refusalWords', () => {
  it('says in plain words why a key cannot be used, and that nothing was saved', () => {
    const words = (c: KeyCheck) => refusalWords(c)!
    expect(words({ ok: false, reason: 'bad_key' })).toMatch(
      /^Klaviyo did not accept this key\..*Nothing was saved\.$/
    )
    expect(words({ ok: false, reason: 'rate_limited' })).toMatch(/slow down/)
    expect(words({ ok: false, reason: 'unavailable' })).toMatch(
      /could not reach Klaviyo/
    )
    expect(words({ ok: false, reason: 'klaviyo_changed' })).toMatch(
      /told the developers/
    )
    const missing = words({
      ok: true,
      account: facts,
      missing: ['catalogs:read', 'events:read'],
      laterMissing: []
    })
    expect(missing).toMatch(/^This key cannot read Catalogs and Events\. /)
    // A new key needs every area, not only the missing ones.
    expect(missing).toContain(
      'Choose Read Access for Accounts, Catalogs, Campaigns, Events, Lists, Metrics and Segments.'
    )
    expect(missing).toContain('Klaviyo cannot change an existing key')
  })
})

describe('connectLiveKlaviyo', () => {
  it('counts the check, asks Klaviyo, then saves the live connection and its facts', async () => {
    const db = database()
    expect(await connectLiveKlaviyo(db, input, recordedCheck())).toMatchObject({
      message: expect.stringMatching(
        /^Klaviyo connected: Cedar Goods\. For now we only read your Klaviyo data\./
      )
    })
    expect(db.rpc.mock.calls.map((c) => c[0])).toEqual([
      'begin_klaviyo_key_check',
      'connect_klaviyo_live'
    ])
    expect(db.rpc).toHaveBeenLastCalledWith('connect_klaviyo_live', {
      t: 't1',
      api_key: key,
      credential_hint: hint,
      account_label: 'Cedar Goods',
      klaviyo_account_id: 'CdrG01',
      api_revision: '2026-10-15',
      later_missing: [],
      account_timezone: 'America/Los_Angeles',
      account_website: 'https://cedar.example',
      account_currency: 'USD',
      account_country: 'US'
    })
  })

  it('saves nothing when the key lacks a scope, is refused, or Klaviyo is away', async () => {
    for (const scenario of [
      { missing: ['catalogs:read' as const] },
      { missing: ['accounts:read' as const] },
      { all: { status: 401, headers: {}, body: '{}' } },
      { all: { status: 503, headers: {}, body: '{}' } }
    ]) {
      const db = database()
      const result = await connectLiveKlaviyo(
        db,
        input,
        recordedCheck(scenario)
      )
      expect(result.error).toMatch(/Nothing was saved\.$/)
      expect(db.rpc).not.toHaveBeenCalledWith(
        'connect_klaviyo_live',
        expect.anything()
      )
    }
  })

  it('stops after too many checks, before calling Klaviyo', async () => {
    const check = vi.fn(recordedCheck())
    const result = await connectLiveKlaviyo(
      database({ begin_klaviyo_key_check: { code: 'PT409' } }),
      input,
      check
    )
    expect(result.error).toMatch(/wait 15 minutes/)
    expect(check).not.toHaveBeenCalled()
  })

  it('refuses to check when the settings name another Klaviyo revision', async () => {
    vi.stubEnv('KLAVIYO_API_REVISION', '2026-07-15')
    const check = vi.fn(recordedCheck())
    const db = database()
    expect((await connectLiveKlaviyo(db, input, check)).error).toMatch(
      /told the developers/
    )
    expect(check).not.toHaveBeenCalled()
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('connects with a note when only later steps lack a scope', async () => {
    const result = await connectLiveKlaviyo(
      database(),
      input,
      recordedCheck({ missing: ['templates:read', 'images:read'] })
    )
    expect(result.message).toMatch(
      /Later, to send emails, GROS also needs Templates and Images/
    )
  })

  it('says the database refused in plain words, never the key', async () => {
    expect(
      await connectLiveKlaviyo(
        database({ connect_klaviyo_live: { code: '42501' } }),
        input,
        recordedCheck()
      )
    ).toEqual({ error: 'Ask your workspace owner to connect accounts.' })
    const other = await connectLiveKlaviyo(
      database({ connect_klaviyo_live: { code: 'XX000' } }),
      input,
      recordedCheck()
    )
    expect(JSON.stringify(other)).not.toContain(key)
  })
})
