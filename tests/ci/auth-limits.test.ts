import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** One `[section]` of supabase/config.toml, as key → raw value. */
function section(name: string) {
  const toml = readFileSync('supabase/config.toml', 'utf8')
  const start = toml.indexOf(`\n[${name}]\n`)
  expect(start, `[${name}] is in supabase/config.toml`).toBeGreaterThan(-1)
  const body = toml.slice(start + name.length + 4).split(/\n\[/)[0]!
  return Object.fromEntries(
    body
      .split('\n')
      .map((line) => line.match(/^([a-z_]+)\s*=\s*(.+)$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => [m[1]!, m[2]!.trim()])
  )
}

describe('the limits on login, sign-up and reset attempts (BAS-004)', () => {
  it('keeps Supabase Auth’s own limits on', () => {
    const limits = section('auth.rate_limit')
    // Sign-ins and sign-ups per 5 minutes per IP address.
    expect(Number(limits.sign_in_sign_ups)).toBeGreaterThan(0)
    expect(Number(limits.sign_in_sign_ups)).toBeLessThanOrEqual(60)
    // Emails (reset and confirmation links) per hour.
    expect(Number(limits.email_sent)).toBeGreaterThan(0)
    expect(Number(limits.email_sent)).toBeLessThanOrEqual(30)
    // Link and code checks per 5 minutes per IP address.
    expect(Number(limits.token_verifications)).toBeGreaterThan(0)
    expect(Number(limits.token_verifications)).toBeLessThanOrEqual(60)
  })

  it('waits between two emails to the same person', () => {
    // A duration such as "1s", "60s" or "1m30s", at least one second.
    const value = section('auth.email').max_frequency ?? ''
    const parts = value.match(/^"(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?"$/)
    expect(parts, value).not.toBeNull()
    const [, h = '0', m = '0', s = '0'] = parts!
    expect(Number(h) * 3600 + Number(m) * 60 + Number(s)).toBeGreaterThan(0)
  })
})
