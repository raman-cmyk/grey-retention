import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({
  createEmailFromInspiration: vi.fn(async () => ({})),
  startPlan: vi.fn(async () => ({})),
  createClient: vi.fn(),
  latestPlanRun: vi.fn()
}))
vi.mock('@/features/email-build/actions', () => ({
  createEmailFromInspiration: mocks.createEmailFromInspiration
}))
vi.mock('@/features/strategy/actions', () => ({ startPlan: mocks.startPlan }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/features/strategy/load', () => ({
  latestPlanRun: mocks.latestPlanRun
}))

import UseDesignError from '@/app/(gros)/inspiration/use/error'
import UseDesignLoading from '@/app/(gros)/inspiration/use/loading'
import type { PlanRun } from '@/features/strategy/load'
import { planScreen } from '@/features/strategy/plan-screen'
import { readUseEmail } from './use-read'
import { UseEmailScreen } from './use-screen'
import {
  inspirationUseView,
  type ChosenEmail,
  type UseEmailInput
} from './use-view'

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

const email: ChosenEmail = {
  id: '00000000-0000-4000-8000-0000000000e1',
  subject: 'The cedar sale',
  from: 'Pine & Co',
  at: '2026-11-10T09:00:00Z',
  html: '<p>Hello</p><script>alert(1)</script><a href="https://x.example">x</a>'
}

const slot = (date: string, over: Record<string, unknown> = {}) => ({
  date,
  time: '18:00',
  emailType: 'bestseller',
  angle: 'Our best candle for cold evenings.',
  products: [{ id: 'p1', title: 'Cedar candle' }],
  offer: null,
  audience: { id: 'a1', label: 'Past buyers' },
  why: 'It sells most in November.',
  evidence: [],
  ...over
})

const run = (over: Partial<PlanRun> = {}): PlanRun => ({
  id: 'run-1',
  state: 'planned',
  reason: null,
  startOn: '2026-11-17',
  stale: false,
  pulse: null,
  plan: {
    start: '2026-11-17',
    end: '2026-12-01',
    dropped: 0,
    brief: [],
    notes: [],
    source: { brief: 'code', planner: 'code', critic: 'skipped' },
    slots: [
      slot('2026-11-20', { emailType: 'offer' }),
      slot('2026-11-18'),
      slot('2026-11-24', { format: 'text', emailType: 'story', products: [] }),
      slot('2026-11-27'),
      slot('2026-11-29')
    ]
  } as unknown as PlanRun['plan'],
  builds: {},
  today: '2026-11-16',
  sendPassed: [false, false, false, false, false],
  ...over
})

const input = (
  r: PlanRun | null = run(),
  over: Partial<Extract<UseEmailInput, { ok: true }>> = {}
): UseEmailInput => ({
  ok: true,
  owner: true,
  email,
  plan: planScreen(r, { owner: true }),
  ...over
})

const draw = (i: UseEmailInput) =>
  render(<UseEmailScreen view={inspirationUseView(i)} timezone="UTC" />)

describe('what "Use this design" shows (UI-USE)', () => {
  it('offers the planned emails with no email yet, designed ones only, in plan order', () => {
    const view = inspirationUseView(
      input(
        run({
          builds: {
            // Being made: not free. Failed: free again (Try again).
            3: {
              id: 'b3',
              state: 'build_queued',
              step: 'copy',
              sampleDraft: false,
              reason: null
            },
            4: {
              id: 'b4',
              state: 'failed',
              step: 'design',
              sampleDraft: false,
              reason: 'It failed.'
            }
          },
          // Its send time passed: no Create email.
          sendPassed: [false, true, false, false, false]
        })
      )
    )
    expect(view.kind).toBe('pick')
    if (view.kind !== 'pick') return
    expect(view.runId).toBe('run-1')
    // Slot 1's time passed, 2 is a text email, 3 is being made.
    expect(view.emails.map((e) => e.slot)).toEqual([0, 4])
    expect(view.emails[0]).toEqual({
      slot: 0,
      title: 'Offer: Cedar candle',
      details: ['Fri 20', '6:00 pm', 'Past buyers']
    })
  })

  it('asks for a plan, or opens the plan, when there is no planned email to use', () => {
    expect(inspirationUseView(input(null))).toMatchObject({
      kind: 'no_plan',
      title: 'No plan yet'
    })
    expect(
      inspirationUseView(input(run({ state: 'failed', reason: 'It broke.' })))
    ).toMatchObject({ kind: 'no_plan', title: 'No plan to use' })
    expect(
      inspirationUseView(input(run({ state: 'pulse_queued', plan: null })))
    ).toMatchObject({ kind: 'not_ready', title: 'Your plan is not ready' })
    const made = {
      id: 'b',
      state: 'drafted' as const,
      step: 'push' as const,
      sampleDraft: true,
      reason: null
    }
    expect(
      inspirationUseView(
        input(run({ builds: { 0: made, 1: made, 3: made, 4: made } }))
      )
    ).toMatchObject({ kind: 'not_ready', title: 'Nothing left to create' })
  })

  it('shows staff the email only, and an email not this workspace’s as gone', () => {
    expect(inspirationUseView(input(run(), { owner: false }))).toEqual({
      kind: 'staff',
      email
    })
    expect(inspirationUseView(input(run(), { email: null }))).toEqual({
      kind: 'missing'
    })
    expect(inspirationUseView({ ok: false })).toEqual({ kind: 'error' })
  })
})

describe('the "Use this design" screen (UI-USE)', () => {
  it('shows the chosen email safely, the planned emails, Copy or Remix, and one Create email', () => {
    draw(input())
    expect(
      screen.getByRole('heading', { name: 'Use this design', level: 1 })
    ).toBeInTheDocument()
    const chosen = screen.getByRole('region', { name: 'The email you chose' })
    expect(
      within(chosen).getByRole('heading', { name: 'The cedar sale' })
    ).toBeInTheDocument()
    expect(chosen).toHaveTextContent('Pine & Co · 10 Nov 2026')
    const frame = within(chosen).getByTitle('The email: The cedar sale')
    expect(frame).toHaveAttribute('sandbox', '')
    const doc = frame.getAttribute('srcdoc') ?? ''
    expect(doc).toContain('Hello')
    expect(doc).not.toContain('<script')
    expect(doc).not.toContain('https://x.example')

    const pick = screen.getByRole('region', { name: 'Choose a planned email' })
    const rows = within(
      within(pick).getByRole('list', { name: 'Planned emails' })
    ).getAllByRole('listitem')
    // In date order: Wed 18, Fri 20, Fri 27, Sun 29 (the text email left out).
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Wed 18'),
      expect.stringContaining('Fri 20'),
      expect.stringContaining('Fri 27'),
      expect.stringContaining('Sun 29')
    ])
    const first = within(pick).getByRole('radio', {
      name: 'Bestseller: Cedar candle, Wed 18, 6:00 pm, Past buyers'
    })
    expect(first).toBeChecked()
    expect(
      within(pick).getByLabelText('Copy an inspiration email')
    ).toBeChecked()
    expect(
      within(pick).getByLabelText('Remix an inspiration email')
    ).not.toBeChecked()
    expect(within(pick).queryByLabelText('From scratch')).toBeNull()
    const create = within(pick).getByRole('button', { name: 'Create email' })
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(
      Object.fromEntries(
        new FormData(create.closest('form')!) as unknown as [string, string][]
      )
    ).toEqual({ run: 'run-1', reference: email.id, slot: '1', mode: 'copy' })
  })

  it('gives staff the email and one line, with no button', () => {
    draw(input(run(), { owner: false }))
    expect(screen.getByTitle('The email: The cedar sale')).toBeInTheDocument()
    expect(
      screen.getByText('Only this workspace’s owner can create emails.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('radio')).toBeNull()
  })

  it('asks for a plan with one button, or opens the plan', () => {
    draw(input(null))
    expect(
      screen.getByRole('heading', { name: 'No plan yet' })
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Plan next 15 days'
    ])
    cleanup()
    draw(input(run({ state: 'plan_queued', plan: null })))
    expect(
      screen.getByRole('heading', { name: 'Your plan is not ready' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Open your plan' })
    ).toHaveAttribute('href', '/plan')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says when the email is gone or the page could not be read', () => {
    draw(input(run(), { email: null }))
    expect(screen.getByRole('alert')).toHaveTextContent('This email is gone')
    expect(
      screen.getByRole('link', { name: 'Open Inspiration' })
    ).toHaveAttribute('href', '/inspiration')
    cleanup()
    draw({ ok: false })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This page did not open'
    )
    expect(
      screen.getByRole('link', { name: 'Back to Inspiration' })
    ).toBeInTheDocument()
  })

  it('has its own loading and error screens', () => {
    render(<UseDesignLoading />)
    expect(screen.getByText('Opening the email')).toBeInTheDocument()
    cleanup()
    render(<UseDesignError retry={() => undefined} />)
    expect(
      screen.getByRole('button', { name: 'Try again' })
    ).toBeInTheDocument()
  })
})

describe('what "Use this design" reads (UI-USE)', () => {
  const context = {
    tenantId: 'tenant-1',
    tenantRole: 'owner' as const,
    timezone: 'UTC'
  }
  type Answer = { data: unknown; error: unknown }
  const db = (tables: Record<string, Answer>) => {
    const seen: { table: string; ops: unknown[][] }[] = []
    return {
      seen,
      client: {
        from(table: string) {
          const call = { table, ops: [] as unknown[][] }
          seen.push(call)
          const chain: Record<string, unknown> = {}
          for (const op of ['select', 'eq'])
            chain[op] = (...a: unknown[]) => {
              call.ops.push([op, ...a])
              return chain
            }
          chain.maybeSingle = () => Promise.resolve(tables[table])
          return chain
        }
      }
    }
  }
  const row = {
    id: email.id,
    capture_id: 'pine',
    subject: 'The cedar sale',
    safe_html: '<p>Hello</p>',
    received_at: '2026-11-10T09:00:00Z'
  }

  it('reads the email of a brand this workspace follows, and the latest plan', async () => {
    const { client, seen } = db({
      competitor_emails: { data: row, error: null },
      competitor_subscriptions: { data: { label: 'Pine & Co' }, error: null },
      competitor_hidden: { data: null, error: null }
    })
    mocks.createClient.mockResolvedValue(client)
    mocks.latestPlanRun.mockResolvedValue({ ok: true, run: null })
    const read = await readUseEmail(context, email.id)
    expect(read).toMatchObject({
      ok: true,
      owner: true,
      email: {
        id: email.id,
        from: 'Pine & Co',
        subject: 'The cedar sale',
        html: '<p>Hello</p>'
      },
      plan: { kind: 'empty' }
    })
    expect(mocks.latestPlanRun).toHaveBeenCalledWith('tenant-1', 'UTC')
    const follow = seen.find((c) => c.table === 'competitor_subscriptions')!
    expect(follow.ops).toEqual(
      expect.arrayContaining([
        ['eq', 'tenant_id', 'tenant-1'],
        ['eq', 'capture_id', 'pine'],
        ['eq', 'active', true]
      ])
    )
  })

  it('treats an email of a brand not followed here, or hidden, as gone', async () => {
    mocks.latestPlanRun.mockResolvedValue({ ok: true, run: null })
    for (const [followed, hidden] of [
      [null, null],
      [{ label: 'Pine & Co' }, { capture_id: 'pine' }]
    ]) {
      mocks.createClient.mockResolvedValue(
        db({
          competitor_emails: { data: row, error: null },
          competitor_subscriptions: { data: followed, error: null },
          competitor_hidden: { data: hidden, error: null }
        }).client
      )
      expect(await readUseEmail(context, email.id)).toMatchObject({
        ok: true,
        email: null
      })
    }
    // No email by that id (or none the member may read): gone too.
    mocks.createClient.mockResolvedValue(
      db({ competitor_emails: { data: null, error: null } }).client
    )
    expect(await readUseEmail(context, email.id)).toMatchObject({
      email: null
    })
    expect(await readUseEmail(context, null)).toMatchObject({ email: null })
  })

  it('is an error when a read fails', async () => {
    mocks.latestPlanRun.mockResolvedValue({ ok: false })
    mocks.createClient.mockResolvedValue(
      db({ competitor_emails: { data: row, error: null } }).client
    )
    expect(await readUseEmail(context, email.id)).toEqual({ ok: false })
    mocks.latestPlanRun.mockResolvedValue({ ok: true, run: null })
    mocks.createClient.mockResolvedValue(
      db({ competitor_emails: { data: null, error: { code: 'XX000' } } }).client
    )
    expect(await readUseEmail(context, email.id)).toEqual({ ok: false })
    mocks.createClient.mockResolvedValue(null)
    expect(await readUseEmail(context, email.id)).toEqual({ ok: false })
  })
})
