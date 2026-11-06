import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CreditsIndicator } from './credits-indicator'

afterEach(cleanup)

describe('CreditsIndicator', () => {
  it('shows credits left, plan and renewal in plain words', () => {
    render(
      <CreditsIndicator
        plan="Scale plan"
        renewsInDays={30}
        used={2500}
        included={10000}
        sample
      />
    )
    const region = screen.getByRole('region', { name: 'AI credits' })
    expect(region).toHaveTextContent('Scale plan · renews in 30 days')
    expect(region).toHaveTextContent('7,500 of 10,000 left')
    expect(region).toHaveTextContent('(sample numbers)')
    expect(
      screen.getByRole('meter', { name: 'AI credits left' })
    ).toHaveAttribute('aria-valuenow', '75')
  })

  it('warns when credits run low and never shows negative numbers', () => {
    render(
      <CreditsIndicator
        plan="Scale plan"
        renewsInDays={1}
        used={12000}
        included={10000}
      />
    )
    expect(
      screen.getByText(/0 of 10,000 left — running low/)
    ).toBeInTheDocument()
    expect(screen.getByText('Scale plan · renews in 1 day')).toBeInTheDocument()
  })

  it('says when usage is unknown instead of showing zero', () => {
    render(
      <CreditsIndicator
        plan="Starter"
        renewsInDays={null}
        used={Number.NaN}
        included={0}
      />
    )
    expect(screen.getByText('Usage not available yet')).toBeInTheDocument()
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
  })
})
