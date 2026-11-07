import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StatusInput } from './status'
import { CampaignPill } from './status-pill'

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: React.ReactNode }) => (
    <a {...props}>{children}</a>
  )
}))
const { monthSummary } = await import('./calendar')

afterEach(cleanup)
const now = new Date('2026-11-06T12:00:00Z')
const base: StatusInput & { id: string; title: string } = {
  id: 'a',
  title: 'A',
  channel: 'email_design',
  calendar_state: 'approved',
  copy_state: 'approved',
  design_state: 'owner_approved',
  delivery_state: 'not_ready',
  planned_at: '2026-11-20T09:00:00Z',
  superseded_by_plan: null
}

describe('campaign pill', () => {
  it('shows the one status in words', () => {
    render(<CampaignPill campaign={base} now={now} />)
    expect(screen.getByText('Needs your approval')).toBeVisible()
  })

  it('names a failed delivery and a replaced entry in words', () => {
    render(
      <>
        <CampaignPill
          campaign={{ ...base, delivery_state: 'failed' }}
          now={now}
        />
        <CampaignPill
          campaign={{ ...base, superseded_by_plan: 'p2' }}
          now={now}
        />
      </>
    )
    expect(screen.getByText('Delivery problem')).toBeVisible()
    expect(screen.getByText('Replaced').closest('[title]')).toHaveAttribute(
      'title',
      'A newer plan replaced this entry.'
    )
  })
})

describe('calendar month summary', () => {
  it('counts with the same status as the pills, and never says approved', () => {
    const entries = [
      base,
      { ...base, id: 'b', delivery_state: 'scheduled' },
      { ...base, id: 'c', planned_at: '2026-11-01T09:00:00Z' },
      { ...base, id: 'd', delivery_state: 'reconciling' },
      { ...base, id: 'e', copy_state: 'draft', design_state: 'unassigned' },
      { ...base, id: 'f', superseded_by_plan: 'p2' }
    ] as never[]
    const summary = monthSummary(entries, now)
    expect(summary).toBe(
      '5 campaigns · 1 needs your approval · 1 scheduled · 1 missed · 1 with a delivery problem'
    )
    expect(summary).not.toMatch(/approved/)
    expect(monthSummary([], now)).toBe('0 campaigns')
  })
})
