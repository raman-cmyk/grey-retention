import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/font/google', () => ({
  Urbanist: () => ({ variable: 'urbanist-variable' })
}))
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

const sample = (syncedAt: string | null = null): KlaviyoData =>
  ({
    state: 'sample',
    shopify: 'missing',
    snapshot: {
      syncedAt,
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
    if (view.state !== 'sample') throw new Error(view.state)
    expect(view.segments.map((s) => [s.name, s.people, s.active])).toEqual([
      ['VIP', 120, true],
      ['Lapsed', 4000, false],
      ['Engaged', 900, true]
    ])
    expect(view.lists.map((l) => [l.name, l.detail])).toEqual([
      ['Newsletter', 'Double opt-in'],
      ['Popup', 'Single opt-in']
    ])
    expect(view.source).toMatch(/^Sample Klaviyo data/)
    expect(audiencesView(sample('2026-11-16T14:00:00Z'), now).state).toBe(
      'live'
    )
  })

  it('says when Klaviyo is not connected or the numbers are unavailable', () => {
    expect(
      audiencesView({ state: 'not_connected', reason: 'missing' }, now)
    ).toEqual({
      state: 'not_connected',
      source: 'Klaviyo is not connected yet.'
    })
    expect(audiencesView({ state: 'unavailable' }, now).state).toBe(
      'unavailable'
    )
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
      timezone: 'UTC'
    }
    expect((await audiencesReadModel(context, now)).state).toBe('sample')
    expect(mocks.klaviyoData).toHaveBeenCalledWith(
      'tenant-1',
      'UTC',
      now.getTime()
    )
    mocks.klaviyoData.mockRejectedValue(new Error('down'))
    expect((await audiencesReadModel(context, now)).state).toBe('unavailable')
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
    const segments = screen.getByRole('region', { name: 'Segments' })
    const [vip, lapsed] = within(segments).getAllByRole('listitem')
    expect(vip).toHaveTextContent('VIP')
    expect(vip).toHaveTextContent('120 people · Bought in the last 90 days')
    expect(within(vip!).getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      '/segments/SEGb'
    )
    expect(lapsed).toHaveTextContent('Not kept up to date')
    const lists = screen.getByRole('region', { name: 'Lists' })
    expect(lists).toHaveTextContent('5,000 people · Double opt-in')
    expect(lists).toHaveTextContent('1 person · Single opt-in')
    expect(
      within(lists).getAllByRole('link', { name: 'Open' })[0]
    ).toHaveAttribute('href', '/lists/LSTa')
    expect(segments).toHaveTextContent('Sample Klaviyo data')
  })

  it('asks the owner to connect Klaviyo, and says when it cannot be read', () => {
    const view = audiencesView(
      { state: 'not_connected', reason: 'missing' },
      now
    )
    render(<AudiencesScreen view={view} owner />)
    expect(
      screen.getByRole('heading', { name: 'Connect Klaviyo' })
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Settings' })).toHaveAttribute(
      'href',
      '/settings'
    )
    cleanup()
    render(<AudiencesScreen view={view} owner={false} />)
    expect(screen.queryByRole('link', { name: 'Open Settings' })).toBeNull()
    cleanup()
    render(
      <AudiencesScreen
        view={{
          state: 'unavailable',
          source: 'The audiences could not be read just now.'
        }}
        owner
      />
    )
    expect(screen.getByRole('region', { name: 'Audiences' })).toHaveTextContent(
      'could not be read'
    )
  })
})
