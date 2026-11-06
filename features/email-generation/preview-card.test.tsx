import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmailPreviewCard } from './preview-card'

afterEach(cleanup)

const hostile = `<!doctype html><html><head><title>x</title></head><body>
<h1>Spring sale</h1><img src="https://tracker.example/open.gif">
<a href="https://competitor.example/unsubscribe?u=1">Unsubscribe</a>
<script>parent.alert(1)</script></body></html>`

describe('EmailPreviewCard', () => {
  it('shows a sandboxed, link-free preview with the template name', () => {
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
  })

  it('reloads the frame on Refresh', async () => {
    render(<EmailPreviewCard html="<p>Hi</p>" title="Preview" source="draft" />)
    const before = screen.getByTitle('Preview')
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(screen.getByTitle('Preview')).not.toBe(before)
    expect(screen.getByRole('status')).toHaveTextContent('Preview reloaded.')
  })

  it('opens the frame fullscreen when the browser allows it', async () => {
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
    expect(screen.getByRole('status')).toHaveTextContent(
      'Fullscreen is not available here.'
    )
  })

  it('shows plain-text emails without a frame', () => {
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
      screen.queryByRole('button', { name: 'Refresh' })
    ).not.toBeInTheDocument()
  })
})
