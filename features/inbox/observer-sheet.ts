import 'server-only'
import { createHash, createSign } from 'node:crypto'
import { InboundTransportError } from '@/lib/providers/inbound-capture'

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
