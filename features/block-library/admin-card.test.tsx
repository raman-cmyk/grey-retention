import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BlockLibraryCard } from './admin-card'
import { blockLibraryCount } from './count'

afterEach(cleanup)

describe('the Admin block library card (DES-ENGINE-004)', () => {
  it('says the count toward 2,000, the folded sections and how a block is counted', () => {
    render(
      <BlockLibraryCard
        count={blockLibraryCount([
          {
            source: 'inbox',
            kind: 'hero',
            quality: 'passed',
            blocks: 37,
            uses: 49,
            reused: 6,
            two_brands: 2
          },
          {
            source: 'upload',
            kind: 'footer',
            quality: 'passed',
            blocks: 2,
            uses: 2,
            reused: 0,
            two_brands: 0
          }
        ])}
      />
    )
    expect(screen.getByText('57 of 2,000')).toBeInTheDocument()
    expect(
      screen.getByText(
        /20 coded seed blocks and 37 blocks from the Inspiration inbox/
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(/one block is one distinct layout/)
    ).toBeInTheDocument()
    expect(screen.getByText('Heroes')).toBeInTheDocument()
    expect(screen.getByText('Footers')).toBeInTheDocument()
  })

  it('says so in plain words when the count cannot be read', () => {
    render(<BlockLibraryCard count={null} />)
    expect(screen.getByText(/could not be read/)).toBeInTheDocument()
  })
})
