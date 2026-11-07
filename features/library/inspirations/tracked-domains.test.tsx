import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { installDialogPolyfill } from '@/tests/helpers/dialog-polyfill'

const actions = vi.hoisted(() => ({
  trackDomain: vi.fn(async () => ({
    message:
      'Tracking northwind.example. It shows PENDING until their emails arrive.'
  })),
  stopTracking: vi.fn(async () => ({
    message: 'Stopped tracking cedar.example. Its emails left your library.'
  }))
}))
vi.mock('./actions', () => actions)

import type { TrackedDomain } from '@/features/library/reference-library/data'
import { TrackedDomains } from './tracked-domains'

beforeAll(installDialogPolyfill)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const domain = (
  name: string,
  status: TrackedDomain['status']
): TrackedDomain => ({
  subscriptionId: `sub-${name}`,
  revision: 2,
  domain: name,
  label: name,
  status,
  emails: status === 'live' ? 10 : 0,
  sample: true
})

describe('TrackedDomains', () => {
  it('lists domains with LIVE and PENDING, and explains PENDING', () => {
    render(
      <TrackedDomains
        tracked={[
          domain('cedar.example', 'live'),
          domain('north.example', 'pending')
        ]}
        limit={10}
        owner
      />
    )
    expect(
      screen.getByRole('heading', { name: /Your competitor domains \(2\/10\)/ })
    ).toBeVisible()
    const list = screen.getByRole('list', { name: 'Tracked domains' })
    expect(within(list).getByText('LIVE')).toBeVisible()
    expect(within(list).getByText('PENDING')).toBeVisible()
    expect(
      screen.getByText(/usually takes 1–7 days after their next send/)
    ).toBeVisible()
  })

  it('tracks a domain and empties the field', async () => {
    render(<TrackedDomains tracked={[]} limit={10} owner />)
    const field = screen.getByLabelText('Competitor domain')
    expect(screen.getByRole('button', { name: 'Track' })).toBeDisabled()
    await userEvent.type(field, 'northwind.example')
    await userEvent.click(screen.getByRole('button', { name: 'Track' }))
    expect(
      await screen.findByText(/^Tracking northwind\.example/)
    ).toBeVisible()
    expect(field).toHaveValue('')
  })

  it('asks before it stops tracking', async () => {
    render(
      <TrackedDomains
        tracked={[domain('cedar.example', 'live')]}
        limit={10}
        owner
      />
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove cedar.example' })
    )
    const dialog = screen.getByRole('alertdialog', {
      name: 'Stop tracking cedar.example?'
    })
    expect(
      within(dialog).getByText('Its emails will disappear from your library.')
    ).toBeVisible()
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel' })
    )
    expect(actions.stopTracking).not.toHaveBeenCalled()
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove cedar.example' })
    )
    await userEvent.click(screen.getByRole('button', { name: 'Stop tracking' }))
    expect(
      await screen.findByText(/^Stopped tracking cedar\.example/)
    ).toBeVisible()
    const sent = (
      actions.stopTracking.mock.calls[0] as unknown[]
    )[1] as FormData
    expect(Object.fromEntries(sent)).toEqual({
      subscription: 'sub-cedar.example',
      revision: '2',
      domain: 'cedar.example'
    })
  })

  it('stops at 10 domains', () => {
    const ten = Array.from({ length: 10 }, (_, i) =>
      domain(`d${i}.example`, 'live')
    )
    render(<TrackedDomains tracked={ten} limit={10} owner />)
    expect(screen.getByLabelText('Competitor domain')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Track' })).toBeDisabled()
    expect(
      screen.getByText(/You track 10 domains, the most at a time/)
    ).toBeVisible()
  })

  it('shows staff the list without controls', () => {
    render(
      <TrackedDomains
        tracked={[domain('cedar.example', 'live')]}
        limit={10}
        owner={false}
      />
    )
    expect(screen.queryByLabelText('Competitor domain')).toBeNull()
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
  })
})
