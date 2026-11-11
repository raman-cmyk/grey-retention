import 'server-only'
import { z } from 'zod'
import { KlaviyoError, type KlaviyoClient } from './client'

/**
 * The Klaviyo calls that make and change one draft campaign (PSH-001),
 * in the shapes revision 2026-10-15 publishes: an HTML template, a picture
 * imported into Klaviyo's library, a draft campaign with one message and
 * one or two variations (design A and design B), the message's A/B
 * settings, and reading it all back. Nothing here schedules or sends: the
 * client refuses any address that would (`isDraftWrite`).
 */

const kid = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const invalid = (endpoint: string) =>
  new KlaviyoError('invalid_response', { endpoint })
const parsed = <T>(schema: z.ZodType<T>, body: unknown, endpoint: string) => {
  const result = schema.safeParse(body)
  if (!result.success) throw invalid(endpoint)
  return result.data
}

/** One design's content on a variation. */
export type VariationContent = {
  /** "Design A" or "Design B": how a variation is told apart when read back. */
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

/**
 * A draft campaign: one email message to one list or segment, with one
 * variation per design, never scheduled. `description` carries our mark,
 * so a create whose answer was lost is found again (`findOwnCampaign`).
 */
export async function createDraftCampaign(
  client: KlaviyoClient,
  draft: {
    name: string
    description: string
    audienceId: string
    timezone: string
    variations: VariationContent[]
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
          ],
          messages: [
            {
              audience_temporary_id: 'audience',
              name: draft.name.slice(0, 120),
              variations: draft.variations.map(variation)
            }
          ]
        }
      }
    },
    'campaigns:write'
  )
  const data = parsed(
    z.object({
      data: z.object({
        type: z.literal('campaign'),
        id: kid,
        relationships: z.object({
          'campaign-messages': z.object({
            data: z.array(z.object({ id: kid })).length(1)
          })
        })
      })
    }),
    body,
    '/api/campaigns'
  ).data
  return {
    campaignId: data.id,
    messageId: data.relationships['campaign-messages'].data[0]!.id
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

const campaignRecord = z.object({
  type: z.literal('campaign'),
  id: kid,
  attributes: z.object({
    created_at: z.string().nullish(),
    definition: z.object({
      name: z.string().nullish(),
      description: z.string().nullish()
    })
  }),
  relationships: z
    .object({
      'campaign-messages': z
        .object({ data: z.array(z.object({ id: kid })).nullish() })
        .nullish()
    })
    .nullish()
})

const quoted = (s: string) => s.replace(/["\\]/g, ' ')

/**
 * A campaign we made, found by its exact name and our mark among those
 * created since `since`: when a create's answer was lost (a timeout), the
 * campaign may exist. More than one is `ambiguous` (never guessed).
 */
export async function findOwnCampaign(
  client: KlaviyoClient,
  own: { name: string; description: string; since: Date }
): Promise<{ campaignId: string; messageId: string } | null | 'ambiguous'> {
  const since = own.since.toISOString().replace(/\.\d{3}Z$/, 'Z')
  const path =
    '/api/campaigns?fields[campaign]=definition.name,definition.description,created_at' +
    `&filter=contains(name,"${quoted(own.name.slice(0, 120))}"),greater-or-equal(created_at,${since})` +
    '&include=campaign-messages&fields[campaign-message]=definition.name&page[size]=10'
  const body = parsed(
    z.object({ data: z.array(z.unknown()) }),
    await client.get(path, 'campaigns:read'),
    '/api/campaigns'
  )
  const ours = body.data.flatMap((raw) => {
    const c = campaignRecord.safeParse(raw)
    return c.success &&
      c.data.attributes.definition.name === own.name.slice(0, 120) &&
      c.data.attributes.definition.description === own.description
      ? [c.data]
      : []
  })
  if (ours.length > 1) return 'ambiguous'
  const found = ours[0]
  const messageId = found?.relationships?.['campaign-messages']?.data?.[0]?.id
  if (!found) return null
  if (!messageId) throw invalid('/api/campaigns')
  return { campaignId: found.id, messageId }
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
  campaignId: string | null
  description: string | null
  /** The share that gets a winner (0: everyone in the even test); null when none. */
  winnerPercentage: number | null
  variations: DraftVariation[]
}

const messagePath = (id: string) =>
  `/api/campaign-messages/${kid.parse(id)}?fields[campaign-message]=definition.status,definition.ab_test` +
  '&include=campaign,campaign-variations&fields[campaign]=definition.name,definition.description' +
  '&fields[campaign-variation]=definition.name,definition.details'

/**
 * A draft's message read back: its status, A/B settings, campaign mark and
 * variations; null when Klaviyo no longer has it (deleted in Klaviyo).
 */
export async function readDraft(
  client: KlaviyoClient,
  messageId: string
): Promise<DraftRead | null> {
  let body: unknown
  try {
    body = await client.get(messagePath(messageId), 'campaigns:read')
  } catch (error) {
    if (
      error instanceof KlaviyoError &&
      error.kind === 'rejected' &&
      (error.details.status === 404 || error.details.status === 410)
    )
      return null
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
              .nullish()
          })
        }),
        relationships: z
          .object({
            campaign: z
              .object({ data: z.object({ id: kid }).nullish() })
              .nullish(),
            'campaign-variations': z
              .object({ data: z.array(z.object({ id: kid })).nullish() })
              .nullish()
          })
          .nullish()
      }),
      included: z.array(z.unknown()).nullish()
    }),
    body,
    endpoint
  )
  const included = answer.included ?? []
  const campaignId = answer.data.relationships?.campaign?.data?.id ?? null
  const campaign = included
    .map((raw) => campaignRecord.safeParse(raw))
    .find((c) => c.success && c.data.id === campaignId)
  const variationIds = (
    answer.data.relationships?.['campaign-variations']?.data ?? []
  ).map((v) => v.id)
  const variations = variationIds.map((id) => {
    const found = included
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
  })
  return {
    status: answer.data.attributes.definition.status.toLowerCase(),
    campaignId,
    description: campaign?.success
      ? (campaign.data.attributes.definition.description ?? null)
      : null,
    winnerPercentage:
      answer.data.attributes.definition.ab_test?.winner_percentage ?? null,
    variations
  }
}

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

/** A variation added to a message; its id. */
export async function addVariation(
  client: KlaviyoClient,
  messageId: string,
  content: VariationContent
) {
  kid.parse(messageId)
  const body = await client.write(
    'POST',
    '/api/campaign-variations',
    {
      data: {
        type: 'campaign-variation',
        attributes: variation(content),
        relationships: {
          'campaign-message': {
            data: { type: 'campaign-message', id: messageId }
          }
        }
      }
    },
    'campaigns:write'
  )
  return parsed(
    z.object({
      data: z.object({ type: z.literal('campaign-variation'), id: kid })
    }),
    body,
    '/api/campaign-variations'
  ).data.id
}

export async function deleteVariation(client: KlaviyoClient, id: string) {
  kid.parse(id)
  await client.write(
    'DELETE',
    `/api/campaign-variations/${id}`,
    null,
    'campaigns:write'
  )
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
