import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StatusMark } from './status-mark'

afterEach(cleanup)

describe('StatusMark', () => {
  it('uses the shared word and explains its meaning', () => {
    render(<StatusMark status="needs_review" />)
    const mark = screen.getByText('Needs review')
    expect(mark).toHaveAttribute(
      'title',
      'Waiting for the brand owner to check and approve it.'
    )
    expect(mark.className).toContain('text-[var(--warning-ink)]')
  })

  it('keeps custom labels and older tones working', () => {
    render(<StatusMark tone="active">Scheduled for Tuesday</StatusMark>)
    expect(screen.getByText('Scheduled for Tuesday').className).toContain(
      'text-[var(--brand-secondary)]'
    )
  })

  it('shows status as text with a decorative dot, not colour alone', () => {
    const { container } = render(<StatusMark status="failed" />)
    expect(screen.getByText('Failed')).toBeInTheDocument()
    const dot = container.querySelector('[aria-hidden]')
    expect(dot).not.toBeNull()
    expect(dot?.className).not.toContain('rounded-full')
  })

  it('offers a sentence-case variant without the mono label style', () => {
    render(
      <StatusMark tone="active" variant="text">
        Today
      </StatusMark>
    )
    const mark = screen.getByText('Today')
    expect(mark.className).not.toContain('uppercase')
    expect(mark.className).not.toContain('tracking-label')
  })
})
