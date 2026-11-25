import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { KlaviyoData } from '@/features/klaviyo-data/reader'
import { sampleKlaviyoSnapshot } from '@/lib/providers/fake-klaviyo-read'
import { klaviyoResults } from './klaviyo'
import { resultsScreen } from './results-screen'
import { ResultsScreen } from './screen'

afterEach(cleanup)

const now = new Date('2026-11-24T03:00:00Z')
const sample: KlaviyoData = {
  state: 'sample',
  shopify: 'missing',
  snapshot: sampleKlaviyoSnapshot({ timezone: 'UTC', now })
}
const place = { currency: 'USD', timezone: 'UTC' }

describe('Klaviyo on Results (UI-KLV)', () => {
  it('lists the campaigns, flows and metrics in words, each with its page', () => {
    const k = klaviyoResults(sample, 'UTC', now)!
    expect(k.source).toMatch(/^Sample Klaviyo data/)
    const spring = k.campaigns.find((c) => c.title === 'Spring restock')!
    expect(spring.href).toBe('/results/campaigns/CMPspr001')
    expect(spring.details[0]).toBe('Sent')
    expect(spring.details).toContain('15,880 sent')
    const draft = k.campaigns.find((c) => c.key === 'CMPdrf008')!
    // No send time and no numbers: nothing made up.
    expect(draft.details).toEqual(['Draft'])
    const post = k.flows.find((f) => f.title === 'Post-purchase')!
    expect(post).toMatchObject({
      href: '/results/flows/FLWpst004',
      details: ['Live', 'Metric: Placed Order', '2 emails', '$3,304 in 30 days']
    })
    expect(k.metrics.find((m) => m.key === 'METord005')).toMatchObject({
      title: 'Placed Order',
      details: ['1,380 in 30 days', 'Shopify'],
      href: '/results/metrics/METord005'
    })
  })

  it('shows nothing from Klaviyo when it cannot be read', () => {
    expect(
      klaviyoResults({ state: 'not_connected', reason: 'missing' }, 'UTC', now)
    ).toBeNull()
    expect(klaviyoResults({ state: 'unavailable' }, 'UTC', now)).toBeNull()
  })

  it('draws a card each, every row opening its page, beside a store with no email yet', () => {
    render(
      <ResultsScreen
        view={resultsScreen([], place)}
        klaviyo={klaviyoResults(sample, 'UTC', now)}
      />
    )
    expect(
      screen.getByRole('heading', { name: 'No results yet' })
    ).toBeInTheDocument()
    for (const [name, href] of [
      ['Klaviyo campaigns', '/results/campaigns/CMPspr001'],
      ['Flows', '/results/flows/FLWwel001'],
      ['Metrics', '/results/metrics/METopn001']
    ] as const) {
      const card = within(screen.getByRole('region', { name }))
      expect(card.getByText(/^Sample Klaviyo data/)).toBeInTheDocument()
      const links = card.getAllByRole('link', { name: 'Open' })
      expect(links.map((l) => l.getAttribute('href'))).toContain(href)
      // One action per row, and no forest button among them.
      expect(links).toHaveLength(card.getAllByRole('listitem').length)
    }
    // Klaviyo's own ids are not the owner's words.
    expect(screen.getByRole('main')).not.toHaveTextContent(
      /\b(CMP|FLW|MET)[a-z]{3}\d{3}/
    )
  })

  it('says when Klaviyo has none of a kind yet', () => {
    const empty = klaviyoResults(
      {
        ...sample,
        snapshot: { ...sample.snapshot, flows: [], metrics: [] }
      } as KlaviyoData,
      'UTC',
      now
    )
    render(<ResultsScreen view={resultsScreen([], place)} klaviyo={empty} />)
    expect(screen.getByText('No flows in Klaviyo yet.')).toBeInTheDocument()
    expect(screen.getByText('No metrics in Klaviyo yet.')).toBeInTheDocument()
  })
})
