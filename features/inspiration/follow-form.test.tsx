import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ trackDomain: vi.fn() }))
vi.mock('@/features/library/inspirations/actions', () => ({
  trackDomain: mocks.trackDomain
}))
vi.mock('@/components/ui/use-hydrated', () => ({ useHydrated: () => true }))

import { FollowForm } from './follow-form'

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

async function follow(website: string) {
  const field = screen.getByLabelText('Brand website') as HTMLInputElement
  fireEvent.change(field, { target: { value: website } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Follow' }))
  })
  return field
}

describe('FollowForm (UI-INSa)', () => {
  it('keeps a refused website to correct, and reads the refusal out once', async () => {
    mocks.trackDomain.mockResolvedValue({
      error: 'For now you can follow only sample brands.'
    })
    render(<FollowForm />)
    const field = await follow('brand.com')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'For now you can follow only sample brands.'
    )
    // One place says it (a browser test finds it once).
    expect(
      screen.getAllByText('For now you can follow only sample brands.')
    ).toHaveLength(1)
    expect(field).toHaveValue('brand.com')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(mocks.trackDomain.mock.calls[0]![1].get('domain')).toBe('brand.com')
  })

  it('empties the field after a follow, and says what happens next in a live region that is always there', async () => {
    mocks.trackDomain.mockResolvedValue({
      message: 'Following northwind.example.'
    })
    render(<FollowForm />)
    const live = document.querySelector('[aria-live="polite"]')!
    // In the page before any answer, never hidden.
    expect(live).toBeInTheDocument()
    expect(live).toBeEmptyDOMElement()
    expect(live.className).not.toContain('hidden')
    const field = await follow('northwind.example')
    expect(await screen.findByText('Following northwind.example.')).toBe(live)
    expect(field).toHaveValue('')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
