import 'server-only'
import { createSign } from 'node:crypto'
import { InboundTransportError } from '@/lib/providers/inbound-capture'

/**
 * Google access for the writer of brand requests (GROS-INS-002, the one
 * "GROS requests" tab of the Observer Sheet). The reader of human ratings
 * (`observer-sheet.ts`) keeps its own read-only sign-in. Credentials stay
 * server-side; a token is cached only until shortly before it expires, and
 * every answer is read fresh.
 */
export type ServiceAccount = { client_email: string; private_key: string }

export const writeScope = 'https://www.googleapis.com/auth/spreadsheets'

export const sheetUnavailable = (code = 'observer_sheet_unavailable') =>
  new InboundTransportError('unavailable', code)

type Env = Record<string, string | undefined>

/** The workbook and its service account, or null when either is malformed. */
export function observerSheetConfig(
  env: Env = process.env
): { sheet: string; credential: ServiceAccount } | null {
  let credential: Partial<ServiceAccount>
  try {
    credential = JSON.parse(env.OBSERVER_SHEETS_SERVICE_ACCOUNT ?? '')
  } catch {
    return null
  }
  const sheet = env.OBSERVER_SPREADSHEET_ID ?? ''
  if (
    !/^[\w-]+$/.test(sheet) ||
    typeof credential?.client_email !== 'string' ||
    typeof credential.private_key !== 'string' ||
    !credential.client_email.endsWith('.gserviceaccount.com') ||
    !credential.private_key.includes('BEGIN PRIVATE KEY')
  )
    return null
  return {
    sheet,
    credential: {
      client_email: credential.client_email,
      private_key: credential.private_key
    }
  }
}

/**
 * JSON from the Sheets API with a service-account token for one scope.
 * Any failure (token, network, refusal, timeout) is the given error, never
 * the provider's own message.
 */
export function googleJson(
  credential: ServiceAccount,
  scope: string,
  request: typeof fetch = fetch,
  failure: () => Error = () => sheetUnavailable(),
  /** Ends every call at once when the caller's time is up. */
  stop?: AbortSignal
) {
  const signal = () =>
    stop
      ? AbortSignal.any([AbortSignal.timeout(8000), stop])
      : AbortSignal.timeout(8000)
  let token = '',
    expires = 0
  return async (url: string, init: RequestInit = {}) => {
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
            scope,
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
          signal: signal(),
          cache: 'no-store'
        })
        if (!response.ok) throw failure()
        const value = await response.json()
        if (typeof value.access_token !== 'string') throw failure()
        token = value.access_token
        expires = Date.now() + 3000000
      }
      const response = await request(url, {
        ...init,
        headers: {
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          Authorization: 'Bearer ' + token
        },
        signal: signal(),
        cache: 'no-store'
      })
      if (!response.ok) throw failure()
      return await response.json()
    } catch {
      throw failure()
    }
  }
}
