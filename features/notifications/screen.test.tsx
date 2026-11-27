import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./actions', () => ({
  openNotice: vi.fn(async () => {}),
  markAllNoticesRead: vi.fn(async () => ({
    message: 'Done. Every notification is read.'
  })),
  setNoticeEmail: vi.fn(async () => ({
    message: 'Emails are on. This build records each one but sends none yet.'
  }))
}))

import NotificationsError from '@/app/(gros)/notifications/error'
import NotificationsLoading from '@/app/(gros)/notifications/loading'
import { markAllNoticesRead, setNoticeEmail } from './actions'
import type { NoticesView } from './read-model'
import { NotificationsScreen } from './screen'

beforeEach(() => {
  // The bell asks how many are new; here it never hears back.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {}))
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const ready = (over: Partial<NoticesView & { state: 'ready' }> = {}) =>
  ({
    state: 'ready',
    items: [
      {
        id: 'n1',
        kind: 'drafts_ready',
        line: '12 of 15 drafts are in Klaviyo',
        href: '/plan',
        unread: true,
        at: 'Nov 27, 2026 · 9:07 AM'
      },
      {
        id: 'n2',
        kind: 'plan_ready',
        line: 'Your 15-day plan is ready',
        href: '/plan',
        unread: false,
        at: 'Nov 26, 2026 · 6:40 PM'
      }
    ],
    unread: 1,
    emailOn: false,
    owner: true,
    ...over
  }) as NoticesView

describe('NotificationsScreen (PICK-107)', () => {
  it('lists each notice as one line with when, which are new, and Open', () => {
    render(<NotificationsScreen view={ready()} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Notifications'
    )
    // The bell is current in the bar, with the count this page read: it
    // does not ask again.
    expect(
      screen.getByRole('link', { name: 'Notifications, 1 new' })
    ).toHaveAttribute('aria-current', 'page')
    expect(fetch).not.toHaveBeenCalled()
    const list = screen.getByRole('list', { name: 'Notifications' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      '12 of 15 drafts are in KlaviyoNew · Nov 27, 2026 · 9:07 AMOpen',
      'Your 15-day plan is readyNov 26, 2026 · 6:40 PMOpen'
    ])
    expect(
      within(rows[0]!).getByRole('button', {
        name: 'Open: 12 of 15 drafts are in Klaviyo'
      })
    ).toHaveAttribute('type', 'submit')
    expect(
      rows[0]!.querySelector('input[name="notice"]')?.getAttribute('value')
    ).toBe('n1')
    expect(screen.getByText('1', { selector: 'p' })).toBeInTheDocument()
  })

  it('marks all read with one button, only while some are new', async () => {
    render(<NotificationsScreen view={ready()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
    expect(markAllNoticesRead).toHaveBeenCalledOnce()
    expect(
      await screen.findByText('Done. Every notification is read.')
    ).toBeInTheDocument()
    cleanup()
    render(<NotificationsScreen view={ready({ unread: 0 })} />)
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull()
  })

  it('lets the owner turn emails on, and says the build sends none', async () => {
    render(<NotificationsScreen view={ready()} />)
    const email = screen.getByRole('region', { name: 'Email' })
    expect(email).toHaveTextContent('Off')
    await userEvent.click(
      within(email).getByRole('button', { name: 'Turn on emails' })
    )
    expect(setNoticeEmail).toHaveBeenCalledOnce()
    expect(
      (vi.mocked(setNoticeEmail).mock.calls[0]![1] as FormData).get('turn')
    ).toBe('on')
    cleanup()
    render(<NotificationsScreen view={ready({ emailOn: true })} />)
    expect(screen.getByRole('region', { name: 'Email' })).toHaveTextContent(
      'This build records the emails but sends none yet.'
    )
    expect(
      screen.getByRole('button', { name: 'Turn off emails' })
    ).toBeInTheDocument()
  })

  it('shows staff the email switch without a button', () => {
    render(<NotificationsScreen view={ready({ owner: false })} />)
    const email = screen.getByRole('region', { name: 'Email' })
    expect(within(email).queryByRole('button')).toBeNull()
    expect(email).toHaveTextContent('Only the owner changes this.')
  })

  it('has an empty state with one button, and an error state', () => {
    render(<NotificationsScreen view={ready({ items: [], unread: 0 })} />)
    expect(
      screen.getByRole('heading', { name: 'No notifications yet' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Plan next 15 days' })
    ).toHaveAttribute('href', '/plan')
    cleanup()
    render(<NotificationsScreen view={{ state: 'unread' }} />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Notifications did not open'
    )
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      '/notifications'
    )
  })

  it('draws its loading and error pages under the bar', () => {
    render(<NotificationsLoading />)
    expect(screen.getByText('Opening Notifications')).toBeInTheDocument()
    cleanup()
    const retry = vi.fn()
    render(<NotificationsError retry={retry} />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Notifications did not open'
    )
  })
})
