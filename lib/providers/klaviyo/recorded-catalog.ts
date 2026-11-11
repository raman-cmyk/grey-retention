import { catalogItemsPath, metricsPath } from './catalog'
import type { KlaviyoResponse, KlaviyoTransport } from './client'
import { recorded } from './recorded'

/**
 * Recorded catalog and store-event answers (revision 2026-10-15, ONB-102):
 * the shapes of Klaviyo's published API with a made-up store. No real
 * account, key, customer or order is in here. Dates are relative to `now`,
 * so the 90-day window always holds them.
 *
 * Two stores:
 * * `shopify`: a Shopify store. Klaviyo's catalog API shows nothing (it
 *   shows only catalogs sent to it directly), so the products come from its
 *   Viewed Product and Placed Order events. The overshirt went on sale (seen
 *   at full price first), the knit always shows a compare-at price of twice
 *   its price, the tote is listed twice, the beanie has no photo, the beanie
 *   and the socks are new.
 * * `custom`: a catalog sent to Klaviyo directly, with variants.
 */

const day = 86_400_000
const json = (status: number, body: unknown): KlaviyoResponse => ({
  status,
  headers: { 'content-type': 'application/vnd.api+json' },
  body: JSON.stringify(body)
})

type Item = {
  id: string
  name: string
  path: string
  image: string | null
  price: number
  compareAt?: number | null
}

export function catalogRecordings(
  options: { domain?: string; now?: Date } = {}
) {
  const domain = options.domain ?? 'cedar.example'
  const now = (options.now ?? new Date()).getTime()
  const at = (days: number, hour = 10) =>
    new Date(now - days * day + hour * 3_600_000 - 12 * 3_600_000)
      .toISOString()
      .replace(/\.\d{3}Z$/, '+00:00')
  const site = (path: string) => `https://${domain}${path}`
  const image = (name: string) => `https://${domain}/cdn/shop/files/${name}.jpg`

  const overshirt: Item = {
    id: '7001',
    name: 'Field Overshirt',
    path: '/products/field-overshirt',
    image: image('field-overshirt'),
    price: 89
  }
  const knit: Item = {
    id: '7002',
    name: 'Weekend Knit',
    path: '/products/weekend-knit',
    image: image('weekend-knit'),
    price: 120,
    compareAt: 240
  }
  const tote: Item = {
    id: '7003',
    name: 'Canvas Tote',
    path: '/products/canvas-tote',
    image: image('canvas-tote'),
    price: 45
  }
  const oldTote: Item = {
    id: '7006',
    name: 'Canvas Tote',
    path: '/products/canvas-tote-1',
    image: image('canvas-tote'),
    price: 45
  }
  const beanie: Item = {
    id: '7004',
    name: 'Merino Beanie',
    path: '/products/merino-beanie',
    image: null,
    price: 32
  }
  const socks: Item = {
    id: '7005',
    name: 'Trail Socks',
    path: '/products/trail-socks',
    image: image('trail-socks'),
    price: 18.5
  }

  const view = (
    item: Item,
    daysAgo: number,
    over: Partial<Record<string, unknown>> = {}
  ) => ({
    type: 'event',
    id: `view-${item.id}-${daysAgo}`,
    attributes: {
      timestamp: Math.floor((now - daysAgo * day) / 1000),
      datetime: at(daysAgo),
      uuid: `00000000-0000-4000-8000-${item.id.padStart(6, '0')}${String(daysAgo).padStart(6, '0')}`,
      event_properties: {
        ProductName: item.name,
        ProductID: Number(item.id),
        SKU: `CL-${item.id}`,
        Categories: ['Menswear'],
        ImageURL: item.image,
        URL: site(item.path),
        Brand: 'Cedar Goods',
        Price: item.price,
        CompareAtPrice: item.compareAt ?? null,
        ...over
      }
    }
  })
  const order = (
    daysAgo: number,
    lines: { item: Item; quantity: number; variant?: string }[]
  ) => ({
    type: 'event',
    id: `order-${daysAgo}-${lines.map((l) => l.item.id).join('-')}`,
    attributes: {
      timestamp: Math.floor((now - daysAgo * day) / 1000),
      datetime: at(daysAgo, 15),
      uuid: `00000000-0000-4000-9000-${String(daysAgo).padStart(12, '0')}`,
      event_properties: {
        $event_id: `100${daysAgo}`,
        $value: lines.reduce((s, l) => s + l.item.price * l.quantity, 0),
        $currency_code: 'USD',
        Items: lines.map((l) => l.item.name),
        'Item Count': lines.reduce((s, l) => s + l.quantity, 0),
        $extra: {
          line_items: lines.map((l) => ({
            product_id: Number(l.item.id),
            title: l.item.name,
            variant_title: l.variant ?? null,
            quantity: l.quantity,
            price: String(l.item.price.toFixed(2)),
            sku: `CL-${l.item.id}`
          }))
        }
      }
    }
  })
  const events = (data: unknown[]) =>
    json(200, {
      data,
      links: {
        self: 'https://a.klaviyo.com/api/events/',
        next: null,
        prev: null
      }
    })

  return {
    metrics: json(200, {
      data: [
        {
          type: 'metric',
          id: 'OpnEml',
          attributes: {
            name: 'Opened Email',
            integration: { name: 'Klaviyo', category: 'Internal' }
          }
        },
        {
          type: 'metric',
          id: 'PlcdOr',
          attributes: {
            name: 'Placed Order',
            integration: { name: 'Shopify', category: 'eCommerce' }
          }
        },
        {
          type: 'metric',
          id: 'VwdPrd',
          attributes: {
            name: 'Viewed Product',
            integration: { name: 'Shopify', category: 'eCommerce' }
          }
        }
      ],
      links: { self: 'https://a.klaviyo.com/api/metrics/', next: null }
    }),
    /** A Shopify catalog is not in Klaviyo's catalog API. */
    emptyCatalog: json(200, {
      data: [],
      links: { self: 'https://a.klaviyo.com/api/catalog-items/', next: null }
    }),
    viewedProduct: events([
      view(socks, 2),
      view(overshirt, 3, { Price: 69, CompareAtPrice: 89 }),
      view(knit, 4),
      view(beanie, 9),
      view(overshirt, 12, { Price: 69, CompareAtPrice: 89 }),
      view(socks, 12),
      view(tote, 20),
      view(knit, 40, { ProductName: 'Weekend Knit - Navy / L' }),
      view(overshirt, 60),
      view(oldTote, 70),
      view(tote, 80)
    ]),
    placedOrder: events([
      order(1, [{ item: overshirt, quantity: 2, variant: 'Olive / M' }]),
      order(5, [
        { item: overshirt, quantity: 1, variant: 'Olive / L' },
        { item: socks, quantity: 1 }
      ]),
      order(14, [{ item: tote, quantity: 2 }]),
      order(35, [
        { item: knit, quantity: 2, variant: 'Navy / M' },
        { item: overshirt, quantity: 2, variant: 'Sand / M' }
      ]),
      order(50, [{ item: oldTote, quantity: 1 }])
    ]),
    /** A catalog sent to Klaviyo directly: items with their variants. */
    customCatalog: json(200, {
      data: [
        {
          type: 'catalog-item',
          id: '$custom:::$default:::CG-OVERSHIRT',
          attributes: {
            external_id: 'CG-OVERSHIRT',
            title: 'Field Overshirt',
            url: site('/products/field-overshirt'),
            image_full_url: image('field-overshirt'),
            price: 89,
            custom_metadata: {},
            published: true,
            created: at(200)
          },
          relationships: {
            variants: {
              data: [
                {
                  type: 'catalog-variant',
                  id: '$custom:::$default:::CG-OVERSHIRT-S'
                },
                {
                  type: 'catalog-variant',
                  id: '$custom:::$default:::CG-OVERSHIRT-M'
                },
                {
                  type: 'catalog-variant',
                  id: '$custom:::$default:::CG-OVERSHIRT-L'
                }
              ]
            }
          }
        },
        {
          type: 'catalog-item',
          id: '$custom:::$default:::CG-TOTE',
          attributes: {
            external_id: 'CG-TOTE',
            title: 'Canvas Tote',
            url: site('/products/canvas-tote'),
            image_full_url: image('canvas-tote'),
            price: 45,
            custom_metadata: { compare_at_price: 60 },
            published: true,
            created: at(15)
          },
          relationships: { variants: { data: [] } }
        },
        {
          type: 'catalog-item',
          id: '$custom:::$default:::CG-SCARF',
          attributes: {
            external_id: 'CG-SCARF',
            title: 'Old Scarf',
            url: site('/products/old-scarf'),
            image_full_url: image('old-scarf'),
            price: 25,
            custom_metadata: null,
            published: false,
            created: at(400)
          },
          relationships: { variants: { data: [] } }
        },
        // A record in a shape this version does not know: skipped.
        {
          type: 'catalog-item',
          id: '$custom:::$default:::CG-BROKEN',
          attributes: {}
        }
      ],
      included: ['S', 'M', 'L'].map((size, i) => ({
        type: 'catalog-variant',
        id: `$custom:::$default:::CG-OVERSHIRT-${size}`,
        attributes: {
          title: `Field Overshirt - ${size}`,
          sku: `CG-OVERSHIRT-${size}`,
          price: 89,
          inventory_quantity: [4, 0, 7][i],
          image_full_url: image('field-overshirt'),
          published: true
        }
      })),
      links: {
        self: 'https://a.klaviyo.com/api/catalog-items/',
        next: null
      }
    }),
    /** The custom store's orders: Items with the catalog's own ids. */
    customOrders: events([
      {
        type: 'event',
        id: 'custom-order-1',
        attributes: {
          timestamp: Math.floor((now - 3 * day) / 1000),
          datetime: at(3),
          uuid: '00000000-0000-4000-a000-000000000001',
          event_properties: {
            $value: 223,
            Currency: 'USD',
            Items: [
              {
                ProductID: 'CG-OVERSHIRT',
                SKU: 'CG-OVERSHIRT-M',
                ProductName: 'Field Overshirt',
                Quantity: 2,
                ItemPrice: 89,
                RowTotal: 178,
                ProductURL: site('/products/field-overshirt'),
                ImageURL: image('field-overshirt')
              },
              {
                ProductID: 'CG-TOTE',
                ProductName: 'Canvas Tote',
                Quantity: 1,
                ItemPrice: 45
              }
            ]
          }
        }
      }
    ])
  }
}

export type CatalogStore = 'shopify' | 'custom' | 'empty'

const eventsQuery =
  /^\/api\/events\?fields\[event\]=event_properties,datetime&filter=equals\(metric_id,"([A-Za-z0-9]{1,64})"\),greater-than\(datetime,\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\)&sort=-datetime$/

/**
 * A transport answering from the recordings, like Klaviyo: the account,
 * the catalog, the metrics and their events, each only at its exact
 * address (anything else is not found). `fail` answers one kind of request
 * with a given response instead (a 401, a 403, a 429…).
 */
export function recordedCatalogTransport(
  options: {
    store?: CatalogStore
    domain?: string
    now?: Date
    fail?: {
      on: 'account' | 'catalog' | 'metrics' | 'orders' | 'views'
      with: KlaviyoResponse
    }
  } = {}
): KlaviyoTransport & { calls: string[] } {
  const store = options.store ?? 'shopify'
  const calls: string[] = []
  const transport = (async (request) => {
    const r = catalogRecordings({ domain: options.domain, now: options.now })
    const url = new URL(request.url)
    const path = decodeURIComponent(url.pathname + url.search)
    calls.push(`${request.method} ${path}`)
    const fail = (on: NonNullable<typeof options.fail>['on']) =>
      options.fail?.on === on ? options.fail.with : null
    if (path.startsWith('/api/accounts?'))
      return fail('account') ?? recorded.account
    if (path === catalogItemsPath)
      return (
        fail('catalog') ??
        (store === 'custom' ? r.customCatalog : r.emptyCatalog)
      )
    if (path === metricsPath) return fail('metrics') ?? r.metrics
    const metric = eventsQuery.exec(path)?.[1]
    if (metric === 'PlcdOr')
      return (
        fail('orders') ??
        (store === 'shopify'
          ? r.placedOrder
          : store === 'custom'
            ? r.customOrders
            : json(200, { data: [], links: { next: null } }))
      )
    if (metric === 'VwdPrd')
      return (
        fail('views') ??
        (store === 'shopify'
          ? r.viewedProduct
          : json(200, { data: [], links: { next: null } }))
      )
    return json(404, { errors: [{ status: 404, code: 'not_found' }] })
  }) as KlaviyoTransport & { calls: string[] }
  transport.calls = calls
  return transport
}
