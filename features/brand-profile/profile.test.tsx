import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./actions', () => ({
  saveBrandSection: vi.fn(async () => ({})),
  redoBrandSection: vi.fn(async () => ({})),
  redoAllBrandSections: vi.fn(async () => ({}))
}))
vi.mock('@/features/brand/actions', () => ({
  brandAction: vi.fn(async () => ({}))
}))
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}))

import { BrandProfile, type SectionView } from './profile'
import { ApprovalBar, BrandTabs, MismatchBanner, updatedAgo } from './header'

afterEach(cleanup)

const views: SectionView[] = [
  {
    section: 'identity',
    content: {
      brand_name: 'Cedar Lane',
      niche: 'Outdoor layers',
      origin_story: ''
    },
    locked: ['niche'],
    source: 'owner',
    revision: 2,
    updated: '96 days ago'
  },
  {
    section: 'tone',
    content: { formality: 'Casual', do: ['Say what it is'], dont: ['No hype'] },
    locked: [],
    source: 'sample',
    revision: 1,
    updated: 'today'
  },
  {
    section: 'vocabulary',
    content: {
      preferred: ['layers'],
      avoid: ['act now'],
      terms: [{ term: 'Field cut', definition: 'relaxed fit' }],
      signature_phrases: ['Hi {{ first_name }},']
    },
    locked: [],
    source: 'owner',
    revision: 1,
    updated: 'today'
  }
]
const section = (name: string) =>
  screen.getByRole('heading', { name, level: 2 }).closest('section')!

describe('BrandProfile', () => {
  it('shows every section with its fields, locks and update time', () => {
    render(<BrandProfile owner views={views} products={[]} />)
    for (const title of [
      'Brand Identity',
      'Product Intelligence',
      'Tone of Voice',
      'Vocabulary',
      'Sample Copy',
      'Audience'
    ])
      expect(section(title)).toBeInTheDocument()
    const identity = section('Brand Identity')
    expect(within(identity).getByText('Updated 96 days ago')).toBeVisible()
    expect(within(identity).getByText('Outdoor layers')).toBeVisible()
    expect(
      within(identity).getByText('(kept when AI redoes this section)')
    ).toBeInTheDocument()
    expect(within(identity).getAllByText('Not set yet').length).toBeGreaterThan(
      0
    )
    expect(
      within(section('Tone of Voice')).getByText(
        /sample suggestion, not real AI/
      )
    ).toBeVisible()
    expect(
      within(section('Tone of Voice')).getByLabelText('Do')
    ).toBeInTheDocument()
    const vocabulary = section('Vocabulary')
    expect(within(vocabulary).getByText('“Hi {{ first_name }},”')).toBeVisible()
    expect(within(vocabulary).getByText('Field cut')).toBeVisible()
  })

  it('shows the no-products callout with real links (old-app fix)', () => {
    render(<BrandProfile owner views={views} products={[]} />)
    const products = section('Product Intelligence')
    expect(within(products).getByText('No products extracted')).toBeVisible()
    expect(
      within(products).getByRole('link', { name: 'connect Shopify' })
    ).toHaveAttribute('href', '/connections')
    expect(
      within(products).getByRole('link', { name: 'Hero Product URL' })
    ).toHaveAttribute('href', '#products')
  })

  it('lists products when there are any', () => {
    render(
      <BrandProfile
        owner
        views={views}
        products={[{ title: 'Field overshirt' }]}
      />
    )
    expect(
      within(section('Product Intelligence')).getByText('Field overshirt')
    ).toBeVisible()
    expect(screen.queryByText('No products extracted')).toBeNull()
  })

  it('edits a section inline with a lock per field', async () => {
    render(<BrandProfile owner views={views} products={[]} />)
    const identity = section('Brand Identity')
    await userEvent.click(
      within(identity).getByRole('button', { name: 'Edit' })
    )
    const name = within(identity).getByLabelText('Brand name')
    expect(name).toHaveValue('Cedar Lane')
    expect(name).toHaveFocus()
    expect(
      within(identity).getByRole('checkbox', { name: /AI won’t change niche/ })
    ).toBeChecked()
    expect(
      within(identity).getByRole('checkbox', {
        name: /AI won’t change brand name/
      })
    ).not.toBeChecked()
    expect(
      within(identity).getByRole('button', { name: 'Save Brand Identity' })
    ).toBeVisible()
    await userEvent.click(
      within(identity).getByRole('button', { name: 'Cancel' })
    )
    expect(within(identity).queryByLabelText('Brand name')).toBeNull()
  })

  it('offers a per-section Redo with AI button with a tooltip', () => {
    render(<BrandProfile owner views={views} products={[]} />)
    const redo = within(section('Tone of Voice')).getByRole('button', {
      name: 'Redo Tone of Voice with AI'
    })
    expect(redo).toHaveAttribute('title', 'Redo this section with AI')
  })

  it('gives staff a read-only view', () => {
    render(<BrandProfile owner={false} views={views} products={[]} />)
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: /with AI/ })).toBeNull()
  })
})

describe('header pieces', () => {
  it('says how long ago in plain words', () => {
    const now = Date.parse('2026-11-06T12:00:00Z')
    expect(updatedAgo('2026-11-06T08:00:00Z', now)).toBe('today')
    expect(updatedAgo('2026-11-05T08:00:00Z', now)).toBe('yesterday')
    expect(updatedAgo('2026-08-02T08:00:00Z', now)).toBe('96 days ago')
    expect(updatedAgo(null, now)).toBeNull()
  })

  it('marks the active tab', () => {
    render(<BrandTabs active="store" />)
    expect(screen.getByRole('link', { name: 'Store' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(
      screen.getByRole('link', { name: 'Brand profile' })
    ).not.toHaveAttribute('aria-current')
  })

  it('shows the mismatch banner only when something does not match', () => {
    const { rerender } = render(<MismatchBanner mismatches={[]} />)
    expect(screen.queryByRole('heading')).toBeNull()
    rerender(
      <MismatchBanner
        mismatches={[
          { source: 'klaviyo', message: 'Klaviyo is Juniper Supply.' }
        ]}
      />
    )
    expect(
      screen.getByRole('heading', {
        name: 'This profile may belong to a different brand'
      })
    ).toBeVisible()
    expect(screen.getByText('Klaviyo is Juniper Supply.')).toBeVisible()
  })

  it('asks the owner to approve changed brand details', () => {
    const { rerender } = render(
      <ApprovalBar owner brand={{ revision: 4, approved_revision: null }} />
    )
    expect(
      screen.getByRole('button', { name: 'Approve brand v4' })
    ).toBeVisible()
    rerender(
      <ApprovalBar owner brand={{ revision: 4, approved_revision: 4 }} />
    )
    expect(screen.getByText('Approved for AI use · version 4')).toBeVisible()
    rerender(
      <ApprovalBar
        owner={false}
        brand={{ revision: 5, approved_revision: null }}
      />
    )
    expect(screen.queryByRole('button')).toBeNull()
  })
})
