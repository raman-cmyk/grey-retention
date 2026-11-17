import {
  cleanup,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/features/auth/presentation/actions', () => ({
  signOut: vi.fn(async () => undefined)
}))
vi.mock('@/features/connections/actions', () => ({
  connectKlaviyo: vi.fn(async () => ({})),
  disconnectKlaviyo: vi.fn(async () => ({}))
}))
vi.mock('@/features/offers/actions', () => ({
  saveMaxDiscount: vi.fn(async () => ({})),
  addDiscountCode: vi.fn(async () => ({})),
  retireDiscountCode: vi.fn(async () => ({}))
}))
vi.mock('./timezone-actions', () => ({
  saveBrandTimezone: vi.fn(async () => ({})),
  switchToKlaviyoTimezone: vi.fn(async () => ({}))
}))

import { disconnectKlaviyo } from '@/features/connections/actions'
import type { SettingsView } from './page-model'
import { SettingsScreen } from './screen'

afterEach(cleanup)

function view(over: Partial<SettingsView> = {}): SettingsView {
  return {
    demo: false,
    owner: true,
    editor: true,
    offers: {
      maxDiscountPercent: 20,
      grossMarginPercent: null,
      marginFloorPercent: null,
      revision: 3,
      codes: [
        {
          id: '00000000-0000-4000-8000-0000000000c1',
          code: 'WELCOME15',
          percent: 15,
          expiresAt: null,
          ended: false
        },
        {
          id: '00000000-0000-4000-8000-0000000000c2',
          code: 'BIG30',
          percent: 30,
          expiresAt: '2026-11-30T18:14:59.000Z',
          ended: false
        },
        {
          id: '00000000-0000-4000-8000-0000000000c3',
          code: 'OLD10',
          percent: 10,
          expiresAt: '2026-11-01T18:14:59.000Z',
          ended: true
        }
      ]
    },
    klaviyo: {
      status: 'connected',
      mode: 'sample',
      keyStatus: null,
      accountLabel: 'Cedar Lane (sample)',
      keyHint: 'pk_abcde••••••••1234',
      checkedAt: null,
      missingLater: []
    },
    liveKeys: false,
    timezone: {
      saved: 'Asia/Kathmandu',
      label: 'Asia/Kathmandu (UTC+05:45)',
      source: 'setup',
      at: '2026-11-16T12:00:00.000Z',
      localTime: 'Mon, Nov 16 2026 · 5:45 PM',
      klaviyo: null,
      options: ['Asia/Kathmandu', 'Europe/London']
    },
    team: { members: 3, openInvites: 1, canManage: true },
    account: { name: 'Sam Cedar', email: 'owner@cedarlane.example' },
    unread: [],
    ...over
  }
}

const card = (name: string) => screen.getByRole('region', { name })
const formOf = (button: HTMLElement) =>
  Object.fromEntries(
    new FormData(button.closest('form')!) as unknown as [string, string][]
  )

describe('Settings screen (UI-SETa)', () => {
  it('is the GROS page with Settings current', () => {
    render(<SettingsScreen view={view()} />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Settings' })
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  it('shows the biggest discount and saves it with its revision', () => {
    render(<SettingsScreen view={view()} />)
    const max = card('Biggest discount')
    expect(max).toHaveTextContent('20%')
    const save = within(max).getByRole('button', {
      name: 'Save biggest discount'
    })
    expect(formOf(save)).toEqual({ revision: '3', percent: '20' })
    expect(save.className).toContain('bg-[var(--forest)]')
    cleanup()
    render(
      <SettingsScreen
        view={view({ offers: { ...view().offers!, maxDiscountPercent: null } })}
      />
    )
    expect(card('Biggest discount')).toHaveTextContent('Not set')
    expect(card('Biggest discount')).toHaveTextContent(
      'Emails offer no discount.'
    )
  })

  it('lists the codes, each with its own Remove, and adds a code', () => {
    render(<SettingsScreen view={view()} />)
    const codes = card('Discount codes')
    const rows = within(codes).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('WELCOME15')
    expect(rows[0]).toHaveTextContent('15% off · No end date')
    expect(rows[1]).toHaveTextContent(
      '30% off · Until Nov 30, 2026 · Above your biggest discount, not used'
    )
    expect(rows[2]).toHaveTextContent('10% off · Ended Nov 1, 2026')
    expect(
      formOf(within(rows[1]!).getByRole('button', { name: 'Remove: BIG30' }))
    ).toEqual({ id: '00000000-0000-4000-8000-0000000000c2' })
    const add = within(codes).getByRole('button', { name: 'Add code' })
    expect(Object.keys(formOf(add))).toEqual(['code', 'percent', 'expires'])
    expect(within(codes).getByLabelText('Ends (optional)')).toHaveAttribute(
      'type',
      'date'
    )
    cleanup()
    render(
      <SettingsScreen
        view={view({ offers: { ...view().offers!, codes: [] } })}
      />
    )
    expect(card('Discount codes')).toHaveTextContent('No codes yet.')
  })

  it('shows a working Klaviyo connection by its masked hint, never the key', () => {
    render(<SettingsScreen view={view()} />)
    const klaviyo = card('Klaviyo')
    expect(within(klaviyo).queryByText(/In Klaviyo|Needs you/)).toBeNull()
    expect(klaviyo).toHaveTextContent('Cedar Lane (sample)')
    expect(klaviyo).toHaveTextContent('Key pk_abcde••••••••1234')
    const field = within(klaviyo).getByLabelText('New private API key')
    expect(field).toHaveAttribute('type', 'password')
    expect(field).toHaveAttribute('autocomplete', 'off')
    expect(field).toHaveValue('')
    const change = within(klaviyo).getByRole('button', { name: 'Change key' })
    expect(change.className).toContain('gros-button-outline')
    expect(formOf(change)).toEqual({ apiKey: '' })
    expect(
      within(klaviyo).getByRole('button', { name: 'Disconnect' })
    ).toBeInTheDocument()
    expect(klaviyo).not.toHaveTextContent('more access')
  })

  it('asks before Disconnect, and names what the key cannot do yet', async () => {
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      <SettingsScreen
        view={view({
          klaviyo: { ...view().klaviyo!, missingLater: ['flows:read'] }
        })}
      />
    )
    expect(card('Klaviyo')).toHaveTextContent(
      'Later, to read your flows, GROS needs a key with more access.'
    )
    await userEvent.click(
      within(card('Klaviyo')).getByRole('button', { name: 'Disconnect' })
    )
    await waitFor(() =>
      expect(ask).toHaveBeenCalledWith(
        expect.stringContaining('GROS stops reading it')
      )
    )
    expect(disconnectKlaviyo).not.toHaveBeenCalled()
    ask.mockRestore()
  })

  it('says when Klaviyo needs the owner, with one main button', () => {
    const none = view().klaviyo!
    for (const [klaviyo, words, button] of [
      [
        { ...none, status: 'none', accountLabel: null, keyHint: null },
        'Not connected.',
        'Connect Klaviyo'
      ],
      [
        { ...none, mode: 'live', keyStatus: 'refused' },
        'Klaviyo key stopped working.',
        'Reconnect'
      ],
      [
        { ...none, status: 'expired' },
        'This connection has expired.',
        'Reconnect'
      ]
    ] as const) {
      render(<SettingsScreen view={view({ klaviyo })} />)
      const c = card('Klaviyo')
      expect(within(c).getByText('Needs you')).toBeInTheDocument()
      expect(c).toHaveTextContent(words)
      expect(
        within(c).getByRole('button', { name: button }).className
      ).toContain('bg-[var(--forest)]')
      cleanup()
    }
    // With live keys, a sample connection still waits for a real key.
    render(<SettingsScreen view={view({ liveKeys: true })} />)
    expect(card('Klaviyo')).toHaveTextContent(
      'Sample connection. Paste your real key'
    )
  })

  it('shows the timezone, and offers Klaviyo’s when it differs', () => {
    render(<SettingsScreen view={view()} />)
    const zone = card('Timezone')
    expect(zone).toHaveTextContent('Asia/Kathmandu (UTC+05:45)')
    expect(zone).toHaveTextContent('Set when the workspace was created.')
    expect(
      within(zone).getByText('Mon, Nov 16 2026 · 5:45 PM')
    ).toHaveAttribute('datetime', '2026-11-16T12:00:00.000Z')
    const save = within(zone).getByRole('button', { name: 'Save timezone' })
    expect(formOf(save)).toEqual({
      expected: 'Asia/Kathmandu',
      timezone: 'Asia/Kathmandu'
    })
    cleanup()
    const differs = view({
      timezone: {
        ...view().timezone!,
        source: 'owner',
        klaviyo: { zone: 'Europe/London', label: 'Europe/London (UTC+00:00)' }
      }
    })
    render(<SettingsScreen view={differs} />)
    const use = within(card('Timezone')).getByRole('button', {
      name: 'Use Klaviyo’s timezone'
    })
    expect(formOf(use)).toEqual({
      klaviyoTimezone: 'Europe/London',
      expected: 'Asia/Kathmandu'
    })
    expect(card('Timezone')).toHaveTextContent(
      'Your Klaviyo account (sample connection) uses Europe/London (UTC+00:00).'
    )
    expect(
      within(card('Timezone')).getByRole('button', { name: 'Save timezone' })
        .className
    ).toContain('gros-button-outline')
    cleanup()
    // Sample only when the connection is the sample one, not when unread.
    render(
      <SettingsScreen
        view={view({
          klaviyo: null,
          unread: ['klaviyo'],
          timezone: { ...view().timezone!, source: 'klaviyo' }
        })}
      />
    )
    expect(card('Timezone')).toHaveTextContent('From your Klaviyo account.')
    expect(card('Timezone')).not.toHaveTextContent('sample connection')
  })

  it('shows the team and the account, linking to their pages', () => {
    render(<SettingsScreen view={view()} />)
    const team = card('Team')
    expect(within(team).getByText('Members').parentElement).toHaveTextContent(
      'Members3'
    )
    expect(
      within(team).getByText('Open invites').parentElement
    ).toHaveTextContent('Open invites1')
    expect(
      within(team).getByRole('link', { name: 'Manage team' })
    ).toHaveAttribute('href', '/team')
    const account = card('Account')
    expect(account).toHaveTextContent('Sam Cedar')
    expect(account).toHaveTextContent('owner@cedarlane.example')
    expect(
      within(account).getByRole('link', { name: 'Change' })
    ).toHaveAttribute('href', '/profile')
    expect(
      within(account).getByRole('button', { name: 'Log out' })
    ).toBeVisible()
    cleanup()
    // Without a name, the email shows once.
    render(
      <SettingsScreen
        view={view({ account: { name: '', email: 'owner@cedarlane.example' } })}
      />
    )
    expect(
      within(card('Account')).getAllByText('owner@cedarlane.example')
    ).toHaveLength(1)
  })

  it('lets an admin change offers only, and staff change nothing', () => {
    render(<SettingsScreen view={view({ owner: false })} />)
    expect(
      screen.getByRole('button', { name: 'Save biggest discount' })
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add code' })).toBeVisible()
    expect(screen.queryByLabelText(/private API key/i)).toBeNull()
    expect(
      screen.queryByRole('button', { name: /Disconnect|timezone/ })
    ).toBeNull()
    expect(card('Klaviyo')).toHaveTextContent(
      'Only the workspace owner can change Klaviyo.'
    )
    cleanup()
    // Only the owner can fix Klaviyo, so only the owner is told Needs you.
    render(
      <SettingsScreen
        view={view({
          owner: false,
          klaviyo: { ...view().klaviyo!, status: 'expired' }
        })}
      />
    )
    expect(card('Klaviyo')).toHaveTextContent('This connection has expired.')
    expect(within(card('Klaviyo')).queryByText('Needs you')).toBeNull()
    cleanup()
    render(
      <SettingsScreen
        view={view({
          owner: false,
          editor: false,
          team: { members: 3, openInvites: null, canManage: false },
          timezone: {
            ...view().timezone!,
            klaviyo: {
              zone: 'Europe/London',
              label: 'Europe/London (UTC+00:00)'
            }
          }
        })}
      />
    )
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Log out'
    ])
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(card('Timezone')).toHaveTextContent(
      'The workspace owner can switch to it.'
    )
    expect(within(card('Team')).queryByText('Open invites')).toBeNull()
    expect(
      within(card('Team')).getByRole('link', { name: 'See team' })
    ).toBeVisible()
  })

  it('says which parts could not be read, and that the demo keeps nothing', () => {
    const unread = view({
      offers: null,
      klaviyo: null,
      timezone: null,
      team: null,
      account: null,
      unread: ['offers', 'klaviyo', 'timezone', 'team', 'account']
    })
    render(<SettingsScreen view={unread} />)
    for (const [name, words] of [
      ['Biggest discount', 'Your offers could not be read just now.'],
      ['Discount codes', 'Your offers could not be read just now.'],
      ['Klaviyo', 'The Klaviyo connection could not be read just now.'],
      ['Timezone', 'The timezone could not be read just now.'],
      ['Team', 'The team could not be read just now.'],
      ['Account', 'Your account could not be read just now.']
    ])
      expect(card(name)).toHaveTextContent(words)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Log out'
    ])
    cleanup()
    render(<SettingsScreen view={{ ...unread, demo: true }} />)
    expect(screen.getAllByText('Nothing is kept in the demo.')).toHaveLength(6)
    cleanup()
    // The demo's timezone shows, but cannot be saved.
    render(
      <SettingsScreen
        view={{ ...unread, demo: true, timezone: view().timezone }}
      />
    )
    expect(card('Timezone')).toHaveTextContent('Asia/Kathmandu (UTC+05:45)')
    expect(card('Timezone')).toHaveTextContent('Nothing is kept in the demo.')
    expect(
      within(card('Timezone')).queryByRole('button', { name: 'Save timezone' })
    ).toBeNull()
  })
})
