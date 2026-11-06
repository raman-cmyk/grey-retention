import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LocalDateTimeField, timezoneName } from './local-date-time-field'

function field(props: Partial<Parameters<typeof LocalDateTimeField>[0]> = {}) {
  render(
    <form aria-label="form">
      <LocalDateTimeField
        name="planned_at"
        label="Send time"
        timezone="Asia/Kathmandu"
        defaultValue="2026-11-10T04:15:00.000Z"
        {...props}
      />
    </form>
  )
  return screen.getByLabelText('Send time') as HTMLInputElement
}

afterEach(cleanup)

describe('LocalDateTimeField', () => {
  it('shows the saved time in the workspace timezone, never as ISO', () => {
    const input = field()
    expect(input.type).toBe('datetime-local')
    expect(input.name).toBe('planned_at')
    expect(input.value).toBe('2026-11-10T10:00')
    expect(input.required).toBe(true)
    expect(screen.getByText(/Tuesday, November 10, 2026/)).toHaveTextContent(
      'Kathmandu time (your workspace timezone).'
    )
    expect(document.body.textContent).not.toMatch(/\d{2}:\d{2}:\d{2}/)
    expect(document.body.textContent).not.toContain('Z')
  })

  it('is a plain keyboard-usable input linked to its help text', async () => {
    const input = field()
    await userEvent.tab()
    expect(input).toHaveFocus()
    expect(input).toHaveAccessibleDescription(/your workspace timezone/)
  })

  it('flags a time that does not exist when clocks go forward', async () => {
    const input = field({
      timezone: 'America/New_York',
      defaultValue: undefined
    })
    await userEvent.type(input, '2026-03-08T02:30')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This time does not exist in New York because the clocks change.'
    )
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('asks which one when a time happens twice, and resets on change', async () => {
    const input = field({
      timezone: 'America/New_York',
      defaultValue: '2026-11-01T05:30:00.000Z'
    })
    expect(input.value).toBe('2026-11-01T01:30')
    const choice = screen.getByLabelText(
      'This time happens twice when the clocks go back'
    ) as HTMLSelectElement
    expect(choice.name).toBe('planned_atOccurrence')
    expect(choice.required).toBe(true)
    expect([...choice.options].map((o) => o.textContent)).toEqual([
      'Choose which one',
      'The first time (1:30 AM GMT-4)',
      'The second time (1:30 AM GMT-5)'
    ])
    await userEvent.selectOptions(choice, 'later')
    expect(choice.value).toBe('later')
    await userEvent.clear(input)
    await userEvent.type(input, '2026-11-01T03:30')
    expect(
      screen.queryByLabelText('This time happens twice when the clocks go back')
    ).toBeNull()
  })

  it('starts empty when there is no default', () => {
    expect(field({ defaultValue: undefined }).value).toBe('')
  })
})

describe('timezoneName', () => {
  it.each([
    ['Asia/Kathmandu', 'Kathmandu'],
    ['America/Los_Angeles', 'Los Angeles'],
    ['America/Argentina/Buenos_Aires', 'Buenos Aires'],
    ['UTC', 'UTC'],
    ['Etc/UTC', 'UTC']
  ])('%s → %s', (zone, name) => expect(timezoneName(zone)).toBe(name))
})
