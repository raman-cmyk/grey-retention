import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CreditsIndicator } from './credits-indicator'

afterEach(cleanup)

const show = (over: Partial<Parameters<typeof CreditsIndicator>[0]>) =>
  render(
    <CreditsIndicator
      plan="Scale plan"
      renewsInDays={30}
      used={2500}
      included={10000}
      sample={false}
      {...over}
    />
  )

describe('CreditsIndicator', () => {
  it('shows credits left, plan and renewal in plain words', () => {
    show({ sample: true })
    const region = screen.getByRole('region', { name: 'AI credits' })
    expect(region).toHaveTextContent('Scale plan · renews in 30 days')
    expect(region).toHaveTextContent('7,500 of 10,000 left')
    expect(region).toHaveTextContent('(sample numbers)')
    expect(
      screen.getByRole('meter', { name: 'AI credits left' })
    ).toHaveAttribute('aria-valuenow', '75')
  })

  it('warns when credits run low', () => {
    show({ renewsInDays: 1, used: 9500 })
    expect(
      screen.getByText(/500 of 10,000 left — running low/)
    ).toBeInTheDocument()
    expect(screen.getByText('Scale plan · renews in 1 day')).toBeInTheDocument()
  })

  it('says "No credits left" and never shows negative numbers', () => {
    show({ renewsInDays: -3, used: 12000 })
    expect(screen.getByText('No credits left')).toBeInTheDocument()
    expect(
      screen.getByText('Scale plan · renewal date has passed')
    ).toBeInTheDocument()
  })

  it('rounds days and ignores negative usage', () => {
    show({ renewsInDays: 0.4, used: -50, included: 100 })
    expect(screen.getByText('100 of 100 left')).toBeInTheDocument()
    expect(screen.getByText('Scale plan · renews today')).toBeInTheDocument()
  })

  it('says when usage is unknown instead of showing zero', () => {
    show({ renewsInDays: null, used: Number.NaN, included: 0.4 })
    expect(screen.getByText('Usage not available yet')).toBeInTheDocument()
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
  })
})
