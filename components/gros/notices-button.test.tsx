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

  it('clears a number it showed when a later answer is not a count', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, data: { unread: 4 } })
      })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ ok: false }) })
    vi.stubGlobal('fetch', fetch)
    render(<NoticesButton className="round" />)
    await screen.findByRole('link', { name: 'Notifications, 4 new' })
    // The window comes back into view: the bell asks again.
    document.dispatchEvent(new Event('visibilitychange'))
    await screen.findByRole('link', { name: 'Notifications' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('shows the count the page read, and asks nothing while a page loads', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const { rerender } = render(<NoticesButton className="round" count={2} />)
    expect(
      screen.getByRole('link', { name: 'Notifications, 2 new' })
    ).toBeInTheDocument()
    // After Mark all read the page reads 0 again.
    rerender(<NoticesButton className="round" count={0} />)
    expect(
      screen.getByRole('link', { name: 'Notifications' })
    ).toBeInTheDocument()
    rerender(<NoticesButton className="round" count="wait" />)
    expect(
      screen.getByRole('link', { name: 'Notifications' })
    ).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('caps the spoken number', () => {
    expect(noticesLabel(0)).toBe('Notifications')
    expect(noticesLabel(1)).toBe('Notifications, 1 new')
    expect(noticesLabel(250)).toBe('Notifications, 99+ new')
  })
})
