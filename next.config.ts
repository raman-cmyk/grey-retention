import type { NextConfig } from 'next'

const isDevelopment = process.env.NODE_ENV === 'development'

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' blob: data: https:${isDevelopment ? ' http://127.0.0.1:54321' : ''}`,
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(!isDevelopment ? ['upgrade-insecure-requests'] : [])
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()'
  },
  ...(isDevelopment
    ? []
    : [
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload'
        }
      ])
]

/**
 * UI-OLDc: old client pages and the GROS screen that replaces each. A
 * page whose job a GROS screen does opens it; a page the v2 brief dropped
 * opens the closest one (the bill optimizer, the old reports).
 */
const oldClientPages: [source: string, destination: string][] = [
  // "Use this design" and the draft it saves.
  ['/first-draft', '/inspiration/use'],
  ['/campaigns/:campaignId', '/plan/draft/:campaignId'],
  // The Klaviyo key is on Settings.
  ['/connections', '/settings'],
  // Results replaces "Results & learning".
  ['/reports', '/results'],
  // Following brands and their emails are on Inspiration.
  ['/competitor-agent', '/inspiration'],
  ['/competitor-agent/:subscriptionId', '/inspiration'],
  ['/email-library', '/inspiration'],
  ['/email-library/:emailId', '/inspiration/use?reference=:emailId'],
  // The old campaign calendar: the next 15 days are the Plan.
  ['/campaign-agent', '/plan'],
  // Onboarding is Setup (UI-ONBb..e).
  ['/get-started', '/setup'],
  // Not part of v2: the closest GROS screen.
  ['/optimizer', '/settings'],
  // UI-BRAND: Brand and Brand assets are GROS pages under Settings. The
  // old Copy & Voice address opens the Tone of voice card; the old Store
  // tab (Shopify, hidden in v2) opens Brand as it did.
  ['/brand', '/settings/brand'],
  ['/brand/voice', '/settings/brand#tone'],
  ['/store', '/settings/brand'],
  ['/assets', '/settings/assets']
]

/** UI-KLV: the old Klaviyo detail pages and their GROS pages under Results. */
const klaviyoPages: [source: string, destination: string][] = [
  ['/campaigns/klaviyo/:campaignId', '/results/campaigns/:campaignId'],
  ['/flows/:flowId', '/results/flows/:flowId'],
  ['/flow-messages/:messageId', '/results/flow-emails/:messageId'],
  ['/metrics/:metricId', '/results/metrics/:metricId']
]

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  // The IMAP client (INB-001) loads its parts at run time; keep it unbundled.
  serverExternalPackages: ['imapflow'],
  experimental: { serverActions: { bodySizeLimit: '12mb' } },
  // UI-HOMEb: the old dashboard is retired; its address (and old
  // bookmarks and emails pointing at it) opens Home.
  async redirects() {
    return [
      { source: '/dashboard', destination: '/home', permanent: false },
      // UI-INSa: the old inspirations library is Inspiration now.
      {
        source: '/library/inspirations',
        destination: '/inspiration',
        permanent: false
      },
      // UI-SETc: the old Team page is retired; the team and who changed
      // what are on Settings.
      { source: '/team', destination: '/settings', permanent: false },
      // UI-SETd: holidays and events are a page under Settings.
      {
        source: '/holidays',
        destination: '/settings/holidays',
        permanent: false
      },
      // UI-SETd: support and feature requests are cards on Settings.
      { source: '/support', destination: '/settings', permanent: false },
      { source: '/feedback', destination: '/settings', permanent: false },
      // UI-AUTH: the old Profile page is Account, a GROS page under Settings.
      {
        source: '/profile',
        destination: '/settings/account',
        // Not cached by browsers while the GROS routes settle.
        permanent: false
      },
      // UI-AUDc: a segment's and a list's page are under Audiences, on the
      // GROS screens; old links (and bookmarks) open the new page.
      {
        source: '/segments/:segmentId',
        destination: '/audiences/segments/:segmentId',
        // Not permanent while the routes settle (a browser keeps a 308).
        permanent: false
      },
      {
        source: '/lists/:listId',
        destination: '/audiences/lists/:listId',
        permanent: false
      },
      // UI-KLV: a Klaviyo campaign's, a flow's, a flow email's and a
      // metric's page are GROS pages under Results; old links (and
      // bookmarks) open the new page, query strings passed on.
      ...klaviyoPages.map(([source, destination]) => ({
        source,
        destination,
        permanent: false
      })),
      // UI-OLDc: the last old client pages, each opening the GROS screen
      // that does its job now (old links, bookmarks and the old shell's
      // menu land there; query strings are passed on).
      ...oldClientPages.map(([source, destination]) => ({
        source,
        destination,
        // Temporary, like /support and /feedback: a browser never keeps
        // them, so a page that comes back later is not hidden.
        permanent: false
      }))
    ]
  },
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
      // Email downloads are untrusted markup: later rules win, so the
      // attachment keeps an opaque sandbox instead of the app policy.
      ...[
        '/api/v1/emails/:resultId/export',
        '/api/v1/email-imports/:importId/file'
      ].map((source) => ({
        source,
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "sandbox; default-src 'none'"
          }
        ]
      }))
    ]
  }
}

export default nextConfig
