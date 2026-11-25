/**
 * Brand assets (UI-BRAND, `/settings/assets`): the brand's own image
 * files, kept private (signed preview links of five minutes), the sample
 * sorting and the owner's corrections, the brand kit's colors and fonts,
 * and the sample data tools (test controls for the sample data used
 * before live connections; owners only, as before). This file turns the
 * onboarding workspace's rows into what the screen shows, in the owner's
 * words; it reads nothing itself.
 */
export const assetCategories = [
  'product',
  'lifestyle',
  'proof',
  'logo',
  'unusable'
] as const
export type AssetCategory = (typeof assetCategories)[number]
export const assetFilters = ['all', 'pending', ...assetCategories] as const
export type AssetFilter = (typeof assetFilters)[number]

export const filterWords: Record<AssetFilter, string> = {
  all: 'All',
  pending: 'Not sorted',
  product: 'Product',
  lifestyle: 'Lifestyle',
  proof: 'Proof',
  logo: 'Logo',
  unusable: 'Unusable'
}

type AssetRow = {
  id: string
  filename: string
  category: string | null
  revision: number
  classification_source: string | null
  synthetic: boolean
  product_id: string | null
  variant_id: string | null
  preview: string | null
}

export type AssetTile = {
  id: string
  filename: string
  preview: string | null
  revision: number
  /** The saved category, or null when not sorted yet. */
  category: AssetCategory | null
  productId: string | null
  variantId: string | null
  /** Category · version · who sorted it (· sample graphic). */
  details: string
  /** The catalog match, in words. */
  match: string
}

export type SetupInput = {
  connections: {
    provider: string
    status: string
    revision: number
    last_sync_at: string | null
    last_error: string | null
    folder_id: string | null
  }[]
  assets: AssetRow[]
  imports: { id: string; source: string; state: string }[]
  items: {
    id: string
    filename: string
    status: string
    error_code: string | null
  }[]
  kit: {
    revision: number
    colors: string[]
    fonts: string[]
    approved_by: string | null
  } | null
  variants: { id: string; title: string; sku: string }[]
  jobs: {
    id: string
    kind: string
    status: string
    attempt: number
    error_code: string | null
  }[]
  readiness: {
    ready: boolean
    gates: { name: string; met: boolean; detail: string }[]
  }
}

export type AssetsView =
  | { state: 'error'; reason: string }
  | {
      state: 'ready'
      owner: boolean
      filter: AssetFilter
      /** Every file, for the counts. */
      total: number
      tiles: AssetTile[]
      products: { id: string; title: string }[]
      variants: { id: string; label: string }[]
      uploads: {
        id: string
        filename: string
        outcome: string
        diagnostic: string | null
      }[]
      importsLine: string
      kit: SetupInput['kit']
      jobs: SetupInput['jobs']
      readiness: SetupInput['readiness']
      connections: SetupInput['connections']
      /** Live Klaviyo is on: no sample Klaviyo tool. */
      liveKlaviyo: boolean
    }

const sourceWords: Record<string, string> = {
  fixture: 'Sample sort',
  owner: 'Your correction'
}

const outcomeWords: Record<string, string> = {
  stored: 'Saved',
  duplicate: 'Already saved',
  failed: 'Not saved'
}

const diagnosticWords: Record<string, string> = {
  invalid_file: 'Not a PNG, JPEG or WebP image',
  storage_unavailable: 'File storage did not answer',
  metadata_unavailable: 'The file’s details could not be saved'
}

const jobKindWords: Record<string, string> = {
  'assets.classify': 'Sort the sample files',
  'drive.sync': 'Read the sample Drive folder',
  'commerce.sync': 'Read the sample catalog',
  'brand.extract': 'Read the brand kit text',
  'brand.read_site': 'Read your website',
  'brand.read_catalog': 'Read your Klaviyo catalog',
  'brand.read_history': 'Read your past Klaviyo emails',
  'brand.read_ads': 'Read your ads',
  'brand.read_reviews': 'Read your reviews'
}

const jobStatusWords: Record<string, string> = {
  queued: 'Waiting to run',
  retry_wait: 'Waiting to try again',
  leased: 'Running',
  running: 'Running',
  succeeded: 'Done',
  failed: 'Stopped',
  cancelled: 'Cancelled'
}

/** A setup job in the owner's words (never its raw kind or state). */
export function jobWords(job: {
  kind: string
  status: string
  attempt: number
  error_code: string | null
}) {
  return {
    title: jobKindWords[job.kind] ?? 'Another setup step',
    details: [
      jobStatusWords[job.status] ?? 'Waiting',
      `Try ${job.attempt} of 4`,
      job.error_code ? 'It hit a problem' : ''
    ]
  }
}

const connectionStatusWords: Record<string, string> = {
  connected: 'Connected',
  disconnected: 'Not connected',
  expired: 'Expired',
  error: 'Stopped working'
}
export const connectionStatuses = Object.keys(connectionStatusWords)

/** A sample connection's state in words, with when it was last read. */
export function connectionLine(
  c:
    | { status: string; last_sync_at: string | null; last_error: string | null }
    | undefined
) {
  const read = c?.last_sync_at ? new Date(c.last_sync_at) : null
  return [
    connectionStatusWords[c?.status ?? 'disconnected'] ?? 'Not connected',
    read && !Number.isNaN(read.getTime())
      ? `Last read ${new Intl.DateTimeFormat('en-US', {
          timeZone: 'UTC',
          dateStyle: 'medium',
          timeStyle: 'short'
        }).format(read)} UTC`
      : 'Not read yet',
    c?.last_error ? 'The last read hit a problem' : ''
  ]
    .filter(Boolean)
    .join(' · ')
}

export const connectionStatusWord = (status: string) =>
  connectionStatusWords[status] ?? status

const importSourceWords: Record<string, string> = {
  upload: 'Files',
  zip: 'ZIP',
  drive: 'Sample Drive folder'
}
const importStateWords: Record<string, string> = {
  started: 'uploading',
  running: 'uploading',
  complete: 'done',
  completed: 'done',
  failed: 'stopped'
}

const isCategory = (value: string | null): value is AssetCategory =>
  (assetCategories as readonly string[]).includes(value ?? '')

/** The filter in the address, or All. */
export function assetFilter(value: string | string[] | undefined): AssetFilter {
  return typeof value === 'string' &&
    (assetFilters as readonly string[]).includes(value)
    ? (value as AssetFilter)
    : 'all'
}

/** Files shown under a filter (Not sorted: no category yet). */
export function shownAssets<T extends { category: string | null }>(
  assets: readonly T[],
  filter: AssetFilter
): T[] {
  return assets.filter((a) =>
    filter === 'all'
      ? true
      : filter === 'pending'
        ? !a.category
        : a.category === filter
  )
}

export function assetTile(
  asset: AssetRow,
  products: readonly { id: string; title: string }[]
): AssetTile {
  const category = isCategory(asset.category) ? asset.category : null
  return {
    id: asset.id,
    filename: asset.filename,
    preview: asset.preview,
    revision: asset.revision,
    category,
    productId: asset.product_id,
    variantId: asset.variant_id,
    details: [
      category ? filterWords[category] : 'Not sorted',
      `v${asset.revision}`,
      asset.classification_source
        ? (sourceWords[asset.classification_source] ??
          asset.classification_source)
        : '',
      asset.synthetic ? 'Sample graphic' : ''
    ]
      .filter(Boolean)
      .join(' · '),
    match: `Match: ${
      products.find((p) => p.id === asset.product_id)?.title ?? 'none yet'
    }${asset.variant_id ? ' · variant matched' : ''}`
  }
}

export function assetsView(input: {
  owner: boolean
  filter: AssetFilter
  setup: SetupInput | null
  products: { id: string; title: string }[] | null
  liveKlaviyo: boolean
}): AssetsView {
  if (!input.setup || !input.products)
    return {
      state: 'error',
      reason:
        'We could not read your brand files just now. Your files are safe. Open this page again in a minute.'
    }
  const { setup, products } = input
  return {
    state: 'ready',
    owner: input.owner,
    filter: input.filter,
    total: setup.assets.length,
    tiles: shownAssets(setup.assets, input.filter).map((a) =>
      assetTile(a, products)
    ),
    products: products.map((p) => ({ id: p.id, title: p.title })),
    variants: setup.variants.map((v) => ({
      id: v.id,
      label: `${v.title} · ${v.sku}`
    })),
    uploads: setup.items.map((i) => ({
      id: i.id,
      filename: i.filename,
      outcome: outcomeWords[i.status] ?? i.status,
      diagnostic: i.error_code
        ? (diagnosticWords[i.error_code] ?? i.error_code)
        : null
    })),
    importsLine:
      setup.imports
        .map(
          (i) =>
            `${importSourceWords[i.source] ?? 'Upload'}: ${importStateWords[i.state] ?? 'in progress'}`
        )
        .join(' · ') || 'No uploads yet',
    kit: setup.kit,
    jobs: setup.jobs,
    readiness: setup.readiness,
    connections: setup.connections,
    liveKlaviyo: input.liveKlaviyo
  }
}
