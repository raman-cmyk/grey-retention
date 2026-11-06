import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SegmentedControl } from './segmented-control'

afterEach(cleanup)

const modes = [
  { value: 'exact', label: 'Exact', description: 'Keeps the email as it is.' },
  {
    value: 'rebrand',
    label: 'Rebrand',
    description: 'Keeps the layout and swaps in your brand.'
  },
  {
    value: 'adapt',
    label: 'Adapt',
    disabledReason: 'Coming in the replication engine'
  }
] as const

describe('SegmentedControl', () => {
  it('is a labelled radio group with one selected option', () => {
    render(<SegmentedControl name="mode" legend="Mode" options={modes} />)
    const group = screen.getByRole('group', { name: 'Mode' })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Exact/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Rebrand/ })).not.toBeChecked()
    expect(screen.getByText('Keeps the email as it is.')).toBeInTheDocument()
  })

  it('moves the selection with arrow keys and reports changes', async () => {
    const onValueChange = vi.fn()
    render(
      <SegmentedControl
        name="mode"
        legend="Mode"
        options={modes}
        onValueChange={onValueChange}
      />
    )
    screen.getByRole('radio', { name: /Exact/ }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: /Rebrand/ })).toBeChecked()
    expect(onValueChange).toHaveBeenLastCalledWith('rebrand')
    expect(
      screen.getByText('Keeps the layout and swaps in your brand.')
    ).toBeInTheDocument()
  })

  it('shows unavailable options honestly and never selects them', async () => {
    render(<SegmentedControl name="mode" legend="Mode" options={modes} />)
    const adapt = screen.getByRole('radio', { name: /Adapt/ })
    expect(adapt).toBeDisabled()
    expect(adapt).toHaveAccessibleDescription(
      'Not available: Coming in the replication engine'
    )
    await userEvent.click(screen.getByText('Adapt'))
    expect(adapt).not.toBeChecked()
  })

  it('submits the selected value with its form', async () => {
    render(
      <form data-testid="form">
        <SegmentedControl
          name="mode"
          legend="Mode"
          options={modes}
          defaultValue="rebrand"
        />
      </form>
    )
    const form = screen.getByTestId('form') as HTMLFormElement
    expect(new FormData(form).get('mode')).toBe('rebrand')
    await userEvent.click(screen.getByText('Exact'))
    expect(new FormData(form).get('mode')).toBe('exact')
  })
})
