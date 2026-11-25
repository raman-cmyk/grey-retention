import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({
  klaviyoData: vi.fn(),
  role: 'owner' as 'owner' | 'staff',
  denied: false
}))
vi.mock('@/features/klaviyo-data/reader', () => ({
  klaviyoData: mocks.klaviyoData
}))
vi.mock('@/features/auth/application/request-context', () => ({
  requireRequestContext: async () => {
    if (mocks.denied) throw new Error('NEXT_REDIRECT /login')
    return {
      kind: 'client',
      userId: 'u1',
      tenantId: 'tenant-1',
      tenantName: 'Cedar Lane',
      tenantSlug: 'cedar-lane',
      tenantRole: mocks.role,
      timezone: 'Australia/Sydney'
    }
  }
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  }
}))

import AudienceNotFound from '@/app/(gros)/audiences/not-found'
import ListError from '@/app/(gros)/audiences/lists/[listId]/error'
import ListLoading from '@/app/(gros)/audiences/lists/[listId]/loading'
import ListPage from '@/app/(gros)/audiences/lists/[listId]/page'
import SegmentError from '@/app/(gros)/audiences/segments/[segmentId]/error'
import SegmentLoading from '@/app/(gros)/audiences/segments/[segmentId]/loading'
import SegmentPage from '@/app/(gros)/audiences/segments/[segmentId]/page'
import type { KlaviyoData } from '@/features/klaviyo-data/reader'
import { sampleKlaviyoSnapshot } from '@/lib/providers/fake-klaviyo-read'
import { listView, segmentView } from './detail'

const now = new Date('2026-11-24T03:00:00Z')

afterEach(() => {
  cleanup()
  mocks.klaviyoData.mockReset()
  mocks.role = 'owner'
  mocks.denied = false
})

/** The sample Klaviyo data the fake provider gives every workspace. */
async function sample(): Promise<KlaviyoData> {
  return {
    state: 'sample',
    shopify: 'missing',
    snapshot: sampleKlaviyoSnapshot({ timezone: 'Australia/Sydney', now })
  }
}

const read = async (data?: KlaviyoData) => ({
  data: data ?? (await sample()),
  timezone: 'Australia/Sydney',
  now
})

const segmentProps = (segmentId: string) => ({
  params: Promise.resolve({ segmentId })
})
const listProps = (listId: string) => ({ params: Promise.resolve({ listId }) })

describe('segment and list views (UI-AUDc)', () => {
  it('a segment: its size, rules in words, dates, and the campaigns using it', async () => {
    const view = segmentView(await read(), 'SEGeng090')
    if (view.state !== 'ready') throw new Error(view.state)
    expect(view.source).toMatch(/^Sample Klaviyo data/)
    const s = view.audience
    expect(s.kind).toBe('segment')
    expect(s.rules).not.toMatch(/condition_groups/)
    expect(s.created?.date).toMatch(/^\w{3} \d{1,2}, \d{4}$/)
    expect(s.updated?.ago).toMatch(/ago$/)
    expect(s.usedBy.length).toBeGreaterThan(0)
    for (const use of s.usedBy) {
      expect(use.kind).toBe('campaign')
      expect(use.details[0]).toBe('Campaign')
      expect(use.details[2]).toMatch(
        /^(Sends to this segment|Leaves this segment out)$/
      )
      // Each opens its own page under Results (UI-KLV).
      expect(use.href).toMatch(/^\/results\/campaigns\/CMP/)
    }
  })

  it('a list: how people join, and the flows and campaigns using it', async () => {
    const view = listView(await read(), 'LSTnews01')
    if (view.state !== 'ready') throw new Error(view.state)
    const l = view.audience
    expect(l.signUp.label).toBe('Double opt-in')
    const flows = l.usedBy.filter((u) => u.kind === 'flow')
    expect(flows.length).toBeGreaterThan(0)
    for (const f of flows)
      expect(f.details).toContain(
        f.details.includes('Live')
          ? 'Starts when someone joins'
          : 'Would start when someone joins'
      )
    expect(l.usedBy.some((u) => u.kind === 'campaign')).toBe(true)
  })

  it('an id Klaviyo does not have is not found; Klaviyo problems say so', async () => {
    expect(segmentView(await read(), 'nope')).toEqual({ state: 'not_found' })
    expect(listView(await read(), 'SEGeng090')).toEqual({ state: 'not_found' })
    expect(
      segmentView(
        await read({ state: 'not_connected', reason: 'missing' }),
        'SEGeng090'
      )
    ).toEqual({ state: 'not_connected' })
    expect(
      listView(
        await read({ state: 'not_connected', reason: 'expired' }),
        'LSTnews01'
      )
    ).toEqual({ state: 'reconnect' })
    expect(listView(await read({ state: 'unavailable' }), 'x')).toEqual({
      state: 'unavailable',
      reason: "Klaviyo numbers aren't available in this version yet.",
      retry: false
    })
  })
})

describe('the segment and list pages (UI-AUDc)', () => {
  it('a segment: its name as the title, Audiences current, Back to Audiences, its facts', async () => {
    mocks.klaviyoData.mockResolvedValue(await sample())
    render(await SegmentPage(segmentProps('SEGeng030')))
    expect(
      screen.getByRole('heading', { level: 1, name: 'Engaged 30 days' })
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole(
        'link',
        { name: 'Audiences' }
      )
    ).toHaveAttribute('aria-current', 'page')
    expect(
      screen.getByRole('link', { name: 'Back to Audiences' })
    ).toHaveAttribute('href', '/audiences')
    const peopleCard = screen.getByRole('region', { name: 'People' })
    expect(peopleCard).toHaveTextContent(/people in this segment/)
    expect(peopleCard).toHaveTextContent('Starred in Klaviyo')
    expect(peopleCard).toHaveTextContent(/Sample Klaviyo data/)
    const rules = screen.getByRole('region', { name: 'Rules' })
    expect(rules).toHaveTextContent('Opened an email in the last 30 days.')
    expect(rules).toHaveTextContent('Klaviyo adds and removes people')
    expect(rules).not.toHaveTextContent('condition_groups')
    const dates = screen.getByRole('region', { name: 'Dates' })
    // Klaviyo's own ids are not the owner's words (BRAND.md rule 20).
    expect(dates).not.toHaveTextContent('SEGeng030')
    expect(dates).toHaveTextContent(/Created/)
    expect(dates).toHaveTextContent(/Last changed/)
    expect(screen.getByRole('region', { name: 'Used by' })).toBeInTheDocument()
    // Read for the session's workspace, in its timezone.
    expect(mocks.klaviyoData).toHaveBeenCalledWith(
      'tenant-1',
      'Australia/Sydney',
      expect.any(Number)
    )
  })

  it('a segment Klaviyo no longer keeps up to date says so', async () => {
    const data = await sample()
    if (data.state !== 'sample') throw new Error(data.state)
    data.snapshot.segments[0]!.active = false
    mocks.klaviyoData.mockResolvedValue(data)
    render(await SegmentPage(segmentProps(data.snapshot.segments[0]!.id)))
    expect(screen.getByRole('region', { name: 'Rules' })).toHaveTextContent(
      'Klaviyo is not keeping this segment up to date'
    )
  })

  it('a list: its name, how people join in words, what uses it', async () => {
    mocks.klaviyoData.mockResolvedValue(await sample())
    render(await ListPage(listProps('LSTnews01')))
    expect(
      screen.getByRole('heading', { level: 1, name: 'Newsletter' })
    ).toBeInTheDocument()
    const signUp = screen.getByRole('region', { name: 'Sign-up' })
    expect(signUp).toHaveTextContent('Double opt-in')
    expect(signUp).not.toHaveTextContent('double_opt_in')
    expect(screen.getByRole('region', { name: 'People' })).toHaveTextContent(
      /people on this list/
    )
    const used = within(screen.getByRole('region', { name: 'Used by' }))
    expect(used.getAllByRole('listitem').length).toBeGreaterThan(0)
    expect(used.getAllByText(/^Flow · /).length).toBeGreaterThan(0)
    // Each opens its own page under Results (UI-KLV).
    const opens = used
      .getAllByRole('link', { name: 'Open' })
      .map((l) => l.getAttribute('href'))
    expect(opens).toContain('/results/flows/FLWwel001')
    expect(opens).toContain('/results/campaigns/CMPspr001')
    // Nothing on the page leads back to the old pages.
    for (const link of screen.getAllByRole('link'))
      expect(link.getAttribute('href')).not.toMatch(/^\/(lists|segments)\//)
  })

  it('an unknown segment or list is not found', async () => {
    mocks.klaviyoData.mockResolvedValue(await sample())
    await expect(SegmentPage(segmentProps('nope'))).rejects.toThrow(
      'NEXT_NOT_FOUND'
    )
    await expect(ListPage(listProps('nope'))).rejects.toThrow('NEXT_NOT_FOUND')
    render(<AudienceNotFound />)
    expect(
      screen.getByRole('heading', { name: 'Audience not found' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Back to Audiences' })
    ).toHaveAttribute('href', '/audiences')
  })

  it('Klaviyo not connected: the owner connects it on Settings, staff are told who does', async () => {
    mocks.klaviyoData.mockResolvedValue({
      state: 'not_connected',
      reason: 'missing'
    })
    render(await SegmentPage(segmentProps('SEGeng030')))
    expect(
      screen.getByRole('heading', { level: 1, name: 'Segment' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Connect Klaviyo' })
    ).toHaveAttribute('href', '/settings#klaviyo')
    expect(
      screen.getByRole('link', { name: 'Back to Audiences' })
    ).toHaveAttribute('href', '/audiences')
    cleanup()
    mocks.role = 'staff'
    render(await ListPage(listProps('LSTnews01')))
    expect(screen.queryByRole('link', { name: 'Connect Klaviyo' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Klaviyo' })).toHaveTextContent(
      'The store’s owner connects Klaviyo.'
    )
  })

  it('a key that stopped working: Reconnect on Settings', async () => {
    mocks.klaviyoData.mockResolvedValue({
      state: 'not_connected',
      reason: 'error'
    })
    render(await ListPage(listProps('LSTnews01')))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Klaviyo key stopped working'
    )
    expect(screen.getByRole('link', { name: 'Reconnect' })).toHaveAttribute(
      'href',
      '/settings#klaviyo'
    )
  })

  it('a failed read says so, and Try again opens the same page', async () => {
    mocks.klaviyoData.mockRejectedValue(new Error('down'))
    render(await SegmentPage(segmentProps('SEG a/b')))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Klaviyo could not be read just now. Try again in a minute.'
    )
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      '/audiences/segments/SEG%20a%2Fb'
    )
  })

  it('reads nothing when the visitor is not signed in', async () => {
    mocks.denied = true
    await expect(SegmentPage(segmentProps('SEGeng030'))).rejects.toThrow(
      'NEXT_REDIRECT'
    )
    await expect(ListPage(listProps('LSTnews01'))).rejects.toThrow(
      'NEXT_REDIRECT'
    )
    expect(mocks.klaviyoData).not.toHaveBeenCalled()
  })

  it('loading: the bar with Audiences current, its words, busy, and no main', () => {
    for (const [Loading, words] of [
      [SegmentLoading, 'Opening the segment'],
      [ListLoading, 'Opening the list']
    ] as const) {
      const { container } = render(<Loading />)
      expect(
        within(screen.getByRole('navigation', { name: 'Main' })).getByRole(
          'link',
          { name: 'Audiences' }
        )
      ).toHaveAttribute('aria-current', 'page')
      expect(screen.getByText(words)).toHaveAttribute('aria-live', 'polite')
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
      expect(container.querySelector('main')).toBeNull()
      cleanup()
    }
  })

  it('error: what happened, Try again, and the way back to Audiences', async () => {
    for (const [Error, words] of [
      [SegmentError, 'This segment did not open'],
      [ListError, 'This list did not open']
    ] as const) {
      const retry = vi.fn()
      render(<Error retry={retry} />)
      expect(screen.getAllByRole('main')).toHaveLength(1)
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent(words)
      expect(alert).toHaveTextContent('Nothing was changed.')
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
      expect(retry).toHaveBeenCalledTimes(1)
      expect(
        screen.getByRole('link', { name: 'Back to Audiences' })
      ).toHaveAttribute('href', '/audiences')
      cleanup()
    }
  })
})
