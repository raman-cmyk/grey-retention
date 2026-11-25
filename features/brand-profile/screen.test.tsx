import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./actions', () => ({
  saveBrandSection: vi.fn(async () => ({})),
  redoBrandSection: vi.fn(async () => ({})),
  redoAllBrandSections: vi.fn(async () => ({}))
}))
vi.mock('@/features/brand/actions', () => ({
  brandAction: vi.fn(async () => ({}))
}))
vi.mock('@/features/onboarding/actions', () => ({
  onboardingAction: vi.fn(async () => ({}))
}))

import { brandAction } from '@/features/brand/actions'
import { saveBrandSection } from './actions'
import type { BrandPageView } from './page-model'
import { BrandScreen } from './screen'
import { profileViews } from './view'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const brand = {
  brand_name: 'Cedar Lane',
  domain: 'cedarlane.example',
  positioning: 'Quiet layers.',
  voice:
    'Say what it is\nUse U.S. spelling. Write like Mr. Pemberly’s field notes.',
  prohibitions: 'No hype',
  revision: 7
}
const now = Date.parse('2026-11-06T12:00:00Z')
const views = profileViews(
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

function view(
  over: Partial<Extract<BrandPageView, { state: 'ready' }>> = {}
): BrandPageView {
  return {
    state: 'ready',
    owner: true,
    timezone: 'America/New_York',
    brand: { revision: 7, approvedRevision: 6 },
    views,
    lastUpdated: 'today',
    mismatches: [],
    sectionsUnavailable: false,
    products: [
      {
        id: '00000000-0000-4000-8000-0000000000p1',
        title: 'Field overshirt',
        stock: 4,
        source: 'manual',
        synthetic: false,
        stockCheckedAt: '2026-11-05T15:00:00Z'
      }
    ],
    offers: [
      {
        id: '00000000-0000-4000-8000-0000000000o1',
        label: 'Welcome offer',
        conditions: 'First order only',
        kind: 'discount',
        depthPercent: 15,
        endsAt: '2026-12-31T12:00:00Z'
      }
    ],
    history: [
      {
        id: 'e1',
        revision: 6,
        action: 'owner_approved',
        at: '2026-11-01T15:00:00Z'
      }
    ],
    book: { version: 5, writtenAt: '2026-11-24T10:00:00Z' },
    ...over
  }
}

const card = (name: string) => screen.getByRole('region', { name })
const formOf = (el: HTMLElement) =>
  Object.fromEntries(
    new FormData(el.closest('form')!) as unknown as [string, string][]
  )

describe('BrandScreen', () => {
  it('is a GROS page under Settings with the way back', () => {
    render(<BrandScreen view={view()} />)
    expect(
      screen.getByRole('heading', { name: 'Brand', level: 1 })
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(
      screen.getByRole('link', { name: 'Back to Settings' })
    ).toHaveAttribute('href', '/settings')
  })

  it('asks the owner to approve exactly the version shown', async () => {
    vi.mocked(brandAction).mockResolvedValueOnce({
      message: 'Brand version approved.'
    })
    render(<BrandScreen view={view()} />)
    const version = card('Brand version')
    expect(version).toHaveTextContent('Version7')
    expect(within(version).getByText('Needs you')).toBeVisible()
    expect(version).toHaveTextContent(
      'Your brand details changed since version 6. Drafts and planning wait until you approve version 7.'
    )
    const approve = within(version).getByRole('button', {
      name: 'Approve brand v7'
    })
    expect(formOf(approve)).toEqual({ kind: 'approve', revision: '7' })
    await userEvent.click(approve)
    expect(vi.mocked(brandAction).mock.calls[0]![1].get('revision')).toBe('7')
    expect(
      await within(version).findByText('Brand version approved.')
    ).toBeVisible()
  })

  it('shows an approved version with no button', () => {
    render(
      <BrandScreen
        view={view({ brand: { revision: 7, approvedRevision: 7 } })}
      />
    )
    const version = card('Brand version')
    expect(
      within(version).getByText('Approved for AI use · version 7')
    ).toBeVisible()
    expect(within(version).queryByRole('button')).toBeNull()
    expect(within(version).queryByText('Needs you')).toBeNull()
  })

  it('asks for the brand identity first when there is no brand', () => {
    render(<BrandScreen view={view({ brand: null })} />)
    expect(card('Brand version')).toHaveTextContent(
      'No brand yet. Save the brand identity below first.'
    )
  })

  it('opens the Brand book review', () => {
    render(<BrandScreen view={view()} />)
    const book = card('Brand book')
    expect(book).toHaveTextContent('Version5')
    expect(
      within(book).getByRole('link', { name: 'Review Brand book' })
    ).toHaveAttribute('href', '/settings/brand/book')
    render(<BrandScreen view={view({ book: null })} />)
    expect(
      screen.getAllByRole('region', { name: 'Brand book' })[1]
    ).toHaveTextContent('Not written yet.')
  })

  it('warns when the profile looks like another brand', () => {
    const mismatches = [
      { source: 'klaviyo' as const, message: 'Klaviyo is Juniper Supply.' }
    ]
    render(<BrandScreen view={view({ mismatches })} />)
    const check = card('Check your brand')
    expect(check).toHaveTextContent('Klaviyo is Juniper Supply.')
    expect(
      within(check).getByRole('link', { name: 'Check Klaviyo' })
    ).toHaveAttribute('href', '/settings#klaviyo')
    cleanup()
    render(<BrandScreen view={view({ mismatches, owner: false })} />)
    expect(card('Check your brand')).toHaveTextContent(
      'Ask the workspace owner to check the brand identity.'
    )
    cleanup()
    render(<BrandScreen view={view()} />)
    expect(
      screen.queryByRole('region', { name: 'Check your brand' })
    ).toBeNull()
  })

  it('shows every section with its fields, locks and update time', () => {
    render(<BrandScreen view={view()} />)
    for (const title of [
      'Brand identity',
      'Products',
      'Tone of voice',
      'Vocabulary',
      'Sample copy',
      'Audience'
    ])
      expect(card(title)).toBeInTheDocument()
    const identity = card('Brand identity')
    expect(identity).toHaveTextContent('Updated 96 days ago')
    expect(within(identity).getByText('Outdoor layers')).toBeVisible()
    // Brand facts come from the saved brand, marked as what GROS reads.
    expect(within(identity).getByText('Quiet layers.')).toBeVisible()
    expect(within(identity).getAllByText(/GROS reads this/)).toHaveLength(3)
    expect(within(identity).getByText(/Kept when redone/)).toBeVisible()
    expect(within(identity).getAllByText('Not set yet').length).toBeGreaterThan(
      0
    )
    // Rules line by line, exactly as written.
    expect(
      within(card('Tone of voice')).getByText(
        'Use U.S. spelling. Write like Mr. Pemberly’s field notes.'
      )
    ).toBeVisible()
    const vocabulary = card('Vocabulary')
    expect(vocabulary).toHaveTextContent('Has sample text (not real AI)')
    expect(within(vocabulary).getAllByText('layers')).toHaveLength(2)
    expect(within(vocabulary).getByText('“Hi {{ first_name }},”')).toBeVisible()
    expect(
      within(vocabulary).getByText('Field cut — relaxed fit')
    ).toBeVisible()
    // The Tone card is the old Copy & Voice address's anchor.
    expect(document.getElementById('tone')).toContainElement(
      card('Tone of voice')
    )
  })

  it('lists the catalog on Products, or says how to add one', () => {
    render(<BrandScreen view={view()} />)
    expect(within(card('Products')).getByText('Field overshirt')).toBeVisible()
    cleanup()
    render(<BrandScreen view={view({ products: [] })} />)
    const products = card('Products')
    expect(within(products).getByText('No products yet')).toBeVisible()
    expect(
      within(products).getByRole('link', {
        name: 'add products to the catalog'
      })
    ).toHaveAttribute('href', '#catalog')
    expect(products).not.toHaveTextContent(/Shopify/)
  })

  it('edits a section inline: facts with the brand revision, locks for notes', async () => {
    render(<BrandScreen view={view()} />)
    const identity = card('Brand identity')
    await userEvent.click(
      within(identity).getByRole('button', { name: 'Edit Brand identity' })
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
    expect(
      within(identity).queryByRole('checkbox', {
        name: /AI won’t change brand name/
      })
    ).toBeNull()
    expect(identity).toHaveTextContent(
      /campaigns not sent yet go back to draft/
    )
    const form = formOf(name)
    expect(form.brand_revision).toBe('7')
    expect(form.revision).toBe('2')
    expect(form.section).toBe('identity')
    await userEvent.click(
      within(identity).getByRole('button', { name: 'Cancel' })
    )
    expect(within(identity).queryByLabelText('Brand name')).toBeNull()
    expect(
      within(identity).getByRole('button', { name: 'Edit Brand identity' })
    ).toHaveFocus()
  })

  it('closes the editor after a save and shows the answer in the card', async () => {
    vi.mocked(saveBrandSection).mockResolvedValueOnce({ message: 'Saved.' })
    render(<BrandScreen view={view()} />)
    const audience = card('Audience')
    await userEvent.click(
      within(audience).getByRole('button', { name: 'Edit Audience' })
    )
    await userEvent.click(
      within(audience).getByRole('button', { name: 'Save audience' })
    )
    expect(await within(audience).findByText('Saved.')).toBeVisible()
    expect(within(audience).queryByLabelText('Age range')).toBeNull()
  })

  it('keeps the editor open with the error when a save is refused', async () => {
    vi.mocked(saveBrandSection).mockResolvedValueOnce({
      error: 'Brand name: at least 2 characters.'
    })
    render(<BrandScreen view={view()} />)
    const identity = card('Brand identity')
    await userEvent.click(
      within(identity).getByRole('button', { name: 'Edit Brand identity' })
    )
    await userEvent.clear(within(identity).getByLabelText('Brand name'))
    await userEvent.type(within(identity).getByLabelText('Brand name'), 'C')
    await userEvent.click(
      within(identity).getByRole('button', { name: 'Save brand identity' })
    )
    expect(
      await within(identity).findByText('Brand name: at least 2 characters.')
    ).toBeVisible()
    expect(within(identity).getByLabelText('Brand name')).toHaveValue('C')
  })

  it('offers Redo with AI per section and for the whole profile', () => {
    render(<BrandScreen view={view()} />)
    const redo = within(card('Tone of voice')).getByRole('button', {
      name: 'Redo with AI: Tone of voice'
    })
    expect(formOf(redo)).toEqual({ section: 'tone', revision: '1' })
    const all = within(card('Profile')).getByRole('button', {
      name: 'Redo all with AI'
    })
    expect(formOf(all)).toEqual({
      'revision:identity': '2',
      'revision:products': '0',
      'revision:tone': '1',
      'revision:vocabulary': '1',
      'revision:sample_copy': '0',
      'revision:audience': '0'
    })
  })

  it('sends the catalog, product and offer forms to the existing actions', () => {
    render(<BrandScreen view={view()} />)
    expect(
      formOf(
        within(card('Catalog')).getByRole('button', { name: 'Save stock' })
      )
    ).toEqual({
      kind: 'stock',
      product: '00000000-0000-4000-8000-0000000000p1',
      stock: ''
    })
    expect(
      formOf(
        within(card('Add a product')).getByRole('button', {
          name: 'Add product'
        })
      )
    ).toEqual({
      kind: 'product',
      title: '',
      url: '',
      price_minor: '0',
      stock: '0'
    })
    const offer = formOf(
      within(card('Permitted offers')).getByRole('button', {
        name: 'Save offer'
      })
    )
    expect(offer).toMatchObject({
      kind: 'offer',
      offer_kind: 'evergreen',
      depth_percent: '0',
      conditions: ''
    })
    expect(card('Permitted offers')).toHaveTextContent(
      'Welcome offer' + 'Discount · Up to 15% off · Until Dec 31, 2026'
    )
    expect(card('Brand history')).toHaveTextContent(
      'Version 6Approved by the owner'
    )
  })

  it('gives staff the same page with no buttons that change anything', () => {
    render(<BrandScreen view={view({ owner: false, mismatches: [] })} />)
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /with AI/ })).toBeNull()
    for (const name of [
      'Approve brand v7',
      'Save stock',
      'Add product',
      'Save offer'
    ])
      expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Add a product' })).toBeNull()
    expect(card('Brand version')).toHaveTextContent(
      'Only the workspace owner can approve the brand.'
    )
    expect(card('Brand identity')).toHaveTextContent('Cedar Lane')
  })

  it('says plainly when the brand cannot be read', () => {
    render(
      <BrandScreen
        view={{ state: 'error', owner: true, reason: 'We could not read it.' }}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Brand did not openWe could not read it.'
    )
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      '/settings/brand'
    )
  })
})
