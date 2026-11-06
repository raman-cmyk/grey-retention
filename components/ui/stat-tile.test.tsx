import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SplitSection } from './split-section'
import { StatGrid, StatTile } from './stat-tile'

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

  it('links a tile when it has a destination', () => {
    render(
      <StatGrid>
        <StatTile label="In production" value={2} href="/campaign-agent" />
      </StatGrid>
    )
    expect(screen.getByRole('link')).toHaveAttribute('href', '/campaign-agent')
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
