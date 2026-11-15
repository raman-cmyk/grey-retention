// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { memoryFallbackLog } from '@/features/fallback/log'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import { logger } from '@/lib/logger'
import { runEmailBuilds } from './worker'
import { buildEmail, type BuiltEmail, type PlannedEmail } from './build'
import {
  fakeDraftPusher,
  type DraftPusher,
  type DraftResult
} from '@/lib/providers/klaviyo-draft'
import {
  sampleOffers,
  sampleOffersFrom,
  sampleStoreFrom,
  sampleStoreSource
} from './ports'

const tenant = '00000000-0000-4000-8000-000000000101'
const inDays = (n: number) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const planned: PlannedEmail = {
  date: inDays(2),
  time: '10:00',
  emailType: 'launch',
  angle: 'Meet the linen throw',
  products: [{ id: 'p-linen-throw', title: 'Linen throw' }],
  offer: null,
  audience: { id: 'sample-engaged', label: 'Engaged subscribers (sample)' }
}

type Call = { fn: string; args: Record<string, unknown> }
type Saved = {
  brand_offers?: Record<string, unknown>[]
  discount_codes?: Record<string, unknown>[]
  /** The plan's other builds' subjects (REL-AI). */
  email_builds?: Record<string, unknown>[]
}
/**
 * A database that hands out the given steps, then nothing, and records
 * calls. A saved build step hands out the same build at its next step,
 * with the output saved (as `finish_email_step` does). `saved` is what the
 * owner saved in Settings (DSC-001's tables, read by the real
 * `SupabaseOfferSource`); 'error' makes that read fail.
 */
function fakeDb(
  steps: Record<string, unknown>[],
  fail: Record<string, { code: string }> = {},
  saved: Saved | 'error' = {}
) {
  const queue = [...steps]
  let claimed: Record<string, unknown> = {}
  const calls: Call[] = []
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args })
    if (fail[fn]) return { data: null, error: fail[fn] }
    if (fn === 'claim_email_build') {
      // The owner's click claims only its own build.
      const at = args.target ? queue.findIndex((s) => s.id === args.target) : 0
      const next = at >= 0 ? queue.splice(at, 1)[0] : undefined
      if (next) claimed = next
      return { data: next ? [next] : [], error: null }
    }
    if (fn === 'finish_email_step') {
      const order = ['sections', 'content', 'copy', 'design']
      const done = String(args.done)
      queue.unshift({
        ...claimed,
        step: order[order.indexOf(done) + 1],
        progress: {
          ...(claimed.progress as object),
          [done]: JSON.parse(JSON.stringify(args.output))
        }
      })
      return { data: order[order.indexOf(done) + 1], error: null }
    }
    return { data: fn === 'fail_email_step' ? 'retry' : null, error: null }
  })
  const from = (table: keyof Saved) => {
    const result =
      (saved === 'error' && table !== 'email_builds') ||
      (table === 'email_builds' && fail.email_builds)
        ? { data: null, error: { code: 'PGRST000' } }
        : { data: (saved !== 'error' && saved[table]) || [], error: null }
    const read =
      (method: string) =>
      (...args: unknown[]) => {
        if (table === 'email_builds')
          calls.push({ fn: `email_builds.${method}`, args: { args } })
        return query
      }
    const query: Record<string, unknown> = {
      eq: read('eq'),
      neq: read('neq'),
      or: read('or'),
      then: (
        done: (r: typeof result) => unknown,
        failed: (e: unknown) => unknown
      ) => Promise.resolve(result).then(done, failed)
    }
    return { select: read('select') }
  }
  return { db: { rpc, from } as never, calls }
}
const step = (over: Record<string, unknown> = {}) => ({
  id: 'build-1',
  tenant_id: tenant,
  state: 'build_queued',
  step: 'sections',
  progress: {},
  run_id: 'run-1',
  slot: 0,
  planned,
  email: null,
  push_key: 'key-1',
  timezone: 'Asia/Kathmandu',
  start_on: inDays(1),
  lease_token: 'lease-1',
  ...over
})
const built = async (): Promise<BuiltEmail> => {
  const result = await buildEmail(
    {
      planned,
      store: await sampleStoreSource.read(tenant),
      offers: sampleOffers
    },
    { tenantId: tenant, callerKey: 'x', fallbacks: memoryFallbackLog() }
  )
  if (!result.ok) throw new Error('sample build failed')
  return result.email
}
const failure = (calls: Call[]) =>
  calls.find((c) => c.fn === 'fail_email_step')?.args

describe('building and pushing (code-only, fake pusher)', () => {
  it('builds the email in four saved steps and stores it for the push', async () => {
    const { db, calls } = fakeDb([step()])
    expect(
      await runEmailBuilds(db, { fallbacks: memoryFallbackLog() })
    ).toEqual({ ran: 4 })
    expect(
      calls.filter((c) => c.fn === 'finish_email_step').map((c) => c.args.done)
    ).toEqual(['sections', 'content', 'copy'])
    const finish = calls.find((c) => c.fn === 'finish_email_build')!
    expect(finish.args).toMatchObject({ build: 'build-1', lease: 'lease-1' })
    expect(finish.args.result).toMatchObject({
      sample: true,
      ai: false,
      approach: 'A',
      productIds: ['p-linen-throw']
    })
  })

  it('builds in the workspace’s own timezone', async () => {
    const { db, calls } = fakeDb([step()])
    await runEmailBuilds(db, { fallbacks: memoryFallbackLog() })
    const email = calls.find((c) => c.fn === 'finish_email_build')!.args
      .result as BuiltEmail
    expect(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kathmandu',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }).format(new Date(email.plannedSendAt))
    ).toBe('10:00')
  })

  it('pushes a built email as a draft, keyed by the planned email’s push key', async () => {
    const pusher = fakeDraftPusher()
    const email = await built()
    const { db, calls } = fakeDb([
      step({ state: 'push_queued', step: 'push', email })
    ])
    expect(await runEmailBuilds(db, { pusher })).toEqual({ ran: 1 })
    expect(pusher.calls).toEqual([
      expect.objectContaining({
        tenantId: tenant,
        idempotencyKey: 'key-1',
        sample: true,
        subject: email.subject,
        html: email.html,
        audienceId: 'sample-engaged'
      })
    ])
    expect(calls.find((c) => c.fn === 'finish_email_push')!.args).toEqual({
      build: 'build-1',
      lease: 'lease-1',
      campaign: 'sample-draft-key-1',
      sample: true
    })
  })

  it('runs the owner’s own build, then its push, and nothing else', async () => {
    const email = await built()
    const { db, calls } = fakeDb([
      step(),
      step({ state: 'push_queued', step: 'push', email }),
      step({ id: 'build-2' })
    ])
    expect(
      await runEmailBuilds(db, {
        build: 'build-1',
        fallbacks: memoryFallbackLog()
      })
    ).toEqual({ ran: 5 })
    // Four steps and the push, then nothing more of its own to claim.
    expect(calls.filter((c) => c.fn === 'claim_email_build')).toEqual(
      Array.from({ length: 6 }, () => ({
        fn: 'claim_email_build',
        args: { target: 'build-1' }
      }))
    )
  })

  it('stops at its deadline', async () => {
    const { db, calls } = fakeDb([step()])
    expect(
      await runEmailBuilds(db, { deadline: 1000, now: () => 2000 })
    ).toEqual({ ran: 0 })
    expect(calls).toEqual([])
  })
})

/** A whole build, with each step's saved output and the stored email. */
const fullRun = async () => {
  const { db, calls } = fakeDb([step()])
  await runEmailBuilds(db, { fallbacks: memoryFallbackLog() })
  const saved = Object.fromEntries(
    calls
      .filter((c) => c.fn === 'finish_email_step')
      .map((c) => [c.args.done as string, c.args.output])
  )
  const email = calls.find((c) => c.fn === 'finish_email_build')!.args
    .result as BuiltEmail
  return { saved, email }
}

describe('saved steps (REL-081)', () => {
  it('saves each step as plain data', async () => {
    const { saved } = await fullRun()
    expect(Object.keys(saved)).toEqual(['sections', 'content', 'copy'])
    for (const output of Object.values(saved))
      expect(JSON.parse(JSON.stringify(output))).toEqual(output)
  })

  it('resumes with the send time, offers and timezone the first step saved, and makes the same email as a straight build', async () => {
    // An offer email: the sample's CANDLE10, 10% off (the sample max is 20%).
    const offerEmail: PlannedEmail = {
      ...planned,
      emailType: 'offer',
      offer: { id: 'offer:CANDLE10', code: 'CANDLE10', percent: 10 }
    }
    const first = fakeDb([step({ planned: offerEmail })])
    await runEmailBuilds(first.db, { limit: 1, fallbacks: memoryFallbackLog() })
    const sections = first.calls.find((c) => c.fn === 'finish_email_step')!.args
      .output
    // Then the owner saves a 5% max and moves the workspace to another
    // timezone, and the build goes on at its content step.
    const { db, calls } = fakeDb(
      [
        step({
          planned: offerEmail,
          step: 'content',
          progress: { sections },
          timezone: 'Pacific/Kiritimati'
        })
      ],
      {},
      {
        brand_offers: [{ max_discount_percent: 5, revision: 1 }],
        discount_codes: []
      }
    )
    expect(
      await runEmailBuilds(db, { fallbacks: memoryFallbackLog() })
    ).toEqual({ ran: 3 })
    const straight = await buildEmail(
      {
        planned: offerEmail,
        store: {
          ...(await sampleStoreFrom(inDays(1)).read(tenant)),
          timezone: 'Asia/Kathmandu'
        },
        offers: sampleOffersFrom(inDays(1))
      },
      { tenantId: tenant, callerKey: 'x', fallbacks: memoryFallbackLog() }
    )
    if (!straight.ok) throw new Error('straight build failed')
    const email = calls.find((c) => c.fn === 'finish_email_build')!.args
      .result as BuiltEmail
    expect(email).toEqual(straight.email)
    expect(email.code).toBe('CANDLE10')
  })

  it('saves a step before the next one fails, and the retry starts at the failed step', async () => {
    let reads = 0
    const sample = sampleStoreFrom(inDays(1))
    const { db, calls } = fakeDb([step()])
    await runEmailBuilds(db, {
      stores: {
        read: async (t) => {
          if (++reads > 1) throw new Error('down')
          return sample.read(t)
        }
      },
      fallbacks: memoryFallbackLog()
    })
    const saved = calls.filter((c) => c.fn === 'finish_email_step')
    expect(saved.map((c) => c.args.done)).toEqual(['sections'])
    expect(failure(calls)).toMatchObject({ code: 'step_error', final: false })
    // The next claim brings the saved step: the build goes on from there.
    const retry = fakeDb([
      step({ step: 'content', progress: { sections: saved[0].args.output } })
    ])
    await runEmailBuilds(retry.db, { fallbacks: memoryFallbackLog() })
    expect(
      retry.calls
        .filter((c) => c.fn === 'finish_email_step')
        .map((c) => c.args.done)
    ).toEqual(['content', 'copy'])
    expect(retry.calls.some((c) => c.fn === 'finish_email_build')).toBe(true)
  })

  it('tries a step again when its save is lost, and a step it does not know (an app newer than the database)', async () => {
    for (const error of [{ code: 'PT409' }, {}]) {
      const { db, calls } = fakeDb([step()], {
        finish_email_step: error as never
      })
      await runEmailBuilds(db, { fallbacks: memoryFallbackLog() })
      expect(failure(calls)).toMatchObject({ code: 'step_error', final: false })
    }
    for (const s of [step({ step: 'review' }), step({ step: undefined })]) {
      const { db, calls } = fakeDb([s])
      await runEmailBuilds(db, { fallbacks: memoryFallbackLog() })
      expect(failure(calls)).toMatchObject({
        code: 'step_unknown',
        final: false
      })
    }
  })

  it('fails at once for a saved step that cannot be read, or a store that changed between sample and real data', async () => {
    const { saved } = await fullRun()
    for (const [s, code] of [
      [step({ step: 'design', progress: {} }), 'step_progress_invalid'],
      [
        step({ step: 'copy', progress: { content: { sections: 'x' } } }),
        'step_progress_invalid'
      ],
      [step({ step: 'content', progress: null }), 'step_progress_invalid'],
      [
        step({
          step: 'copy',
          progress: {
            sections: { ...(saved.sections as object), sample: false }
          }
        }),
        'store_changed'
      ]
    ] as const) {
      const { db, calls } = fakeDb([s])
      await runEmailBuilds(db, { fallbacks: memoryFallbackLog() })
      expect(failure(calls), code).toMatchObject({ code, final: true })
    }
  })

  it('stores a code it has no words for as step_error, and logs the code (REL-084)', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const { db, calls } = fakeDb([step()])
    await runEmailBuilds(db, {
      stores: { read: async () => Promise.reject({ code: 'something_new' }) },
      fallbacks: memoryFallbackLog()
    })
    expect(failure(calls)).toMatchObject({ code: 'step_error', final: false })
    expect(error).toHaveBeenCalledWith(
      'Email build step threw',
      expect.objectContaining({ code: 'something_new' })
    )
    error.mockRestore()
  })

  it('gives the copy step the plan’s other subjects, so this email’s differs (REL-AI)', async () => {
    const { saved } = await fullRun()
    const own = (saved.copy as { draft: { subject: string } }).draft.subject
    const { db, calls } = fakeDb(
      [
        step({
          step: 'copy',
          progress: { sections: saved.sections, content: saved.content }
        })
      ],
      {},
      { email_builds: [{ built: own, saved: null }] }
    )
    await runEmailBuilds(db, { limit: 1, fallbacks: memoryFallbackLog() })
    const copy = calls.find((c) => c.fn === 'finish_email_step')!.args
      .output as { draft: { subject: string } }
    expect(copy.draft.subject).not.toBe(own)
  })

  it('reads the plan’s other subjects once, at the copy step, from this plan only (REL-AI)', async () => {
    const { db, calls } = fakeDb([step()])
    await runEmailBuilds(db, { fallbacks: memoryFallbackLog() })
    expect(
      calls
        .filter((c) => c.fn.startsWith('email_builds.'))
        .map((c) => [c.fn, ...(c.args.args as unknown[])])
    ).toEqual([
      [
        'email_builds.select',
        'built:email->>subject,saved:progress->copy->draft->>subject'
      ],
      ['email_builds.eq', 'tenant_id', tenant],
      ['email_builds.eq', 'run_id', 'run-1'],
      ['email_builds.neq', 'slot', 0],
      ['email_builds.or', 'state.neq.failed,email.not.is.null']
    ])
  })

  it('tries the copy step again when the plan’s subjects cannot be read', async () => {
    const { saved } = await fullRun()
    const { db, calls } = fakeDb(
      [
        step({
          step: 'copy',
          progress: { sections: saved.sections, content: saved.content }
        })
      ],
      { email_builds: { code: 'PGRST000' } }
    )
    await runEmailBuilds(db, { fallbacks: memoryFallbackLog() })
    expect(failure(calls)).toMatchObject({ code: 'step_error', final: false })
  })

  it('fails at once when every subject it could use is taken (planning again helps, not a retry)', async () => {
    const { db, calls } = fakeDb([step()])
    const sample = sampleStoreFrom(inDays(1))
    await runEmailBuilds(db, {
      stores: {
        read: async (t) => {
          const s = await sample.read(t)
          return { ...s, brand: { ...s.brand, name: 'Shop {{ x }}' } }
        }
      },
      fallbacks: memoryFallbackLog()
    })
    expect(failure(calls)).toMatchObject({ final: true })
    expect(['subject_taken', 'copy_failed']).toContain(failure(calls)!.code)
  })

  it('tries the copy step again when the database finds its subject taken by another email of the plan (REL-AI1b)', async () => {
    const { saved } = await fullRun()
    const { db, calls } = fakeDb(
      [
        step({
          step: 'copy',
          progress: { sections: saved.sections, content: saved.content }
        })
      ],
      {
        finish_email_step: { code: 'PT409', details: 'subject_taken' } as never
      }
    )
    await runEmailBuilds(db, { fallbacks: memoryFallbackLog() })
    expect(failure(calls)).toMatchObject({
      code: 'subject_taken',
      final: false
    })
  })

  it('fails at once when the database refuses a step’s output', async () => {
    const { db, calls } = fakeDb([step()], {
      finish_email_step: { code: '22023' }
    })
    await runEmailBuilds(db, { fallbacks: memoryFallbackLog() })
    expect(failure(calls)).toMatchObject({
      code: 'step_output_invalid',
      final: true
    })
  })

  it('logs a step that runs past its time budget', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    let clock = 0
    const { db } = fakeDb([step()])
    await runEmailBuilds(db, {
      limit: 1,
      now: () => (clock += 60_000),
      fallbacks: memoryFallbackLog()
    })
    expect(warn).toHaveBeenCalledWith(
      'Email build step ran long',
      expect.objectContaining({ build: 'build-1', step: 'sections' })
    )
    warn.mockRestore()
  })
})

describe('the agent path (REL-AI part 2)', () => {
  const answer = (content: unknown) =>
    ({
      ok: true,
      content,
      provider: 'gemini',
      model: 'test',
      costMicro: 0,
      inputTokens: 1,
      outputTokens: 1,
      settled: true
    }) as const
  const agentsWith = (ai: AiCall) => ({
    memory: new InMemoryMemoryStore(),
    log: new InMemoryRunLog(),
    ai
  })
  const built = (calls: Call[]) =>
    calls.find((c) => c.fn === 'finish_email_build')!.args.result as BuiltEmail

  it('stays on code by default, even with a Gemini key, while the owner’s switch is off', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k')
    vi.stubEnv('AI_DEFAULT_PROVIDER', '')
    vi.stubEnv('EMAIL_BUILD_AGENTS', 'off')
    try {
      const { db, calls } = fakeDb([step()])
      await runEmailBuilds(db, { fallbacks: memoryFallbackLog() })
      const sections = calls.find(
        (c) => c.fn === 'finish_email_step' && c.args.done === 'sections'
      )!.args.output as { layout: { source: string } }
      expect(sections.layout.source).toBe('code')
      expect(built(calls).ai).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('with the agents on, starts a step only while a whole step fits before the deadline', async () => {
    const ai = vi.fn<AiCall>(async () => ({ ok: false, code: 'cap_reached' }))
    const { db, calls } = fakeDb([step()])
    let clock = 0
    await runEmailBuilds(db, {
      agents: agentsWith(ai),
      deadline: 40_000,
      now: () => clock,
      fallbacks: memoryFallbackLog()
    })
    // 40 s left is less than a whole step: nothing is claimed.
    expect(calls.some((c) => c.fn === 'claim_email_build')).toBe(false)
    clock = 0
    const roomy = fakeDb([step()])
    await runEmailBuilds(roomy.db, {
      agents: agentsWith(ai),
      deadline: 60_000,
      limit: 1,
      now: () => clock,
      fallbacks: memoryFallbackLog()
    })
    expect(roomy.calls.some((c) => c.fn === 'claim_email_build')).toBe(true)
  })

  it('uses the Section planner’s plan when the agents are on, and says the email was made with AI', async () => {
    const { saved } = await fullRun()
    const plan = (
      saved.sections as {
        layout: { sections: { variantId: string; purpose: string }[] }
      }
    ).layout.sections.map((s) => ({
      variantId: s.variantId,
      purpose: s.purpose
    }))
    let first = true
    const ai = vi.fn<AiCall>(async () => {
      if (!first) return { ok: false, code: 'cap_reached' }
      first = false
      return answer({ sections: plan })
    })
    const { db, calls } = fakeDb([step()])
    await runEmailBuilds(db, {
      agents: agentsWith(ai),
      fallbacks: memoryFallbackLog()
    })
    expect(ai.mock.calls[0][0]).toMatchObject({
      tenantId: tenant,
      purpose: 'copy'
    })
    const sections = calls.find(
      (c) => c.fn === 'finish_email_step' && c.args.done === 'sections'
    )!.args.output as { layout: { source: string } }
    expect(sections.layout.source).toBe('agent')
    expect(built(calls).ai).toBe(true)
  })

  it('gives a busy Copywriter’s email plain words now, with the reason, and passes the claim’s time (REL-AI part 2b)', async () => {
    const { saved } = await fullRun()
    const ai = vi.fn<AiCall>(async (call) =>
      call.callerKey.startsWith('copywriter:')
        ? { ok: false, code: 'rate_limited', retryAfterSeconds: 20 }
        : { ok: false, code: 'setup_required' }
    )
    const fallbacks = memoryFallbackLog()
    const { db, calls } = fakeDb([
      step({
        step: 'copy',
        progress: { sections: saved.sections, content: saved.content }
      })
    ])
    await runEmailBuilds(db, { agents: agentsWith(ai), fallbacks, limit: 1 })
    expect(failure(calls)).toBeUndefined()
    const copy = calls.find(
      (c) => c.fn === 'finish_email_step' && c.args.done === 'copy'
    )!.args.output as { written?: boolean }
    expect(copy.written).toBeUndefined()
    expect(
      fallbacks.entries().find((e) => e.reasonCode === 'copy_ai_busy')
    ).toMatchObject({
      agent: 'copy-inspectors',
      fallback: 'Used plain copy: the facts only, in the locked sections.'
    })
  })

  it('still builds on code’s choices, logged, when the agents cannot answer', async () => {
    const ai = vi.fn<AiCall>(async () => ({ ok: false, code: 'cap_reached' }))
    const fallbacks = memoryFallbackLog()
    const { db, calls } = fakeDb([step()])
    await runEmailBuilds(db, { agents: agentsWith(ai), fallbacks })
    expect(ai).toHaveBeenCalled()
    expect(built(calls)).toMatchObject({ ai: false, copy: 'plain' })
    expect(
      fallbacks.entries().some((e) => e.reasonCode.startsWith('sections_'))
    ).toBe(true)
  })
})

describe('the offers a build uses', () => {
  // The plan chose the sample code CANDLE10 (10% off; the sample max is 20%).
  const offerStep = () =>
    step({
      planned: {
        ...planned,
        emailType: 'offer',
        offer: { id: 'offer:CANDLE10', code: 'CANDLE10', percent: 10 }
      }
    })
  const builtWith = async (saved: Saved | 'error') => {
    const { db, calls } = fakeDb([offerStep()], {}, saved)
    await runEmailBuilds(db, { fallbacks: memoryFallbackLog() })
    return calls.find((c) => c.fn === 'finish_email_build')!.args
      .result as BuiltEmail
  }
  const code = (over: Record<string, unknown> = {}) => ({
    id: '00000000-0000-4000-8000-0000000000c1',
    code: 'CANDLE10',
    percent: 10,
    expires_at: null,
    ...over
  })

  it('uses what the owner saved, even while the store is the sample store', async () => {
    // The owner's max is 5%, so the planned 10% code is not offered.
    const email = await builtWith({
      brand_offers: [{ max_discount_percent: 5, revision: 1 }],
      discount_codes: [code()]
    })
    expect(email.sample).toBe(true)
    expect(email.code).toBeNull()
    expect(email.html).not.toContain('CANDLE10')
    // Found in the owner's codes, then refused by the owner's max.
    expect(email.changes).toContain('offer_above_max')
    // The owner's own CANDLE10 is 15% off: the email says 15%, not the sample's 10%.
    const own = await builtWith({
      brand_offers: [{ max_discount_percent: 20, revision: 2 }],
      discount_codes: [code({ percent: 15 })]
    })
    expect(own.code).toBe('CANDLE10')
    expect(own.html).toContain('15%')
    expect(own.html).not.toContain('10%')
    // A saved code with no max saved yet: no discount (DSC-001), not the sample.
    const codesOnly = await builtWith({ discount_codes: [code()] })
    expect(codesOnly.code).toBeNull()
  })

  it('uses the sample offers only when the owner has saved nothing', async () => {
    const email = await builtWith({})
    expect(email.code).toBe('CANDLE10')
    expect(email.html).toContain('CANDLE10')
  })

  it('tries an offer email again, never with the sample or no discount, when the saved offers cannot be read (REL-084)', async () => {
    const { db, calls } = fakeDb([offerStep()], {}, 'error')
    await runEmailBuilds(db, { fallbacks: memoryFallbackLog() })
    // Its 3 tries (a minute apart) then fail it with plain words.
    expect(failure(calls)).toMatchObject({
      code: 'offers_unreadable',
      final: false
    })
    expect(calls.some((c) => c.fn === 'finish_email_step')).toBe(false)
    expect(calls.some((c) => c.fn === 'finish_email_build')).toBe(false)
  })

  it('makes an email without an offer even when the saved offers cannot be read', async () => {
    const { db, calls } = fakeDb([step()], {}, 'error')
    await runEmailBuilds(db, { fallbacks: memoryFallbackLog() })
    const email = calls.find((c) => c.fn === 'finish_email_build')!.args
      .result as BuiltEmail
    expect(email.code).toBeNull()
    expect(email.html).not.toContain('CANDLE10')
  })
})

describe('failed steps', () => {
  it('wait as long as a busy Klaviyo asks, and fail at once when it refuses', async () => {
    const email = await built()
    for (const [result, args] of [
      [
        { ok: false, code: 'rate_limited', retryAfterSeconds: 90 },
        { code: 'klaviyo_rate_limited', final: false, retry_after_seconds: 90 }
      ],
      [
        { ok: false, code: 'unavailable' },
        { code: 'klaviyo_unavailable', final: false }
      ],
      [
        { ok: false, code: 'rejected', checks: ['images'] },
        { code: 'klaviyo_rejected', final: true }
      ],
      [
        { ok: false, code: 'auth' },
        { code: 'klaviyo_auth', final: true }
      ]
    ] as [DraftResult, Record<string, unknown>][]) {
      const pusher: DraftPusher = { createDraft: async () => result }
      const { db, calls } = fakeDb([
        step({ state: 'push_queued', step: 'push', email })
      ])
      await runEmailBuilds(db, { pusher })
      expect(failure(calls)).toEqual({
        build: 'build-1',
        lease: 'lease-1',
        ...args
      })
      expect(calls.some((c) => c.fn === 'finish_email_push')).toBe(false)
    }
  })

  it('are tried again when the store cannot be read or the pusher throws', async () => {
    const one = fakeDb([step()])
    await runEmailBuilds(one.db, {
      stores: { read: async () => Promise.reject(new Error('down')) }
    })
    expect(failure(one.calls)).toMatchObject({
      code: 'step_error',
      final: false
    })
    const two = fakeDb([
      step({ state: 'push_queued', step: 'push', email: await built() })
    ])
    await runEmailBuilds(two.db, {
      pusher: {
        createDraft: async () => {
          throw new Error('bug')
        }
      }
    })
    expect(failure(two.calls)).toMatchObject({
      code: 'step_error',
      final: false
    })
  })

  it('fail at once for bad stored data or an email that cannot be built', async () => {
    const cases = [
      [step({ planned: { date: 'soon' } }), 'planned_email_invalid'],
      [
        step({ state: 'push_queued', step: 'push', email: { subject: 's' } }),
        'built_email_invalid'
      ],
      [
        // Melbourne's clock skips 02:00 to 03:00 that day.
        step({
          planned: { ...planned, date: '2027-10-03', time: '02:30' },
          timezone: 'Australia/Melbourne'
        }),
        'slot_time_invalid'
      ]
    ] as const
    for (const [s, code] of cases) {
      const { db, calls } = fakeDb([s])
      await runEmailBuilds(db, { fallbacks: memoryFallbackLog() })
      expect(failure(calls), code).toMatchObject({ code, final: true })
    }
  })

  it('fail at once when the database refuses the built email, and retry a lost draft record with the same key', async () => {
    const one = fakeDb([step()], { finish_email_build: { code: '22023' } })
    await runEmailBuilds(one.db, { fallbacks: memoryFallbackLog() })
    expect(failure(one.calls)).toMatchObject({
      code: 'built_email_invalid',
      final: true
    })
    const pusher = fakeDraftPusher()
    const two = fakeDb(
      [step({ state: 'push_queued', step: 'push', email: await built() })],
      {
        finish_email_push: { code: 'PT409' }
      }
    )
    await runEmailBuilds(two.db, { pusher })
    expect(failure(two.calls)).toMatchObject({ final: false })
    expect(pusher.calls[0].idempotencyKey).toBe('key-1')
  })

  it('stop the call when a claim fails', async () => {
    const { db } = fakeDb([step()], { claim_email_build: { code: '42501' } })
    await expect(runEmailBuilds(db)).rejects.toMatchObject({ code: '42501' })
  })
})
