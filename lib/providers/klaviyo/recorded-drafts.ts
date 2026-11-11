import type { KlaviyoResponse, KlaviyoTransport } from './client'

/**
 * A made-up Klaviyo account that answers the draft calls (PSH-001) in the
 * shapes revision 2026-10-15 publishes, and checks each request against
 * what that revision requires (a request it would refuse is refused here
 * too, 400): templates, imported pictures, campaigns with their audience,
 * messages with their variations, the A/B settings, the campaign list's
 * filters. It remembers what was made, so tests can change it from outside
 * (the owner scheduling or deleting a draft) and ask it to fail in given
 * ways. No real account is involved.
 */

export type DraftFaults = {
  /** The A/B settings PATCH is refused (400), or answered 200 and not kept. */
  abTest?: 'refused' | 'ignored'
  /** The campaign is made, but its answer is lost (a timeout), once. */
  loseCreate?: boolean
  /** A template is made, but its answer is lost, once. */
  loseTemplate?: boolean
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
  /** Klaviyo makes a message of its own with each campaign. */
  autoMessage?: boolean
  /** Klaviyo renames the variations it is given. */
  renameVariations?: boolean
  /** The first read of a message just made answers 404 (read lag). */
  lagRead?: boolean
  /** Message reads leave out their relationships. */
  dropRelationships?: boolean
}

type Campaign = {
  name: string
  description: string
  createdAt: string
  included: string[]
  audienceRef: string
  messageIds: string[]
}
type Message = {
  campaignId: string
  name: string
  status: string
  winnerPercentage: number | null
  variationIds: string[]
}
type Variation = {
  messageId: string
  name: string
  subject: string
  preview: string
  templateId: string | null
}

export type FakeDraftAccount = {
  templates: Map<string, { name: string; html: string; created: string }>
  images: Map<string, { from: string; url: string }>
  campaigns: Map<string, Campaign>
  messages: Map<string, Message>
  variations: Map<string, Variation>
  /** The lists and segments in the account. */
  audiences: Set<string>
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
const bad = () => refused(400)

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown) => typeof v === 'string'
const kid = (v: unknown) => str(v) && /^[A-Za-z0-9_-]{1,64}$/.test(v as string)
/** Email variation details as the spec has them; nothing else. */
const emailDetails = (d: unknown) =>
  isObj(d) &&
  (d.channel === undefined || d.channel === 'email') &&
  Object.keys(d).every((k) =>
    [
      'channel',
      'template_id',
      'from_label',
      'from_email',
      'reply_to_email',
      'cc_email',
      'bcc_email',
      'subject',
      'preview_text'
    ].includes(k)
  )
const variationDefinition = (d: unknown) =>
  isObj(d) &&
  (d.name === undefined || str(d.name)) &&
  (d.details === undefined || emailDetails(d.details))

/** The campaign list's filters revision 2026-10-15 allows. */
const listFilter =
  /^(?:(?:any\(id,\[[^\]]*\]\)|contains\(name,"[^"]*"\)|equals\((?:archived|builder),[^)]*\)|(?:greater|less)-(?:or-equal|than)\((?:created_at|updated_at),[0-9T:Z.+-]+\))(?:,|$))+$/
const listSorts = [
  'created_at',
  '-created_at',
  'id',
  '-id',
  'name',
  '-name',
  'updated_at',
  '-updated_at'
]

export function fakeDraftAccount(
  options: { faults?: DraftFaults; now?: () => Date; audiences?: string[] } = {}
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
    audiences: new Set(options.audiences ?? ['SegEng90', 'SegVIP', 'LstNews']),
    calls: [],
    faults: { copiesTemplates: true, ...options.faults }
  }
  const once = new Set<string>()
  const firstTime = (key: string) => {
    if (once.has(key)) return false
    once.add(key)
    return true
  }
  const keepTemplate = (templateId: string | undefined) => {
    if (!templateId) return null
    const source = account.templates.get(templateId)
    if (!source || !account.faults.copiesTemplates) return templateId
    const copy = id('TplCopy')
    account.templates.set(copy, { ...source })
    return copy
  }
  const addVariation = (messageId: string, definition: Obj) => {
    const vid = id('Var')
    const message = account.messages.get(messageId)!
    const details = (definition.details ?? {}) as Obj
    account.variations.set(vid, {
      messageId,
      name: account.faults.renameVariations
        ? `Variation ${message.variationIds.length + 1}`
        : String(definition.name ?? ''),
      subject: String(details.subject ?? ''),
      preview: String(details.preview_text ?? ''),
      templateId: keepTemplate(details.template_id as string | undefined)
    })
    message.variationIds.push(vid)
    // Klaviyo's own A/B default: a 20% test, then the winner to the rest.
    if (message.variationIds.length > 1 && message.winnerPercentage === null)
      message.winnerPercentage = 80
    return vid
  }
  const newMessage = (campaignId: string, name: string) => {
    const mid = id('Msg')
    account.messages.set(mid, {
      campaignId,
      name,
      status: 'draft',
      winnerPercentage: null,
      variationIds: []
    })
    account.campaigns.get(campaignId)!.messageIds.push(mid)
    return mid
  }
  const lagged = new Set<string>()
  const relOf = (data: Obj | undefined, name: string) => {
    const rel = isObj(data?.relationships) ? (data.relationships as Obj) : {}
    const r = rel[name]
    return isObj(r) && isObj(r.data) ? r.data.id : undefined
  }

  const transport: KlaviyoTransport = async (request) => {
    const url = new URL(request.url)
    const path = url.pathname
    account.calls.push(`${request.method} ${path}`)
    if (account.faults.rateLimit && path.startsWith(account.faults.rateLimit))
      if (firstTime(`rate ${account.faults.rateLimit}`))
        return {
          ...refused(429, 'throttled'),
          headers: { 'retry-after': '30' }
        }
    if (account.faults.outage && path.startsWith(account.faults.outage))
      if (firstTime(`outage ${account.faults.outage}`)) return refused(503)
    let data: Obj | undefined
    if (request.body)
      try {
        const parsed = JSON.parse(request.body) as unknown
        data = isObj(parsed) && isObj(parsed.data) ? parsed.data : undefined
      } catch {
        return bad()
      }
    const attributes = isObj(data?.attributes)
      ? (data.attributes as Obj)
      : undefined

    // Templates.
    if (path === '/api/templates' && request.method === 'POST') {
      if (
        data?.type !== 'template' ||
        !attributes ||
        !str(attributes.name) ||
        attributes.editor_type !== 'CODE' ||
        !str(attributes.html)
      )
        return bad()
      const tid = id('Tpl')
      account.templates.set(tid, {
        name: attributes.name as string,
        html: attributes.html as string,
        created: now().toISOString()
      })
      if (account.faults.loseTemplate && firstTime('lose template'))
        throw new Error('timeout')
      return json(201, {
        data: {
          type: 'template',
          id: tid,
          attributes: { name: attributes.name }
        }
      })
    }
    if (path === '/api/templates' && request.method === 'GET') {
      const filter = url.searchParams.get('filter') ?? ''
      const m = filter.match(
        /^equals\(name,"([^"]*)"\),greater-or-equal\(created,([0-9T:Z.+-]+)\)$/
      )
      if (!m) return bad()
      return json(200, {
        data: [...account.templates.entries()]
          .filter(
            ([, t]) =>
              t.name === m[1] && Date.parse(t.created) >= Date.parse(m[2]!)
          )
          .map(([tid, t]) => ({
            type: 'template',
            id: tid,
            attributes: { name: t.name, created: t.created }
          })),
        links: { self: request.url, next: null }
      })
    }
    const template = path.match(/^\/api\/templates\/([^/]+)$/)
    if (template && request.method === 'DELETE') {
      if (!account.templates.delete(template[1]!)) return refused(404)
      return json(204)
    }

    // Pictures and audiences.
    if (path === '/api/images' && request.method === 'POST') {
      if (
        data?.type !== 'image' ||
        !attributes ||
        !str(attributes.import_from_url)
      )
        return bad()
      const from = attributes.import_from_url as string
      if (from === account.faults.badImage) return bad()
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
    const group = path.match(/^\/api\/(segments|lists)\/([^/]+)$/)
    if (group && request.method === 'GET')
      return account.audiences.has(group[2]!)
        ? json(200, {
            data: {
              type: group[1] === 'lists' ? 'list' : 'segment',
              id: group[2],
              attributes: { name: 'An audience' }
            }
          })
        : refused(404, 'not_found')

    // Campaigns.
    if (path === '/api/campaigns' && request.method === 'POST') {
      const definition = attributes?.definition
      const audiences = attributes?.audiences
      const settings = isObj(definition) ? definition.send_settings : undefined
      if (
        data?.type !== 'campaign' ||
        !isObj(definition) ||
        !str(definition.name) ||
        (definition.description !== undefined &&
          !str(definition.description)) ||
        (settings !== undefined &&
          (!isObj(settings) ||
            !['simple', 'timezone'].includes(String(settings.send_strategy)) ||
            (settings.send_strategy === 'simple' &&
              !str(settings.send_timezone)))) ||
        !Array.isArray(audiences) ||
        audiences.length < 1 ||
        !audiences.every(
          (a) => isObj(a) && str(a.temporary_id) && Array.isArray(a.included)
        )
      )
        return bad()
      const included = (audiences[0] as Obj).included as string[]
      if (!included.every((x) => account.audiences.has(x))) return bad()
      const cid = id('Cmp')
      account.campaigns.set(cid, {
        name: definition.name as string,
        description: (definition.description as string | undefined) ?? '',
        createdAt: now().toISOString(),
        included,
        audienceRef: id('Aud'),
        messageIds: []
      })
      if (account.faults.autoMessage)
        addVariation(newMessage(cid, definition.name as string), {
          name: 'Variation 1'
        })
      if (account.faults.loseCreate && firstTime('lose create'))
        throw new Error('timeout')
      return json(201, {
        data: { type: 'campaign', id: cid, attributes: { definition } }
      })
    }
    if (path === '/api/campaigns' && request.method === 'GET') {
      const filter = url.searchParams.get('filter') ?? ''
      if (filter && !listFilter.test(filter)) return bad()
      const sort = url.searchParams.get('sort')
      if (sort && !listSorts.includes(sort)) return bad()
      const size = Number(url.searchParams.get('page[size]') ?? 2)
      if (!(size >= 1 && size <= 100)) return bad()
      const since = filter.match(/greater-or-equal\(created_at,([^)]+)\)/)?.[1]
      const all = [...account.campaigns.entries()]
        .filter(
          ([, c]) => !since || Date.parse(c.createdAt) >= Date.parse(since)
        )
        .sort((a, b) => b[1].createdAt.localeCompare(a[1].createdAt))
      const from = Number(url.searchParams.get('page[cursor]') ?? 0)
      const next =
        from + size < all.length
          ? `https://a.klaviyo.com/api/campaigns?${new URLSearchParams({
              ...Object.fromEntries(url.searchParams),
              'page[cursor]': String(from + size)
            })}`
          : null
      return json(200, {
        data: all.slice(from, from + size).map(([cid, c]) => ({
          type: 'campaign',
          id: cid,
          attributes: {
            created_at: c.createdAt,
            definition: { name: c.name, description: c.description }
          }
        })),
        links: { self: request.url, next }
      })
    }
    const campaign = path.match(/^\/api\/campaigns\/([^/]+)$/)
    if (campaign && request.method === 'GET') {
      const c = account.campaigns.get(campaign[1]!)
      if (!c) return refused(404, 'not_found')
      return json(200, {
        data: {
          type: 'campaign',
          id: campaign[1],
          attributes: {
            definition: { name: c.name, description: c.description }
          },
          relationships: {
            'campaign-audiences': {
              data: [{ type: 'campaign-audience', id: c.audienceRef }]
            },
            'campaign-messages': {
              data: c.messageIds.map((m) => ({
                type: 'campaign-message',
                id: m
              }))
            }
          }
        }
      })
    }

    // Messages.
    if (path === '/api/campaign-messages' && request.method === 'POST') {
      const definition = attributes?.definition
      const variations = attributes?.variations
      const cid = relOf(data, 'campaign')
      const c = kid(cid) ? account.campaigns.get(cid as string) : undefined
      if (
        data?.type !== 'campaign-message' ||
        !isObj(definition) ||
        !c ||
        relOf(data, 'campaign-audience') !== c.audienceRef ||
        (variations !== undefined &&
          (!Array.isArray(variations) ||
            variations.length > 2 ||
            !variations.every(
              (v) => isObj(v) && variationDefinition(v.definition)
            )))
      )
        return bad()
      const mid = newMessage(cid as string, String(definition.name ?? ''))
      for (const v of (variations ?? []) as Obj[])
        addVariation(mid, v.definition as Obj)
      if (account.faults.lagRead) lagged.add(mid)
      return json(201, { data: { type: 'campaign-message', id: mid } })
    }
    const message = path.match(/^\/api\/campaign-messages\/([^/]+)$/)
    if (message) {
      const m = account.messages.get(message[1]!)
      if (!m) return refused(404, 'not_found')
      if (request.method === 'PATCH') {
        const definition = attributes?.definition
        if (
          data?.type !== 'campaign-message' ||
          data.id !== message[1] ||
          !isObj(definition) ||
          Object.keys(definition).some((k) => k !== 'ab_test' && k !== 'name')
        )
          return bad()
        if (m.status !== 'draft') return bad()
        if (account.faults.abTest === 'refused') return bad()
        if (m.variationIds.length < 2) return bad()
        const ab = definition.ab_test
        if (
          account.faults.abTest !== 'ignored' &&
          isObj(ab) &&
          typeof ab.winner_percentage === 'number'
        )
          m.winnerPercentage = ab.winner_percentage
        return json(200, {
          data: { type: 'campaign-message', id: message[1] }
        })
      }
      if (lagged.delete(message[1]!)) return refused(404, 'not_found')
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
          ...(account.faults.dropRelationships
            ? {}
            : {
                relationships: {
                  campaign: { data: { type: 'campaign', id: m.campaignId } },
                  'campaign-variations': {
                    data: m.variationIds.map((v) => ({
                      type: 'campaign-variation',
                      id: v
                    }))
                  }
                }
              })
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

    // Variations.
    if (path === '/api/campaign-variations' && request.method === 'POST') {
      const mid = relOf(data, 'campaign-message')
      const m = kid(mid) ? account.messages.get(mid as string) : undefined
      if (
        data?.type !== 'campaign-variation' ||
        !attributes ||
        !variationDefinition(attributes.definition)
      )
        return bad()
      if (!m) return refused(404, 'not_found')
      if (m.status !== 'draft') return bad()
      const vid = addVariation(mid as string, attributes.definition as Obj)
      return json(201, { data: { type: 'campaign-variation', id: vid } })
    }
    const variation = path.match(/^\/api\/campaign-variations\/([^/]+)$/)
    if (variation) {
      const v = account.variations.get(variation[1]!)
      if (!v) return refused(404, 'not_found')
      const m = account.messages.get(v.messageId)!
      if (m.status !== 'draft') return bad()
      if (request.method === 'DELETE') {
        if (account.faults.deleteVariation === 'refused') return bad()
        account.variations.delete(variation[1]!)
        m.variationIds = m.variationIds.filter((x) => x !== variation[1])
        if (m.variationIds.length < 2) m.winnerPercentage = null
        return json(204)
      }
      if (request.method === 'PATCH') {
        if (
          data?.type !== 'campaign-variation' ||
          data.id !== variation[1] ||
          !attributes ||
          !variationDefinition(attributes.definition)
        )
          return bad()
        const d = attributes.definition as Obj
        const details = (d.details ?? {}) as Obj
        if (!account.faults.renameVariations && str(d.name))
          v.name = d.name as string
        if (str(details.subject)) v.subject = details.subject as string
        if (str(details.preview_text))
          v.preview = details.preview_text as string
        if (str(details.template_id))
          v.templateId = keepTemplate(details.template_id as string)
        return json(200, {
          data: { type: 'campaign-variation', id: variation[1] }
        })
      }
    }
    return refused(404, 'not_found')
  }
  return { ...account, transport }
}
