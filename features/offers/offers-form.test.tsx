import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('./actions', () => ({
  saveMaxDiscount: vi.fn(async () => ({})),
  addDiscountCode: vi.fn(async () => ({})),
  retireDiscountCode: vi.fn(async () => ({}))
}))
import { OffersCard } from './offers-form'

afterEach(cleanup)

const codes = [
  {
    id: '00000000-0000-4000-8000-0000000000c1',
    code: 'WELCOME15',
    percent: 15,
    expiresAt: null
  },
  {
    id: '00000000-0000-4000-8000-0000000000c2',
    code: 'BIGSALE40',
    percent: 40,
    expiresAt: '2026-12-31T18:14:59.000Z'
  }
]

describe('OffersCard', () => {
  it('lets the owner set the max discount and manage codes', () => {
    render(
      <OffersCard
        maxDiscountPercent={20}
        revision={2}
        codes={codes}
        timezone="Asia/Kathmandu"
        editor
      />
    )
    expect(
      screen.getByRole('button', { name: 'Save max discount' })
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add code' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2)
    expect(screen.getByText('until Dec 31, 2026')).toBeTruthy()
    // A code above the max is shown but never used.
    expect(screen.getByText('above your max, not used')).toBeTruthy()
  })

  it('shows staff the offers without any way to change them', () => {
    render(
      <OffersCard
        maxDiscountPercent={null}
        revision={0}
        codes={[]}
        timezone="UTC"
        editor={false}
      />
    )
    expect(screen.queryByRole('button')).toBeNull()
    expect(
      screen.getByText('Not set yet, so emails offer no discount.')
    ).toBeTruthy()
    expect(
      screen.getByText('No codes yet. Emails will not mention a code.')
    ).toBeTruthy()
  })
})
