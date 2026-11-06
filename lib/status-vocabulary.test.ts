import { describe, expect, it } from 'vitest'
import { operatorStatuses } from './status-vocabulary'

describe('operator status vocabulary (UX-012)', () => {
  it('defines the nine statuses with exact, distinct words and meanings', () => {
    expect(Object.values(operatorStatuses).map((s) => s.label)).toEqual([
      'Collecting',
      'Ready',
      'Needs setup',
      'In production',
      'Needs review',
      'Scheduled',
      'Sending',
      'Sent',
      'Failed'
    ])
    const meanings = Object.values(operatorStatuses).map((s) => s.meaning)
    expect(new Set(meanings).size).toBe(meanings.length)
    for (const meaning of meanings) expect(meaning.length).toBeGreaterThan(20)
  })

  it('only calls something Sent when the platform confirmed it', () => {
    expect(operatorStatuses.sent.meaning).toMatch(/confirmed/)
    expect(operatorStatuses.sending.meaning).toMatch(/not confirmed/)
    expect(operatorStatuses.failed.tone).toBe('danger')
  })
})
