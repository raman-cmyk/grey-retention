import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./actions', () => ({
  startPlan: vi.fn(async () => ({})),
  pickOffers: vi.fn(async () => ({}))
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { PlanView, type PlanRun } from './view'
import { codePulse, gatherEvidence } from './pulse'
import { sampleStore } from './sample'
import type { FifteenDayPlan } from './plan'

const pulse = codePulse(gatherEvidence(sampleStore('2026-11-16')))
const plan: FifteenDayPlan = {
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
      screen.getByText(/BIGSALE40 is not offered: It is 40% off/)
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Plan the 15 days' })
    ).toBeInTheDocument()
  })

  it('shows each planned email with its reason and facts, and says the AI was not used', () => {
    render(<PlanView run={run({})} owner />)
    expect(screen.getByText('Tue 17 Nov · 10:00')).toBeVisible()
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
})
