import { validTimezone } from '@/lib/brand-time'
import type {
  AudienceRef,
  DailyRevenue,
  KlaviyoCampaign,
  KlaviyoFlow,
  KlaviyoReadProvider,
  KlaviyoSnapshot,
  Money
} from './klaviyo-read'

/**
 * Deterministic SAMPLE Klaviyo data for the fake provider. Every name is
 * fictional, and dates are relative to `now`, so the dashboard always looks
 * current. Totals are derived from the rows, so the KPI strip, the revenue
 * chart and the tabs always agree (docs/OWNER_JOURNEYS.md §3 friction).
 */

const DAY = 24 * 3600 * 1000

function iso(now: Date, daysAgo: number, hour = 10, minute = 0) {
  const date = new Date(now.getTime() - daysAgo * DAY)
  date.setUTCHours(hour, minute, 0, 0)
  // Never in the future for "past" records (before 10:00 UTC, for example).
  if (daysAgo >= 0 && date > now) date.setTime(now.getTime() - 60_000)
  return date.toISOString()
}

/** The last `count` calendar days in `timezone`, oldest first (DST-safe). */
export function lastDays(now: Date, timezone: string, count: number) {
  const [y, m, d] = dayKey(now, timezone).split('-').map(Number)
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(y, m - 1, d - (count - 1 - i))).toISOString().slice(0, 10)
  )
}

function dayKey(value: string | Date, timezone: string) {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: validTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

const money = (minor: number, currency: string): Money => ({
  minor: Math.round(minor),
  currency
})

function sampleEmail(title: string, body: string) {
  return `<!doctype html><html><head><title>${title}</title></head><body style="margin:0;background:#f4f1ec;font-family:Georgia,serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:40px"><tr><td><p style="font:12px sans-serif;letter-spacing:2px;color:#8a8580;text-transform:uppercase">Sample store</p><h1 style="font-size:32px;font-weight:400;color:#111">${title}</h1><p style="font:16px/1.6 sans-serif;color:#333">${body}</p><p><a href="https://shop.example/sale" style="display:inline-block;background:#111;color:#fff;padding:14px 24px;text-decoration:none;font:14px sans-serif">Shop now</a></p><p style="font:11px sans-serif;color:#8a8580">Sample email. <a href="https://shop.example/unsubscribe">Unsubscribe</a></p></td></tr></table></td></tr></table></body></html>`
}

export function sampleKlaviyoSnapshot({
  now = new Date(),
  timezone,
  currency = 'USD'
}: {
  now?: Date
  timezone: string
  currency?: string
}): KlaviyoSnapshot {
  const m = (minor: number) => money(minor, currency)
  const lists = [
    {
      id: 'LSTnews01',
      name: 'Newsletter',
      optIn: 'double' as const,
      profileCount: 16520,
      created: iso(now, 420),
      updated: iso(now, 2)
    },
    {
      id: 'LSTvip002',
      name: 'VIP early access',
      optIn: 'single' as const,
      profileCount: 1840,
      created: iso(now, 300),
      updated: iso(now, 9)
    },
    {
      id: 'LSTpop003',
      name: 'Pop-up signups',
      optIn: 'single' as const,
      profileCount: 5210,
      created: iso(now, 210),
      updated: iso(now, 1)
    },
    {
      id: 'LSTwhl004',
      name: 'Wholesale enquiries',
      optIn: 'double' as const,
      profileCount: 96,
      created: iso(now, 180),
      updated: iso(now, 40)
    }
  ]
  const segments = [
    {
      id: 'SEGeng030',
      name: 'Engaged 30 days',
      starred: true,
      active: true,
      profileCount: 4210,
      rules: 'Opened an email in the last 30 days.',
      definition: {
        condition_groups: [
          {
            conditions: [
              {
                type: 'profile-metric',
                metric: 'Opened Email',
                timeframe: 'in-the-last',
                quantity: 30,
                unit: 'day'
              }
            ]
          }
        ]
      },
      created: iso(now, 400),
      updated: iso(now, 1)
    },
    {
      id: 'SEGeng090',
      name: 'Engaged 90 days',
      starred: false,
      active: true,
      profileCount: 7930,
      rules: 'Opened an email in the last 90 days.',
      definition: {
        condition_groups: [
          {
            conditions: [
              {
                type: 'profile-metric',
                metric: 'Opened Email',
                timeframe: 'in-the-last',
                quantity: 90,
                unit: 'day'
              }
            ]
          }
        ]
      },
      created: iso(now, 400),
      updated: iso(now, 1)
    },
    {
      id: 'SEGrep002',
      name: 'Repeat buyers',
      starred: true,
      active: true,
      profileCount: 1260,
      rules: 'Placed 2 or more orders, ever.',
      definition: {
        condition_groups: [
          {
            conditions: [
              {
                type: 'profile-metric',
                metric: 'Placed Order',
                measurement: 'count',
                operator: 'greater-than-or-equal',
                value: 2
              }
            ]
          }
        ]
      },
      created: iso(now, 350),
      updated: iso(now, 3)
    },
    {
      id: 'SEGone001',
      name: 'Purchased once',
      starred: false,
      active: true,
      profileCount: 2980,
      rules: 'Placed exactly 1 order, ever.',
      definition: {
        condition_groups: [
          {
            conditions: [
              {
                type: 'profile-metric',
                metric: 'Placed Order',
                measurement: 'count',
                operator: 'equals',
                value: 1
              }
            ]
          }
        ]
      },
      created: iso(now, 350),
      updated: iso(now, 3)
    },
    {
      id: 'SEGwin180',
      name: 'Winback 180 days',
      starred: false,
      active: true,
      profileCount: 640,
      rules: 'Last placed an order more than 180 days ago.',
      definition: {
        condition_groups: [
          {
            conditions: [
              {
                type: 'profile-metric',
                metric: 'Placed Order',
                timeframe: 'before',
                quantity: 180,
                unit: 'day'
              }
            ]
          }
        ]
      },
      created: iso(now, 250),
      updated: iso(now, 6)
    },
    {
      id: 'SEGnvr000',
      name: 'Never purchased',
      starred: false,
      active: true,
      profileCount: 10950,
      rules: 'Has never placed an order.',
      definition: {
        condition_groups: [
          {
            conditions: [
              {
                type: 'profile-metric',
                metric: 'Placed Order',
                measurement: 'count',
                operator: 'equals',
                value: 0
              }
            ]
          }
        ]
      },
      created: iso(now, 250),
      updated: iso(now, 6)
    }
  ]
  const ref = (id: string): AudienceRef => {
    const list = lists.find((l) => l.id === id)
    if (list) return { id, name: list.name, kind: 'list' }
    const segment = segments.find((s) => s.id === id)!
    return { id, name: segment.name, kind: 'segment' }
  }
  const campaign = (
    id: string,
    name: string,
    status: KlaviyoCampaign['status'],
    sendDaysAgo: number | null,
    revenue: number | null,
    recipients: number,
    included: string[],
    excluded: string[],
    subject: string
  ): KlaviyoCampaign => {
    const sendTime = sendDaysAgo === null ? null : iso(now, sendDaysAgo, 22, 15)
    const sent = status === 'sent'
    return {
      id,
      name,
      localTime: id === 'CMPhol007',
      sendStrategy: 'static',
      fromEmail: 'hello@shop.example',
      status,
      sendTime,
      subject,
      previewText: 'A sample preview line for this email.',
      fromLabel: 'Sample Store',
      included: included.map(ref),
      excluded: excluded.map(ref),
      revenue30d: sent && revenue !== null ? m(revenue) : null,
      stats: sent
        ? {
            recipients,
            opens: Math.round(recipients * 0.41),
            clicks: Math.round(recipients * 0.027),
            orders: Math.max(1, Math.round((revenue ?? 0) / 6200)),
            revenue: m(revenue ?? 0)
          }
        : null,
      templateName: `${name} v1`,
      html: sampleEmail(
        subject,
        'This is a sample campaign email from the fake Klaviyo provider. Nothing here was sent to anyone.'
      ),
      created: iso(now, (sendDaysAgo ?? 0) + 6),
      updated: iso(now, Math.max(0, (sendDaysAgo ?? 1) - 1))
    }
  }
  const campaigns: KlaviyoCampaign[] = [
    campaign(
      'CMPspr001',
      'Spring restock',
      'sent',
      3,
      372000,
      15880,
      ['LSTnews01'],
      ['SEGnvr000'],
      'The spring blends are back'
    ),
    campaign(
      'CMPbrw002',
      'Brewing guide',
      'sent',
      7,
      118500,
      15210,
      ['LSTnews01'],
      [],
      'Three ways to brew better at home'
    ),
    campaign(
      'CMPvip003',
      'VIP early access',
      'sent',
      10,
      264050,
      1820,
      ['LSTvip002', 'SEGrep002'],
      [],
      'You get first pick, 48 hours early'
    ),
    campaign(
      'CMPwkd004',
      'Weekend offer',
      'sent',
      14,
      205990,
      14990,
      ['SEGeng090'],
      ['SEGwin180'],
      '15% off this weekend only'
    ),
    campaign(
      'CMPorg005',
      'Origin story: Colombia',
      'sent',
      21,
      87400,
      14700,
      ['LSTnews01'],
      [],
      'Meet the growers behind your cup'
    ),
    campaign(
      'CMPwin006',
      'We miss you',
      'sent',
      27,
      63210,
      640,
      ['SEGwin180'],
      [],
      'A little something to welcome you back'
    ),
    campaign(
      'CMPhol007',
      'Holiday gift guide',
      'scheduled',
      -5,
      null,
      0,
      ['LSTnews01', 'SEGeng090'],
      ['SEGnvr000'],
      'Gifts for every coffee lover'
    ),
    campaign(
      'CMPdrf008',
      'Cold brew season',
      'draft',
      null,
      null,
      0,
      [],
      [],
      'Cold brew season is here'
    ),
    campaign(
      'CMPcnl009',
      'Flash sale (stopped)',
      'cancelled',
      18,
      null,
      0,
      ['LSTnews01'],
      [],
      'Flash sale: 2 hours only'
    )
  ]
  const flow = (
    id: string,
    name: string,
    status: KlaviyoFlow['status'],
    trigger: KlaviyoFlow['trigger'],
    revenue: number,
    steps: [string, string, number, 'live' | 'draft'][]
  ): KlaviyoFlow => ({
    id,
    name,
    status,
    trigger,
    revenue30d: m(revenue),
    messages: steps.map(
      ([stepName, subject, delaySeconds, stepStatus], index) => ({
        id: `${id}M${index + 1}`,
        name: stepName,
        subject,
        status: status === 'draft' ? 'draft' : stepStatus,
        fromLabel: 'Sample Store',
        fromEmail: 'hello@shop.example',
        replyTo: index === 0 ? 'help@shop.example' : null,
        previewText: 'A sample preview line for this flow email.',
        templateUpdated: iso(now, 20 + index),
        delaySeconds,
        daysOfWeek: null,
        templateName: `${name} · ${stepName}`,
        html: sampleEmail(
          subject,
          'This is a sample flow email from the fake Klaviyo provider.'
        )
      })
    ),
    created: iso(now, 380),
    updated: iso(now, 12)
  })
  const flows: KlaviyoFlow[] = [
    flow(
      'FLWwel001',
      'Welcome series',
      'live',
      { kind: 'list', name: 'Newsletter' },
      804500,
      [
        ['Welcome 1', 'Welcome to Sample Store', 0, 'live'],
        ['Welcome 2', 'How we roast', 172800, 'live'],
        ['Welcome 3', 'Your first-order gift', 345600, 'live']
      ]
    ),
    flow(
      'FLWabc002',
      'Abandoned checkout',
      'live',
      { kind: 'metric', name: 'Started Checkout' },
      912030,
      [
        ['Reminder', 'You left something behind', 14400, 'live'],
        ['Last call', 'Still thinking it over?', 86400, 'live']
      ]
    ),
    flow(
      'FLWbrw003',
      'Browse abandonment',
      'live',
      { kind: 'metric', name: 'Viewed Product' },
      216840,
      [['Nudge', 'Still curious?', 2700, 'live']]
    ),
    flow(
      'FLWpst004',
      'Post-purchase',
      'live',
      { kind: 'metric', name: 'Placed Order' },
      330400,
      [
        ['Thank you', 'Thank you for your order', 0, 'live'],
        ['Review ask', 'How was your coffee?', 864000, 'draft']
      ]
    ),
    flow(
      'FLWwbk005',
      'Winback',
      'draft',
      { kind: 'metric', name: 'Placed Order' },
      0,
      [['Come back', 'It has been a while', 15552000, 'draft']]
    )
  ]
  const metrics = (
    [
      [
        'METopn001',
        'Opened Email',
        'Klaviyo',
        'Internal',
        'Someone opened one of your emails.',
        61240
      ],
      [
        'METclk002',
        'Clicked Email',
        'Klaviyo',
        'Internal',
        'Someone clicked a link in one of your emails.',
        4120
      ],
      [
        'METrcv003',
        'Received Email',
        'Klaviyo',
        'Internal',
        'One of your emails reached an inbox.',
        148600
      ],
      [
        'METuns004',
        'Unsubscribed',
        'Klaviyo',
        'Internal',
        'Someone stopped getting your emails.',
        212
      ],
      [
        'METord005',
        'Placed Order',
        'Shopify',
        'eCommerce',
        'Someone completed a purchase.',
        1380
      ],
      [
        'METchk006',
        'Started Checkout',
        'Shopify',
        'eCommerce',
        'Someone began checking out.',
        1799
      ],
      [
        'METvpr007',
        'Viewed Product',
        'Shopify',
        'eCommerce',
        'Someone looked at a product page.',
        30450
      ],
      [
        'METful008',
        'Fulfilled Order',
        'Shopify',
        'eCommerce',
        'An order was shipped.',
        1322
      ]
    ] as const
  ).map(([id, name, integration, category, measures, events30d], index) => ({
    id,
    name,
    integration,
    category,
    measures,
    events30d,
    created: iso(now, 420 - index)
  }))

  // 30 days of revenue, oldest first. Flow revenue spreads over the days;
  // each campaign's revenue lands on its send day. The sum is exact.
  const flowTotal = flows.reduce((sum, f) => sum + f.revenue30d.minor, 0)
  const weights = Array.from({ length: 30 }, (_, i) => 3 + ((i * 7) % 5))
  const weightSum = weights.reduce((a, b) => a + b, 0)
  const days = lastDays(now, timezone, 30)
  const amounts = weights.map((w) => Math.floor((flowTotal * w) / weightSum))
  amounts[29] += flowTotal - amounts.reduce((a, b) => a + b, 0)
  for (const c of campaigns) {
    if (!c.revenue30d || !c.sendTime) continue
    const index = days.indexOf(dayKey(c.sendTime, timezone))
    if (index >= 0) amounts[index] += c.revenue30d.minor
  }
  const daily: DailyRevenue[] = days.map((date, i) => ({
    date,
    revenue: m(amounts[i])
  }))

  return {
    account: {
      organization: 'Sample Store (sample data)',
      industry: 'Food & Beverage',
      timezone: validTimezone(timezone),
      currency,
      locale: 'en-US',
      maskedKey: 'pk_SAMP••••••••0000'
    },
    lists,
    segments,
    campaigns,
    flows,
    metrics,
    daily,
    activeSubscribers: { count: 16520, changePercent: 15 },
    abandonedCheckouts30d: 419,
    // Sample data is never synced from Klaviyo.
    syncedAt: null
  }
}

/** The fake Klaviyo read adapter: labelled sample data, never a network call. */
export class FakeKlaviyoReadProvider implements KlaviyoReadProvider {
  async snapshot({
    timezone,
    now
  }: {
    tenantId: string
    timezone: string
    now: Date
  }) {
    return sampleKlaviyoSnapshot({ now, timezone })
  }
}
