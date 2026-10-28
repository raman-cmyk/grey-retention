import { describe, it, expect } from 'vitest'
import { cronAuthorized, localFixtureDispatch } from './gate'
describe('fixture transport gates', () => {
  const secret = 'original-synthetic-cron-secret-32-characters'
  it('denies missing, short, malformed and incorrect authorization', () => {
    for (const [header, key] of [
      [null, secret],
      ['Bearer wrong', secret],
      [`Bearer ${secret}`, undefined],
      [`Bearer ${secret}`, 'short'],
      [`Basic ${secret}`, secret]
    ] as const)
      expect(cronAuthorized(header, key)).toBe(false)
    expect(cronAuthorized(`Bearer ${secret}`, secret)).toBe(true)
  })
  it('denies real or unset mode and every non-loopback URL', () => {
    for (const [mode, url] of [
      ['real', 'http://127.0.0.1:54321'],
      [undefined, 'http://127.0.0.1:54321'],
      ['fake', 'https://remote.supabase.co'],
      ['fake', 'http://127.0.0.1.attacker.example'],
      ['fake', 'invalid']
    ] as const)
      expect(localFixtureDispatch(mode, url)).toBe(false)
    expect(localFixtureDispatch('fake', 'http://127.0.0.1:54321')).toBe(true)
  })
})
