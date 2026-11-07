import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./actions', () => ({ submitDesign: vi.fn() }))

import { SubmitDesignCard } from './submit-card'

afterEach(cleanup)

const id = '11111111-1111-4111-8111-111111111111'

describe('SubmitDesignCard', () => {
  it('opens the upload form on a first brief', () => {
    render(
      <SubmitDesignCard
        assignmentId={id}
        designRevision={3}
        state="assigned"
        stale={false}
      />
    )
    expect(screen.getByLabelText('Design image')).toHaveAttribute(
      'accept',
      'image/png,image/jpeg,image/webp'
    )
    expect(screen.getByLabelText('Submission notes')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Submit design version' })
    ).toBeVisible()
    expect(screen.getByText(/only you and this brand.s team/)).toBeVisible()
    expect(screen.queryByText(/Read the owner feedback/)).toBeNull()
  })

  it('points to the owner feedback on a redo', () => {
    render(
      <SubmitDesignCard
        assignmentId={id}
        designRevision={4}
        state="revisions_requested"
        stale={false}
      />
    )
    expect(screen.getByText(/Read the owner feedback below/)).toBeVisible()
  })

  it.each([
    ['submitted', false, /owner is reviewing/],
    ['approved', false, /owner approved this design/],
    ['assigned', true, /until platform admin assigns the current brief/],
    ['revisions_requested', true, /until platform admin assigns/]
  ])('closes the form when %s (stale %s) and says why', (state, stale, why) => {
    render(
      <SubmitDesignCard
        assignmentId={id}
        designRevision={4}
        state={state}
        stale={stale}
      />
    )
    expect(screen.queryByLabelText('Design image')).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Submit design version' })
    ).toBeNull()
    expect(screen.getByText(why)).toBeVisible()
  })
})
