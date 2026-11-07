import type { KlaviyoResponse, KlaviyoScope, KlaviyoTransport } from './client'

/**
 * Recorded Klaviyo answers (revision 2026-10-15) for contract tests: the
 * shapes of Klaviyo's published API with a made-up account ("Cedar Goods",
 * cedar.example). No real account, key or customer is in here.
 */

const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): KlaviyoResponse => ({
  status,
  headers: { 'content-type': 'application/vnd.api+json', ...headers },
  body: JSON.stringify(body)
})

export const recorded = {
  account: json(200, {
    data: [
      {
        type: 'account',
        id: 'CdrG01',
        attributes: {
          test_account: false,
          contact_information: {
            default_sender_name: 'Cedar Goods',
            default_sender_email: 'hello@cedar.example',
            website_url: 'https://cedar.example',
            organization_name: 'Cedar Goods',
            street_address: {
              address1: '1 Sample Street',
              address2: null,
              city: 'Springfield',
              region: 'OR',
              country: 'US',
              zip: '00000'
            }
          },
          industry: 'Apparel & Accessories',
          timezone: 'US/Pacific',
          preferred_currency: 'USD',
          locale: 'en-US'
        },
        links: { self: 'https://a.klaviyo.com/api/accounts/CdrG01/' }
      }
    ],
    links: { self: 'https://a.klaviyo.com/api/accounts/' }
  }),
  /** Any other probe: one record is enough to prove the scope. */
  page: (type: string) =>
    json(200, {
      data: [{ type, id: `${type}-1`, attributes: {} }],
      links: {
        self: `https://a.klaviyo.com/api/${type}s/`,
        next: null,
        prev: null
      }
    }),
  badKey: json(401, {
    errors: [
      {
        id: '1f0e2d3c-0000-4000-8000-000000000401',
        status: 401,
        code: 'authentication_failed',
        title: 'Incorrect authentication credentials.',
        detail: 'Incorrect authentication credentials.',
        source: { pointer: '/data/' }
      }
    ]
  }),
  noScope: json(403, {
    errors: [
      {
        id: '1f0e2d3c-0000-4000-8000-000000000403',
        status: 403,
        code: 'permission_denied',
        title: 'You do not have permission to perform this action.',
        detail: 'You do not have permission to perform this action.',
        source: { pointer: '/data/' }
      }
    ]
  }),
  throttled: (seconds: number) =>
    json(
      429,
      {
        errors: [
          {
            id: '1f0e2d3c-0000-4000-8000-000000000429',
            status: 429,
            code: 'throttled',
            title: 'Request was throttled.',
            detail: `Request was throttled. Expected available in ${seconds} seconds.`
          }
        ]
      },
      { 'retry-after': String(seconds) }
    ),
  down: json(503, { errors: [{ status: 503, code: 'service_unavailable' }] })
}

/** The scope each probe path proves. */
const scopeOfPath: [RegExp, KlaviyoScope][] = [
  [/^\/api\/accounts/, 'accounts:read'],
  [/^\/api\/catalog-items/, 'catalogs:read'],
  [/^\/api\/campaign-messages/, 'campaigns:read'],
  [/^\/api\/events/, 'events:read'],
  [/^\/api\/lists/, 'lists:read'],
  [/^\/api\/metrics/, 'metrics:read'],
  [/^\/api\/segments/, 'segments:read'],
  [/^\/api\/templates/, 'templates:read'],
  [/^\/api\/images/, 'images:read']
]

/**
 * A transport that answers from the recordings: every probe succeeds,
 * except the scopes in `missing` (403), or every call answers `all`.
 */
export function recordedTransport(
  scenario: { missing?: KlaviyoScope[]; all?: KlaviyoResponse } = {}
): KlaviyoTransport & { calls: string[] } {
  const calls: string[] = []
  const transport = (async (request) => {
    const url = new URL(request.url)
    calls.push(`${request.method} ${url.pathname}${url.search}`)
    if (scenario.all) return scenario.all
    const scope = scopeOfPath.find(([path]) => path.test(url.pathname))?.[1]
    if (scope && scenario.missing?.includes(scope)) return recorded.noScope
    if (scope === 'accounts:read') return recorded.account
    return recorded.page(
      url.pathname.split('/')[2]?.replace(/s$/, '') ?? 'item'
    )
  }) as KlaviyoTransport & { calls: string[] }
  transport.calls = calls
  return transport
}
