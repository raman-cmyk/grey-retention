import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('./actions', () => ({
  startPlan: vi.fn(async () => ({})),
  pickOffers: vi.fn(async () => ({}))
}))
vi.mock('@/features/email-build/actions', () => ({
  createEmail: vi.fn(async () => ({}))
}))

import type { PlanRun } from './load'
import { planScreen } from './plan-screen'
import { PlanScreen, emailDetails } from './screen'

afterEach(cleanup)

const owner = { owner: true }
const slot = (date: string, over: Record<string, unknown> = {}) => ({
  date,
  time: '18:00',
  emailType: 'bestseller',
  angle: 'Our best candle.',
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
    slots: [slot('2026-11-17'), slot('2026-11-20')],
    sample: true
  } as unknown as PlanRun['plan'],
  builds: {},
  today: '2026-11-16',
  sendPassed: [false, false],
  ...over
})

describe('the Plan screen (UI-PLAN-b)', () => {
  it('asks for a first plan, and tells staff only the owner can plan', () => {
    const { rerender } = render(<PlanScreen view={planScreen(null, owner)} />)
    expect(
      screen.getByRole('heading', { name: 'No plan yet' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Plan next 15 days' })
    ).toBeInTheDocument()
    rerender(<PlanScreen view={planScreen(null, { owner: false })} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(
      screen.getByText('Only this workspace’s owner can plan.')
    ).toBeInTheDocument()
  })

  it('shows the planner’s steps while it works', () => {
    render(
      <PlanScreen
        view={planScreen(run({ state: 'plan_queued', plan: null }), owner)}
      />
    )
    expect(
      screen.getByRole('heading', { name: 'Planning your next 15 days' })
    ).toBeInTheDocument()
    expect(screen.getByText('Planning 15 days of emails')).toBeInTheDocument()
  })

  it('shows the 15 days and each email with its one action, the next one first', () => {
    render(
      <PlanScreen
        view={planScreen(
          run({
            builds: {
              1: {
                id: 'b1',
                state: 'drafted',
                step: 'push',
                sampleDraft: true,
                reason: null
              }
            }
          }),
          owner
        )}
      />
    )
    expect(
      screen.getByRole('heading', { name: 'Your next 15 days' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('0 in Klaviyo · 1 sample draft · 1 planned')
    ).toBeInTheDocument()
    const rows = within(screen.getByRole('list', { name: 'The emails' }))
    expect(
      rows.getByRole('button', { name: 'Create email' })
    ).toBeInTheDocument()
    // A sample draft is never In Klaviyo: it opens its page.
    expect(rows.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      '/plan/email/b1'
    )
    expect(rows.queryByText('In Klaviyo')).toBeNull()
    expect(
      screen.getByText(/the AI was not used for this plan/)
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Plan again' })
    ).toBeInTheDocument()
  })

  it('says what to do on a row that needs the owner', () => {
    const view = planScreen(
      run({
        builds: {
          0: {
            id: 'b0',
            state: 'failed',
            step: 'copy',
            sampleDraft: false,
            reason: 'Its words did not pass the checks.'
          }
        }
      }),
      owner
    )
    if (view.kind !== 'plan') throw new Error('expected a plan')
    expect(emailDetails(view.emails[0]!)).toContain(
      'Its words did not pass the checks.'
    )
    render(<PlanScreen view={view} />)
    expect(
      screen.getByRole('button', { name: 'Try again' })
    ).toBeInTheDocument()
  })

  it('lets the owner pick the offers, and tells staff only the owner can', () => {
    const pulse = {
      start: '2026-11-17',
      end: '2026-12-01',
      offers: [{ id: 'o1', code: 'CANDLE10', percent: 10, until: null }],
      leftOut: [],
      highlights: [],
      summary: 'A busy fortnight.',
      source: 'code'
    } as unknown as PlanRun['pulse']
    const { rerender } = render(
      <PlanScreen
        view={planScreen(
          run({ state: 'offers_ready', plan: null, pulse }),
          owner
        )}
      />
    )
    expect(
      screen.getByRole('checkbox', { name: '10% off with CANDLE10' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Plan the 15 days' })
    ).toBeInTheDocument()
    rerender(
      <PlanScreen
        view={planScreen(run({ state: 'offers_ready', plan: null, pulse }), {
          owner: false
        })}
      />
    )
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(
      screen.getByText('Only this workspace’s owner chooses the offers.')
    ).toBeInTheDocument()
  })
})
