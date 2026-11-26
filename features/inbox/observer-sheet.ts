import 'server-only'
import { createHash } from 'node:crypto'
import { InboundTransportError } from '@/lib/providers/inbound-capture'
import { googleJson, observerSheetConfig, readScope } from './observer-google'

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
export const observerEnabled = (
  env: Record<string, string | undefined> = process.env
) => !!env.OBSERVER_SOURCE?.trim() && env.OBSERVER_SOURCE.trim() !== 'off'
const failed = () =>
  new InboundTransportError('unavailable', 'observer_sheet_unavailable')

/** A public handoff schema, independently implemented for the GROS reader.
 * Computed eligibility cells are never an authorization decision.
 */
export function selectedObserverRows(values: unknown[][]): ObserverEmail[] {
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
      gmailId = String(r[7] ?? ''),
      messageId = String(r[8] ?? '')
    if (
      counts.get(id) !== 1 ||
      !idShape.test(id) ||
      !r[1] ||
      !domainShape.test(domain) ||
      domain.length > 253 ||
      r[12] !== 'Exemplary' ||
      !String(r[13] ?? '').trim() ||
      r[21] !== schema ||
      r[11] === 'confirmation'
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
        sender: String(r[4] ?? '').toLowerCase(),
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
  const config = observerSheetConfig(env)
  if (!config) throw failed()
  const { sheet } = config
  const read = googleJson(config.credential, readScope, request, failed)
  return {
    async read() {
      const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + sheet
      const metadata = await read(
        base + '?fields=sheets(properties(title,gridProperties))'
      )
      const grid = metadata.sheets?.find(
        (s: { properties: { title: string } }) =>
          s.properties.title === 'Email review'
      )?.properties.gridProperties
      if (!grid || grid.columnCount < 22 || grid.rowCount < 6) throw failed()
      const values: unknown[][] = []
      for (let first = 6; first <= grid.rowCount; first += 5000) {
        const range =
          "'Email review'!A" +
          first +
          ':V' +
          Math.min(first + 4999, grid.rowCount)
        const page = await read(
          base +
            '/values/' +
            encodeURIComponent(range) +
            '?valueRenderOption=UNFORMATTED_VALUE'
        )
        values.push(...(page.values ?? []))
      }
      return selectedObserverRows(values)
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
