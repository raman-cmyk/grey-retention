import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ApprovedCopy,
  BrandFacts,
  BriefHeader,
  InspirationPack,
  OwnerFeedback,
  SubmissionHistory
} from './assignment-parts'
import { DeskList, DeskNotifications, DeskTabs } from './desk'
import { assignmentStatus, deskModel, dueLine } from './model'

afterEach(cleanup)

const now = new Date('2026-11-07T12:00:00Z')
const hours = (n: number) =>
  new Date(now.getTime() + n * 3600_000).toISOString()
const desk = deskModel(
  [
    {
      id: '11111111-1111-4111-8111-111111111111',
      state: 'revisions_requested',
      due_at: hours(-2),
      copy_revision: 2,
      brief: { title: 'Weekend edit', brandName: 'Cedar Lane' }
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      state: 'submitted',
      due_at: hours(8),
      copy_revision: 3,
      brief: { title: 'Autumn restock', brandName: 'Cedar Lane' }
    }
  ],
  null,
  now
)

describe('designer desk', () => {
  it('shows status tabs with counts as links that keep the choice', () => {
    render(<DeskTabs filter={desk.filter} counts={desk.counts} />)
    const nav = within(
      screen.getByRole('navigation', { name: 'Assignment status' })
    )
    const todo = nav.getByRole('link', { name: 'To do (1)' })
    expect(todo).toHaveAttribute('aria-current', 'page')
    expect(todo).toHaveAttribute('href', '/designer/dashboard?show=todo')
    expect(
      nav.getByRole('link', { name: 'Waiting for owner (1)' })
    ).not.toHaveAttribute('aria-current')
    expect(nav.getByRole('link', { name: 'All (2)' })).toHaveAttribute(
      'href',
      '/designer/dashboard?show=all'
    )
  })

  it('lists each brief as one link with its status and due time', () => {
    render(<DeskList rows={desk.rows} filter={desk.filter} />)
    const row = screen.getByRole('link', { name: /Weekend edit/ })
    expect(row).toHaveAttribute(
      'href',
      '/designer/assignments/11111111-1111-4111-8111-111111111111'
    )
    expect(row).toHaveTextContent('Cedar Lane · Approved copy v2')
    expect(row).toHaveTextContent('Redo requested')
    expect(row).toHaveTextContent('Was due 2 hours ago')
    // Only the To do tab's brief is shown.
    expect(screen.queryByRole('link', { name: /Autumn restock/ })).toBeNull()
  })

  it('says plainly when a tab is empty', () => {
    render(<DeskList rows={[]} filter="approved" />)
    expect(
      screen.getByRole('heading', { name: 'No approved designs yet' })
    ).toBeVisible()
  })

  it('labels notification email as simulated', () => {
    const { rerender } = render(
      <DeskNotifications
        now={now}
        items={[
          { id: 'n1', message: 'New brief assigned.', created_at: hours(-3) }
        ]}
      />
    )
    expect(screen.getByText('New brief assigned.')).toBeVisible()
    expect(
      screen.getByText('3 hours ago · Email delivery simulated')
    ).toBeVisible()
    rerender(<DeskNotifications now={now} items={[]} />)
    expect(screen.getByText(/No notifications yet/)).toBeVisible()
  })
})

describe('assignment page parts', () => {
  it('heads the brief with status, due time and the next step', () => {
    render(
      <BriefHeader
        title="Weekend edit"
        brand="Cedar Lane"
        copyRevision={2}
        status={assignmentStatus('revisions_requested')}
        due={dueLine(hours(3), 'revisions_requested', now)}
      />
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'Weekend edit' })
    ).toBeVisible()
    expect(screen.getByText('Redo requested')).toBeVisible()
    expect(screen.getByText('· Due in 3 hours')).toHaveAttribute(
      'title',
      expect.stringMatching(/UTC$/)
    )
    expect(screen.getByText(/Read their feedback/)).toBeVisible()
  })

  it('shows the approved copy and names missing parts', () => {
    render(
      <ApprovedCopy
        subject="A considered weekend"
        preheader=""
        body="Body text"
        cta="Explore"
        url="https://example.test/weekend"
      />
    )
    expect(screen.getByText('A considered weekend')).toBeVisible()
    expect(screen.getByText('No preview text')).toBeVisible()
    expect(screen.getByText(/Use this text exactly/)).toBeVisible()
  })

  it('draws swatches only for real colours', () => {
    const { container } = render(
      <BrandFacts
        brandName="Cedar Lane"
        brandRevision={4}
        voice="Calm"
        prohibitions=""
        referenceStructure=""
        kit={{
          colors: ['#222222', 'url(evil)'],
          fonts: ['Arial'],
          approved: false
        }}
      />
    )
    expect(screen.getByText('Cedar Lane · profile v4')).toBeVisible()
    expect(screen.getByText('url(evil)')).toBeVisible()
    const swatches = container.querySelectorAll('[style]')
    expect(swatches).toHaveLength(1)
    expect((swatches[0] as HTMLElement).style.backgroundColor).toBe(
      'rgb(34, 34, 34)'
    )
    expect(screen.getByText(/not yet owner approved/)).toBeVisible()
    expect(screen.getByText('No prohibitions')).toBeVisible()
    expect(
      screen.getByText('A single send, not part of a series')
    ).toBeVisible()
  })

  it('tells the designer when shared images failed to load', () => {
    const { rerender } = render(
      <InspirationPack assets={[{ path: 'a.png', preview: null }]} />
    )
    expect(screen.getByText(/could not be loaded/)).toBeVisible()
    rerender(<InspirationPack assets={[]} />)
    expect(
      screen.getByText('No images were shared with this brief.')
    ).toBeVisible()
  })

  it('lists owner feedback in the designer words', () => {
    render(
      <OwnerFeedback
        now={now}
        reviews={[
          {
            id: 'r2',
            decision: 'approved',
            section: 'Whole email',
            feedback: '',
            created_at: hours(-1)
          },
          {
            id: 'r1',
            decision: 'revision',
            section: 'Hero',
            feedback: 'More breathing room.',
            created_at: hours(-26)
          }
        ]}
      />
    )
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Approved')
    expect(items[1]).toHaveTextContent('Redo requested')
    expect(items[1]).toHaveTextContent('Hero')
    expect(screen.getByText('More breathing room.')).toBeVisible()
  })

  it('keeps the version heading the review loop relies on', () => {
    render(
      <SubmissionHistory
        now={now}
        submissions={[
          {
            id: 's1',
            revision: 4,
            copy_revision: 2,
            notes: 'First pass.',
            created_at: hours(-4),
            preview: null
          }
        ]}
      />
    )
    expect(
      screen.getByRole('heading', { name: 'Design v4 · copy v2' })
    ).toBeVisible()
    expect(screen.getByText('Submitted 4 hours ago')).toBeVisible()
    expect(screen.getByText(/image could not be loaded/)).toBeVisible()
  })
})
