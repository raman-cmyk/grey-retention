// @vitest-environment node
import { generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import {
  newRequestRows,
  requestsHeader,
  runObserverRequests,
  syncObserverRequests,
  verifiedBrands
} from './observer-requests'

afterEach(() => vi.clearAllMocks())

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' }
})
const env = {
  OBSERVER_SOURCE: 'sheet',
  OBSERVER_SPREADSHEET_ID: 'sheet-test',
  OBSERVER_SHEETS_SERVICE_ACCOUNT: JSON.stringify({
    client_email: 'gros@example.iam.gserviceaccount.com',
    private_key: privateKey
  })
}

/** Brands tab rows from row 6: the header, then brands. */
function brandsTab(rows: [string, string][]) {
  const header = Array.from({ length: 11 }, () => '')
  header[0] = 'Brand ID'
  header[1] = 'Domain'
  header[10] = 'Signup status'
  return [
    header,
    ...rows.map(([domain, signup], i) => {
      const r = Array.from({ length: 11 }, () => '')
      r[0] = String(i + 1)
      r[1] = domain
      r[10] = signup
      return r
    })
  ]
}

/** A database with pending captures and their active followers. */
function database(
  captures: { id: string; domain: string; pending_since: string }[],
  followers: string[]
) {
  const updates: { values: unknown; filters: unknown[][] }[] = []
  const from = (table: string) => {
    const filters: unknown[][] = []
    let update: unknown = null
    const result = () =>
      table === 'competitor_captures'
        ? {
            data: captures.map((c) => ({ ...c, created_at: c.pending_since })),
            error: null
          }
        : { data: followers.map((capture_id) => ({ capture_id })), error: null }
    const chain: Record<string, unknown> = {}
    for (const name of ['select', 'eq', 'order', 'limit', 'in'])
      chain[name] = (...args: unknown[]) => {
        filters.push([name, ...args])
        return chain
      }
    chain.update = (values: unknown) => {
      update = values
      return chain
    }
    chain.then = (resolve: (v: unknown) => void) => {
      if (update) {
        updates.push({ values: update, filters })
        return resolve({ error: null })
      }
      return resolve(result())
    }
    return chain
  }
  return { db: { from } as never, updates }
}

/** A fake Google: the token, the workbook, its tabs and what was written. */
function google(options: {
  tabs: string[]
  requests?: unknown[][]
  brands?: unknown[][]
  fail?: (url: string) => boolean
}) {
  const writes: { method: string; url: string; body: unknown }[] = []
  const request = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = decodeURIComponent(String(input))
      if (options.fail?.(url)) return new Response('no', { status: 403 })
      if (url.includes('oauth2.')) {
        const assertion = (init?.body as URLSearchParams).get('assertion')!
        const claim = JSON.parse(
          Buffer.from(assertion.split('.')[1], 'base64url').toString()
        )
        expect(claim.scope).toBe('https://www.googleapis.com/auth/spreadsheets')
        return Response.json({ access_token: 'private-token' })
      }
      if (init?.method && init.method !== 'GET') {
        writes.push({
          method: init.method,
          url,
          body: JSON.parse(String(init.body))
        })
        return Response.json({})
      }
      if (url.includes("'GROS requests'!A1:D"))
        return Response.json({ values: options.requests ?? [] })
      if (url.includes("'Brands'!A6:K"))
        return Response.json({ values: options.brands ?? brandsTab([]) })
      return Response.json({
        sheets: options.tabs.map((title) => ({ properties: { title } }))
      })
    }
  )
  return { request: request as unknown as typeof fetch, writes, calls: request }
}

describe('brand requests for Grey Observer (GROS-INS-002)', () => {
  it('lists only new requests, oldest first, as plain cells', () => {
    expect(
      newRequestRows(
        [
          {
            domain: 'b.com',
            requestedAt: '2026-11-26T13:05:00Z',
            workspaces: 2
          },
          {
            domain: 'a.com',
            requestedAt: '2026-11-26T12:40:00Z',
            workspaces: 1
          },
          {
            domain: 'old.com',
            requestedAt: '2026-11-20T09:00:00Z',
            workspaces: 1
          }
        ],
        new Set(['old.com'])
      )
    ).toEqual([
      ['a.com', '2026-11-26 12:40', '1', 'gros-brand-requests-v1'],
      ['b.com', '2026-11-26 13:05', '2', 'gros-brand-requests-v1']
    ])
  })

  it('reads verified sign-ups from the Brands tab and refuses an unknown layout', () => {
    expect(
      verifiedBrands(
        brandsTab([
          ['Signed.com', 'Verified'],
          ['waiting.com', 'Unverified']
        ])
      )
    ).toEqual(new Set(['signed.com']))
    expect(() => verifiedBrands([['Domain', 'Brand ID']])).toThrow()
  })

  it('does nothing while the Observer source is off', async () => {
    const { db } = database([], [])
    const g = google({ tabs: [] })
    expect(
      await syncObserverRequests(db, { env: {}, request: g.request })
    ).toEqual({ state: 'off' })
    expect(g.calls).not.toHaveBeenCalled()
  })

  it('creates the tab once, appends each new request and marks verified ones subscribed', async () => {
    const { db, updates } = database(
      [
        {
          id: 'c1',
          domain: 'newbrand.com',
          pending_since: '2026-11-26T12:40:00Z'
        },
        {
          id: 'c2',
          domain: 'signed.com',
          pending_since: '2026-11-25T08:00:00Z'
        },
        // Nobody follows it any more: not handed over.
        {
          id: 'c3',
          domain: 'dropped.com',
          pending_since: '2026-11-24T08:00:00Z'
        }
      ],
      ['c1', 'c1', 'c2']
    )
    const g = google({
      tabs: ['Brands', 'Email review'],
      brands: brandsTab([['signed.com', 'Verified']])
    })
    expect(await syncObserverRequests(db, { env, request: g.request })).toEqual(
      { state: 'done', pending: 2, sent: 2, subscribed: 1 }
    )
    expect(g.writes.map((w) => w.method)).toEqual(['POST', 'PUT', 'POST'])
    expect(g.writes[0].body).toEqual({
      requests: [{ addSheet: { properties: { title: 'GROS requests' } } }]
    })
    expect(g.writes[1].url).toContain('valueInputOption=RAW')
    expect(g.writes[1].body).toEqual({ values: [requestsHeader] })
    expect(g.writes[2].url).toContain(':append?valueInputOption=RAW')
    expect(g.writes[2].body).toEqual({
      values: [
        ['signed.com', '2026-11-25 08:00', '1', 'gros-brand-requests-v1'],
        ['newbrand.com', '2026-11-26 12:40', '2', 'gros-brand-requests-v1']
      ]
    })
    // Only GROS's own tab is ever written.
    for (const w of g.writes.slice(1))
      expect(w.url).toContain("'GROS requests'!")
    expect(updates).toHaveLength(1)
    expect(updates[0].values).toEqual({ subscription_status: 'subscribed' })
    expect(updates[0].filters).toContainEqual(['in', 'domain', ['signed.com']])
    expect(updates[0].filters).toContainEqual([
      'eq',
      'subscription_status',
      'pending'
    ])
  })

  it('never appends a website the tab already lists, and stops on a changed tab', async () => {
    const { db } = database(
      [
        {
          id: 'c1',
          domain: 'newbrand.com',
          pending_since: '2026-11-26T12:40:00Z'
        }
      ],
      ['c1']
    )
    const listed = google({
      tabs: ['GROS requests'],
      requests: [[...requestsHeader], ['newbrand.com', '2026-11-26 12:40', '1']]
    })
    expect(
      await syncObserverRequests(db, { env, request: listed.request })
    ).toEqual({ state: 'done', pending: 1, sent: 0, subscribed: 0 })
    expect(listed.writes).toEqual([])
    const changed = google({
      tabs: ['GROS requests'],
      requests: [['Website', 'When']]
    })
    await expect(
      syncObserverRequests(db, { env, request: changed.request })
    ).rejects.toMatchObject({ code: 'observer_requests_layout' })
    expect(changed.writes).toEqual([])
  })

  it('reports a refused Sheet without its message, and never throws in the sweep', async () => {
    const { db } = database(
      [
        {
          id: 'c1',
          domain: 'newbrand.com',
          pending_since: '2026-11-26T12:40:00Z'
        }
      ],
      ['c1']
    )
    const refused = google({
      tabs: ['GROS requests'],
      fail: (url) => url.includes(':append')
    })
    await expect(
      syncObserverRequests(db, { env, request: refused.request })
    ).rejects.toMatchObject({ code: 'observer_requests_unavailable' })
    expect(
      await runObserverRequests(db, () =>
        syncObserverRequests(db, { env, request: refused.request })
      )
    ).toEqual({ state: 'failed', code: 'observer_requests_unavailable' })
    expect(
      await runObserverRequests(db, () => new Promise(() => {}), 5)
    ).toEqual({ state: 'failed', code: 'observer_requests_timeout' })
    await expect(
      syncObserverRequests(db, {
        env: { ...env, OBSERVER_SHEETS_SERVICE_ACCOUNT: 'not json' }
      })
    ).rejects.toMatchObject({ code: 'observer_requests_config' })
  })
})
