import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ApproveStep } from './approve-step'
import type { ReadinessInput } from './schedule-readiness'
import { audienceNames, ScheduleSummary } from './schedule-summary'

afterEach(cleanup)
const now = new Date('2026-11-06T12:00:00Z')
const ready: ReadinessInput = {
  calendar_state: 'approved',
  copy_state: 'approved',
  design_state: 'owner_approved',
  delivery_state: 'ready',
  planned_at: '2026-11-20T09:00:00Z',
  audience_id: 'aud-1',
  calendar_revision: 1,
  copy_revision: 3,
  design_revision: 2,
  superseded_by_plan: null
}

describe('Approve, then schedule', () => {
  it('lets the owner go to Schedule only when everything is approved and packaged', () => {
    render(<ApproveStep campaign={ready} owner hasCurrentPackage now={now} />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Ready. Check the summary and confirm Schedule below.'
    )
    expect(
      screen.getByRole('link', { name: 'Go to Schedule' })
    ).toHaveAttribute('href', '#schedule')
    cleanup()
    render(
      <ApproveStep campaign={ready} owner hasCurrentPackage={false} now={now} />
    )
    expect(
      screen.getByRole('link', { name: 'Go to the delivery package' })
    ).toHaveAttribute('href', '#package')
  })

  it('keeps Schedule off and links each missing step', () => {
    render(
      <ApproveStep
        campaign={{ ...ready, copy_state: 'pending_approval' }}
        owner
        hasCurrentPackage
        now={now}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Schedule stays off until every step above is done.'
    )
    const steps = screen.getByRole('list', { name: 'Approval steps' })
    expect(
      within(steps).getByRole('link', { name: 'Approve copy version 3' })
    ).toHaveAttribute('href', '#copy')
    expect(within(steps).getByText(/Copy:/).parentElement).toHaveTextContent(
      'not done'
    )
    expect(screen.queryByRole('link', { name: 'Go to Schedule' })).toBeNull()
  })

  it('never offers staff or admins a way to schedule', () => {
    render(
      <ApproveStep campaign={ready} owner={false} hasCurrentPackage now={now} />
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Waiting for the brand owner to make the package and schedule it.'
    )
    expect(screen.queryByRole('link', { name: /Go to/ })).toBeNull()
  })

  it('says Sent, not "pick a new date", once a campaign was sent', () => {
    render(
      <ApproveStep
        campaign={{
          ...ready,
          delivery_state: 'sent',
          planned_at: '2026-11-01T09:00:00Z'
        }}
        owner
        hasCurrentPackage
        now={now}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Sent. Nothing more to approve.'
    )
    expect(screen.queryByText(/pick a new date/)).toBeNull()
  })

  it('offers a new package after a cancelled send', () => {
    render(
      <ApproveStep
        campaign={{ ...ready, delivery_state: 'cancelled' }}
        owner
        hasCurrentPackage={false}
        now={now}
      />
    )
    expect(
      screen.getByRole('link', { name: 'Go to the delivery package' })
    ).toHaveAttribute('href', '#package')
  })

  it('shows nothing to approve on a replaced entry', () => {
    render(
      <ApproveStep
        campaign={{
          ...ready,
          calendar_state: 'rejected',
          superseded_by_plan: 'p2'
        }}
        owner
        hasCurrentPackage={false}
        now={now}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Replaced by a newer plan.'
    )
    expect(screen.queryByRole('list', { name: 'Approval steps' })).toBeNull()
  })

  it('says when scheduling has already started', () => {
    render(
      <ApproveStep
        campaign={{ ...ready, delivery_state: 'scheduled' }}
        owner
        hasCurrentPackage
        now={now}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Scheduling has started.'
    )
  })
})

describe('schedule summary', () => {
  const audiences = [
    { provider_id: 'LST1', label: 'Newsletter' },
    { provider_id: 'SUP1', label: 'Unsubscribed' }
  ]
  it('shows subject, from, audience names and the brand-timezone time', () => {
    render(
      <ScheduleSummary
        pkg={{
          subject: 'Winter sale starts now',
          sender: { name: 'Acme', email: 'hello@acme.example' },
          audience: {
            includes: ['LST1'],
            excludes: ['fixture-cedar-suppressed']
          },
          scheduledAt: '2026-11-20T14:00:00Z',
          timezone: 'America/New_York'
        }}
        audiences={audiences}
        timezone="America/New_York"
      />
    )
    const summary = screen.getByLabelText('What you are scheduling')
    expect(summary).toHaveTextContent('Winter sale starts now')
    expect(summary).toHaveTextContent('Acme · hello@acme.example')
    expect(summary).toHaveTextContent('Send toNewsletter')
    expect(summary).toHaveTextContent(
      "Don't send toUnsubscribed, spam and bounced profiles"
    )
    expect(summary).not.toHaveTextContent('fixture-cedar-suppressed')
    expect(summary).toHaveTextContent(/9:00 AM \(New York time\)/)
    expect(summary).not.toHaveTextContent('LST1')
  })

  it('shows times in the brand timezone and says when the package differs', () => {
    render(
      <ScheduleSummary
        pkg={{
          subject: 'S',
          sender: { name: 'A', email: 'a@b.example' },
          audience: { includes: ['LST1'], excludes: [] },
          scheduledAt: '2026-11-20T14:00:00Z',
          timezone: 'Europe/London'
        }}
        audiences={audiences}
        timezone="America/New_York"
      />
    )
    expect(screen.getByText(/9:00 AM \(New York time\)/)).toBeVisible()
    expect(
      screen.getByText(/This package was made for London time/)
    ).toBeVisible()
  })

  it('names unknown lists instead of printing ids', () => {
    expect(audienceNames(['LST1', 'X9'], audiences, 'include')).toEqual([
      'Newsletter',
      'A list no longer in this workspace'
    ])
    expect(audienceNames(['S1', 'S2'], audiences, 'exclude')).toEqual([
      'Unsubscribed, spam and bounced profiles'
    ])
  })
})
