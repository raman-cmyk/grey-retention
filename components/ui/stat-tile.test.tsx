import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SplitSection } from './split-section'
import { StatGrid, StatTile, cappedCount } from './stat-tile'

afterEach(cleanup)

describe('StatTile and StatGrid', () => {
  it('pairs each label with its number for screen readers', () => {
    render(
      <StatGrid label="Campaign progress">
        <StatTile label="Awaiting review" value={3} caption="Your decisions" />
        <StatTile label="Scheduled" value={0} />
      </StatGrid>
    )
    const grid = screen.getByLabelText('Campaign progress')
    expect(grid.tagName).toBe('DL')
    const terms = within(grid).getAllByRole('term')
    const values = within(grid).getAllByRole('definition')
    expect(terms.map((t) => t.textContent)).toEqual([
      'Awaiting review',
      'Scheduled'
    ])
    expect(values[0]).toHaveTextContent('3Your decisions')
    expect(values[1]).toHaveTextContent(/^0$/)
  })

  it('never shows an unknown value as zero', () => {
    render(
      <StatGrid>
        <StatTile
          label="Real revenue"
          value={null}
          caption="Last 30 days"
          unknownReason="Not connected yet"
        />
      </StatGrid>
    )
    const value = screen.getByRole('definition')
    expect(value).toHaveTextContent('—Not connected yet')
    expect(value).not.toHaveTextContent('0')
    expect(value).not.toHaveTextContent('Last 30 days')
  })

  it('names a linked tile by its label and number', () => {
    render(
      <StatGrid>
        <StatTile
          label="In production"
          value={2}
          caption="Copy and design"
          href="/campaign-agent"
        />
      </StatGrid>
    )
    const link = screen.getByRole('link', { name: 'In production 2' })
    expect(link).toHaveAttribute('href', '/campaign-agent')
    expect(link).toHaveAccessibleDescription('Copy and design')
  })

  it('keeps every tile as a dt and dd pair inside the list', () => {
    const { container } = render(
      <StatGrid>
        <StatTile label="A" value={1} />
        <StatTile label="B" value={2} href="/dashboard" />
      </StatGrid>
    )
    for (const tile of container.querySelectorAll('dl > div')) {
      expect([...tile.children].map((child) => child.tagName)).toEqual([
        'DT',
        'DD'
      ])
    }
  })

  it('explains an unknown value even without a reason', () => {
    render(
      <StatGrid>
        <StatTile label="Opens" value={undefined} />
      </StatGrid>
    )
    expect(screen.getByRole('definition')).toHaveTextContent('—Not known yet')
  })

  it('marks counts from capped lists as minimums', () => {
    expect(cappedCount(12, 100)).toBe(12)
    expect(cappedCount(100, 100)).toBe('100+')
  })
})

describe('SplitSection', () => {
  it('puts the headline and takeaway before the data', () => {
    render(
      <SplitSection
        eyebrow="Results summary"
        title="What we have learned so far"
        takeaway="These numbers are simulated."
      >
        <p>data panel</p>
      </SplitSection>
    )
    const heading = screen.getByRole('heading', {
      name: 'What we have learned so far'
    })
    expect(
      heading.compareDocumentPosition(screen.getByText('data panel')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.getByText('These numbers are simulated.')).toBeInTheDocument()
  })
})
