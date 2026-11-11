import type { KlaviyoResponse, KlaviyoTransport } from './client'

/**
 * A made-up Klaviyo account that answers the draft calls (PSH-001) in the
 * shapes revision 2026-10-15 publishes, and remembers what was made:
 * templates, imported pictures, campaigns with their message and
 * variations. No real account is involved. Tests change it from outside
 * (the owner scheduling or deleting a draft in Klaviyo) and ask it to fail
 * in given ways.
 */

export type DraftFaults = {
  /** The A/B settings PATCH is refused (400). */
  abTest?: 'refused' | 'ignored'
  /** The campaign is made, but its answer is lost (a timeout), once. */
  loseCreate?: boolean
  /** One request to this path prefix answers 429 (Retry-After 30), once. */
  rateLimit?: string
  /** One request to this path prefix answers 503, once. */
  outage?: string
  /** Deleting a variation is refused (400). */
  deleteVariation?: 'refused'
  /** This picture address cannot be imported (400). */
  badImage?: string
  /**
   * Whether a variation keeps its own copy of the template (true, as
   * "assign template" does) or points at ours (false).
   */
  copiesTemplates?: boolean
}

type Campaign = {
  name: string
  description: string
  createdAt: string
  included: string[]
  messageId: string
}
type Message = {
  campaignId: string
  status: string
  winnerPercentage: number | null
  variationIds: string[]
}
type Variation = {
  messageId: string
  name: string
  subject: string
  preview: string
  templateId: string
}

export type FakeDraftAccount = {
  templates: Map<string, { name: string; html: string }>
  images: Map<string, { from: string; url: string }>
  campaigns: Map<string, Campaign>
  messages: Map<string, Message>
  variations: Map<string, Variation>
  /** Every request, as "METHOD /path". */
  calls: string[]
  faults: DraftFaults
  transport: KlaviyoTransport
}

const json = (status: number, body?: unknown): KlaviyoResponse => ({
  status,
  headers: { 'content-type': 'application/vnd.api+json' },
  body: body === undefined ? '' : JSON.stringify(body)
})
const refused = (status: number, code = 'invalid') =>
  json(status, { errors: [{ status, code, title: 'Refused.' }] })

export function fakeDraftAccount(
  options: { faults?: DraftFaults; now?: () => Date } = {}
): FakeDraftAccount {
  const now = options.now ?? (() => new Date())
  let n = 0
  const id = (prefix: string) => `${prefix}${String(++n).padStart(4, '0')}`
  const account: Omit<FakeDraftAccount, 'transport'> = {
    templates: new Map(),
    images: new Map(),
    campaigns: new Map(),
    messages: new Map(),
    variations: new Map(),
    calls: [],
    faults: { copiesTemplates: true, ...options.faults }
  }
  const once = new Set<string>()
  const firstTime = (key: string) => {
    if (once.has(key)) return false
    once.add(key)
    return true
  }

  const keepTemplate = (templateId: string) => {
    if (!account.faults.copiesTemplates) return templateId
    const source = account.templates.get(templateId)
    if (!source) return templateId
    const copy = id('TplCopy')
    account.templates.set(copy, { ...source })
    return copy
  }
  const addVariation = (
    messageId: string,
    definition: {
      name?: string
      details?: {
        subject?: string
        preview_text?: string
        template_id?: string
      }
    }
  ) => {
    const vid = id('Var')
    account.variations.set(vid, {
      messageId,
      name: definition.name ?? '',
      subject: definition.details?.subject ?? '',
      preview: definition.details?.preview_text ?? '',
      templateId: keepTemplate(definition.details?.template_id ?? '')
    })
    const message = account.messages.get(messageId)!
    message.variationIds.push(vid)
    // Klaviyo's own A/B default (a 20% test, then the winner to the rest).
    if (message.variationIds.length > 1 && message.winnerPercentage === null)
      message.winnerPercentage = 80
    return vid
  }

  const transport: KlaviyoTransport = async (request) => {
    const url = new URL(request.url)
    const path = url.pathname
    const key = `${request.method} ${path}`
    account.calls.push(key)
    if (account.faults.rateLimit && path.startsWith(account.faults.rateLimit))
      if (firstTime(`rate ${account.faults.rateLimit}`))
        return {
          ...refused(429, 'throttled'),
          headers: { 'retry-after': '30' }
        }
    if (account.faults.outage && path.startsWith(account.faults.outage))
      if (firstTime(`outage ${account.faults.outage}`)) return refused(503)
    const body = request.body
      ? (JSON.parse(request.body) as {
          data: {
            id?: string
            attributes: Record<string, unknown>
            relationships?: Record<string, { data: { id: string } }>
          }
        })
      : null
    const attributes = body?.data.attributes ?? {}

    if (request.method === 'POST' && path === '/api/templates') {
      const tid = id('Tpl')
      account.templates.set(tid, {
        name: String(attributes.name),
        html: String(attributes.html)
      })
      return json(201, {
        data: {
          type: 'template',
          id: tid,
          attributes: { name: attributes.name }
        }
      })
    }
    const template = path.match(/^\/api\/templates\/([^/]+)$/)
    if (request.method === 'DELETE' && template) {
      if (!account.templates.delete(template[1]!)) return refused(404)
      return json(204)
    }
    if (request.method === 'POST' && path === '/api/images') {
      const from = String(attributes.import_from_url)
      if (from === account.faults.badImage) return refused(400)
      const iid = id('Img')
      const served = `https://images.klaviyo.example/company/SAMPLE/images/${iid}.jpg`
      account.images.set(iid, { from, url: served })
      return json(201, {
        data: {
          type: 'image',
          id: iid,
          attributes: {
            name: attributes.name,
            image_url: served,
            format: 'jpeg',
            size: 1000,
            hidden: true,
            updated_at: now().toISOString()
          }
        }
      })
    }
    if (request.method === 'POST' && path === '/api/campaigns') {
      const definition = attributes.definition as {
        name: string
        description: string
      }
      const audiences = attributes.audiences as { included: string[] }[]
      const messages = attributes.messages as {
        variations: { definition: Parameters<typeof addVariation>[1] }[]
      }[]
      const cid = id('Cmp')
      const mid = id('Msg')
      account.campaigns.set(cid, {
        name: definition.name,
        description: definition.description,
        createdAt: now().toISOString(),
        included: audiences[0]?.included ?? [],
        messageId: mid
      })
      account.messages.set(mid, {
        campaignId: cid,
        status: 'draft',
        winnerPercentage: null,
        variationIds: []
      })
      for (const v of messages[0]?.variations ?? [])
        addVariation(mid, v.definition)
      if (account.faults.loseCreate && firstTime('lose create'))
        throw new Error('timeout')
      return json(201, {
        data: {
          type: 'campaign',
          id: cid,
          attributes: { definition },
          relationships: {
            'campaign-messages': {
              data: [{ type: 'campaign-message', id: mid }]
            }
          }
        }
      })
    }
    if (request.method === 'GET' && path === '/api/campaigns') {
      const filter = url.searchParams.get('filter') ?? ''
      const name = filter.match(/contains\(name,"([^"]*)"\)/)?.[1] ?? ''
      const since = filter.match(/greater-or-equal\(created_at,([^)]+)\)/)?.[1]
      const found = [...account.campaigns.entries()].filter(
        ([, c]) =>
          c.name.includes(name) &&
          (!since || Date.parse(c.createdAt) >= Date.parse(since))
      )
      return json(200, {
        data: found.map(([cid, c]) => ({
          type: 'campaign',
          id: cid,
          attributes: {
            created_at: c.createdAt,
            definition: { name: c.name, description: c.description }
          },
          relationships: {
            'campaign-messages': {
              data: [{ type: 'campaign-message', id: c.messageId }]
            }
          }
        })),
        links: { self: request.url, next: null }
      })
    }
    const message = path.match(/^\/api\/campaign-messages\/([^/]+)$/)
    if (message) {
      const m = account.messages.get(message[1]!)
      if (!m) return refused(404, 'not_found')
      if (request.method === 'PATCH') {
        if (m.status !== 'draft') return refused(400)
        if (account.faults.abTest === 'refused') return refused(400)
        if (m.variationIds.length < 2) return refused(400)
        const ab = (
          attributes.definition as {
            ab_test?: { winner_percentage?: number }
          }
        ).ab_test
        if (
          account.faults.abTest !== 'ignored' &&
          ab?.winner_percentage !== undefined
        )
          m.winnerPercentage = ab.winner_percentage
        return json(200, { data: { type: 'campaign-message', id: message[1] } })
      }
      const c = account.campaigns.get(m.campaignId)!
      return json(200, {
        data: {
          type: 'campaign-message',
          id: message[1],
          attributes: {
            definition: {
              status: m.status,
              ab_test:
                m.winnerPercentage === null
                  ? null
                  : { winner_percentage: m.winnerPercentage }
            }
          },
          relationships: {
            campaign: { data: { type: 'campaign', id: m.campaignId } },
            'campaign-variations': {
              data: m.variationIds.map((v) => ({
                type: 'campaign-variation',
                id: v
              }))
            }
          }
        },
        included: [
          {
            type: 'campaign',
            id: m.campaignId,
            attributes: {
              definition: { name: c.name, description: c.description }
            }
          },
          ...m.variationIds.map((vid) => {
            const v = account.variations.get(vid)!
            return {
              type: 'campaign-variation',
              id: vid,
              attributes: {
                definition: {
                  name: v.name,
                  details: {
                    channel: 'email',
                    subject: v.subject,
                    preview_text: v.preview,
                    template_id: v.templateId
                  }
                }
              }
            }
          })
        ]
      })
    }
    if (request.method === 'POST' && path === '/api/campaign-variations') {
      const mid = body?.data.relationships?.['campaign-message']?.data.id ?? ''
      const m = account.messages.get(mid)
      if (!m) return refused(404, 'not_found')
      if (m.status !== 'draft') return refused(400)
      const vid = addVariation(
        mid,
        attributes.definition as Parameters<typeof addVariation>[1]
      )
      return json(201, { data: { type: 'campaign-variation', id: vid } })
    }
    const variation = path.match(/^\/api\/campaign-variations\/([^/]+)$/)
    if (variation) {
      const v = account.variations.get(variation[1]!)
      if (!v) return refused(404, 'not_found')
      const m = account.messages.get(v.messageId)!
      if (m.status !== 'draft') return refused(400)
      if (request.method === 'DELETE') {
        if (account.faults.deleteVariation === 'refused') return refused(400)
        account.variations.delete(variation[1]!)
        m.variationIds = m.variationIds.filter((x) => x !== variation[1])
        if (m.variationIds.length < 2) m.winnerPercentage = null
        return json(204)
      }
      if (request.method === 'PATCH') {
        const d = attributes.definition as Parameters<typeof addVariation>[1]
        v.name = d.name ?? v.name
        v.subject = d.details?.subject ?? v.subject
        v.preview = d.details?.preview_text ?? v.preview
        if (d.details?.template_id)
          v.templateId = keepTemplate(d.details.template_id)
        return json(200, {
          data: { type: 'campaign-variation', id: variation[1] }
        })
      }
    }
    return refused(404, 'not_found')
  }
  return { ...account, transport }
}
