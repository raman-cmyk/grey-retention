import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const reads = vi.hoisted(() => ({ catalog: vi.fn() }))
vi.mock('./catalog/read', async (original) => ({
  ...(await original<typeof import('./catalog/read')>()),
  listCatalog: reads.catalog
}))
const { photoLibrary, readPhotoLibrary } = await import('./photo-library')

const cdn = 'https://cdn.shopify.com/s/files/1'
const tenantId = '00000000-0000-4000-8000-000000000101'

describe('photoLibrary (ONB-059b)', () => {
  it('lists the catalog’s product pictures first, then the site’s photos, each once', () => {
    expect(
      photoLibrary(
        [
          {
            id: 'p1',
            title: 'Trail socks',
            image: `${cdn}/socks.jpg?v=3`,
            hiddenReason: null
          },
          { id: 'p2', title: ' ', image: `${cdn}/cap.png`, hiddenReason: null },
          { id: 'p3', title: 'No photo', image: null, hiddenReason: null },
          {
            id: 'p4',
            title: 'Fancy',
            image: `${cdn}/fancy.webp`,
            hiddenReason: null
          },
          // Not yet released: no email shows it, so no photo of it either.
          {
            id: 'p5',
            title: 'Secret',
            image: `${cdn}/secret.jpg`,
            hiddenReason: 'unpublished'
          }
        ],
        [
          {
            url: `${cdn}/runners.jpg`,
            kind: 'lifestyle',
            page: 'home',
            alt: 'Runners at dawn'
          },
          // The catalog's own picture, at another size: listed once, as the catalog's.
          {
            url: `${cdn}/socks_800x.jpg`,
            kind: 'product',
            page: 'product',
            alt: 'Socks, side'
          },
          {
            url: `${cdn}/cap.png`,
            kind: 'product',
            page: 'home',
            alt: 'Cedar cap'
          },
          { url: `${cdn}/odd.svg`, kind: 'lifestyle', page: 'home', alt: null }
        ]
      )
    ).toEqual([
      {
        url: `${cdn}/socks.jpg?v=3`,
        kind: 'product',
        source: 'catalog',
        alt: 'Trail socks',
        page: null,
        productId: 'p1'
      },
      {
        url: `${cdn}/cap.png`,
        kind: 'product',
        source: 'catalog',
        alt: 'Cedar cap',
        page: null,
        productId: 'p2'
      },
      {
        url: `${cdn}/runners.jpg`,
        kind: 'lifestyle',
        source: 'site',
        alt: 'Runners at dawn',
        page: 'home',
        productId: null
      }
    ])
  })
})

describe('readPhotoLibrary (ONB-059b)', () => {
  type Answer = { data: unknown; error: unknown }
  /** The workspace's own website, and the set kept from it, unless a test says otherwise. */
  const own: Record<string, Answer> = {
    brand_profiles: {
      data: { domain: 'https://www.Cedarlane.com/' },
      error: null
    },
    brand_photo_sets: {
      data: { domain: 'cedarlane.com', run_id: 'run-1' },
      error: null
    }
  }
  function fakeDb(given: Record<string, Answer>) {
    const answers = { ...own, ...given }
    const asked: [string, ...unknown[]][] = []
    const from = (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const op of ['select', 'eq', 'order', 'limit'])
        chain[op] = (...a: unknown[]) => (asked.push([table, op, ...a]), chain)
      chain.maybeSingle = async () => answers[table]
      chain.then = (done: (r: unknown) => unknown) => done(answers[table])
      return chain
    }
    return { db: { from } as never, asked }
  }
  const site = {
    data: [
      { url: `${cdn}/runners.jpg`, kind: 'lifestyle', page: 'home', alt: null }
    ],
    error: null
  }

  it('reads the workspace’s own catalog, real or sample as it was read, and its site photos in order', async () => {
    reads.catalog.mockResolvedValue([
      {
        id: 'p1',
        title: 'Socks',
        image: `${cdn}/socks.jpg`,
        hiddenReason: null
      }
    ])
    const { db, asked } = fakeDb({
      catalog_status: { data: { live: true }, error: null },
      brand_photos: site
    })
    const got = await readPhotoLibrary(db, tenantId)
    expect(got.map((p) => [p.url, p.source])).toEqual([
      [`${cdn}/socks.jpg`, 'catalog'],
      [`${cdn}/runners.jpg`, 'site']
    ])
    expect(reads.catalog).toHaveBeenLastCalledWith(db, tenantId, {
      synthetic: false
    })
    expect(asked).toContainEqual(['brand_photos', 'eq', 'tenant_id', tenantId])
    // Only the photos of the set its website belongs to.
    expect(asked).toContainEqual(['brand_photos', 'eq', 'run_id', 'run-1'])
    expect(asked).toContainEqual([
      'brand_photos',
      'order',
      'position',
      { ascending: true }
    ])
    expect(asked).toContainEqual([
      'catalog_status',
      'eq',
      'tenant_id',
      tenantId
    ])
    // Read from the fake Klaviyo: only its sample products.
    await readPhotoLibrary(
      fakeDb({
        catalog_status: { data: { live: false }, error: null },
        brand_photos: site
      }).db,
      tenantId
    )
    expect(reads.catalog).toHaveBeenLastCalledWith(
      expect.anything(),
      tenantId,
      { synthetic: true }
    )
  })

  it('shows the site’s photos only while they come from the current website', async () => {
    reads.catalog.mockResolvedValue([])
    for (const [profile, kept, shown] of [
      ['cedarlane.com', 'cedarlane.com', 1],
      ['newshop.com', 'cedarlane.com', 0],
      ['cedarlane.com', null, 0],
      [null, 'cedarlane.com', 0]
    ] as const) {
      const got = await readPhotoLibrary(
        fakeDb({
          catalog_status: { data: null, error: null },
          brand_profiles: {
            data: profile === null ? null : { domain: profile },
            error: null
          },
          brand_photo_sets: {
            data: kept === null ? null : { domain: kept, run_id: 'run-1' },
            error: null
          },
          brand_photos: site
        }).db,
        tenantId
      )
      expect(got, `${profile} ${kept}`).toHaveLength(shown)
    }
  })

  it('has only the site’s photos while the catalog was never read, and throws a read that fails', async () => {
    reads.catalog.mockClear()
    const got = await readPhotoLibrary(
      fakeDb({
        catalog_status: { data: null, error: null },
        brand_photos: site
      }).db,
      tenantId
    )
    expect(got.map((p) => p.source)).toEqual(['site'])
    expect(reads.catalog).not.toHaveBeenCalled()
    const failed = { data: null, error: { code: 'PGRST000' } }
    const cases: Record<string, Answer>[] = [
      { catalog_status: failed, brand_photos: site },
      {
        catalog_status: { data: { live: true }, error: null },
        brand_photos: failed
      },
      { catalog_status: failed, brand_profiles: failed, brand_photos: site },
      { catalog_status: failed, brand_photo_sets: failed, brand_photos: site }
    ]
    for (const answers of cases)
      await expect(
        readPhotoLibrary(fakeDb(answers).db, tenantId)
      ).rejects.toMatchObject({
        code: 'PGRST000'
      })
  })
})
