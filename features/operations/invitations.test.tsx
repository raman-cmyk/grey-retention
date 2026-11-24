import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => db }))
vi.mock('./actions', () => ({ acceptInvite: vi.fn(async () => ({})) }))

import { PendingInvites } from './invitations'

afterEach(() => {
  cleanup()
  db.rpc.mockReset()
})

describe('PendingInvites (UI-AUTH)', () => {
  it('lists each waiting invite with its role and one Accept invite button', async () => {
    db.rpc.mockResolvedValue({
      data: [
        {
          id: '00000000-0000-4000-8000-0000000000a1',
          tenant_name: 'Cedar Lane',
          role: 'staff'
        }
      ],
      error: null
    })
    render(await PendingInvites())
    expect(db.rpc).toHaveBeenCalledWith('my_pending_invites')
    expect(
      screen.getByRole('heading', { level: 2, name: 'Your invites' })
    ).toBeVisible()
    expect(screen.getByText('Cedar Lane')).toBeVisible()
    expect(screen.getByText('Staff')).toBeVisible()
    const accept = screen.getByRole('button', {
      name: 'Accept invite: Cedar Lane'
    })
    expect(accept).toHaveTextContent('Accept invite')
    expect(
      accept.closest('form')?.querySelector('input[name="id"]')
    ).toHaveValue('00000000-0000-4000-8000-0000000000a1')
  })

  it('shows nothing without invites or when they cannot be read', async () => {
    db.rpc.mockResolvedValueOnce({ data: [], error: null })
    expect(await PendingInvites()).toBeNull()
    db.rpc.mockResolvedValueOnce({ data: null, error: { message: 'down' } })
    expect(await PendingInvites()).toBeNull()
  })
})
