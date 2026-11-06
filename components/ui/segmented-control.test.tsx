import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
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
  it('is a labelled radio group with exact option names', () => {
    render(<SegmentedControl name="mode" legend="Mode" options={modes} />)
    expect(screen.getByRole('group', { name: 'Mode' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Exact' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Rebrand' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Adapt' })).toBeDisabled()
  })

  it('describes only the selected option', () => {
    render(<SegmentedControl name="mode" legend="Mode" options={modes} />)
    expect(
      screen.getByRole('radio', { name: 'Exact' })
    ).toHaveAccessibleDescription('Keeps the email as it is.')
    expect(
      screen.getByRole('radio', { name: 'Rebrand' })
    ).not.toHaveAccessibleDescription()
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
    screen.getByRole('radio', { name: 'Exact' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    const rebrand = screen.getByRole('radio', { name: 'Rebrand' })
    expect(rebrand).toBeChecked()
    expect(onValueChange).toHaveBeenLastCalledWith('rebrand')
    expect(rebrand).toHaveAccessibleDescription(
      'Keeps the layout and swaps in your brand.'
    )
  })

  it('shows why an option is unavailable and never selects it', async () => {
    render(<SegmentedControl name="mode" legend="Mode" options={modes} />)
    const adapt = screen.getByRole('radio', { name: 'Adapt' })
    expect(adapt).toHaveAccessibleDescription(
      'Adapt: not available yet — Coming in the replication engine'
    )
    expect(
      screen.getByText(
        'Adapt: not available yet — Coming in the replication engine'
      )
    ).toBeVisible()
    await userEvent.click(screen.getByText('Adapt'))
    expect(adapt).not.toBeChecked()
  })

  it('falls back to the first available option for a disabled or unknown value', () => {
    const { unmount } = render(
      <SegmentedControl
        name="mode"
        legend="Mode"
        options={modes}
        defaultValue="adapt"
      />
    )
    expect(screen.getByRole('radio', { name: 'Exact' })).toBeChecked()
    unmount()
    render(
      <SegmentedControl
        name="mode"
        legend="Mode"
        options={modes}
        value={'missing' as 'exact'}
      />
    )
    expect(screen.getByRole('radio', { name: 'Exact' })).toBeChecked()
  })

  it('works as a controlled component', async () => {
    function Controlled() {
      const [mode, setMode] = useState<'exact' | 'rebrand' | 'adapt'>('rebrand')
      return (
        <>
          <SegmentedControl
            name="mode"
            legend="Mode"
            options={modes}
            value={mode}
            onValueChange={setMode}
          />
          <output>{mode}</output>
        </>
      )
    }
    render(<Controlled />)
    expect(screen.getByRole('radio', { name: 'Rebrand' })).toBeChecked()
    await userEvent.click(screen.getByText('Exact'))
    expect(screen.getByRole('status')).toHaveTextContent('exact')
    expect(screen.getByRole('radio', { name: 'Exact' })).toBeChecked()
  })

  it('submits the selected value and returns to the default on form reset', async () => {
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
    act(() => form.reset())
    expect(new FormData(form).get('mode')).toBe('rebrand')
    expect(screen.getByRole('radio', { name: 'Rebrand' })).toBeChecked()
    expect(
      screen.getByText('Keeps the layout and swaps in your brand.')
    ).toBeInTheDocument()
  })
})
