import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/features/assets/actions', () => ({
  importAssets: vi.fn(async () => ({}))
}))
vi.mock('@/features/onboarding/actions', () => ({
  onboardingAction: vi.fn(async () => ({}))
}))

import { AssetsScreen } from './screen'
import { assetFilter, assetsView, shownAssets, type SetupInput } from './view'

afterEach(cleanup)

const product = { id: 'p1', title: 'Field overshirt' }
const asset = (over: Partial<SetupInput['assets'][number]> = {}) => ({
  id: 'a1',
  filename: 'cedar-logo.png',
  category: 'logo',
  revision: 2,
  classification_source: 'fixture',
  synthetic: true,
  product_id: null,
  variant_id: null,
  preview: 'https://storage.example/signed/cedar-logo.png',
  ...over
})
const setup: SetupInput = {
  connections: [
    {
      provider: 'drive',
      status: 'connected',
      revision: 2,
      last_sync_at: '2026-11-20T10:00:00Z',
      last_error: null,
      folder_id: 'fixture:brand-assets'
    }
  ],
  assets: [
    asset(),
    asset({
      id: 'a2',
      filename: 'overshirt.jpg',
      category: null,
      revision: 1,
      classification_source: null,
      synthetic: false,
      preview: null
    }),
    asset({
      id: 'a3',
      filename: 'overshirt-on-trail.jpg',
      category: 'proof',
      revision: 3,
      classification_source: 'owner',
      synthetic: false,
      product_id: 'p1',
      variant_id: 'v1'
    })
  ],
  imports: [{ id: 'i1', source: 'zip', state: 'complete' }],
  items: [
    {
      id: 'it1',
      filename: 'unsupported.svg',
      status: 'failed',
      error_code: 'invalid_file'
    }
  ],
  kit: {
    revision: 2,
    colors: ['#123abc'],
    fonts: ['Inter'],
    approved_by: null
  },
  variants: [{ id: 'v1', title: 'Large', sku: 'FO-L' }],
  jobs: [
    {
      id: 'j1',
      kind: 'assets.classify',
      status: 'succeeded',
      attempt: 1,
      error_code: null
    }
  ],
  readiness: {
    ready: false,
    gates: [
      {
        name: 'Classified usable assets',
        met: true,
        detail: '2/2; fixture classifications are synthetic'
      }
    ]
  }
}
const ready = (
  over: { owner?: boolean; filter?: string; live?: boolean } = {}
) =>
  assetsView({
    owner: over.owner ?? true,
    filter: assetFilter(over.filter),
    setup,
    products: [product],
    liveKlaviyo: over.live ?? false
  })
const card = (name: string) => screen.getByRole('region', { name })
const formOf = (el: HTMLElement) =>
  Object.fromEntries(
    new FormData(el.closest('form')!) as unknown as [string, string][]
  )

describe('assets view', () => {
  it('reads the filter from the address, All otherwise', () => {
    expect(assetFilter('logo')).toBe('logo')
    expect(assetFilter('pending')).toBe('pending')
    expect(assetFilter('banner')).toBe('all')
    expect(assetFilter(['logo'])).toBe('all')
    expect(assetFilter(undefined)).toBe('all')
  })

  it('filters the files: Not sorted has no category yet', () => {
    expect(shownAssets(setup.assets, 'pending').map((a) => a.id)).toEqual([
      'a2'
    ])
    expect(shownAssets(setup.assets, 'proof').map((a) => a.id)).toEqual(['a3'])
    expect(shownAssets(setup.assets, 'all')).toHaveLength(3)
  })

  it('says who sorted a file and what it matches, in plain words', () => {
    const view = ready()
    if (view.state !== 'ready') throw new Error('not ready')
    expect(view.tiles.map((t) => [t.details, t.match])).toEqual([
      ['Logo · v2 · Sample sort · Sample graphic', 'Match: none yet'],
      ['Not sorted · v1', 'Match: none yet'],
      [
        'Proof · v3 · Your correction',
        'Match: Field overshirt · variant matched'
      ]
    ])
    expect(view.uploads).toEqual([
      {
        id: 'it1',
        filename: 'unsupported.svg',
        outcome: 'Not saved',
        diagnostic: 'Not a PNG, JPEG or WebP image'
      }
    ])
  })

  it('is an error when the workspace could not be read', () => {
    expect(
      assetsView({
        owner: true,
        filter: 'all',
        setup: null,
        products: null,
        liveKlaviyo: false
      }).state
    ).toBe('error')
  })
})

describe('AssetsScreen', () => {
  it('is a GROS page under Settings with the upload and the files', () => {
    render(<AssetsScreen view={ready()} />)
    expect(
      screen.getByRole('heading', { name: 'Brand assets', level: 1 })
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    const upload = card('Upload files')
    const input = within(upload).getByLabelText('Brand image files or one ZIP')
    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAttribute(
      'accept',
      'image/png,image/jpeg,image/webp,.zip'
    )
    expect(
      within(upload).getByRole('button', { name: 'Import private assets' })
    ).toBeVisible()
    const files = card('Your files')
    expect(within(files).getByRole('link', { name: 'All' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(
      within(files).getByRole('link', { name: 'Not sorted' })
    ).toHaveAttribute('href', '/settings/assets?category=pending')
    const logo = within(files)
      .getAllByRole('article')
      .find((a) =>
        within(a).queryByRole('heading', { name: 'cedar-logo.png' })
      )!
    expect(
      within(logo).getByRole('img', { name: 'cedar-logo.png' })
    ).toBeVisible()
    expect(
      within(logo).getByText('Logo · v2 · Sample sort · Sample graphic')
    ).toBeVisible()
    expect(
      formOf(
        within(logo).getByRole('button', {
          name: 'Save owner correction: cedar-logo.png'
        })
      )
    ).toEqual({
      kind: 'correct',
      asset: 'a1',
      revision: '2',
      category: 'logo',
      product: '',
      variant: ''
    })
    expect(
      within(logo).getByLabelText('Review classification for cedar-logo.png')
    ).toBeInTheDocument()
    expect(card('Recent uploads')).toHaveTextContent(
      'unsupported.svgNot saved · Not a PNG, JPEG or WebP image'
    )
  })

  it('shows only the filtered files, with a word when none match', () => {
    render(<AssetsScreen view={ready({ filter: 'lifestyle' })} />)
    expect(card('Your files')).toHaveTextContent('0 of 3 files shown')
    expect(card('Your files')).toHaveTextContent('No files here.')
  })

  it('lets the owner approve exactly the kit version shown', () => {
    render(<AssetsScreen view={ready()} />)
    const kit = card('Brand kit')
    expect(within(kit).getByText('#123abc')).toBeVisible()
    expect(kit).toHaveTextContent('Inter')
    expect(
      formOf(within(kit).getByRole('button', { name: 'Approve kit v2' }))
    ).toEqual({ kind: 'kit_approve', revision: '2' })
    // The fixture kit reader is a sample tool, not part of the kit.
    expect(
      within(kit).queryByRole('button', {
        name: 'Queue fixture kit extraction'
      })
    ).toBeNull()
    expect(
      formOf(
        within(card('Sample kit reader')).getByRole('button', {
          name: 'Queue fixture kit extraction'
        })
      )
    ).toEqual({ kind: 'queue', job: 'brand.extract', sourceText: '' })
  })

  it('gives the sample data tools to the owner only', () => {
    render(<AssetsScreen view={ready()} />)
    expect(
      formOf(
        within(card('Setup jobs')).getByRole('button', {
          name: 'Run queued setup jobs'
        })
      )
    ).toEqual({ kind: 'run' })
    expect(
      within(card('Readiness')).getByText('Classified usable assets')
    ).toBeVisible()
    expect(card('Readiness')).toHaveTextContent('Done')
    // Setup jobs and connections in the owner's words, never raw states.
    const jobs = card('Setup jobs')
    expect(jobs).toHaveTextContent('Sort the sample filesDone · Try 1 of 4')
    expect(jobs).not.toHaveTextContent(/assets\.classify|succeeded/)
    for (const name of [
      'Sample Klaviyo',
      'Sample catalog',
      'Sample Drive folder'
    ])
      expect(card(name)).toBeInTheDocument()
    const drive = card('Sample Drive folder')
    expect(drive).toHaveTextContent(
      'Connected · Last read Nov 20, 2026, 10:00 AM UTC'
    )
    expect(card('Sample Klaviyo')).toHaveTextContent(
      'Not connected · Not read yet'
    )
    expect(
      within(drive).getByRole('option', { name: 'Stopped working' })
    ).toHaveValue('error')
    expect(
      formOf(
        within(card('Sample Drive folder')).getByRole('button', {
          name: 'Save drive fixture'
        })
      )
    ).toEqual({
      kind: 'connection',
      provider: 'drive',
      status: 'connected',
      folder: 'fixture:brand-assets'
    })
    expect(
      formOf(
        within(card('Sample Drive folder')).getByRole('button', {
          name: 'Queue drive sync'
        })
      )
    ).toEqual({ kind: 'queue', job: 'drive.sync', sourceText: '' })
    cleanup()
    render(<AssetsScreen view={ready({ owner: false })} />)
    for (const name of [
      'Setup jobs',
      'Readiness',
      'Sample kit reader',
      'Sample Drive folder'
    ])
      expect(screen.queryByRole('region', { name })).toBeNull()
    expect(screen.queryByText(/Review classification/)).toBeNull()
    expect(screen.queryByRole('button', { name: /^Approve kit/ })).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Queue fixture kit extraction' })
    ).toBeNull()
    // Every member can still upload, as before.
    expect(
      screen.getByRole('button', { name: 'Import private assets' })
    ).toBeVisible()
  })

  it('offers no sample Klaviyo with live Klaviyo on', () => {
    render(<AssetsScreen view={ready({ live: true })} />)
    expect(screen.queryByRole('region', { name: 'Sample Klaviyo' })).toBeNull()
    expect(card('Sample catalog')).toBeInTheDocument()
  })

  it('says plainly when the files cannot be read', () => {
    render(
      <AssetsScreen
        view={assetsView({
          owner: true,
          filter: 'all',
          setup: null,
          products: null,
          liveKlaviyo: false
        })}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Brand assets did not open'
    )
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      '/settings/assets'
    )
  })
})
