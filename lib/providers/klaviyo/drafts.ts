import 'server-only'
import { z } from 'zod'
import { KlaviyoError, type KlaviyoClient } from './client'

/**
 * The Klaviyo calls that make and change one draft campaign (PSH-001), in
 * the shapes revision 2026-10-15 publishes and in the order Step 0's push
 * that worked used (docs/step0/README.md): pictures imported, an HTML
 * template, the campaign with its audience (no message inline), then its
 * message made in one request with its designs (and, for an A/B test, the
 * even test), and reading it all back. No variation is ever added to a
 * message afterwards. Nothing here schedules or sends:
 * the client refuses any address or body field that would (`isDraftWrite`,
 * `carriesSchedule`).
 */

const kid = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const invalid = (endpoint: string) =>
  new KlaviyoError('invalid_response', { endpoint })
const parsed = <T>(schema: z.ZodType<T>, body: unknown, endpoint: string) => {
  const result = schema.safeParse(body)
  if (!result.success) throw invalid(endpoint)
  return result.data
}
const gone = (error: unknown) =>
  error instanceof KlaviyoError &&
  error.kind === 'rejected' &&
  (error.details.status === 404 || error.details.status === 410)
const stamp = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z')
/** A time Klaviyo gave, as ISO; null when it gave none or not a time. */
const isoTime = (v: string | null | undefined) =>
  v && z.iso.datetime({ offset: true }).safeParse(v).success
    ? new Date(v).toISOString()
    : null

/** One design's content on a variation. */
export type VariationContent = {
  /** "Design A" or "Design B". */
  name: string
  subject: string
  preview: string
  templateId: string
}

export const designName = (approach: 'A' | 'B') => `Design ${approach}`

/** An HTML template (the "code" editor); its id. */
export async function createTemplate(
  client: KlaviyoClient,
  name: string,
  html: string
) {
  const body = await client.write(
    'POST',
    '/api/templates',
    {
      data: {
        type: 'template',
        attributes: { name: name.slice(0, 120), editor_type: 'CODE', html }
      }
    },
    'templates:write'
  )
  return parsed(
    z.object({ data: z.object({ type: z.literal('template'), id: kid }) }),
    body,
    '/api/templates'
  ).data.id
}

/**
 * A template we made, by its exact name, made since `since` (a create
 * whose answer was lost), never one of `skip` (ours known deleted); null
 * when there is none.
 */
export async function findTemplate(
  client: KlaviyoClient,
  name: string,
  since: Date,
  skip: ReadonlySet<string> = new Set()
) {
  const query = new URLSearchParams({
    'fields[template]': 'name,created',
    // The first made: ours, before any copy Klaviyo makes of it.
    sort: 'created',
    filter: `equals(name,"${name.replace(/[^A-Za-z0-9 ]/g, '')}"),greater-or-equal(created,${stamp(since)})`
  })
  const body = parsed(
    z.object({
      data: z.array(
        z.object({
          id: kid,
          attributes: z.object({ name: z.string().nullish() })
        })
      )
    }),
    await client.get(`/api/templates?${query}`, 'templates:read'),
    '/api/templates'
  )
  const ours = body.data.filter(
    (t) => t.attributes.name === name && !skip.has(t.id)
  )
  // A lost create shows once; more than one is our earlier lost ones: the
  // first made is used (a leftover template is harmless).
  return ours[0]?.id ?? null
}

/** A template's HTML; null when Klaviyo no longer has it. */
export async function templateHtml(client: KlaviyoClient, id: string) {
  let body: unknown
  try {
    body = await client.get(
      `/api/templates/${kid.parse(id)}?fields[template]=html`,
      'templates:read'
    )
  } catch (error) {
    if (gone(error)) return null
    throw error
  }
  return (
    parsed(
      z.object({
        data: z.object({ attributes: z.object({ html: z.string().nullish() }) })
      }),
      body,
      '/api/templates/'
    ).data.attributes.html ?? null
  )
}

export async function deleteTemplate(client: KlaviyoClient, id: string) {
  kid.parse(id)
  await client.write('DELETE', `/api/templates/${id}`, null, 'templates:write')
}

/**
 * A picture imported into Klaviyo's library from its address (hidden from
 * the library list); the address Klaviyo serves it from.
 */
export async function importImage(
  client: KlaviyoClient,
  url: string,
  name: string
) {
  const body = await client.write(
    'POST',
    '/api/images',
    {
      data: {
        type: 'image',
        attributes: {
          name: name.slice(0, 120),
          import_from_url: url,
          hidden: true
        }
      }
    },
    'images:write'
  )
  const imageUrl = parsed(
    z.object({
      data: z.object({
        type: z.literal('image'),
        id: kid,
        attributes: z.object({ image_url: z.string().url() })
      })
    }),
    body,
    '/api/images'
  ).data.attributes.image_url
  if (!imageUrl.startsWith('https://')) throw invalid('/api/images')
  return imageUrl
}

/** Whether a list or segment with this id is in the account. */
export async function audienceExists(client: KlaviyoClient, id: string) {
  kid.parse(id)
  for (const [path, scope] of [
    [`/api/segments/${id}?fields[segment]=name`, 'segments:read'],
    [`/api/lists/${id}?fields[list]=name`, 'lists:read']
  ] as const) {
    try {
      await client.get(path, scope)
      return true
    } catch (error) {
      if (!gone(error)) throw error
    }
  }
  return false
}

/**
 * A draft campaign to one list or segment, with no message yet (Step 0:
 * messages are made apart). `description` carries our mark, so a create
 * whose answer was lost is found again (`findOwnCampaign`).
 */
export async function createCampaign(
  client: KlaviyoClient,
  draft: {
    name: string
    description: string
    audienceId: string
    timezone: string
  }
) {
  kid.parse(draft.audienceId)
  const body = await client.write(
    'POST',
    '/api/campaigns',
    {
      data: {
        type: 'campaign',
        attributes: {
          definition: {
            name: draft.name.slice(0, 120),
            description: draft.description,
            send_settings: {
              send_strategy: 'simple',
              send_timezone: draft.timezone
            }
          },
          audiences: [
            {
              temporary_id: 'audience',
              included: [draft.audienceId],
              excluded: []
            }
          ]
        }
      }
    },
    'campaigns:write'
  )
  return parsed(
    z.object({ data: z.object({ type: z.literal('campaign'), id: kid }) }),
    body,
    '/api/campaigns'
  ).data.id
}

export type CampaignParts = {
  name: string | null
  description: string | null
  /** The campaign's audience (its first). */
  audienceRef: string | null
  messageIds: string[]
}

/** A campaign's audience and messages; null when Klaviyo no longer has it. */
export async function campaignParts(
  client: KlaviyoClient,
  campaignId: string
): Promise<CampaignParts | null> {
  const path =
    `/api/campaigns/${kid.parse(campaignId)}?fields[campaign]=definition.name,definition.description` +
    '&include=campaign-audiences,campaign-messages&fields[campaign-audience]=definition.included' +
    '&fields[campaign-message]=definition.name'
  let body: unknown
  try {
    body = await client.get(path, 'campaigns:read')
  } catch (error) {
    if (gone(error)) return null
    throw error
  }
  const data = parsed(
    z.object({
      data: z.object({
        type: z.literal('campaign'),
        id: kid,
        attributes: z.object({
          definition: z.object({
            name: z.string().nullish(),
            description: z.string().nullish()
          })
        }),
        relationships: z.object({
          'campaign-audiences': z.object({
            data: z.array(z.object({ id: kid }))
          }),
          'campaign-messages': z.object({
            data: z.array(z.object({ id: kid }))
          })
        })
      })
    }),
    body,
    '/api/campaigns/'
  ).data
  return {
    name: data.attributes.definition.name ?? null,
    description: data.attributes.definition.description ?? null,
    audienceRef: data.relationships['campaign-audiences'].data[0]?.id ?? null,
    messageIds: data.relationships['campaign-messages'].data.map((m) => m.id)
  }
}

/**
 * The campaign's email message with its variations, made in one request:
 * design A, or design A and B with an even test and no winner (EML-005),
 * so a draft never exists with two designs and Klaviyo's own A/B settings.
 * Its id.
 */
export async function createMessage(
  client: KlaviyoClient,
  message: {
    campaignId: string
    audienceRef: string
    name: string
    variations: VariationContent[]
  }
) {
  const even = message.variations.length === 2
  const body = await client.write(
    'POST',
    '/api/campaign-messages',
    {
      data: {
        type: 'campaign-message',
        attributes: {
          definition: {
            name: message.name.slice(0, 120),
            ...(even ? { ab_test: { winner_percentage: 0 } } : {})
          },
          variations: message.variations.map(variation)
        },
        relationships: {
          campaign: {
            data: { type: 'campaign', id: kid.parse(message.campaignId) }
          },
          'campaign-audience': {
            data: {
              type: 'campaign-audience',
              id: kid.parse(message.audienceRef)
            }
          }
        }
      }
    },
    'campaigns:write'
  )
  const data = parsed(
    z.object({
      data: z.object({
        type: z.literal('campaign-message'),
        id: kid,
        relationships: z
          .object({
            'campaign-variations': z
              .object({ data: z.array(z.object({ id: kid })).nullish() })
              .nullish()
          })
          .nullish()
      })
    }),
    body,
    '/api/campaign-messages'
  ).data
  return {
    messageId: data.id,
    /** Its variations, in the order given (when Klaviyo says). */
    variationIds: (data.relationships?.['campaign-variations']?.data ?? []).map(
      (v) => v.id
    )
  }
}

const variation = (v: VariationContent) => ({
  definition: {
    name: v.name,
    details: {
      channel: 'email',
      template_id: v.templateId,
      subject: v.subject.slice(0, 300),
      preview_text: v.preview.slice(0, 300)
    }
  }
})

/**
 * Campaigns made since `since` with this exact name and our mark (a create
 * whose answer was lost): matched here, not in Klaviyo's filter, so no name
 * is ever put in a query. More than one is `ambiguous` (never guessed).
 */
/** Another push's mark, whole (`pushMark` of a key). */
const otherMark = /^GROS draft [A-Za-z0-9_-]{1,64}$/

export async function findOwnCampaign(
  client: KlaviyoClient,
  own: { name: string; description: string; since: Date },
  pages = 5
): Promise<string | null | 'ambiguous'> {
  const query = new URLSearchParams({
    'fields[campaign]': 'definition.name,definition.description,created_at',
    filter: `greater-or-equal(created_at,${stamp(own.since)})`,
    sort: '-created_at',
    'page[size]': '100'
  })
  const page = z.object({
    data: z.array(
      z.object({
        type: z.literal('campaign'),
        id: kid,
        attributes: z.object({
          definition: z.object({
            name: z.string().nullish(),
            description: z.string().nullish()
          })
        })
      })
    ),
    links: z.object({ next: z.string().nullish() }).partial().nullish()
  })
  const ours: string[] = []
  let sameName = 0
  let body = parsed(
    page,
    await client.get(`/api/campaigns?${query}`, 'campaigns:read'),
    '/api/campaigns'
  )
  for (let n = 1; ; n++) {
    for (const c of body.data)
      if (c.attributes.definition.description === own.description)
        ours.push(c.id)
      // Our name without our mark: only another push's whole mark makes it
      // that push's; anything else (a mark changed in Klaviyo) is unknown.
      else if (
        c.attributes.definition.name === own.name.slice(0, 120) &&
        !otherMark.test(c.attributes.definition.description ?? '')
      )
        sameName++
    const next = body.links?.next
    if (!next) break
    // Not seen to the end: never guess that it is not there.
    if (n >= pages) return 'ambiguous'
    body = parsed(
      page,
      await client.next(next, 'campaigns:read'),
      '/api/campaigns'
    )
  }
  if (ours.length > 1) return 'ambiguous'
  // Our name without our mark: Klaviyo may not keep the mark; never guess.
  if (!ours.length && sameName) return 'ambiguous'
  return ours[0] ?? null
}

export type DraftVariation = {
  id: string
  name: string | null
  subject: string | null
  preview: string | null
  templateId: string | null
}
export type DraftRead = {
  /** draft, scheduled, sending, sent or cancelled. */
  status: string
  /** When it is (or was) sent, ISO; null while Klaviyo has no time for it. */
  sendTime: string | null
  campaignId: string
  description: string | null
  /** The share that gets a winner (0: everyone in the even test); null when none. */
  winnerPercentage: number | null
  variations: DraftVariation[]
}

const messagePath = (id: string) =>
  `/api/campaign-messages/${kid.parse(id)}?fields[campaign-message]=definition.status,definition.ab_test,definition.send_options.send_time` +
  '&include=campaign,campaign-variations&fields[campaign]=definition.name,definition.description' +
  '&fields[campaign-variation]=definition.name,definition.details'

const variationRecord = z.object({
  type: z.literal('campaign-variation'),
  id: kid,
  attributes: z.object({
    definition: z.object({
      name: z.string().nullish(),
      details: z
        .object({
          subject: z.string().nullish(),
          preview_text: z.string().nullish(),
          template_id: z.string().nullish()
        })
        .passthrough()
        .nullish()
    })
  })
})

/**
 * A draft's message read back: its status, A/B settings, campaign mark and
 * variations; null when Klaviyo no longer has it. Anything missing from
 * the answer (its campaign, its variations) is an unknown answer, never
 * "none".
 */
export async function readDraft(
  client: KlaviyoClient,
  messageId: string
): Promise<DraftRead | null> {
  let body: unknown
  try {
    body = await client.get(messagePath(messageId), 'campaigns:read')
  } catch (error) {
    if (gone(error)) return null
    throw error
  }
  const endpoint = '/api/campaign-messages/'
  const answer = parsed(
    z.object({
      data: z.object({
        type: z.literal('campaign-message'),
        id: kid,
        attributes: z.object({
          definition: z.object({
            status: z.string(),
            ab_test: z
              .object({ winner_percentage: z.number().int().nullish() })
              .nullish(),
            send_options: z
              .object({ send_time: z.string().nullish() })
              .passthrough()
              .nullish()
          })
        }),
        relationships: z.object({
          campaign: z.object({ data: z.object({ id: kid }) }),
          'campaign-variations': z.object({
            data: z.array(z.object({ id: kid })).min(1)
          })
        })
      }),
      included: z.array(z.unknown())
    }),
    body,
    endpoint
  )
  const campaignId = answer.data.relationships.campaign.data.id
  const campaign = answer.included
    .map((raw) =>
      z
        .object({
          type: z.literal('campaign'),
          id: kid,
          attributes: z.object({
            definition: z.object({ description: z.string().nullish() })
          })
        })
        .safeParse(raw)
    )
    .find((c) => c.success && c.data.id === campaignId)
  if (!campaign?.success) throw invalid(endpoint)
  const variations = answer.data.relationships['campaign-variations'].data.map(
    ({ id }) => {
      const found = answer.included
        .map((raw) => variationRecord.safeParse(raw))
        .find((v) => v.success && v.data.id === id)
      if (!found?.success) throw invalid(endpoint)
      const d = found.data.attributes.definition
      return {
        id,
        name: d.name ?? null,
        subject: d.details?.subject ?? null,
        preview: d.details?.preview_text ?? null,
        templateId: d.details?.template_id ?? null
      }
    }
  )
  return {
    status: answer.data.attributes.definition.status.toLowerCase(),
    sendTime: isoTime(
      answer.data.attributes.definition.send_options?.send_time
    ),
    campaignId,
    description: campaign.data.attributes.definition.description ?? null,
    winnerPercentage:
      answer.data.attributes.definition.ab_test?.winner_percentage ?? null,
    variations
  }
}

/** One variation's content replaced (subject, preview, template). */
export async function updateVariation(
  client: KlaviyoClient,
  id: string,
  content: VariationContent
) {
  kid.parse(id)
  await client.write(
    'PATCH',
    `/api/campaign-variations/${id}`,
    {
      data: {
        type: 'campaign-variation',
        id,
        attributes: variation(content)
      }
    },
    'campaigns:write'
  )
}

/** A variation taken out; true also when it was already gone. */
export async function deleteVariation(client: KlaviyoClient, id: string) {
  kid.parse(id)
  try {
    await client.write(
      'DELETE',
      `/api/campaign-variations/${id}`,
      null,
      'campaigns:write'
    )
  } catch (error) {
    if (!gone(error)) throw error
  }
}

/**
 * The message's A/B settings for an even test (EML-005): no share gets a
 * winner, so both designs go to half the audience each and Klaviyo picks
 * and sends nothing on its own.
 */
export async function setEvenTest(client: KlaviyoClient, messageId: string) {
  kid.parse(messageId)
  await client.write(
    'PATCH',
    `/api/campaign-messages/${messageId}`,
    {
      data: {
        type: 'campaign-message',
        id: messageId,
        attributes: { definition: { ab_test: { winner_percentage: 0 } } }
      }
    },
    'campaigns:write'
  )
}
