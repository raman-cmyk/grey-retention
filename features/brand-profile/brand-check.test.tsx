import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const data = vi.hoisted(() => ({ brandGuard: vi.fn() }))
vi.mock('./data', () => data)

import { BrandCheck } from './brand-check'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const tenantId = '00000000-0000-4000-8000-000000000101'

describe('BrandCheck', () => {
  it('shows nothing when the brand matches', async () => {
    data.brandGuard.mockResolvedValue([])
    expect(await BrandCheck({ tenantId })).toBeNull()
    expect(data.brandGuard).toHaveBeenCalledWith(tenantId)
  })

  it('warns before the AI step with the first difference and a link', async () => {
    data.brandGuard.mockResolvedValue([
      { source: 'klaviyo', message: 'Klaviyo is Northwind Outdoor.' },
      { source: 'catalogue', message: 'Products link elsewhere.' }
    ])
    render((await BrandCheck({ tenantId, action: 'GROS answers' }))!)
    const note = screen.getByRole('note', { name: 'Brand check' })
    expect(note).toHaveTextContent(
      'Check your Brand profile before GROS answers.'
    )
    expect(note).toHaveTextContent('Klaviyo is Northwind Outdoor.')
    expect(note).toHaveTextContent('1 more difference on the Brand page.')
    expect(
      screen.getByRole('link', { name: 'Open the Brand profile' })
    ).toHaveAttribute('href', '/brand')
  })

  it('uses a plain default action', async () => {
    data.brandGuard.mockResolvedValue([
      { source: 'shopify', message: 'Shopify differs.' }
    ])
    render((await BrandCheck({ tenantId }))!)
    expect(
      screen.getByText(
        'Check your Brand profile before the AI writes anything.'
      )
    ).toBeVisible()
    expect(screen.queryByText(/more difference/)).toBeNull()
  })
})
