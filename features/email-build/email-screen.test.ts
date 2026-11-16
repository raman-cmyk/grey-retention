// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { emailScreen, klaviyoCampaignsUrl, runSteps } from './email-screen'
import { loadEmailScreen } from './email-screen-load'

vi.mock('server-only', () => ({}))

const tenant = '00000000-0000-4000-8000-000000000101'
const buildId = '00000000-0000-4000-8000-00000000b001'
const pushKey = '00000000-0000-4000-8000-00000000c001'

const email = (over: Record<string, unknown> = {}) => ({
  sample: false,
  ai: true,
  name: 'Bestseller: Cedar candle',
  subject: 'Our cedar candle is back',
  preheader: 'Warm nights start here.',
  html: '<p>B</p>',
  approach: 'A',
  copy: 'written',
  plannedSendAt: '2026-11-20T18:00:00Z',
  audienceId: 'a1',
  productIds: ['p1'],
  code: null,
  changes: [],
  ...over
})

const row = (over: Record<string, unknown> = {}) => ({
  id: buildId,
  state: 'drafted',
  step: 'push',
  email: email(),
  klaviyoCampaignId: 'kc1',
  sampleDraft: false,
  reason: null,
  ...over
})

describe('an email’s page (UI-EMAIL-a)', () => {
  it('shows the steps in plain words: done, now and next', () => {
    expect(
      runSteps({ state: 'build_queued', step: 'copy' }, 'designed')
    ).toEqual([
      { label: 'Planned the sections', state: 'done' },
      { label: 'Chose the products and the offer', state: 'done' },
      { label: 'Writing the words', state: 'now' },
      { label: 'Designed the email', state: 'next' },
      { label: 'Put it in Klaviyo as a draft', state: 'next' }
    ])
    expect(
      runSteps({ state: 'build_queued', step: 'design' }, 'text')[3]
    ).toEqual({ label: 'Laying out the letter', state: 'now' })
    expect(
      runSteps({ state: 'drafted', step: 'push' }, 'designed').every(
        (s) => s.state === 'done'
      )
    ).toBe(true)
    // A step the app no longer knows starts from the first.
    expect(
      runSteps({ state: 'build_queued', step: 'old' }, 'designed')[0]
    ).toEqual({ label: 'Planning the sections', state: 'now' })
  })

  it('says the email is being made, or why it stopped and where', () => {
    expect(
      emailScreen(row({ state: 'build_queued', step: 'sections', email: null }))
    ).toMatchObject({
      kind: 'working',
      steps: [{ label: 'Planning the sections', state: 'now' }, {}, {}, {}, {}]
    })
    const failed = emailScreen(
      row({
        state: 'failed',
        step: 'design',
        email: null,
        reason: 'Its design could not be drawn.'
      })
    )
    expect(failed).toMatchObject({
      kind: 'failed',
      reason: 'Its design could not be drawn.'
    })
    expect(failed.steps.map((s) => s.state)).toEqual([
      'done',
      'done',
      'done',
      'failed',
      'next'
    ])
    expect(failed.steps[3].label).toBe('Designed the email')
    expect(emailScreen(row({ email: { name: 'old' } }))).toMatchObject({
      kind: 'failed',
      reason: 'This email could not be read. Make it again from the plan.'
    })
    expect(emailScreen(row({ state: 'failed', reason: null }))).toMatchObject({
      kind: 'failed',
      reason: 'We could not create this email. Try again.'
    })
  })

  it('previews a drafted email, with Open in Klaviyo only for a real draft', () => {
    const screen = emailScreen(row())
    expect(screen).toMatchObject({
      kind: 'email',
      title: 'Bestseller: Cedar candle',
      format: 'designed',
      subject: 'Our cedar candle is back',
      subjectB: null,
      preview: 'Warm nights start here.',
      status: 'in_klaviyo',
      sample: false,
      sampleDraft: false,
      klaviyo: {
        campaignId: 'kc1',
        href: klaviyoCampaignsUrl,
        name: 'Bestseller: Cedar candle'
      },
      designs: [{ name: 'The email', html: '<p>B</p>' }],
      text: null,
      notes: []
    })
    // A sample draft, a draft still being pushed, or no campaign: no link.
    expect(emailScreen(row({ sampleDraft: true }))).toMatchObject({
      sampleDraft: true,
      klaviyo: null
    })
    expect(
      emailScreen(row({ state: 'push_queued', klaviyoCampaignId: null }))
    ).toMatchObject({ status: 'working', klaviyo: null })
    expect(emailScreen(row({ klaviyoCampaignId: null }))).toMatchObject({
      klaviyo: null
    })
  })

  it('shows both designs of a design test, and both subjects of a subject test', () => {
    const designs = emailScreen(
      row({ email: email({ approach: 'B', designA: '<p>A</p>' }) })
    )
    expect(designs).toMatchObject({
      designs: [
        { name: 'Design A', html: '<p>A</p>' },
        { name: 'Design B', html: '<p>B</p>' }
      ],
      subjectB: null,
      notes: [
        'A test of two designs: half the audience gets each, no winner picked.'
      ]
    })
    expect(
      emailScreen(row({ email: email({ subjectB: 'Cedar, for cold nights' }) }))
    ).toMatchObject({
      subjectB: 'Cedar, for cold nights',
      notes: [
        'A test of two subjects: half the audience gets each, no winner picked.'
      ]
    })
  })

  it('shows a text email’s letter and its own plain-text part', () => {
    const screen = emailScreen(
      row({ email: email({ format: 'text', text: 'Hi,\nA note from me.' }) })
    )
    expect(screen).toMatchObject({
      format: 'text',
      designs: [{ name: 'The letter', html: '<p>B</p>' }],
      text: 'Hi,\nA note from me.'
    })
    expect(screen.steps[3].label).toBe('Laid out the letter')
  })

  it('writes every change the team made, each once', () => {
    const screen = emailScreen(
      row({
        email: email({
          copy: 'plain',
          ai: false,
          changes: ['offer_ended', 'offer_ended', 'not_a_change']
        })
      }),
      [
        {
          code: 'content_replaced',
          reason: 'The planned code ends before the email sends.',
          instead: 'Sent no offer.'
        },
        {
          code: 'ab_one_subject',
          reason: 'This email’s Klaviyo draft could not hold both subjects.',
          instead: 'The draft in Klaviyo has the first subject only.'
        },
        {
          code: 'ab_one_subject',
          reason: 'This email’s Klaviyo draft could not hold both subjects.',
          instead: 'The draft in Klaviyo has the first subject only.'
        }
      ]
    )
    expect(screen.notes).toEqual([
      'The AI was not used for this email: its words are plain words built from your store’s facts.',
      'Some planned content could not be used, so safer choices were made: the planned code ends before the email sends.',
      'This email’s Klaviyo draft could not hold both subjects. The draft in Klaviyo has the first subject only.'
    ])
  })
})

/** A query that records its calls and answers with the table's result. */
function fakeDb(results: Record<string, { data: unknown; error: unknown }[]>) {
  const calls: [string, unknown[]][] = []
  const db = {
    from: (table: string) => {
      calls.push(['from', [table]])
      const result = results[table].shift()!
      const query: Record<string, unknown> = {
        then: (done: (r: unknown) => unknown) =>
          Promise.resolve(result).then(done),
        maybeSingle: () => Promise.resolve(result)
      }
      for (const name of ['select', 'eq', 'like', 'order', 'limit'])
        query[name] = (...args: unknown[]) => {
          calls.push([name, args])
          return query
        }
      return query
    }
  }
  return { db: db as never, calls }
}

const buildRow = (over: Record<string, unknown> = {}) => ({
  id: buildId,
  state: 'drafted',
  step: 'push',
  email: email({ subjectB: 'Cedar, for cold nights' }),
  klaviyo_campaign_id: 'kc1',
  sample_draft: false,
  error_code: null,
  push_key: pushKey,
  ...over
})

describe('loading an email’s page (UI-EMAIL-a)', () => {
  it('reads the workspace’s build and its own log lines, oldest first', async () => {
    const { db, calls } = fakeDb({
      email_builds: [{ data: buildRow(), error: null }],
      agent_fallbacks: [
        {
          data: [
            {
              agent: 'copy-inspectors',
              reason_code: 'inspector_busy',
              reason: 'The inspectors were busy.',
              fallback: 'Checked the words with the code checks.',
              last_seen_at: '2026-11-16T10:00:02Z'
            }
          ],
          error: null
        },
        {
          data: [
            {
              agent: 'ab-test',
              reason_code: 'ab_one_subject',
              reason:
                'This email’s Klaviyo draft could not hold both subjects.',
              fallback: 'The draft in Klaviyo has the first subject only.',
              last_seen_at: '2026-11-16T10:00:01Z'
            }
          ],
          error: null
        }
      ]
    })
    const out = await loadEmailScreen(db, tenant, buildId)
    expect(out.ok && out.screen?.kind).toBe('email')
    expect(out.ok && out.screen?.notes.slice(1)).toEqual([
      'This email’s Klaviyo draft could not hold both subjects. The draft in Klaviyo has the first subject only.',
      'The inspectors were busy. Checked the words with the code checks.'
    ])
    // Tenant first on every read; the build's lines and its push's test.
    expect(calls.filter(([n]) => n === 'eq')).toEqual([
      ['eq', ['tenant_id', tenant]],
      ['eq', ['id', buildId]],
      ['eq', ['tenant_id', tenant]],
      ['eq', ['tenant_id', tenant]]
    ])
    expect(calls.filter(([n]) => n === 'like')).toEqual([
      ['like', ['dedupe_key', `%email-build-${buildId}%`]],
      ['like', ['dedupe_key', `ab-test:${pushKey}:%`]]
    ])
  })

  it('says why a failed build stopped, in the owner’s words', async () => {
    const { db } = fakeDb({
      email_builds: [
        {
          data: buildRow({
            state: 'failed',
            step: 'design',
            email: null,
            error_code: 'render_failed'
          }),
          error: null
        }
      ],
      agent_fallbacks: [
        { data: [], error: null },
        { data: [], error: null }
      ]
    })
    expect(await loadEmailScreen(db, tenant, buildId)).toMatchObject({
      ok: true,
      screen: { kind: 'failed', reason: 'Its design could not be drawn.' }
    })
  })

  it('has no page for a build it cannot see, and fails closed on an error', async () => {
    expect(
      await loadEmailScreen(
        fakeDb({ email_builds: [{ data: null, error: null }] }).db,
        tenant,
        buildId
      )
    ).toEqual({ ok: true, screen: null })
    expect(
      await loadEmailScreen(
        fakeDb({ email_builds: [{ data: null, error: { message: 'x' } }] }).db,
        tenant,
        buildId
      )
    ).toEqual({ ok: false })
    expect(
      await loadEmailScreen(
        fakeDb({
          email_builds: [{ data: buildRow(), error: null }],
          agent_fallbacks: [
            { data: [], error: null },
            { data: null, error: { message: 'x' } }
          ]
        }).db,
        tenant,
        buildId
      )
    ).toEqual({ ok: false })
  })
})
