import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ klaviyoData: vi.fn() }))
vi.mock('@/features/klaviyo-data/reader', () => ({
  klaviyoData: mocks.klaviyoData
}))

import AudiencesError from '@/app/(gros)/audiences/error'
import AudiencesLoading from '@/app/(gros)/audiences/loading'
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
      reason: "We couldn't check the Klaviyo connection.",
      retry: true
    })
    // The live mode has no Klaviyo reader yet: trying again cannot help.
    expect(audiencesView({ state: 'unavailable' }, now)).toEqual({
      state: 'unavailable',
      reason: "Klaviyo numbers aren't available in this version yet.",
      retry: false
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
      reason: 'The audiences could not be read just now.',
      retry: true
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
    // Where the numbers come from, on each card (BRAND rule 1).
    expect(screen.getAllByText(/Sample Klaviyo data/)).toHaveLength(2)
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
      screen.getByRole('heading', { name: 'Klaviyo not connected' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Connect Klaviyo' })
    ).toHaveAttribute('href', '/connections')
    cleanup()
    render(<AudiencesScreen view={{ state: 'not_connected' }} owner={false} />)
    expect(screen.queryByRole('link', { name: 'Connect Klaviyo' })).toBeNull()
    // The same words for staff, who are told who connects it instead.
    expect(
      screen.getByRole('heading', { level: 2, name: 'Klaviyo not connected' })
    ).toBeInTheDocument()
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
          reason: 'The audiences could not be read just now.',
          retry: true
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
    cleanup()
    // Nothing to try again for: no Try again, no "in a minute".
    render(
      <AudiencesScreen
        view={{
          state: 'unavailable',
          reason: "Klaviyo numbers aren't available in this version yet.",
          retry: false
        }}
        owner
      />
    )
    expect(screen.getByRole('alert')).not.toHaveTextContent('Try again')
    expect(screen.queryByRole('link', { name: 'Try again' })).toBeNull()
  })
})

describe('Audiences states (UI-AUDb)', () => {
  it('shows a long segment name and its rules whole, for the owner and staff', () => {
    const name = 'Bought twice in the spring sale and opened every email since'
    const rules =
      'Placed an order at least twice in the last 90 days and opened an email in the last 30 days'
    const data = sample()
    if (data.state !== 'sample') throw new Error(data.state)
    data.snapshot.segments.push(segment('SEGlong', name, 99_999, { rules }))
    for (const owner of [true, false]) {
      render(<AudiencesScreen view={audiencesView(data, now)} owner={owner} />)
      const row = within(
        screen.getByRole('region', { name: 'Segments' })
      ).getByText(name)
      // Never cut to one line: a phone shows every word.
      expect(row).not.toHaveClass('truncate')
      expect(row).toHaveClass('break-words')
      const details = screen.getByText(
        `99,999 people · ${rules.replace(/\.$/, '')}`
      )
      expect(details).not.toHaveClass('truncate')
      expect(details).toHaveClass('break-words')
      // Opening a segment is for everyone who can see it.
      expect(
        screen.getAllByRole('link', { name: 'Open' }).length
      ).toBeGreaterThan(0)
      cleanup()
    }
  })

  it('opens on the loading page: the bar with Audiences current, its words, busy, and no main', () => {
    const { container } = render(<AudiencesLoading />)
    expect(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole(
        'link',
        { name: 'Audiences' }
      )
    ).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Opening Audiences')).toHaveAttribute(
      'aria-live',
      'polite'
    )
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    // The page brings the one main while it streams in.
    expect(container.querySelector('main')).toBeNull()
  })

  it('says plainly when the page did not open, with Try again and the bar as a way out', async () => {
    const retry = vi.fn()
    render(<AudiencesError retry={retry} />)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Audiences did not open')
    expect(alert).toHaveTextContent('Nothing was changed.')
    expect(alert).not.toHaveTextContent(/Something went wrong|error/i)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
    const menu = within(screen.getByRole('navigation', { name: 'Main' }))
    expect(menu.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/home'
    )
    expect(menu.getByRole('link', { name: 'Audiences' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })
})
