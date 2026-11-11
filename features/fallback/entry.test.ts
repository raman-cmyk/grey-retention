// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  assemblyFallback,
  clip,
  copyCheckFallback,
  fallbackEntry
} from './entry'
import { databaseFallbackLog, memoryFallbackLog } from './log'
import { AssemblyError } from '@/features/assembly/assemble'
import { withCopyQa, type QaResult } from '@/features/copy-qa/check'

const tenantId = '00000000-0000-4000-8000-000000000101'
const campaignId = '00000000-0000-4000-8000-000000000601'
const failed = (reason: string, rule = 'price'): QaResult => ({
  pass: false,
  failures: [{ rule, field: 'body', excerpt: 'x', reason } as never]
})

describe('a copy check that never passed', () => {
  it('becomes one fallback entry with the last reasons, not a task for a person', async () => {
    const result = await withCopyQa({
      generate: async () => ({ subject: 'S', preview: 'P', blocks: [] }),
      check: () => failed('A price that is not in the catalog.')
    })
    expect(result.status).toBe('fallback')
    const entry = copyCheckFallback({
      tenantId,
      campaignId,
      revision: 2,
      attempts: result.attempts,
      errors: result.errors,
      fallback: 'Used plainer copy.'
    })
    expect(entry).toEqual({
      tenantId,
      campaignId,
      agent: 'copy_check',
      reasonCode: 'copy_check_failed',
      reason:
        'The copy failed the brand check 3 times. Last time: A price that is not in the catalog.',
      fallback: 'Used plainer copy.',
      attempts: 3,
      detail: { revision: 2, rules: ['price'], errors: 0 },
      dedupeKey: `copy_check:${campaignId}:2`
    })
  })

  it('says when the copywriter itself kept failing', () => {
    const entry = copyCheckFallback({
      tenantId,
      campaignId: null,
      revision: 1,
      attempts: [],
      errors: [new Error('down'), new Error('down')],
      fallback: 'Skipped this email.'
    })
    expect(entry).toMatchObject({
      reasonCode: 'copywriter_failed',
      reason: 'The copywriter failed twice and no draft came back.',
      attempts: 2,
      dedupeKey: 'copy_check:none:1'
    })
  })

  it('keeps each reason once and the entry within its limits', () => {
    const long = 'A claim the brand cannot back up. '.repeat(30)
    const entry = copyCheckFallback({
      tenantId,
      campaignId,
      revision: 1,
      attempts: [failed(long), failed(long, 'claim')],
      errors: [],
      fallback: 'Used plainer copy.'
    })
    expect(entry.reason.length).toBeLessThanOrEqual(500)
    expect(entry.reason.endsWith('…')).toBe(true)
    expect(entry.detail.rules).toEqual(['claim'])
  })
})

describe('an email that could not be assembled', () => {
  it('records the plain reason and the safer choice', () => {
    const entry = assemblyFallback({
      tenantId,
      campaignId,
      revision: 1,
      error: new AssemblyError(
        'The brief names a product that is out of stock.',
        'focus_unavailable'
      ),
      fallback: 'Built the email around the next bestseller.'
    })
    expect(entry).toMatchObject({
      agent: 'assembly',
      reasonCode: 'assembly_focus_unavailable',
      reason: 'The brief names a product that is out of stock.',
      dedupeKey: `assembly:${campaignId}:1:focus_unavailable`
    })
  })
})

describe('the entry shape', () => {
  const good = {
    tenantId: null,
    campaignId: null,
    agent: 'section_tagger',
    reasonCode: 'tag_unsure',
    reason: 'Unsure.',
    fallback: 'Stored as untagged.',
    attempts: 2,
    detail: {},
    dedupeKey: 'tagger:1'
  }
  it('matches the table limits', () => {
    expect(fallbackEntry.safeParse(good).success).toBe(true)
    for (const bad of [
      { agent: 'Section Tagger' },
      { reasonCode: '' },
      { reason: '   ' },
      { fallback: 'x'.repeat(301) },
      { attempts: 11 },
      { tenantId: 'not-a-uuid' },
      { detail: { prompt: 'x'.repeat(201) } },
      { extra: true }
    ])
      expect(
        fallbackEntry.safeParse({ ...good, ...bad }).success,
        JSON.stringify(bad).slice(0, 60)
      ).toBe(false)
  })
  it('clips plain words on a word boundary', () => {
    expect(clip('one two three', 9)).toBe('one two…')
    expect(clip('  spaced   out  ', 50)).toBe('spaced out')
  })
})

describe('the logs', () => {
  const entry = copyCheckFallback({
    tenantId,
    campaignId,
    revision: 1,
    attempts: [failed('Wrong price.')],
    errors: [],
    fallback: 'Used plainer copy.'
  })

  it('send the entry to the record command', async () => {
    const rpc = vi.fn(async () => ({ data: 'entry-1', error: null }))
    expect(await databaseFallbackLog({ rpc }).record(entry)).toEqual({
      ok: true,
      id: 'entry-1'
    })
    expect(rpc).toHaveBeenCalledWith('record_fallback', {
      tenant: tenantId,
      campaign: campaignId,
      agent_key: 'copy_check',
      reason_key: 'copy_check_failed',
      reason_text: entry.reason,
      fallback_text: 'Used plainer copy.',
      tries: 1,
      facts: entry.detail,
      dedupe: `copy_check:${campaignId}:1`
    })
  })

  it('never throw, and never send a broken entry', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: '42501' } }))
    const log = databaseFallbackLog({ rpc })
    expect(await log.record(entry)).toEqual({ ok: false, code: '42501' })
    expect(await log.record({ ...entry, agent: 'Bad agent' })).toEqual({
      ok: false,
      code: 'invalid_entry'
    })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('keep one entry per problem in memory, like the table', async () => {
    const log = memoryFallbackLog()
    const first = await log.record(entry)
    const again = await log.record({ ...entry, reason: 'Still wrong.' })
    await log.record({ ...entry, tenantId: null })
    expect(again).toEqual(first)
    expect(log.entries()).toHaveLength(2)
    expect(log.entries()[0]).toMatchObject({
      reason: 'Still wrong.',
      occurrences: 2
    })
  })
})
