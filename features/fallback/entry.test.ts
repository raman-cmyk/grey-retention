// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  assemblyFallback,
  assemblyWords,
  clip,
  copyCheckFallback,
  fallbackEntry,
  keyPart,
  ruleWords
} from './entry'
import { databaseFallbackLog, memoryFallbackLog } from './log'
import { AssemblyError } from '@/features/assembly/assemble'
import {
  withCopyQa,
  type QaResult,
  type QaRule
} from '@/features/copy-qa/check'

const tenantId = '00000000-0000-4000-8000-000000000101'
const campaignId = '00000000-0000-4000-8000-000000000601'
const failed = (
  reason: string,
  rule: QaRule = 'discount_over_max'
): QaResult => ({
  pass: false,
  failures: [{ rule, field: 'body', excerpt: 'x', reason }]
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
      subject: campaignId,
      revision: 2,
      attempts: result.attempts,
      errors: result.errors,
      fallback: 'Used plainer copy.'
    })
    expect(entry).toEqual({
      tenantId,
      campaignId,
      agent: 'copy-check',
      reasonCode: 'copy_check_failed',
      reason:
        'The copy failed the brand check 3 times. Last time it had a discount above the brand’s maximum.',
      fallback: 'Used plainer copy.',
      attempts: 3,
      detail: { revision: 2, rules: ['discount_over_max'], errors: 0 },
      dedupeKey: `copy-check:${campaignId}:2`
    })
  })

  it('says when the copywriter itself kept failing', () => {
    const entry = copyCheckFallback({
      tenantId,
      campaignId: null,
      subject: 'slot-7',
      revision: 1,
      attempts: [],
      errors: [new Error('down'), new Error('down')],
      fallback: 'Skipped this email.'
    })
    expect(entry).toMatchObject({
      reasonCode: 'copywriter_failed',
      reason: 'The copywriter failed twice and no draft came back.',
      attempts: 2,
      dedupeKey: 'copy-check:slot-7:1'
    })
  })

  it('never repeats the copy or the brand’s codes, only fixed words per rule', () => {
    const quoted: QaResult = {
      pass: false,
      failures: [
        {
          rule: 'unknown_code',
          field: 'body',
          excerpt: 'Use SECRET40 today',
          reason: 'Use exactly: WELCOME15 (15%), VIP20 (20%).'
        },
        {
          rule: 'unknown_code',
          field: 'subject',
          excerpt: 'SECRET40',
          reason: 'Use exactly: WELCOME15 (15%), VIP20 (20%).'
        },
        {
          rule: 'unsupported_claim',
          field: 'body',
          excerpt: 'Clinically proven glow',
          reason: '“Clinically proven glow” needs proof.'
        }
      ]
    }
    const entry = copyCheckFallback({
      tenantId,
      campaignId,
      subject: campaignId,
      revision: 1,
      attempts: [failed('First try.'), quoted],
      errors: [],
      fallback: 'Used plainer copy.'
    })
    expect(entry.reason).toBe(
      'The copy failed the brand check twice. Last time it had a code that is not one of the brand’s codes; a claim the brand cannot back up.'
    )
    for (const secret of ['WELCOME15', 'VIP20', 'SECRET40', 'Clinically'])
      expect(JSON.stringify(entry)).not.toContain(secret)
    expect(entry.detail.rules).toEqual(['unknown_code', 'unsupported_claim'])
  })

  it('stays within its limits when every rule fails', () => {
    const every = Object.keys(ruleWords) as QaRule[]
    const entry = copyCheckFallback({
      tenantId,
      campaignId,
      subject: campaignId,
      revision: 1,
      attempts: [
        {
          pass: false,
          failures: every.map((rule) => ({
            rule,
            field: 'body',
            excerpt: 'x',
            reason: 'x'
          }))
        }
      ],
      errors: [],
      fallback: 'Used plainer copy.'
    })
    expect(entry.reason.length).toBeLessThanOrEqual(500)
    expect(entry.detail.rules).toHaveLength(every.length)
  })
})

describe('an email that could not be assembled', () => {
  it('records the plain reason and the safer choice', () => {
    const entry = assemblyFallback({
      tenantId,
      campaignId,
      subject: campaignId,
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
      reason: assemblyWords.focus_unavailable,
      dedupeKey: `assembly:${campaignId}:1:focus_unavailable`
    })
  })
})

describe('more failure paths', () => {
  it('counts copywriter crashes apart from failed checks, and links the run', () => {
    const entry = copyCheckFallback({
      tenantId,
      campaignId,
      subject: campaignId,
      revision: 3,
      attempts: [failed('x')],
      errors: [new Error('a'), new Error('b')],
      fallback: 'Used plainer copy.',
      runId: 'run-9'
    })
    expect(entry.reason).toBe(
      'The copy failed the brand check once, and the copywriter failed twice. Last time it had a discount above the brand’s maximum.'
    )
    expect(entry).toMatchObject({ attempts: 3, detail: { runId: 'run-9' } })
  })

  it('never puts the assembly message (product names) in the log', () => {
    const entry = assemblyFallback({
      tenantId,
      campaignId: null,
      subject: 'slot 4/b',
      revision: 1,
      error: new AssemblyError('The sample writer broke a rule: Cedar candle'),
      fallback: 'Used the plain layout.'
    })
    expect(entry).toMatchObject({
      reasonCode: 'assembly_bug',
      reason: assemblyWords.bug,
      dedupeKey: 'assembly:slot-4-b:1:bug'
    })
    expect(JSON.stringify(entry)).not.toContain('Cedar')
    expect(fallbackEntry.safeParse(entry).success).toBe(true)
  })

  it('turns any id into a safe key part', () => {
    expect(keyPart('slot 4/b')).toBe('slot-4-b')
    expect(keyPart('')).toBe('none')
    expect(keyPart('x'.repeat(300))).toHaveLength(120)
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
    // An emoji is two code units: it is kept whole or left out.
    expect(clip('ab😀cdef', 4)).toBe('ab…')
  })
})

describe('the logs', () => {
  const entry = copyCheckFallback({
    tenantId,
    campaignId,
    subject: campaignId,
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
      agent_key: 'copy-check',
      reason_key: 'copy_check_failed',
      reason_text: entry.reason,
      fallback_text: 'Used plainer copy.',
      tries: 1,
      facts: entry.detail,
      dedupe: `copy-check:${campaignId}:1`
    })
  })

  it('never throw, even when the client itself throws', async () => {
    const rpc = vi.fn(async () => {
      throw new Error('network down')
    })
    expect(await databaseFallbackLog({ rpc }).record(entry)).toEqual({
      ok: false,
      code: 'unavailable'
    })
    const empty = vi.fn(async () => ({ data: null, error: null }))
    expect(await databaseFallbackLog({ rpc: empty }).record(entry)).toEqual({
      ok: false,
      code: 'no_id'
    })
  })

  it('never send a broken entry', async () => {
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
