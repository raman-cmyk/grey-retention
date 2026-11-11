// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { labelInboxEmails } from './label'
import { blockLabeller, sampleLabeller, type SectionLabeller } from './labeller'

function database(
  options: {
    jobs?: string[]
    recordError?: { code: string; message: string }
    /** Changes to the stored sections, by ordinal. */
    rows?: Record<number, Record<string, unknown>>
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
      if (name === 'record_inbox_labels')
        return options.recordError
          ? { data: null, error: options.recordError }
          : { data: { already: false, sections: 3 }, error: null }
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
                  text_ratio: '0.667'
                },
                error: null
              }
            : { data: null, error: null },
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
              html: '',
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
            }
          ].map((r) => ({
            id: `section-${r.ordinal}`,
            image_path: null,
            owner_block_type: null,
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

describe('labelInboxEmails', () => {
  it('labels every section, works out the facts and records them once', async () => {
    const db = database({ jobs: ['m1'] })
    const run = await labelInboxEmails(
      db as unknown as Db,
      sampleLabeller,
      later()
    )
    expect(run).toEqual({ emails: 1, sections: 3, retried: 0 })
    const recorded = db.calls.find(
      (c) => c.name === 'record_inbox_labels'
    )!.args
    expect(recorded.labels).toEqual([
      {
        ordinal: 1,
        type: 'announcement_bar',
        confidence: 0.7,
        source: 'sample',
        model: null
      },
      {
        ordinal: 2,
        type: 'hero_image',
        confidence: 0.6,
        source: 'sample',
        model: null
      },
      {
        ordinal: 3,
        type: 'cta',
        confidence: 0.7,
        source: 'sample',
        model: null
      }
    ])
    expect(recorded).toMatchObject({
      version: 1,
      facts: {
        subject: 'New arrivals: 20% off',
        preview: 'Light layers',
        offer: { kind: 'percent', value: 20 },
        angle: 'launch',
        cta: 'Shop now',
        sentAt: '2026-11-03T15:00:00.000Z',
        blockSequence: ['announcement_bar', 'hero_image', 'cta'],
        textRatio: 0.667
      }
    })
    expect(db.calls.at(-2)!.name).toBe('finish_platform_job')
  })

  it('passes each section and its place to the labeller (Gemini later)', async () => {
    const labeller: SectionLabeller = {
      label: vi.fn(async () => ({
        type: 'text' as const,
        confidence: 0.9,
        source: 'gemini' as const
      }))
    }
    await labelInboxEmails(
      database({ jobs: ['m1'] }) as unknown as Db,
      labeller,
      later()
    )
    expect(labeller.label).toHaveBeenCalledTimes(3)
    expect(labeller.label).toHaveBeenLastCalledWith(
      expect.objectContaining({ position: { ordinal: 3, of: 3 } })
    )
  })

  it("plugs in Lane A's labeller, one metered call per stored section", async () => {
    const keys: string[] = []
    const live = blockLabeller((id) => {
      keys.push(id)
      return async () => ({
        ok: true as const,
        provider: 'gemini' as const,
        model: 'flash-lite',
        content: { type: 'cta', confidence: 0.9 }
      })
    })
    const db = database({ jobs: ['m1'] })
    await labelInboxEmails(db as unknown as Db, live, later())
    expect(keys).toEqual(['section-1', 'section-2', 'section-3'])
    expect(
      db.calls.find((c) => c.name === 'record_inbox_labels')!.args.labels
    ).toEqual(
      [1, 2, 3].map((ordinal) => ({
        ordinal,
        type: 'cta',
        confidence: 0.9,
        source: 'gemini',
        model: 'flash-lite'
      }))
    )
    // With the AI port's fake, Lane A's own sample rules answer.
    const fake = blockLabeller(() => async () => ({
      ok: true as const,
      provider: 'fake' as const,
      model: 'fake',
      content: null
    }))
    const again = database({ jobs: ['m1'] })
    await labelInboxEmails(again as unknown as Db, fake, later())
    const labels = again.calls.find((c) => c.name === 'record_inbox_labels')!
      .args.labels as { source: string }[]
    expect(labels.map((l) => l.source)).toEqual(['sample', 'sample', 'sample'])
  })

  it('stores only safe labels: an unknown type is unsure, the confidence 0..1, never "owner"', async () => {
    const answers = [
      { type: 'carousel', confidence: 0.9, source: 'gemini', model: 'lite' },
      { type: 'hero_image', confidence: 7.123, source: 'owner', model: 7 },
      { type: 'cta', confidence: Number.NaN, source: 'gemini' }
    ]
    const labeller: SectionLabeller = {
      label: vi.fn(async () => answers.shift() as never)
    }
    const db = database({ jobs: ['m1'] })
    await labelInboxEmails(db as unknown as Db, labeller, later())
    expect(
      db.calls.find((c) => c.name === 'record_inbox_labels')!.args.labels
    ).toEqual([
      {
        ordinal: 1,
        type: 'unsure',
        confidence: 0,
        source: 'gemini',
        model: 'lite'
      },
      {
        ordinal: 2,
        type: 'hero_image',
        confidence: 1,
        source: 'sample',
        model: null
      },
      { ordinal: 3, type: 'cta', confidence: 0, source: 'gemini', model: null }
    ])
  })

  it("labels every section, and a person's own label wins in the block sequence", async () => {
    const labeller = { label: vi.fn(sampleLabeller.label) }
    const db = database({
      jobs: ['m1'],
      rows: { 2: { owner_block_type: 'hero_product' } }
    })
    await labelInboxEmails(db as unknown as Db, labeller, later())
    // The machine label is still stored (the Step 1 gate compares both).
    expect(labeller.label).toHaveBeenCalledTimes(3)
    const recorded = db.calls.find(
      (c) => c.name === 'record_inbox_labels'
    )!.args
    expect(
      (recorded.labels as { ordinal: number }[]).map((l) => l.ordinal)
    ).toEqual([1, 2, 3])
    expect(recorded.facts).toMatchObject({
      blockSequence: ['announcement_bar', 'hero_product', 'cta']
    })
  })

  it('shows a labeller that wants pictures each section crop', async () => {
    const labeller: SectionLabeller = {
      wantsImage: true,
      label: vi.fn(sampleLabeller.label)
    }
    const db = database({
      jobs: ['m1'],
      rows: { 2: { image_path: 'sect/m1/2.jpg' } }
    })
    await labelInboxEmails(db as unknown as Db, labeller, later())
    const images = vi
      .mocked(labeller.label)
      .mock.calls.map(([input]) => input.image)
    expect(images).toEqual([
      undefined,
      {
        mediaType: 'image/jpeg',
        base64: Buffer.from('jpeg:sect/m1/2.jpg').toString('base64')
      },
      undefined
    ])
  })

  it('fails the job for a retry when the labeller fails', async () => {
    const labeller: SectionLabeller = {
      label: vi.fn(async () => {
        throw new Error('model unavailable')
      })
    }
    const db = database({ jobs: ['m1'] })
    expect(
      await labelInboxEmails(db as unknown as Db, labeller, later())
    ).toMatchObject({ emails: 0, retried: 1 })
    expect(db.calls.map((c) => c.name)).not.toContain('record_inbox_labels')
    expect(
      db.calls.find((c) => c.name === 'fail_platform_job')!.args
    ).toMatchObject({ failure: 'internal', error_code: 'label_worker_error' })
  })

  it('fails a job with a safe code and goes on', async () => {
    const db = database({
      jobs: ['m1', 'm2'],
      recordError: { code: 'PT409', message: 'Stale platform job lease' }
    })
    const run = await labelInboxEmails(
      db as unknown as Db,
      sampleLabeller,
      later()
    )
    expect(run).toMatchObject({ emails: 0, retried: 2 })
    expect(
      db.calls.filter((c) => c.name === 'fail_platform_job')[0]!.args
    ).toMatchObject({
      error_code: 'lease_lost'
    })
  })

  it('takes no job once its time is up', async () => {
    const db = database({ jobs: ['m1'] })
    expect(
      await labelInboxEmails(
        db as unknown as Db,
        sampleLabeller,
        Date.now() - 1
      )
    ).toEqual({
      emails: 0,
      sections: 0,
      retried: 0
    })
    expect(db.calls).toEqual([])
  })
})
