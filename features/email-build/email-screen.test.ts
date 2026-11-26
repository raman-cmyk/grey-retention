// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  emailScreen,
  klaviyoCampaignsUrl,
  previewText,
  runSteps,
  type EmailLogLine
} from './email-screen'
import { loadEmailScreen } from './email-screen-load'

vi.mock('server-only', () => ({}))

const tenant = '00000000-0000-4000-8000-000000000101'
const buildId = '00000000-0000-4000-8000-00000000b001'
const runId = '00000000-0000-4000-8000-00000000a001'
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
  format: 'designed' as const,
  klaviyoCampaignId: 'kc1',
  sampleDraft: false,
  reason: null,
  ...over
})

const line = (code: string, agent = 'ab-test'): EmailLogLine => ({
  agent,
  code,
  reason: `Reason ${code}.`,
  instead: `Instead ${code}.`
})

describe('an email’s page (UI-EMAIL-a)', () => {
  it('shows the steps in plain words: past tense only once done', () => {
    expect(
      runSteps({ state: 'build_queued', step: 'copy' }, 'designed')
    ).toEqual([
      { label: 'Planned the sections', state: 'done' },
      { label: 'Chose the products and the offer', state: 'done' },
      { label: 'Writing the words', state: 'now' },
      { label: 'Designing the email', state: 'next' },
      { label: 'Putting it in Klaviyo as a draft', state: 'next' }
    ])
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

  it('never says a sample draft was put in Klaviyo', () => {
    const steps = runSteps(
      { state: 'drafted', step: 'push', sampleDraft: true },
      'designed'
    )
    expect(steps.at(-1)).toEqual({
      label: 'Kept it as a sample draft (Klaviyo is not connected)',
      state: 'done'
    })
    expect(steps.some((s) => /klaviyo as a draft/i.test(s.label))).toBe(false)
  })

  it('says a text email is being laid out as a letter before it is built', () => {
    const screen = emailScreen(
      row({
        state: 'build_queued',
        step: 'design',
        email: null,
        format: 'text'
      })
    )
    expect(screen).toMatchObject({ kind: 'working', format: 'text' })
    expect(screen.steps[3]).toEqual({
      label: 'Laying out the letter',
      state: 'now'
    })
  })

  it('says why it stopped and where, keeping the email when it was made', () => {
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
      reason: 'Its design could not be drawn.',
      email: null
    })
    expect(failed.steps.map((s) => s.state)).toEqual([
      'done',
      'done',
      'done',
      'failed',
      'next'
    ])
    expect(failed.steps[3].label).toBe('Designing the email')
    // A push refused: the owner still sees what was made.
    expect(
      emailScreen(row({ state: 'failed', step: 'push', reason: null }))
    ).toMatchObject({
      kind: 'failed',
      reason: 'We could not create this email. Try again.',
      email: { subject: 'Our cedar candle is back' }
    })
  })

  it('previews a drafted email safely, with Open in Klaviyo only for a real draft', () => {
    const screen = emailScreen(
      row({
        email: email({
          html: '<p>B</p><script>x()</script><p>{% unsubscribe "Unsubscribe" %}</p>'
        })
      })
    )
    expect(screen).toMatchObject({
      kind: 'email',
      title: 'Bestseller: Cedar candle',
      format: 'designed',
      subject: 'Our cedar candle is back',
      subjectB: null,
      preview: 'Warm nights start here.',
      status: 'in_klaviyo',
      sample: false,
      klaviyo: {
        campaignId: 'kc1',
        href: klaviyoCampaignsUrl,
        name: 'Bestseller: Cedar candle'
      },
      text: null,
      notes: []
    })
    if (screen.kind !== 'email') throw new Error('expected an email')
    expect(screen.designs).toHaveLength(1)
    expect(screen.designs[0].name).toBe('The email')
    expect(screen.designs[0].html).toContain('<p>B</p>')
    expect(screen.designs[0].html).not.toMatch(/<script|\{%/)
    expect(screen.designs[0].html).toContain('Unsubscribe')
    // A sample draft is not in Klaviyo; a push in progress or no campaign: no link.
    expect(emailScreen(row({ sampleDraft: true }))).toMatchObject({
      status: 'sample_draft',
      klaviyo: null
    })
    expect(
      emailScreen(row({ state: 'push_queued', klaviyoCampaignId: null }))
    ).toMatchObject({ status: 'working', klaviyo: null })
    expect(emailScreen(row({ klaviyoCampaignId: null }))).toMatchObject({
      klaviyo: null
    })
  })

  it('shows a test only when Klaviyo holds it', () => {
    const designs = emailScreen(
      row({ email: email({ approach: 'B', designA: '<p>A</p>' }) })
    )
    if (designs.kind !== 'email') throw new Error('expected an email')
    expect(designs.designs.map((d) => d.name)).toEqual(['Design A', 'Design B'])
    expect(designs.designs[0].html).toContain('<p>A</p>')
    expect(designs.notes).toEqual([
      'A test of two designs: half the audience gets each, and Results shows which got more clicks once there are enough results.'
    ])
    const subjects = emailScreen(
      row({ email: email({ subjectB: 'Cedar, for cold nights' }) })
    )
    expect(subjects).toMatchObject({
      subjectB: 'Cedar, for cold nights',
      notes: [
        'A test of two subjects: half the audience gets each, and Results shows which got more clicks once there are enough results.'
      ]
    })
    // A sample draft was never sent: no test claimed, design A alone.
    const sample = emailScreen(
      row({
        sampleDraft: true,
        email: email({ approach: 'B', designA: '<p>A</p>', subjectB: 'x' })
      })
    )
    if (sample.kind !== 'email') throw new Error('expected an email')
    expect(sample.designs).toHaveLength(1)
    expect(sample.designs[0].html).toContain('<p>A</p>')
    expect(sample.subjectB).toBeNull()
    expect(sample.notes).toEqual([])
    // The draft could hold only one: no test claimed, design A alone.
    const oneDesign = emailScreen(
      row({ email: email({ approach: 'B', designA: '<p>A</p>' }) }),
      [line('ab_one_design')]
    )
    if (oneDesign.kind !== 'email') throw new Error('expected an email')
    expect(oneDesign.designs).toHaveLength(1)
    expect(oneDesign.designs[0].html).toContain('<p>A</p>')
    expect(oneDesign.notes).toEqual([
      'Reason ab_one_design. Instead ab_one_design.'
    ])
    expect(
      emailScreen(
        row({ email: email({ subjectB: 'Cedar, for cold nights' }) }),
        [line('ab_one_subject')]
      )
    ).toMatchObject({
      subjectB: null,
      notes: ['Reason ab_one_subject. Instead ab_one_subject.']
    })
  })

  it('shows a text email’s letter and its plain-text part without Klaviyo’s tags', () => {
    const screen = emailScreen(
      row({
        email: email({
          format: 'text',
          text: 'Hi {{ first_name|default:"friend" }},\nA note from me.\n{{ organization.name }}\nUnsubscribe: {% unsubscribe_link %}'
        })
      })
    )
    expect(screen).toMatchObject({
      format: 'text',
      text: 'Hi [first name],\nA note from me.\nYour brand\nUnsubscribe: Unsubscribe link'
    })
    if (screen.kind !== 'email') throw new Error('expected an email')
    expect(screen.designs[0].name).toBe('The letter')
    expect(screen.steps[3].label).toBe('Laid out the letter')
    expect(previewText('{% manage_preferences_link %} {% other %}')).toBe(
      'Preferences link '
    )
  })

  it('says a draft it cannot read is in Klaviyo, and keeps Open in Klaviyo', () => {
    expect(emailScreen(row({ email: { name: 'old' } }))).toMatchObject({
      kind: 'unreadable',
      message:
        'This email is in Klaviyo as a draft, but it was made by an older version of the app, so it cannot be shown here. Open it in Klaviyo to see it.',
      klaviyo: { campaignId: 'kc1', name: null }
    })
    expect(
      emailScreen(row({ email: { name: 'old' }, sampleDraft: true }))
    ).toMatchObject({ kind: 'unreadable', klaviyo: null })
  })

  it('writes every change the team made, each once', () => {
    const screen = emailScreen(
      row({
        email: email({
          copy: 'plain',
          ai: false,
          changes: ['offer_ended', 'offer_ended', 'not_a_change', 'toString']
        })
      }),
      [line('content_replaced', 'content-locker'), line('x'), line('x')]
    )
    expect(screen.notes).toEqual([
      'The AI was not used for this email: its words are plain words built from your store’s facts.',
      'Some planned content could not be used, so safer choices were made: the planned code ends before the email sends.',
      'Reason x. Instead x.'
    ])
    // The AI could not write: the copy step's own line says why, once.
    expect(
      emailScreen(row({ email: email({ copy: 'plain', ai: true }) }), [
        line('copy_ai_busy', 'copy-inspectors')
      ]).notes
    ).toEqual(['Reason copy_ai_busy. Instead copy_ai_busy.'])
    expect(
      emailScreen(row({ email: email({ copy: 'plain', ai: true }) })).notes
    ).toEqual([
      'Its words are plain words built from your store’s facts: the AI writer could not be used.'
    ])
  })
})

/** Each table's answers in turn, once awaited; records every call. */
function fakeDb(results: Record<string, { data: unknown; error: unknown }[]>) {
  const calls: [string, string, unknown[]][] = []
  const db = {
    from: (table: string) => {
      const result = results[table]?.shift() ?? { data: null, error: null }
      const query: Record<string, unknown> = {
        then: (done: (r: unknown) => unknown) =>
          Promise.resolve(result).then(done),
        maybeSingle: () => Promise.resolve(result)
      }
      for (const name of ['select', 'eq', 'like', 'order', 'limit'])
        query[name] = (...args: unknown[]) => {
          calls.push([table, name, args])
          return query
        }
      return query
    }
  }
  return { db: db as never, calls }
}

const buildRow = (over: Record<string, unknown> = {}) => ({
  id: buildId,
  run_id: runId,
  slot: 1,
  state: 'drafted',
  step: 'push',
  email: email({ subjectB: 'Cedar, for cold nights' }),
  klaviyo_campaign_id: 'kc1',
  sample_draft: false,
  error_code: null,
  push_key: pushKey,
  ...over
})
const fallback = (code: string, at: string, agent = 'copy-inspectors') => ({
  agent,
  reason_code: code,
  reason: `Reason ${code}.`,
  fallback: `Instead ${code}.`,
  last_seen_at: at
})
const plan = {
  data: { plan: { slots: [{}, { format: 'text' }] } },
  error: null
}

describe('loading an email’s page (UI-EMAIL-a)', () => {
  it('reads the workspace’s build, its slot and its own log lines, tenant first', async () => {
    const { db, calls } = fakeDb({
      email_builds: [{ data: buildRow(), error: null }],
      strategy_runs: [plan],
      agent_fallbacks: [
        {
          data: [fallback('inspector_busy', '2026-11-16T10:00:02Z')],
          error: null
        },
        {
          data: [fallback('ab_one_subject', '2026-11-16T10:00:01Z', 'ab-test')],
          error: null
        }
      ]
    })
    const out = await loadEmailScreen(db, tenant, buildId)
    // Oldest first; the subject test Klaviyo could not hold is not claimed.
    expect(out).toMatchObject({
      ok: true,
      screen: {
        kind: 'email',
        subjectB: null,
        notes: [
          'Reason ab_one_subject. Instead ab_one_subject.',
          'Reason inspector_busy. Instead inspector_busy.'
        ]
      }
    })
    expect(calls.filter(([, n]) => n === 'eq')).toEqual([
      ['email_builds', 'eq', ['tenant_id', tenant]],
      ['email_builds', 'eq', ['id', buildId]],
      ['strategy_runs', 'eq', ['tenant_id', tenant]],
      ['strategy_runs', 'eq', ['id', runId]],
      ['agent_fallbacks', 'eq', ['tenant_id', tenant]],
      ['agent_fallbacks', 'eq', ['tenant_id', tenant]],
      // PICK-99: what the results sync read of its draft, this workspace's.
      ['klaviyo_email_results', 'eq', ['tenant_id', tenant]],
      ['klaviyo_email_results', 'eq', ['build_id', buildId]]
    ])
    expect(calls.filter(([, n]) => n === 'like')).toEqual([
      ['agent_fallbacks', 'like', ['dedupe_key', `%email-build-${buildId}%`]],
      ['agent_fallbacks', 'like', ['dedupe_key', `ab-test:${pushKey}:%`]]
    ])
  })

  it('says what the owner did with its draft in Klaviyo, in store time (PICK-99)', async () => {
    const synced = (over: Record<string, unknown>) => ({
      data: {
        status: 'scheduled',
        changed: false,
        design_changed: false,
        scheduled_for: '2027-01-14T14:00:00Z',
        send_strategy: 'static',
        sent_at: null,
        checked_at: '2027-01-10T10:00:00Z',
        ...over
      },
      error: null
    })
    const open = async (row: ReturnType<typeof synced>) => {
      const { db } = fakeDb({
        email_builds: [{ data: buildRow(), error: null }],
        strategy_runs: [plan],
        agent_fallbacks: [
          { data: [], error: null },
          { data: [], error: null }
        ],
        klaviyo_email_results: [row]
      })
      const out = await loadEmailScreen(db, tenant, buildId, 'America/New_York')
      return out.ok && out.screen?.kind === 'email' ? out.screen : null
    }
    expect((await open(synced({})))?.inKlaviyo).toEqual({
      pill: 'in_klaviyo',
      parts: ['Scheduled in Klaviyo for 14 Jan, 9:00 (store time)'],
      note: 'GROS will not change it now that it is scheduled.',
      waiting: false
    })
    expect(
      (await open(synced({ status: 'draft', design_changed: true })))?.inKlaviyo
    ).toMatchObject({
      pill: 'in_klaviyo',
      parts: ['Draft in Klaviyo', 'Edited in Klaviyo'],
      waiting: false
    })
    // Deleted: none of the four statuses is true, so no pill.
    expect(
      (await open(synced({ status: 'deleted', scheduled_for: null })))
        ?.inKlaviyo
    ).toMatchObject({ pill: null, parts: ['Deleted in Klaviyo'] })
    // Not read yet (or unreadable): the page says what it knew before.
    expect(
      (await open({ data: null, error: null } as never))?.inKlaviyo
    ).toBeNull()
  })

  it('says first which inspiration email it follows (DST-002b)', async () => {
    const reason =
      'We copy Pine & Co’s email “The cedar sale” (10 Nov 2026). It is the same industry (home) and the same kind of email.'
    const { db, calls } = fakeDb({
      email_builds: [
        { data: buildRow({ referenceReason: reason }), error: null }
      ],
      strategy_runs: [plan],
      agent_fallbacks: [
        {
          data: [
            fallback('inspector_busy', '2026-11-16T10:00:02Z'),
            // An earlier try of the sections step, from scratch.
            fallback(
              'reference_unreadable',
              '2026-11-16T10:00:01Z',
              'art-director'
            )
          ],
          error: null
        },
        { data: [], error: null }
      ]
    })
    const out = await loadEmailScreen(db, tenant, buildId)
    if (!out.ok || out.screen?.kind !== 'email')
      throw new Error('expected email')
    expect(out.screen.notes[0]).toBe(reason)
    expect(out.screen.notes).toContain(
      'Reason inspector_busy. Instead inspector_busy.'
    )
    // Never "from scratch" beside the email it follows.
    expect(out.screen.notes.join(' ')).not.toContain('reference_unreadable')
    // Read from the sections step's saved reference.
    expect(
      calls.find(([t, n]) => t === 'email_builds' && n === 'select')?.[2][0]
    ).toMatch(/referenceReason:progress->sections->reference->>reason/)
  })

  it('says why it was made from scratch, and claims no inspiration email', async () => {
    const { db } = fakeDb({
      email_builds: [
        { data: buildRow({ referenceReason: null }), error: null }
      ],
      strategy_runs: [plan],
      agent_fallbacks: [
        {
          data: [
            fallback('reference_none', '2026-11-16T10:00:01Z', 'art-director')
          ],
          error: null
        },
        { data: [], error: null }
      ]
    })
    const out = await loadEmailScreen(db, tenant, buildId)
    if (!out.ok || out.screen?.kind !== 'email')
      throw new Error('expected email')
    expect(out.screen.notes).toContain(
      'Reason reference_none. Instead reference_none.'
    )
    expect(out.screen.notes.some((n) => /We copy|We remix/.test(n))).toBe(false)
  })

  it('shows at most 600 characters of the reason, and nothing that is not words', async () => {
    const long = `We copy ${'a'.repeat(700)}`
    const load = async (referenceReason: unknown) => {
      const { db } = fakeDb({
        email_builds: [{ data: buildRow({ referenceReason }), error: null }],
        strategy_runs: [plan],
        agent_fallbacks: [
          { data: [], error: null },
          { data: [], error: null }
        ]
      })
      const out = await loadEmailScreen(db, tenant, buildId)
      if (!out.ok || out.screen?.kind !== 'email')
        throw new Error('expected email')
      return out.screen.notes
    }
    expect((await load(long))[0]).toBe(long.slice(0, 600))
    expect(await load({ reason: 'We copy x' })).toEqual(
      expect.not.arrayContaining([expect.stringMatching(/We copy/)])
    )
  })

  it('keeps the newest 20 lines, and a text email’s steps before it is built', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      fallback(`c${i}`, `2026-11-16T10:00:${String(i).padStart(2, '0')}Z`)
    )
    const { db } = fakeDb({
      email_builds: [
        {
          data: buildRow({
            state: 'build_queued',
            step: 'design',
            email: null
          }),
          error: null
        }
      ],
      strategy_runs: [plan],
      agent_fallbacks: [
        { data: many, error: null },
        { data: [], error: null }
      ]
    })
    const out = await loadEmailScreen(db, tenant, buildId)
    if (!out.ok || out.screen?.kind !== 'working')
      throw new Error('expected working')
    expect(out.screen.format).toBe('text')
    expect(out.screen.steps[3].label).toBe('Laying out the letter')
    expect(out.screen.notes[0]).toBe('Reason c5. Instead c5.')
    expect(out.screen.notes.at(-1)).toBe('Reason c24. Instead c24.')
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
      strategy_runs: [{ data: null, error: null }]
    })
    expect(await loadEmailScreen(db, tenant, buildId)).toMatchObject({
      ok: true,
      screen: {
        kind: 'failed',
        format: 'designed',
        reason: 'Its design could not be drawn.'
      }
    })
  })

  it('has no page for a build it cannot see, and fails closed on any error', async () => {
    const load = (results: Parameters<typeof fakeDb>[0]) =>
      loadEmailScreen(fakeDb(results).db, tenant, buildId)
    const ok = { data: [], error: null }
    const bad = { data: null, error: { message: 'x' } }
    expect(await load({ email_builds: [{ data: null, error: null }] })).toEqual(
      {
        ok: true,
        screen: null
      }
    )
    expect(await load({ email_builds: [bad] })).toEqual({ ok: false })
    for (const [run, own, test] of [
      [bad, ok, ok],
      [plan, bad, ok],
      [plan, ok, bad]
    ])
      expect(
        await load({
          email_builds: [{ data: buildRow(), error: null }],
          strategy_runs: [run],
          agent_fallbacks: [own, test]
        })
      ).toEqual({ ok: false })
  })
})
