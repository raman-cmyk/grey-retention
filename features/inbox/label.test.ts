// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { labelInboxEmails, tagBatch } from './label'
import { sampleAsk, type Ask, type Tier } from '@/features/intelligence/passes'

function database(
  options: {
    jobs?: string[]
    recordError?: { code: string; message: string }
    /** Changes to the stored sections, by ordinal. */
    rows?: Record<number, Record<string, unknown>>
    niche?: string | null
    /** More plain text sections after the first three. */
    extra?: number
    /** The message as already tagged. */
    message?: Record<string, unknown>
  } = {}
) {
  const jobs = [...(options.jobs ?? [])]
  const calls: { name: string; args: Record<string, unknown> }[] = []
  return {
    calls,
    storage: {
      from: () => ({
        download: async (path: string) => ({
          data: new Blob([`jpeg:${path}`]),
          error: null
        })
      })
    },
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      if (name === 'claim_platform_job') {
        const id = jobs.shift()
        return {
          data: id
            ? [{ id: `job-${id}`, lease_token: 'lease', subject_key: id }]
            : [],
          error: null
        }
      }
      if (name === 'record_inbox_tags')
        return options.recordError
          ? { data: null, error: options.recordError }
          : { data: { already: false, labels: 'tagged' }, error: null }
      if (name === 'record_section_tags')
        return {
          data: (args.sections as unknown[]).length,
          error: null
        }
      return { data: null, error: null }
    }),
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () =>
          table === 'inbox_messages'
            ? {
                data: {
                  id: 'm1',
                  subject: 'New arrivals: 20% off',
                  received_at: '2026-11-03T15:00:00+00:00',
                  preheader: 'Light layers',
                  text_ratio: '0.667',
                  screenshot_path: 'shot/m1.jpg',
                  capture_id: 'c1',
                  labelled_at: null,
                  extraction_version: null,
                  ...options.message
                },
                error: null
              }
            : { data: null, error: null },
        maybeSingle: async () => ({
          data: { niche: 'niche' in options ? options.niche : 'Linen apparel' },
          error: null
        }),
        order: async () => ({
          data: [
            {
              ordinal: 1,
              html: '',
              text: 'Free shipping over $50',
              kind: 'text',
              words: 4,
              images: 0,
              wide_images: 0,
              links: []
            },
            {
              ordinal: 2,
              html: '<img src="https://x.test/hero.jpg" width="600">',
              text: '',
              kind: 'design',
              words: 0,
              images: 1,
              wide_images: 1,
              links: []
            },
            {
              ordinal: 3,
              html: '',
              text: 'Shop now',
              kind: 'text',
              words: 2,
              images: 0,
              wide_images: 0,
              links: [{ text: 'Shop now', href: 'https://x.test' }]
            },
            ...Array.from({ length: options.extra ?? 0 }, (_, i) => ({
              ordinal: 4 + i,
              html: '',
              text: 'A longer paragraph of story text for the reader to enjoy here.',
              kind: 'text',
              words: 12,
              images: 0,
              wide_images: 0,
              links: []
            }))
          ].map((r) => ({
            id: `section-${r.ordinal}`,
            image_path: null,
            owner_block_type: null,
            block_type: null,
            layout: null,
            purpose: null,
            styles: null,
            confidence: null,
            tag_state: null,
            tag_version: null,
            ...r,
            ...options.rows?.[r.ordinal]
          })),
          error: null
        })
      }
      return chain
    }
  }
}
type Db = Parameters<typeof labelInboxEmails>[0]
const later = () => Date.now() + 60_000

/** An `ask` answering like a live model, by agent and tier. */
const live = (answer: (agent: string, tier: Tier) => unknown) => {
  const calls: {
    agent: string
    tier: Tier
    callerKey: string
    image: string | null
  }[] = []
  const ask: Ask = async (def, input, call) => {
    const image = def.images?.(input)[0]
    calls.push({
      agent: def.name,
      tier: call.tier,
      callerKey: call.callerKey,
      image: image ? Buffer.from(image.base64, 'base64').toString() : null
    })
    return {
      ok: true,
      content: answer(def.name, call.tier),
      provider: 'gemini',
      model: call.tier === 'label' ? 'flash-lite' : 'flash'
    }
  }
  return { ask, calls }
}
const sectionAnswer = {
  family: 'text',
  layout: 'single_column',
  purpose: 'story',
  styles: ['text_led'],
  confidence: 0.9
}
const emailAnswer = {
  industry: 'apparel',
  emailType: 'new_arrivals',
  offerType: 'percent_off',
  season: 'none',
  angle: 'newness',
  brandSize: 'unknown',
  confidence: 0.85
}
const byAgent = (agent: string) =>
  agent === 'email-classifier' ? emailAnswer : sectionAnswer
/** What the worker stored: every batch of sections, then the email. */
const recordedOf = (db: ReturnType<typeof database>) => {
  const email = db.calls.find((c) => c.name === 'record_inbox_tags')!.args as {
    email: Record<string, unknown>
    facts: Record<string, unknown>
    version: number
  }
  const batches = db.calls.filter((c) => c.name === 'record_section_tags')
  return {
    ...email,
    batches: batches.map((b) => (b.args.sections as unknown[]).length),
    versions: [...new Set(batches.map((b) => b.args.tag_version))],
    sections: batches.flatMap(
      (b) => b.args.sections as Record<string, unknown>[]
    )
  }
}

describe('labelInboxEmails', () => {
  it('tags every section, classifies the email and records both once, with the facts', async () => {
    const db = database({ jobs: ['m1'] })
    const run = await labelInboxEmails(db as unknown as Db, sampleAsk, later())
    expect(run).toEqual({
      emails: 1,
      sections: 3,
      untagged: 0,
      retried: 0,
      deferred: 0
    })
    const recorded = recordedOf(db)
    expect(recorded.version).toBe(2)
    expect(recorded.versions).toEqual(['tags-v1'])
    expect(recorded.sections).toEqual([
      expect.objectContaining({
        ordinal: 1,
        state: 'tagged',
        family: 'announcement_bar',
        layout: 'strip',
        purpose: 'announcement',
        pass: 'sample',
        model: null
      }),
      expect.objectContaining({
        ordinal: 2,
        state: 'tagged',
        family: 'hero_image',
        layout: 'full_width_image',
        purpose: 'hook',
        styles: expect.arrayContaining(['photo_led'])
      }),
      expect.objectContaining({ ordinal: 3, state: 'tagged', family: 'cta' })
    ])
    // The niche an admin entered gives the industry; the facts give the rest.
    expect(recorded.email).toEqual({
      state: 'tagged',
      industry: 'apparel',
      email_type: 'new_arrivals',
      offer_type: 'percent_off',
      season: 'none',
      angle: 'newness',
      brand_size: 'unknown',
      confidence: 0.7,
      pass: 'sample',
      model: null
    })
    expect(recorded.facts).toMatchObject({
      version: 2,
      blockSequence: ['announcement_bar', 'hero_image', 'cta']
    })
    expect(db.calls.at(-2)!.name).toBe('finish_platform_job')
  })

  it("stores the fast model's sure answers with their model, one call per section and one for the email", async () => {
    const { ask, calls } = live(byAgent)
    const db = database({ jobs: ['m1'] })
    await labelInboxEmails(db as unknown as Db, ask, later())
    expect(calls.map((c) => [c.agent, c.tier, c.callerKey])).toEqual([
      ['section-tagger', 'label', 'section:section-1'],
      ['section-tagger', 'label', 'section:section-2'],
      ['section-tagger', 'label', 'section:section-3'],
      ['email-classifier', 'label', 'email:m1']
    ])
    const recorded = recordedOf(db)
    expect(recorded.sections.map((s) => [s.pass, s.model])).toEqual([
      ['fast', 'flash-lite'],
      ['fast', 'flash-lite'],
      ['fast', 'flash-lite']
    ])
    expect(recorded.email).toMatchObject({ pass: 'fast', industry: 'apparel' })
  })

  it('asks the larger model when unsure, and stores untagged when it is still unsure', async () => {
    const { ask, calls } = live((agent, tier) =>
      tier === 'label'
        ? { ...byAgent(agent), confidence: 0.3 }
        : agent === 'email-classifier'
          ? { ...emailAnswer, confidence: 0.9 }
          : { ...sectionAnswer, family: 'not-a-family' }
    )
    const db = database({ jobs: ['m1'] })
    const run = await labelInboxEmails(db as unknown as Db, ask, later())
    expect(calls.filter((c) => c.tier === 'review')).toHaveLength(4)
    expect(run.untagged).toBe(3)
    const recorded = recordedOf(db)
    expect(recorded.sections[0]).toEqual({
      ordinal: 1,
      state: 'untagged',
      pass: 'strong',
      model: 'flash'
    })
    expect(recorded.email).toMatchObject({ state: 'tagged', pass: 'strong' })
    // Untagged sections are "unsure" in the email's block sequence.
    expect(recorded.facts).toMatchObject({
      blockSequence: ['unsure', 'unsure', 'unsure']
    })
  })

  it("lets a person's own label win in the block sequence", async () => {
    const db = database({
      jobs: ['m1'],
      rows: { 2: { owner_block_type: 'hero_product' } }
    })
    await labelInboxEmails(db as unknown as Db, sampleAsk, later())
    const recorded = recordedOf(db)
    expect(recorded.sections[1]).toMatchObject({ family: 'hero_image' })
    expect(recorded.facts).toMatchObject({
      blockSequence: ['announcement_bar', 'hero_product', 'cta']
    })
  })

  it('sends each crop and the screenshot only when pictures are on', async () => {
    const rows = { 2: { image_path: 'sect/m1/2.jpg' } }
    const off = live(byAgent)
    await labelInboxEmails(
      database({ jobs: ['m1'], rows }) as unknown as Db,
      off.ask,
      later()
    )
    const images = (calls: { callerKey: string; image: string | null }[]) =>
      Object.fromEntries(calls.map((c) => [c.callerKey, c.image]))
    expect(Object.values(images(off.calls))).toEqual([null, null, null, null])
    const on = live(byAgent)
    await labelInboxEmails(
      database({ jobs: ['m1'], rows }) as unknown as Db,
      on.ask,
      later(),
      { pictures: true }
    )
    expect(images(on.calls)).toEqual({
      'section:section-1': null,
      'section:section-2': 'jpeg:sect/m1/2.jpg',
      'section:section-3': null,
      'email:m1': 'jpeg:shot/m1.jpg'
    })
  })

  it('without a niche, the sample rules leave the email untagged', async () => {
    const db = database({ jobs: ['m1'], niche: null })
    await labelInboxEmails(db as unknown as Db, sampleAsk, later())
    expect(recordedOf(db).email).toEqual({
      state: 'untagged',
      pass: 'sample',
      model: null
    })
  })

  it('fails the job for a retry when the model is unavailable, and records nothing', async () => {
    const ask: Ask = async () => ({
      ok: false,
      code: 'rate_limited',
      retryAfterSeconds: 7
    })
    const db = database({ jobs: ['m1'] })
    const run = await labelInboxEmails(db as unknown as Db, ask, later())
    expect(run).toMatchObject({ emails: 0, retried: 1 })
    expect(db.calls.map((c) => c.name)).not.toContain('record_inbox_tags')
    expect(
      db.calls.find((c) => c.name === 'fail_platform_job')!.args
    ).toMatchObject({ failure: 'unavailable', error_code: 'ai_rate_limited' })
  })

  it('stores a refused section as untagged and goes on', async () => {
    const ask: Ask = async (def) =>
      def.name === 'email-classifier'
        ? {
            ok: true,
            content: emailAnswer,
            provider: 'gemini',
            model: 'flash-lite'
          }
        : { ok: false, code: 'refused' }
    const db = database({ jobs: ['m1'] })
    const run = await labelInboxEmails(db as unknown as Db, ask, later())
    expect(run).toMatchObject({ emails: 1, untagged: 3 })
    expect(recordedOf(db).sections.every((s) => s.state === 'untagged')).toBe(
      true
    )
  })

  it('fails a job with a safe code and goes on', async () => {
    const db = database({
      jobs: ['m1', 'm2'],
      recordError: { code: 'PT409', message: 'lease lost' }
    })
    const run = await labelInboxEmails(db as unknown as Db, sampleAsk, later())
    expect(run).toMatchObject({ emails: 0, retried: 2 })
    expect(
      db.calls
        .filter((c) => c.name === 'fail_platform_job')
        .map((c) => c.args.error_code)
    ).toEqual(['lease_lost', 'lease_lost'])
  })

  it('takes no job once its time is up', async () => {
    const db = database({ jobs: ['m1'] })
    expect(
      await labelInboxEmails(db as unknown as Db, sampleAsk, Date.now() - 1)
    ).toEqual({ emails: 0, sections: 0, untagged: 0, retried: 0, deferred: 0 })
    expect(db.calls).toEqual([])
    // Nor when less is left than one batch needs.
    expect(
      await labelInboxEmails(db as unknown as Db, sampleAsk, Date.now() + 500, {
        batchMs: 1_000
      })
    ).toMatchObject({ emails: 0 })
    expect(db.calls).toEqual([])
  })

  it('stores the sections a batch at a time, so a retry pays only for what is left', async () => {
    const { ask, calls } = live(byAgent)
    const db = database({ jobs: ['m1'], extra: 5 })
    await labelInboxEmails(db as unknown as Db, ask, later())
    expect(recordedOf(db).batches).toEqual([tagBatch, 8 - tagBatch])
    expect(calls).toHaveLength(9)
    // Sections already tagged at this version are not asked again.
    const again = live(byAgent)
    const retried = database({
      jobs: ['m1'],
      rows: {
        1: {
          tag_state: 'tagged',
          tag_version: 'tags-v1',
          block_type: 'announcement_bar',
          layout: 'strip',
          purpose: 'announcement',
          styles: [],
          confidence: 0.7
        },
        2: {
          tag_state: 'untagged',
          tag_version: 'tags-v1',
          block_type: 'unsure'
        },
        3: { tag_state: 'tagged', tag_version: 'tags-v0', block_type: 'cta' }
      }
    })
    await labelInboxEmails(retried as unknown as Db, again.ask, later())
    expect(again.calls.map((c) => c.callerKey)).toEqual([
      'section:section-3',
      'email:m1'
    ])
    expect(recordedOf(retried).facts).toMatchObject({
      blockSequence: ['announcement_bar', 'unsure', 'text']
    })
  })

  it('finishes an email already tagged at this version without a call', async () => {
    const { ask, calls } = live(byAgent)
    const db = database({
      jobs: ['m1'],
      message: { labelled_at: '2026-11-11T06:00:00Z', extraction_version: 2 }
    })
    await labelInboxEmails(db as unknown as Db, ask, later())
    expect(calls).toEqual([])
    expect(db.calls.map((c) => c.name)).toEqual([
      'claim_platform_job',
      'finish_platform_job',
      'claim_platform_job'
    ])
  })

  it('puts an email back, without using a try, when time runs short, and keeps what it tagged', async () => {
    const slow: Ask = async (def, input, call) => {
      await new Promise((done) => setTimeout(done, 60))
      return live(byAgent).ask(def, input, call)
    }
    const db = database({ jobs: ['m1', 'm2'], extra: 5 })
    const run = await labelInboxEmails(
      db as unknown as Db,
      slow,
      Date.now() + 1_050,
      {
        batchMs: 1_000
      }
    )
    expect(run).toMatchObject({ emails: 0, sections: tagBatch, deferred: 1 })
    expect(
      db.calls.filter((c) => c.name === 'record_section_tags')
    ).toHaveLength(1)
    expect(
      db.calls.find((c) => c.name === 'defer_platform_job')!.args
    ).toMatchObject({ delay_seconds: 0, reason: 'tagging_continues' })
    expect(db.calls.map((c) => c.name)).not.toContain('record_inbox_tags')
    // The run stops: the next email is not taken.
    expect(
      db.calls.filter((c) => c.name === 'claim_platform_job')
    ).toHaveLength(1)
  })

  it('waits an hour, without using a try, when the platform budget is spent, and stops the run', async () => {
    const spent: Ask = async () => ({ ok: false, code: 'cap_reached' })
    const db = database({ jobs: ['m1', 'm2'] })
    const run = await labelInboxEmails(db as unknown as Db, spent, later())
    expect(run).toMatchObject({ retried: 0, deferred: 1 })
    expect(
      db.calls.find((c) => c.name === 'defer_platform_job')!.args
    ).toMatchObject({ delay_seconds: 3_600, reason: 'ai_cap_reached' })
    expect(db.calls.map((c) => c.name)).not.toContain('fail_platform_job')
    expect(
      db.calls.filter((c) => c.name === 'claim_platform_job')
    ).toHaveLength(1)
  })

  it('stops the run after a rate limit, which would refuse the next email too', async () => {
    const limited: Ask = async () => ({ ok: false, code: 'rate_limited' })
    const db = database({ jobs: ['m1', 'm2'] })
    const run = await labelInboxEmails(db as unknown as Db, limited, later())
    expect(run).toMatchObject({ retried: 1 })
    expect(
      db.calls.filter((c) => c.name === 'claim_platform_job')
    ).toHaveLength(1)
  })
})
