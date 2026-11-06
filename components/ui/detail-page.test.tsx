import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { List } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AdvancedDetails,
  attributeText,
  dashboardBack,
  DetailHero,
  DetailPage,
  TimelineCard
} from './detail-page'
import { RefreshButton } from './refresh-button'
import { Pill } from './pill'

afterEach(cleanup)

describe('detail page pattern', () => {
  it('goes back to the dashboard tab the owner came from', () => {
    expect(dashboardBack('campaigns')).toEqual({
      href: '/dashboard?tab=campaigns',
      label: 'Back to dashboard'
    })
    expect(dashboardBack(['flows', 'x'])).toMatchObject({
      href: '/dashboard?tab=flows'
    })
    for (const bad of [undefined, '', 'admin', '//evil.example', 42])
      expect(dashboardBack(bad).href).toBe('/dashboard')
  })

  it('lays out back link, Refresh and the hero in a narrow column', () => {
    const back = dashboardBack('lists')
    render(
      <DetailPage
        backHref={back.href}
        backLabel={back.label}
        action={
          <form action={vi.fn<(form: FormData) => void>()}>
            <RefreshButton />
          </form>
        }
      >
        <DetailHero
          icon={List}
          kind="List"
          title="Newsletter"
          status={<Pill tone="success">Live</Pill>}
        />
      </DetailPage>
    )
    expect(
      screen.getByRole('link', { name: 'Back to dashboard' })
    ).toHaveAttribute('href', '/dashboard?tab=lists')
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Newsletter' })
    ).toBeInTheDocument()
    expect(screen.getByText('List').className).toContain('uppercase')
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Back to dashboard' }).closest('div')
        ?.parentElement?.className
    ).toContain('max-w-[var(--gr-detail-max)]')
  })

  it('shows created and updated in the brand timezone with "weeks ago"', () => {
    render(
      <TimelineCard
        created="2026-10-07T11:49:00Z"
        updated="garbage"
        timezone="Australia/Sydney"
        now={new Date('2026-11-06T12:00:00Z')}
      />
    )
    const card = screen.getByRole('region', { name: 'Timeline' })
    expect(card).toHaveTextContent('Oct 7, 2026 · 10:49 PM (Sydney time)')
    expect(card).toHaveTextContent('4 weeks ago')
    expect(within(card).getByText('Not known')).toBeInTheDocument()
    expect(card.querySelector('time')).toHaveAttribute(
      'datetime',
      '2026-10-07T11:49:00.000Z'
    )
  })

  it('keeps raw attributes and links in a collapsed Advanced details row', async () => {
    render(
      <AdvancedDetails
        objectId="XyZ123"
        attributes={{
          name: 'Newsletter',
          opt_in_process: 'double_opt_in',
          definition: { condition_groups: [{ metric_id: 'abc' }] },
          note: '<img src=x onerror=alert(1)>'
        }}
        linked={[
          { label: 'Profiles', items: [] },
          { label: 'Tags', items: ['VIP', 'Spring'] },
          { label: 'Flow triggers', items: [] }
        ]}
      />
    )
    const details = screen.getByText('Advanced details').closest('details')!
    expect(details).not.toHaveAttribute('open')
    expect(within(details).getByText('XyZ123')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Advanced details'))
    expect(details).toHaveAttribute('open')
    const attrs = screen.getByRole('region', {
      name: 'All attributes from Klaviyo'
    })
    expect(attrs).toHaveTextContent('opt_in_process')
    expect(attrs).toHaveTextContent(
      '{"condition_groups":[{"metric_id":"abc"}]}'
    )
    expect(attrs.querySelector('img')).toBeNull()
    const linked = screen.getByRole('region', { name: 'Linked resources' })
    expect(linked).toHaveTextContent('VIP, Spring')
    expect(within(linked).getAllByText('none')).toHaveLength(2)
  })

  it('turns any value into bounded text', () => {
    expect(attributeText(null)).toBe('—')
    expect(attributeText(false)).toBe('false')
    expect(attributeText('x'.repeat(400))).toHaveLength(300)
    const loop: Record<string, unknown> = {}
    loop.self = loop
    expect(attributeText(loop)).toBe('[unreadable]')
  })
})
