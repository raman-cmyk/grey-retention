import 'server-only'
import { createHash, createSign } from 'node:crypto'
import { InboundTransportError } from '@/lib/providers/inbound-capture'
import { bareAddress } from './addresses'

export type ObserverEmail = {
  id: string
  domain: string
  alias: string
  sender: string
  gmailId: string
  messageId: string
}
export type ObserverSelection = { read(): Promise<ObserverEmail[]> }
const schema = 'observer-email-review-v1'
const idShape = /^[a-zA-Z0-9_-]{1,80}$/
const domainShape = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/
const brandSchema = 'observer-brand-review-v1'
type BrandRating = { domain: string; rating: unknown; reviewer: string }

function brandRatings(values?: unknown[][]) {
  const out = new Map<string, BrandRating>()
  if (!values) return out
  const header = values[0] ?? []
  for (const [i, name] of [
    [0, 'Brand ID'],
    [1, 'Domain'],
    [2, 'Brand rating'],
    [3, 'Reviewer'],
    [8, 'Schema version']
  ] as const)
    if (header[i] !== name) throw failed()
  const ids = new Map<string, number>(),
    domains = new Map<string, number>()
  for (const r of values.slice(1)) {
    if (r[0]) ids.set(String(r[0]), (ids.get(String(r[0])) ?? 0) + 1)
    if (r[1]) domains.set(String(r[1]), (domains.get(String(r[1])) ?? 0) + 1)
  }
  for (const r of values.slice(1)) {
    const id = String(r[0] ?? ''),
      domain = String(r[1] ?? '')
    if (
      ids.get(id) === 1 &&
      domains.get(domain) === 1 &&
      idShape.test(id) &&
      domainShape.test(domain) &&
      domain.length <= 253 &&
      r[8] === brandSchema
    )
      out.set(id, { domain, rating: r[2], reviewer: String(r[3] ?? '').trim() })
  }
  return out
}
export const observerEnabled = (
  env: Record<string, string | undefined> = process.env
) => !!env.OBSERVER_SOURCE?.trim() && env.OBSERVER_SOURCE.trim() !== 'off'
const failed = () =>
  new InboundTransportError('unavailable', 'observer_sheet_unavailable')

/** A public handoff schema, independently implemented for the GROS reader.
 * Computed eligibility cells are never an authorization decision.
 */
export function selectedObserverRows(
  values: unknown[][],
  brandValues?: unknown[][]
): ObserverEmail[] {
  const brands = brandRatings(brandValues)
  const header = values[0] ?? []
  for (const [i, name] of [
    [0, 'Email ID'],
    [1, 'Brand ID'],
    [2, 'Domain'],
    [6, 'Audit alias'],
    [7, 'Gmail message ID'],
    [8, 'RFC822 Message-ID'],
    [12, 'Human rating'],
    [13, 'Reviewer'],
    [21, 'Schema version']
  ] as const)
    if (header[i] !== name) throw failed()
  const counts = new Map<string, number>()
  for (const r of values.slice(1))
    if (r[0]) counts.set(String(r[0]), (counts.get(String(r[0])) ?? 0) + 1)
  return values.slice(1).flatMap((r) => {
    const id = String(r[0] ?? ''),
      domain = String(r[2] ?? ''),
      alias = String(r[6] ?? '').toLowerCase(),
      sender = bareAddress(String(r[4] ?? '')),
      gmailId = String(r[7] ?? ''),
      messageId = String(r[8] ?? '')
    const brand = brands.get(String(r[1] ?? '')),
      override = r[12] !== '' && r[12] != null,
      matchingBrand = brand?.domain === domain ? brand : undefined,
      rating = override ? r[12] : matchingBrand?.rating,
      reviewer = override ? String(r[13] ?? '').trim() : matchingBrand?.reviewer
    if (
      counts.get(id) !== 1 ||
      !idShape.test(id) ||
      !r[1] ||
      !sender ||
      !domainShape.test(domain) ||
      domain.length > 253 ||
      rating !== 'Exemplary' ||
      !reviewer ||
      r[21] !== schema ||
      ['confirmation', 'transactional'].includes(
        String(r[11] ?? '').toLowerCase()
      )
    )
      return []
    if (!/^[^@\s]+\+greyobserver-[^@\s]+@gmail\.com$/.test(alias)) return []
    if (
      !/^[a-f0-9]{1,16}$/.test(gmailId) &&
      !/^<[^<>\s\x00-\x1f]+@[^<>\s\x00-\x1f]+>$/.test(messageId)
    )
      return []
    return [
      {
        id,
        domain,
        alias,
        sender,
        gmailId,
        messageId
      }
    ]
  })
}

/** Credentials stay server-side. A Sheet token is cached only until expiry;
 * ratings themselves are read fresh, never cached across requests.
 */
export function observerSelection(
  env: Record<string, string | undefined> = process.env,
  request: typeof fetch = fetch
): ObserverSelection {
  if (env.OBSERVER_SOURCE?.trim() && env.OBSERVER_SOURCE.trim() !== 'sheet')
    throw failed()
  let credential: { client_email: string; private_key: string }
  try {
    credential = JSON.parse(env.OBSERVER_SHEETS_SERVICE_ACCOUNT ?? '')
  } catch {
    throw failed()
  }
  const sheet = env.OBSERVER_SPREADSHEET_ID ?? ''
  if (
    !/^[\w-]+$/.test(sheet) ||
    !credential.client_email?.endsWith('.gserviceaccount.com') ||
    !credential.private_key?.includes('BEGIN PRIVATE KEY')
  )
    throw failed()
  let token = '',
    expires = 0
  // Grid bounds are a snapshot for this source instance; rating values are
  // always fetched again. New rows become visible in the next source instance.
  let metadataRead: Promise<Awaited<ReturnType<typeof read>>> | undefined
  const read = async (url: string) => {
    try {
      if (Date.now() >= expires) {
        const issued = Math.floor(Date.now() / 1000)
        const encode = (v: unknown) =>
          Buffer.from(JSON.stringify(v)).toString('base64url')
        const unsigned =
          encode({ alg: 'RS256', typ: 'JWT' }) +
          '.' +
          encode({
            iss: credential.client_email,
            scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
            aud: 'https://oauth2.googleapis.com/token',
            iat: issued,
            exp: issued + 3500
          })
        const sign = createSign('RSA-SHA256')
          .update(unsigned)
          .sign(credential.private_key)
          .toString('base64url')
        const response = await request('https://oauth2.googleapis.com/token', {
          method: 'POST',
          body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: unsigned + '.' + sign
          }),
          signal: AbortSignal.timeout(8000),
          cache: 'no-store'
        })
        if (!response.ok) throw failed()
        const value = await response.json()
        if (typeof value.access_token !== 'string') throw failed()
        token = value.access_token
        expires = Date.now() + 3000000
      }
      const response = await request(url, {
        headers: { Authorization: 'Bearer ' + token },
        signal: AbortSignal.timeout(8000),
        cache: 'no-store'
      })
      if (!response.ok) throw failed()
      return await response.json()
    } catch {
      throw failed()
    }
  }
  return {
    async read() {
      const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + sheet
      metadataRead ??= read(
        base + '?fields=sheets(properties(title,gridProperties))'
      ).catch((error) => {
        metadataRead = undefined
        throw error
      })
      const metadata = await metadataRead
      const grid = metadata.sheets?.find(
        (s: { properties: { title: string } }) =>
          s.properties.title === 'Email review'
      )?.properties.gridProperties
      if (!grid || grid.columnCount < 22 || grid.rowCount < 6) throw failed()
      const brandGrid = metadata.sheets?.find(
        (s: { properties: { title: string } }) =>
          s.properties.title === 'Brand ratings'
      )?.properties.gridProperties
      if (brandGrid && (brandGrid.columnCount < 9 || brandGrid.rowCount < 6))
        throw failed()
      const values: unknown[][] = [],
        brands: unknown[][] = [],
        pages: { range: string; brand: boolean }[] = []
      for (const spec of [
        { title: 'Email review', grid, last: 'V', brand: false },
        ...(brandGrid
          ? [
              {
                title: 'Brand ratings',
                grid: brandGrid,
                last: 'I',
                brand: true
              }
            ]
          : [])
      ])
        for (let first = 6; first <= spec.grid.rowCount; first += 5000)
          pages.push({
            range: `'${spec.title}'!A${first}:${spec.last}${Math.min(first + 4999, spec.grid.rowCount)}`,
            brand: spec.brand
          })
      for (let i = 0; i < pages.length; i += 4) {
        const batch = pages.slice(i, i + 4),
          response = await read(
            base +
              '/values:batchGet?valueRenderOption=UNFORMATTED_VALUE&' +
              batch
                .map((p) => 'ranges=' + encodeURIComponent(p.range))
                .join('&')
          )
        if (
          !Array.isArray(response.valueRanges) ||
          response.valueRanges.length !== batch.length
        )
          throw failed()
        for (let j = 0; j < batch.length; j++)
          (batch[j].brand ? brands : values).push(
            ...(response.valueRanges[j].values ?? [])
          )
      }
      return selectedObserverRows(values, brandGrid ? brands : undefined)
    }
  }
}

export function selectionVersion(rows: ObserverEmail[]) {
  return (
    Number.parseInt(
      createHash('sha256')
        .update(
          JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)))
        )
        .digest('hex')
        .slice(0, 12),
      16
    ) || 1
  )
}
