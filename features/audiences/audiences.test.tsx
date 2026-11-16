import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ klaviyoData: vi.fn() }))
vi.mock('@/features/klaviyo-data/reader', () => ({
  klaviyoData: mocks.klaviyoData
}))

import type { KlaviyoData } from '@/features/klaviyo-data/reader'
import { audiencesReadModel, audiencesView } from './read-model'
import { AudiencesScreen } from './screen'

afterEach(cleanup)
const now = new Date('2026-11-16T15:00:00Z')

const segment = (
  id: string,
  name: string,
  profileCount: number,
  extra: Record<string, unknown> = {}
) => ({
  id,
  name,
  profileCount,
  starred: false,
  active: true,
  rules: 'Bought in the last 90 days',
  definition: {},
  created: '2026-01-01T00:00:00Z',
  updated: '2026-11-01T00:00:00Z',
  ...extra
})

const sample = (): KlaviyoData =>
  ({
    state: 'sample',
    shopify: 'missing',
    snapshot: {
      syncedAt: null,
      segments: [
        segment('SEGa', 'Engaged', 900),
        segment('SEGb', 'VIP', 120, { starred: true }),
        segment('SEGc', 'Lapsed', 4000, { active: false })
      ],
      lists: [
        {
          id: 'LSTa',
          name: 'Newsletter',
          optIn: 'double',
          profileCount: 5000,
          created: '2026-01-01T00:00:00Z',
          updated: '2026-11-01T00:00:00Z'
        },
        {
          id: 'LSTb',
          name: 'Popup',
          optIn: 'single',
          profileCount: 1,
          created: '2026-01-01T00:00:00Z',
          updated: '2026-11-01T00:00:00Z'
        }
      ]
    }
  }) as unknown as KlaviyoData

describe('audiencesView (UI-AUDa)', () => {
  it('lists segments (starred first, then the biggest) and lists with their sizes', () => {
    const view = audiencesView(sample(), now)
    if (view.state !== 'ready') throw new Error(view.state)
    expect(
      view.segments.map((s) => [s.name, s.people, s.active, s.starred])
    ).toEqual([
      ['VIP', 120, true, true],
      ['Lapsed', 4000, false, false],
      ['Engaged', 900, true, false]
    ])
    // Klaviyo's rule sentence sits in a row: no closing full stop.
    expect(view.segments[0]!.detail).toBe('Bought in the last 90 days')
    expect(view.lists.map((l) => [l.name, l.detail])).toEqual([
      ['Newsletter', 'Double opt-in'],
      ['Popup', 'Single opt-in']
    ])
    expect(view.source).toMatch(/^Sample Klaviyo data/)
  })

  it('tells not connected, a key that stopped working and an unreadable connection apart', () => {
    for (const reason of ['missing', 'disconnected'] as const)
      expect(audiencesView({ state: 'not_connected', reason }, now)).toEqual({
        state: 'not_connected'
      })
    for (const reason of ['expired', 'error'] as const)
      expect(audiencesView({ state: 'not_connected', reason }, now)).toEqual({
        state: 'reconnect'
      })
    // A connection that could not be checked is never "connect Klaviyo".
    expect(
      audiencesView({ state: 'not_connected', reason: 'unknown' }, now)
    ).toEqual({
      state: 'unavailable',
      reason: "We couldn't check the Klaviyo connection."
    })
    expect(audiencesView({ state: 'unavailable' }, now)).toEqual({
      state: 'unavailable',
      reason: "Klaviyo numbers aren't available in this version yet."
    })
  })

  it('reads for the session’s workspace and survives a failed read', async () => {
    mocks.klaviyoData.mockResolvedValue(sample())
    const context = {
      kind: 'client' as const,
      userId: 'u',
      tenantId: 'tenant-1',
      tenantRole: 'staff' as const,
      tenantName: 'Cedar Lane',
      tenantSlug: 'cedar-lane',
      timezone: 'Not/AZone'
    }
    expect((await audiencesReadModel(context, now)).state).toBe('ready')
    // A timezone that is not one falls back instead of failing the page.
    expect(mocks.klaviyoData).toHaveBeenCalledWith(
      'tenant-1',
      'UTC',
      now.getTime()
    )
    mocks.klaviyoData.mockRejectedValue(new Error('down'))
    expect(await audiencesReadModel(context, now)).toEqual({
      state: 'unavailable',
      reason: 'The audiences could not be read just now.'
    })
  })
})

describe('Audiences screen (UI-AUDa)', () => {
  it('shows segments and lists, each opening its own page, with Audiences current', () => {
    render(<AudiencesScreen view={audiencesView(sample(), now)} owner />)
    expect(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole(
        'link',
        { name: 'Audiences' }
      )
    ).toHaveAttribute('aria-current', 'page')
    // Where the numbers come from is said once, above both cards.
    expect(screen.getAllByText(/Sample Klaviyo data/)).toHaveLength(1)
    const segments = screen.getByRole('region', { name: 'Segments' })
    const [vip, lapsed] = within(segments).getAllByRole('listitem')
    expect(vip).toHaveTextContent(
      'Starred · 120 people · Bought in the last 90 days'
    )
    expect(within(vip!).getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      '/segments/SEGb'
    )
    expect(lapsed).toHaveTextContent(
      '4,000 people · Bought in the last 90 days · Not kept up to date'
    )
    expect(lapsed).not.toHaveTextContent('Starred')
    const lists = screen.getByRole('region', { name: 'Lists' })
    expect(lists).toHaveTextContent('5,000 people · Double opt-in')
    expect(lists).toHaveTextContent('1 person · Single opt-in')
    expect(
      within(lists).getAllByRole('link', { name: 'Open' })[0]
    ).toHaveAttribute('href', '/lists/LSTa')
  })

  it('says when Klaviyo has no segments or lists', () => {
    render(
      <AudiencesScreen
        view={{ state: 'ready', source: 'Sample.', segments: [], lists: [] }}
        owner
      />
    )
    expect(screen.getByRole('region', { name: 'Segments' })).toHaveTextContent(
      'No segments in Klaviyo yet.'
    )
    expect(screen.getByRole('region', { name: 'Lists' })).toHaveTextContent(
      'No lists in Klaviyo yet.'
    )
  })

  it('sends the owner to connect Klaviyo; staff are told who does it', () => {
    render(<AudiencesScreen view={{ state: 'not_connected' }} owner />)
    expect(
      screen.getByRole('heading', { name: 'Connect Klaviyo' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Connect Klaviyo' })
    ).toHaveAttribute('href', '/connections')
    cleanup()
    render(<AudiencesScreen view={{ state: 'not_connected' }} owner={false} />)
    expect(screen.queryByRole('link', { name: 'Connect Klaviyo' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Klaviyo' })).toHaveTextContent(
      'The store’s owner connects Klaviyo.'
    )
  })

  it('asks the owner to reconnect a key that stopped working', () => {
    render(<AudiencesScreen view={{ state: 'reconnect' }} owner />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Klaviyo key stopped working'
    )
    expect(screen.getByRole('link', { name: 'Reconnect' })).toHaveAttribute(
      'href',
      '/connections'
    )
    cleanup()
    render(<AudiencesScreen view={{ state: 'reconnect' }} owner={false} />)
    expect(screen.queryByRole('link', { name: 'Reconnect' })).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The store’s owner reconnects Klaviyo'
    )
  })

  it('says why the audiences could not be read, with Try again', () => {
    render(
      <AudiencesScreen
        view={{
          state: 'unavailable',
          reason: 'The audiences could not be read just now.'
        }}
        owner={false}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Audiences could not be readThe audiences could not be read just now. Try again in a minute.'
    )
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      '/audiences'
    )
  })
})
