// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The tree is read without rendering it: effects never run here.
vi.mock('react', async (actual) => ({
  ...(await actual<typeof import('react')>()),
  useEffect: () => undefined
}))
import { defaultBrandPresentation } from '@/lib/branding/presentation'
import GlobalError from './global-error'

describe('the last-resort error page', () => {
  it('stands on its own: its document, title and the error page’s words', () => {
    const html = renderToStaticMarkup(
      <GlobalError error={new Error('boom')} retry={vi.fn()} />
    )
    expect(html).toMatch(/^<html lang="en"/)
    expect(html).toContain('<body')
    expect(html).toContain(
      `<title>Something went wrong · ${defaultBrandPresentation.productName}</title>`
    )
    expect(html).toContain('This page couldn’t load')
    expect(html).toContain('Anything you saved before is still stored.')
    expect(html).toContain('<button type="button">Try again</button>')
    // Never the error's own message (it may hold details).
    expect(html).not.toContain('boom')
    expect(html).not.toContain('Reference:')
  })

  it('tries again when its button is pressed', () => {
    const retry = vi.fn()
    // The button in the returned tree, pressed without a browser.
    const find = (node: unknown): { props: { onClick: () => void } } | null => {
      const el = node as { type?: unknown; props?: { children?: unknown } }
      if (el?.type === 'button') return el as never
      const kids = el?.props?.children
      for (const kid of Array.isArray(kids) ? kids : [kids]) {
        const hit = kid && typeof kid === 'object' ? find(kid) : null
        if (hit) return hit
      }
      return null
    }
    find(GlobalError({ error: new Error('x'), retry }))!.props.onClick()
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('still shows when what was thrown is not an error', () => {
    expect(
      renderToStaticMarkup(<GlobalError error={null} retry={vi.fn()} />)
    ).toContain('This page couldn’t load')
  })

  it('shows the reference that matches the server’s log', () => {
    const error = Object.assign(new Error('x'), { digest: 'd1g3st' })
    expect(
      renderToStaticMarkup(<GlobalError error={error} retry={vi.fn()} />)
    ).toMatch(/Reference: (<!-- -->)?d1g3st/)
  })
})
