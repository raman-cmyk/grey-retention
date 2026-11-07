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
import { ApprovalBar, BrandHeader, MismatchBanner } from './header'
import { profileViews } from './view'
import { saveBrandSection } from './actions'

afterEach(cleanup)

const brand = {
  brand_name: 'Cedar Lane',
  domain: 'cedar-lane.example',
  positioning: 'Quiet layers.',
  voice:
    'Say what it is\nUse U.S. spelling. Write like Mr. Pemberly’s field notes.',
  prohibitions: 'No hype',
  revision: 7
}
const now = Date.parse('2026-11-06T12:00:00Z')
const views: SectionView[] = profileViews(
  brand,
  [
    {
      section: 'identity',
      content: { niche: 'Outdoor layers', origin_story: '' },
      locked: ['niche'],
      revision: 2,
      updatedAt: '2026-08-02T08:00:00Z'
    },
    {
      section: 'tone',
      content: { formality: 'Casual' },
      locked: [],
      revision: 1,
      updatedAt: '2026-11-06T08:00:00Z'
    },
    {
      section: 'vocabulary',
      content: {
        preferred: ['layers', 'layers'],
        avoid: ['Sample: words you never use'],
        terms: [{ term: 'Field cut', definition: 'relaxed fit' }],
        signature_phrases: ['Hi {{ first_name }},']
      },
      locked: [],
      revision: 1,
      updatedAt: '2026-11-06T08:00:00Z'
    }
  ],
  now
)
const section = (name: string) =>
  screen.getByRole('heading', { name, level: 3 }).closest('section')!

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
    expect(
      screen.getByRole('heading', { name: 'Brand Truth', level: 2 })
    ).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Copy & Voice', level: 2 })
    ).toBeVisible()
    const identity = section('Brand Identity')
    expect(within(identity).getByText('Updated 96 days ago')).toBeVisible()
    expect(within(identity).getByText('Outdoor layers')).toBeVisible()
    // Brand facts come from the saved brand and are marked as what the AI reads.
    expect(within(identity).getByText('Quiet layers.')).toBeVisible()
    expect(within(identity).getAllByText('AI reads')).toHaveLength(3)
    expect(
      within(identity).getByText(/The other fields are notes for your team/)
    ).toBeVisible()
    expect(
      within(identity).getByText('(kept when AI redoes this section)')
    ).toBeInTheDocument()
    expect(within(identity).getAllByText('Not set yet').length).toBeGreaterThan(
      0
    )
    const tone = section('Tone of Voice')
    // Rules are shown line by line, exactly as written.
    expect(
      within(tone).getByText(
        'Use U.S. spelling. Write like Mr. Pemberly’s field notes.'
      )
    ).toBeVisible()
    expect(within(tone).getAllByLabelText('Do')).toHaveLength(2)
    expect(within(tone).queryByText(/sample text/)).toBeNull()
    const vocabulary = section('Vocabulary')
    expect(
      within(vocabulary).getByText(/has sample text \(not real AI\)/)
    ).toBeVisible()
    expect(within(vocabulary).getAllByText('layers')).toHaveLength(2)
    expect(within(vocabulary).getByText('“Hi {{ first_name }},”')).toBeVisible()
    expect(within(vocabulary).getByText('Field cut')).toBeVisible()
    expect(
      within(section('Audience')).getByText(
        'Notes for your team. The AI does not read this section yet.'
      )
    ).toBeVisible()
  })

  it('shows the no-products callout with real links (old-app fix)', () => {
    render(<BrandProfile owner views={views} products={[]} />)
    const products = section('Product Intelligence')
    expect(within(products).getByText('No products yet')).toBeVisible()
    expect(within(products).queryByText(/scrape/)).toBeNull()
    expect(
      within(products).getByText(
        /Reading products from Klaviyo is not ready yet/
      )
    ).toBeVisible()
    expect(within(products).queryByText(/Shopify/)).toBeNull()
    expect(
      within(products).getByRole('link', {
        name: 'add products to the catalogue'
      })
    ).toHaveAttribute('href', '#catalogue')
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
    expect(screen.queryByText('No products yet')).toBeNull()
  })

  it('edits a section inline: facts with the brand revision, locks for notes', async () => {
    render(<BrandProfile owner views={views} products={[]} />)
    const identity = section('Brand Identity')
    await userEvent.click(
      within(identity).getByRole('button', { name: 'Edit Brand Identity' })
    )
    const name = within(identity).getByLabelText('Brand name')
    expect(name).toHaveValue('Cedar Lane')
    expect(name).toHaveFocus()
    expect(within(identity).getByLabelText('Positioning')).toHaveValue(
      'Quiet layers.'
    )
    expect(
      within(identity).getByRole('checkbox', { name: /AI won’t change niche/ })
    ).toBeChecked()
    // Brand facts have no lock: only the owner changes them.
    expect(
      within(identity).queryByRole('checkbox', {
        name: /AI won’t change brand name/
      })
    ).toBeNull()
    expect(
      within(identity).getByText(/campaigns not sent yet go back to draft/)
    ).toBeVisible()
    const form = name.closest('form')!
    expect(new FormData(form).get('brand_revision')).toBe('7')
    expect(new FormData(form).get('revision')).toBe('2')
    expect(
      within(identity).getByRole('button', { name: 'Save Brand Identity' })
    ).toBeVisible()
    await userEvent.click(
      within(identity).getByRole('button', { name: 'Cancel' })
    )
    expect(within(identity).queryByLabelText('Brand name')).toBeNull()
  })

  it('closes the editor after a save and shows the result in the card', async () => {
    vi.mocked(saveBrandSection).mockResolvedValueOnce({ message: 'Saved.' })
    render(<BrandProfile owner views={views} products={[]} />)
    const audience = section('Audience')
    await userEvent.click(
      within(audience).getByRole('button', { name: 'Edit Audience' })
    )
    await userEvent.click(
      within(audience).getByRole('button', { name: 'Save Audience' })
    )
    expect(await within(audience).findByText('Saved.')).toBeVisible()
    expect(within(audience).queryByLabelText('Age range')).toBeNull()
  })

  it('keeps the editor open with the error when a save is refused', async () => {
    vi.mocked(saveBrandSection).mockResolvedValueOnce({
      error: 'Brand name: at least 2 characters.'
    })
    render(<BrandProfile owner views={views} products={[]} />)
    const identity = section('Brand Identity')
    await userEvent.click(
      within(identity).getByRole('button', { name: 'Edit Brand Identity' })
    )
    await userEvent.clear(within(identity).getByLabelText('Brand name'))
    await userEvent.type(within(identity).getByLabelText('Brand name'), 'C')
    await userEvent.click(
      within(identity).getByRole('button', { name: 'Save Brand Identity' })
    )
    expect(
      await within(identity).findByText('Brand name: at least 2 characters.')
    ).toBeVisible()
    expect(within(identity).getByLabelText('Brand name')).toHaveValue('C')
  })

  it('offers a per-section Redo with AI button with a tooltip', () => {
    render(<BrandProfile owner views={views} products={[]} />)
    const redo = within(section('Tone of Voice')).getByRole('button', {
      name: 'Redo Tone of Voice with AI'
    })
    expect(redo).toHaveAttribute(
      'title',
      'Redo this section with AI (sample writer: fills empty fields only)'
    )
    expect(redo).toBeEnabled()
  })

  it('gives staff a read-only view', () => {
    render(<BrandProfile owner={false} views={views} products={[]} />)
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: /with AI/ })).toBeNull()
  })
})

describe('header pieces', () => {
  it('shows no Store tab (v2 is Klaviyo only)', () => {
    render(<BrandHeader active="profile" owner={false} lastUpdated={null} />)
    expect(
      screen.queryByRole('navigation', { name: 'Brand & Store' })
    ).toBeNull()
    expect(screen.queryByRole('link', { name: 'Store' })).toBeNull()
  })

  it('shows the mismatch banner only when something does not match', () => {
    const { rerender } = render(<MismatchBanner owner mismatches={[]} />)
    expect(screen.queryByRole('heading')).toBeNull()
    rerender(
      <MismatchBanner
        owner
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
    expect(screen.getByText(/you can ignore this note/)).toBeVisible()
    rerender(
      <MismatchBanner
        owner={false}
        mismatches={[{ source: 'shopify', message: 'Shopify differs.' }]}
      />
    )
    expect(
      screen.getByText('Ask the workspace owner to check the Brand Identity.')
    ).toBeVisible()
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
