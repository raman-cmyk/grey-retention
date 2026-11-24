// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { liveSwitches } from './live-switches'

const byLabel = (env: Record<string, string>) =>
  Object.fromEntries(liveSwitches(env).map((s) => [s.label, s]))

describe('the go-live switches (OPS-LIVE)', () => {
  it('says everything is off on a server with nothing set, and how to turn each on', () => {
    const s = byLabel({})
    expect(Object.keys(s)).toEqual([
      'Real AI',
      'AI team in “Create email”',
      'Design studio',
      'Klaviyo reading',
      'Klaviyo drafts',
      'Website reading',
      'Competitor inbox',
      'Background jobs'
    ])
    for (const label of [
      'Real AI',
      'AI team in “Create email”',
      'Design studio',
      'Klaviyo reading',
      'Klaviyo drafts',
      'Website reading',
      'Competitor inbox'
    ])
      expect(s[label]!.state, label).toBe('off')
    expect(s['Real AI']!.detail).toContain('GEMINI_API_KEY')
    expect(s['Klaviyo reading']!.detail).toContain('KLAVIYO_MODE=live')
    expect(s['Background jobs']!.detail).toContain('SCHEDULED_JOBS_ENABLED')
  })

  it('says what is live, with the models in use, never a key', () => {
    const key = 'AIza-secret-value-123'
    const env = {
      GEMINI_API_KEY: key,
      EMAIL_BUILD_AGENTS: 'on',
      DESIGN_STUDIO: 'on',
      KLAVIYO_MODE: 'live',
      KLAVIYO_DRAFT_PUSH: 'live',
      KLAVIYO_WRITE_LOCK: 'unlocked',
      SITE_READER_MODE: 'live'
    }
    const s = byLabel(env)
    for (const label of [
      'Real AI',
      'AI team in “Create email”',
      'Design studio',
      'Klaviyo reading',
      'Klaviyo drafts',
      'Website reading'
    ])
      expect(s[label]!.state, label).toBe('on')
    expect(s['Real AI']!.detail).toContain('gemini-3.5-flash-lite')
    expect(s['Real AI']!.detail).toContain('gemini-3.8-flash')
    expect(JSON.stringify(liveSwitches(env))).not.toContain(key)
  })

  it('flags a switch that is set but cannot work', () => {
    const s = byLabel({
      EMAIL_BUILD_AGENTS: 'on',
      DESIGN_STUDIO: 'on',
      KLAVIYO_DRAFT_PUSH: 'live',
      INBOX_TRANSPORT: 'pop3'
    })
    for (const label of [
      'AI team in “Create email”',
      'Design studio',
      'Klaviyo drafts',
      'Competitor inbox'
    ])
      expect(s[label]!.state, label).toBe('attention')
    expect(
      byLabel({ GEMINI_API_KEY: 'k', GEMINI_COPY_MODEL: 'gemini-unpriced' })[
        'Real AI'
      ]!.state
    ).toBe('attention')
  })

  it('says drafts cannot be written while Klaviyo is locked (KLV-LOCK-001)', () => {
    for (const lock of [undefined, '', 'UNLOCKED', ' unlocked'])
      expect(
        byLabel({
          KLAVIYO_MODE: 'live',
          KLAVIYO_DRAFT_PUSH: 'live',
          ...(lock === undefined ? {} : { KLAVIYO_WRITE_LOCK: lock })
        })['Klaviyo drafts']
      ).toMatchObject({
        state: 'attention',
        detail: expect.stringContaining('locked')
      })
  })

  it('says when the fake AI is forced over a real key', () => {
    const s = byLabel({ GEMINI_API_KEY: 'k', AI_DEFAULT_PROVIDER: 'fake' })
    expect(s['Real AI']).toMatchObject({ state: 'off' })
    expect(s['Real AI']!.detail).toContain('AI_DEFAULT_PROVIDER=fake')
  })
})
