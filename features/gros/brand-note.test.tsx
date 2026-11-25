import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const data = vi.hoisted(() => ({ brandGuard: vi.fn() }))
vi.mock('@/features/brand-profile/data', () => data)

import { BrandNote } from './brand-note'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const tenantId = '00000000-0000-4000-8000-000000000101'

describe('BrandNote (UI-ASK)', () => {
  it('shows nothing when the brand matches', async () => {
    data.brandGuard.mockResolvedValue([])
    expect(await BrandNote({ tenantId, action: 'GROS answers' })).toBeNull()
    expect(data.brandGuard).toHaveBeenCalledWith(tenantId)
  })

  it('says to check the brand before GROS answers, with the first difference', async () => {
    data.brandGuard.mockResolvedValue([
      { source: 'klaviyo', message: 'Klaviyo is Northwind Outdoor.' },
      { source: 'catalogue', message: 'Products link elsewhere.' }
    ])
    render((await BrandNote({ tenantId, action: 'GROS answers' }))!)
    const note = screen.getByRole('note', { name: 'Brand check' })
    expect(note).toHaveTextContent('Needs you')
    expect(note).toHaveTextContent('Check your brand')
    expect(note).toHaveTextContent(
      'Klaviyo is Northwind Outdoor. Check it before GROS answers.'
    )
    expect(note).toHaveTextContent('1 more difference on the Brand page.')
    expect(
      screen.getByRole('link', { name: 'Open the Brand profile' })
    ).toHaveAttribute('href', '/settings/brand')
  })
})
