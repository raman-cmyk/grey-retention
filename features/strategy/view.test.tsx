import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('./actions', () => ({
  startPlan: vi.fn(async () => ({})),
  pickOffers: vi.fn(async () => ({}))
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { PlanView, type PlanRun } from './view'
import { codePulse, gatherEvidence } from './pulse'
import type { StoredPlan } from './stored'
import { sampleStore } from './sample'

const pulse = {
  ...codePulse(gatherEvidence(sampleStore('2026-11-16'))),
  sample: true
}
const plan: StoredPlan = {
  sample: true,
  start: '2026-11-16',
  end: '2026-11-30',
  dropped: 0,
  brief: [],
  notes: [],
  source: { brief: 'code', planner: 'code', critic: 'skipped' },
  slots: [
    {
      date: '2026-11-17',
      time: '10:00',
      emailType: 'offer',
      angle: 'The candle people love, for less',
      products: [{ id: 'p-cedar-candle', title: 'Cedar candle' }],
      offer: { id: 'offer:CANDLE10', code: 'CANDLE10', percent: 10 },
      audience: { id: 'a', label: 'Engaged subscribers (sample)' },
      why: 'Use the candle offer before it ends.',
      evidence: [
        {
          id: 'offer:CANDLE10',
          fact: '10% off with CANDLE10, until 2026-11-22.'
        }
      ]
    }
  ]
}
const run = (over: Partial<PlanRun>): PlanRun => ({
  id: '00000000-0000-4000-8000-0000000000aa',
  state: 'planned',
  startOn: '2026-11-16',
  stale: false,
  pulse,
  plan,
  ...over
})

afterEach(cleanup)

describe('the Plan next 15 days screen', () => {
  it('offers the owner a start button, and staff a plain note', () => {
    const { rerender } = render(<PlanView run={null} owner />)
    expect(
      screen.getByRole('button', { name: 'Plan next 15 days' })
    ).toBeInTheDocument()
    rerender(<PlanView run={null} owner={false} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(
      screen.getByText('Only this workspace’s owner starts a plan.')
    ).toBeVisible()
  })

  it('shows progress while a step runs', () => {
    render(
      <PlanView
        run={run({ state: 'pulse_queued', pulse: null, plan: null })}
        owner
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('Reading your store')
  })

  it('shows what matters and lets the owner choose the offers', () => {
    render(<PlanView run={run({ state: 'offers_ready', plan: null })} owner />)
    expect(
      screen.getByText('10% off with CANDLE10, until Sun 22 Nov')
    ).toBeVisible()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.getByRole('radio', { name: 'You choose' })).toBeChecked()
    expect(
      screen.getByRole('radio', { name: 'Only the offers I tick' })
    ).not.toBeChecked()
    expect(screen.getByText(/uses a sample store/)).toBeVisible()
    expect(
      screen.getByText(/BIGSALE40 is not offered: It is 40% off/)
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Plan the 15 days' })
    ).toBeInTheDocument()
  })

  it('shows each planned email with its reason and facts, and says the AI was not used', () => {
    render(<PlanView run={run({})} owner />)
    expect(screen.getByText('Tue 17 Nov · 10:00 store time')).toBeVisible()
    expect(screen.getByText('10% off with CANDLE10')).toBeVisible()
    expect(
      screen.getByText('Use the candle offer before it ends.')
    ).toBeVisible()
    expect(
      screen.getByText('10% off with CANDLE10, until 2026-11-22.')
    ).toBeVisible()
    expect(screen.getByText(/the AI was not used for this plan/)).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Plan again' })
    ).toBeInTheDocument()
  })

  it('says when a plan failed, and when nothing fits', () => {
    const { rerender } = render(
      <PlanView run={run({ state: 'failed' })} owner />
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'We could not plan these days'
    )
    rerender(
      <PlanView
        run={run({ plan: { ...plan, slots: [], notes: ['A note.'] } })}
        owner
      />
    )
    expect(screen.getByText('A note.')).toBeVisible()
    expect(
      screen.getByText(
        'No email fits these 15 days with your current settings.'
      )
    ).toBeVisible()
  })

  it('shows staff the offers without the form', () => {
    render(
      <PlanView
        run={run({ state: 'offers_ready', plan: null })}
        owner={false}
      />
    )
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(
      screen.getByText('Only this workspace’s owner chooses the offers.')
    ).toBeVisible()
  })

  it('offers a new plan when the 15 days have begun', () => {
    render(<PlanView run={run({ state: 'offers_ready', stale: true })} owner />)
    expect(
      screen.getByRole('heading', { name: 'These 15 days have begun' })
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Start again' })
    ).toBeInTheDocument()
  })

  it('shows progress while the plan is being made', () => {
    render(<PlanView run={run({ state: 'plan_queued', plan: null })} owner />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Planning your next 15 days'
    )
  })

  it('never shows a saved plan of a broken shape, and lets the owner start again', () => {
    render(
      <PlanView
        run={run({ state: 'offers_ready', pulse: null, plan: null })}
        owner
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This plan could not be shown'
    )
    expect(
      screen.getByRole('button', { name: 'Plan next 15 days' })
    ).toBeInTheDocument()
  })
})
