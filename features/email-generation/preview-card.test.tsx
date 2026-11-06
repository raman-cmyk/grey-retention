import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
// jsdom has no ResizeObserver; the scaled frame only needs the API to exist.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  }
)
const { EmailPreviewCard } = await import('./preview-card')

afterEach(() => {
  cleanup()
  Object.defineProperty(document, 'fullscreenEnabled', {
    configurable: true,
    value: false
  })
})

const hostile = `<!doctype html><html><head><title>x</title></head><body>
<h1>Spring sale</h1><img src="https://tracker.example/open.gif">
<a href="https://competitor.example/unsubscribe?u=1">Unsubscribe</a>
<map name="m"><area shape="rect" coords="0,0,9,9" href="https://competitor.example/area"></map>
<a href="//competitor.example/protocol-relative" ping="https://tracker.example/ping" target="_top">Go</a>
<script>parent.alert(1)</script></body></html>`

describe('EmailPreviewCard', () => {
  it('shows a sandboxed preview with no links, pixels or scripts', () => {
    render(
      <EmailPreviewCard
        html={hostile}
        title="Preview of Spring sale"
        templateName="Spring v2"
        source="inspiration"
      />
    )
    const frame = screen.getByTitle(
      'Preview of Spring sale'
    ) as HTMLIFrameElement
    expect(frame.tagName).toBe('IFRAME')
    expect(frame.getAttribute('sandbox')).toBe('')
    const doc = frame.getAttribute('srcdoc')!
    expect(doc).not.toContain('competitor.example')
    expect(doc).not.toContain('tracker.example')
    expect(doc).not.toContain('<script')
    expect(doc).toContain("default-src 'none'")
    expect(screen.getByText('Spring v2')).toBeInTheDocument()
    expect(screen.getByText(/Links are turned off/)).toHaveTextContent(
      'links turned off'
    )
    expect(
      screen.getByRole('region', { name: 'Email preview' })
    ).toBeInTheDocument()
  })

  it('reloads the frame on Refresh and announces it every time', () => {
    render(<EmailPreviewCard html="<p>Hi</p>" title="Preview" source="draft" />)
    const status = screen.getByRole('status')
    const before = screen.getByTitle('Preview')
    // Capture the announcement timer instead of waiting for it.
    const pending: (() => void)[] = []
    const timer = vi.spyOn(window, 'setTimeout').mockImplementation(((
      callback: () => void
    ) => {
      pending.push(callback)
      return 0
    }) as unknown as typeof window.setTimeout)
    try {
      const refresh = screen.getByRole('button', { name: 'Refresh' })
      fireEvent.click(refresh)
      expect(screen.getByTitle('Preview')).not.toBe(before)
      act(() => pending.shift()?.())
      expect(status).toHaveTextContent('Preview reloaded.')
      // The same words again: cleared first, so screen readers hear it.
      fireEvent.click(refresh)
      expect(status).toBeEmptyDOMElement()
      act(() => pending.shift()?.())
      expect(status).toHaveTextContent('Preview reloaded.')
    } finally {
      timer.mockRestore()
    }
  })

  it('offers Fullscreen only where the browser supports it', async () => {
    render(
      <EmailPreviewCard html="<p>Hi</p>" title="Preview" source="klaviyo" />
    )
    expect(
      screen.queryByRole('button', { name: 'Fullscreen' })
    ).not.toBeInTheDocument()
    cleanup()
    Object.defineProperty(document, 'fullscreenEnabled', {
      configurable: true,
      value: true
    })
    const request = vi.fn(async () => undefined)
    HTMLIFrameElement.prototype.requestFullscreen = request
    render(
      <EmailPreviewCard html="<p>Hi</p>" title="Preview" source="klaviyo" />
    )
    await userEvent.click(
      await screen.findByRole('button', { name: 'Fullscreen' })
    )
    expect(request).toHaveBeenCalledOnce()
    request.mockRejectedValueOnce(new Error('denied'))
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Fullscreen' }))
    })
    expect(
      screen.getByText(/Fullscreen is not available here/)
    ).toBeInTheDocument()
  })

  it('shows plain-text emails as text, with an honest caption', () => {
    render(
      <EmailPreviewCard
        html={null}
        text="Hello there"
        title="Preview"
        source="draft"
      />
    )
    expect(screen.queryByTitle('Preview')).not.toBeInTheDocument()
    expect(screen.getByText('Hello there')).toBeInTheDocument()
    expect(
      screen.getByText('Plain-text email: there is no design to show.')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Refresh' })
    ).not.toBeInTheDocument()
    cleanup()
    render(
      <EmailPreviewCard html={null} text="  " title="Preview" source="draft" />
    )
    expect(screen.getByText('This email has no text.')).toBeInTheDocument()
  })
})
