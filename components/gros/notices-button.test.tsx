import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoticesButton, noticesLabel } from './notices-button'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const answer = (body: unknown, ok = true) =>
  vi.fn(async () => ({ ok, json: async () => body }))

describe('NoticesButton (PICK-107)', () => {
  it('shows how many notices are new, and says it', async () => {
    const fetch = answer({ ok: true, data: { unread: 3 } })
    vi.stubGlobal('fetch', fetch)
    render(<NoticesButton className="round" />)
    const link = await screen.findByRole('link', {
      name: 'Notifications, 3 new'
    })
    expect(link).toHaveAttribute('href', '/notifications')
    expect(link).toHaveTextContent('3')
    expect(fetch).toHaveBeenCalledWith('/api/v1/notifications', {
      cache: 'no-store',
      credentials: 'same-origin'
    })
  })

  it('is the plain bell when none are new or the count does not come', async () => {
    for (const fetch of [
      answer({ ok: true, data: { unread: 0 } }),
      answer({ ok: false }, false),
      answer({ ok: true, data: { unread: 'many' } }),
      vi.fn(async () => {
        throw new Error('offline')
      })
    ]) {
      vi.stubGlobal('fetch', fetch)
      render(<NoticesButton className="round" current />)
      await waitFor(() => expect(fetch).toHaveBeenCalled())
      const link = screen.getByRole('link', { name: 'Notifications' })
      expect(link).toHaveTextContent('')
      expect(link).toHaveAttribute('aria-current', 'page')
      cleanup()
    }
  })

  it('caps the spoken number', () => {
    expect(noticesLabel(0)).toBe('Notifications')
    expect(noticesLabel(1)).toBe('Notifications, 1 new')
    expect(noticesLabel(250)).toBe('Notifications, 99+ new')
  })
})
