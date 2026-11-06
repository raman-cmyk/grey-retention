import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { EmptyState } from './empty-state'
import { TextLink } from './text-link'

afterEach(cleanup)

describe('EmptyState', () => {
  it('says what is missing, what to do and offers one action', () => {
    render(
      <EmptyState
        title="No competitors yet."
        description="Add one brand to start collecting its emails."
        action={<TextLink href="/competitor-agent">Add a competitor</TextLink>}
      />
    )
    expect(
      screen.getByRole('heading', { level: 3, name: 'No competitors yet.' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Add one brand to start collecting its emails.')
    ).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('can be a section heading and works without an action', () => {
    render(
      <EmptyState
        headingLevel={2}
        title="Nothing to review."
        description="New drafts appear here."
      />
    )
    expect(
      screen.getByRole('heading', { level: 2, name: 'Nothing to review.' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
