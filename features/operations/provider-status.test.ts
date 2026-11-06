import { describe, expect, it } from 'vitest'
import { rewriteStatus } from './provider-status'

const ready = { ready: true, sample: false, reason: null }

describe('rewriteStatus', () => {
  it('explains why the AI is off without exposing settings', () => {
    const s = rewriteStatus(
      { ready: false, sample: false, reason: 'workspace_not_enabled' },
      []
    )
    expect(s.state).toBe('off')
    expect(s.detail).toContain('not on the AI pilot list')
  })

  it('flags a billing failure on the latest rewrite', () => {
    const s = rewriteStatus(ready, [
      { kind: 'email.import', status: 'succeeded', error_code: null },
      {
        kind: 'email.rewrite',
        status: 'failed',
        error_code: 'provider_account'
      }
    ])
    expect(s.state).toBe('attention')
    expect(s.detail).toContain('billing or access')
  })

  it('reports ready when the latest rewrite succeeded', () => {
    const s = rewriteStatus(ready, [
      { kind: 'email.rewrite', status: 'succeeded', error_code: null }
    ])
    expect(s.state).toBe('ok')
  })

  it('reports ready with no history', () => {
    expect(rewriteStatus(ready, []).detail).toContain('no rewrite run yet')
  })
})
