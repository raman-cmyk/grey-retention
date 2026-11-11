import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BrandSummaries } from './brand-summaries'

afterEach(cleanup)

describe('BrandSummaries', () => {
  it('says in words what a brand sends, its repeats first and one-offs as such', () => {
    render(
      <BrandSummaries
        brands={[
          {
            domain: 'northwind.example',
            label: 'Northwind Outdoor',
            sample: false,
            summary: {
              emails: 4,
              windowDays: 90,
              perWeek: 0.3,
              angles: [
                { angle: 'launch', count: 3, share: 0.75 },
                { angle: 'story', count: 1, share: 0.25 }
              ],
              discount: {
                share: 0.5,
                typicalPercent: 20,
                kinds: [{ kind: 'percent', count: 2 }]
              },
              textRatio: 0.6,
              sends: { day: 'Tuesday', hour: 9 },
              patterns: [
                {
                  angle: 'launch',
                  offer: 'percent',
                  opening: ['hero_image', 'text'],
                  count: 3,
                  weight: 0.75,
                  repeated: true
                },
                {
                  angle: 'story',
                  offer: 'none',
                  opening: ['founder_note'],
                  count: 1,
                  weight: 0.25,
                  repeated: false
                }
              ]
            }
          }
        ]}
      />
    )
    const card = within(
      screen.getByRole('list', { name: 'Brand summaries' })
    ).getAllByRole('listitem')[0]!
    expect(
      within(card).getByRole('heading', { name: /Northwind Outdoor/ })
    ).toBeTruthy()
    expect(within(card).queryByText('Sample')).toBeNull()
    expect(card.textContent).toContain(
      '4 emails in the last 90 days (about 0.3 a week).'
    )
    expect(card.textContent).toContain('New arrivals 75% · Brand story 25%')
    expect(card.textContent).toContain('in 50% of emails, usually 20% off')
    expect(card.textContent).toContain('text 60% · design 40%')
    expect(card.textContent).toContain('usually Tuesday around 09:00 your time')
    expect(
      within(card).getByText(
        /New arrivals with a % off, opening with photo hero → text section — 3×/
      )
    ).toBeTruthy()
    expect(card.textContent).toContain(
      'Tried once: Brand story with no offer, opening with founder note'
    )
  })

  it('names a brand once when its label is its domain', () => {
    render(
      <BrandSummaries
        brands={[
          {
            domain: 'cedar.example',
            label: 'cedar.example',
            sample: true,
            summary: {
              emails: 1,
              windowDays: 90,
              perWeek: 0.1,
              angles: [],
              discount: { share: 0, typicalPercent: null, kinds: [] },
              textRatio: null,
              sends: null,
              patterns: []
            }
          }
        ]}
      />
    )
    expect(screen.getByRole('heading', { name: 'cedar.example' })).toBeTruthy()
    // A sample brand says so.
    expect(screen.getByText('Sample')).toBeTruthy()
  })

  it('shows nothing without a summary', () => {
    const { container } = render(<BrandSummaries brands={[]} />)
    expect(container.innerHTML).toBe('')
  })
})
