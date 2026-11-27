import 'server-only'
import { z } from 'zod'
import { metricsPath, readPages, type MorePages } from './catalog'
import { KlaviyoError, type KlaviyoClient } from './client'
import {
  hygieneSegmentDefinition,
  hygieneSegmentName,
  hygieneSegmentNamePattern,
  type HygieneSegmentSpec
} from './hygiene-segment'

/**
 * PICK-101 (list hygiene): the Klaviyo calls behind the store's exclusion
 * segment, in the shapes revision 2026-10-15 publishes. Reads: the
 * account's id, the metrics the rule needs, segments by exact name, one
 * segment's definition and size. One write: making the segment, built here
 * from typed inputs (`createHygieneSegment`); the client lets it through
 * only for a definition shaped as the app builds it, and only with the
 * write lock released. Nothing here changes or deletes a segment.
 */

const kid = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const invalid = (endpoint: string) =>
  new KlaviyoError('invalid_response', { endpoint })
const gone = (error: unknown) =>
  error instanceof KlaviyoError &&
  error.kind === 'rejected' &&
  (error.details.status === 404 || error.details.status === 410)

/** The account the key belongs to (a reconnect may be another account). */
export async function readAccountId(client: KlaviyoClient) {
  const parsed = z
    .object({
      data: z.array(z.object({ type: z.literal('account'), id: kid })).min(1)
    })
    .safeParse(
      await client.get(
        '/api/accounts?fields[account]=timezone',
        'accounts:read'
      )
    )
  if (!parsed.success) throw invalid('/api/accounts')
  return parsed.data.data[0]!.id
}

/** The metrics the rule reads, by their id in this account. */
export type HygieneMetrics = {
  /** Klaviyo's own email metrics (null: not in the account). */
  receivedEmail: string | null
  clickedEmail: string | null
  openedEmail: string | null
  /** Every Active on Site metric, whichever integration sends it. */
  activeOnSite: string[]
  /** Every Placed Order metric, whichever integration sends it. */
  placedOrders: string[]
  /** False when not every page was read: then nothing is certain. */
  complete: boolean
}

const metricRecord = z.object({
  type: z.literal('metric'),
  id: kid,
  attributes: z.object({
    name: z.string().max(200),
    integration: z.object({ name: z.string().max(200).nullish() }).nullish()
  })
})

/** At most this many pages of metrics. */
const maxMetricPages = 5

export async function readHygieneMetrics(
  client: KlaviyoClient,
  more: MorePages = () => true
): Promise<HygieneMetrics> {
  const read = await readPages(
    client,
    metricsPath,
    'metrics:read',
    maxMetricPages,
    more,
    (body) => {
      let skipped = 0
      const records = body.data.flatMap((raw) => {
        const m = metricRecord.safeParse(raw)
        if (m.success) return [m.data]
        skipped++
        return []
      })
      return { records, skipped }
    }
  )
  const source = (m: (typeof read.records)[number]) =>
    (m.attributes.integration?.name ?? '').toLowerCase()
  const klaviyos = (name: string) =>
    read.records.find(
      (m) => m.attributes.name === name && source(m) === 'klaviyo'
    )?.id ?? null
  const all = (name: string) =>
    [
      ...new Set(
        read.records.filter((m) => m.attributes.name === name).map((m) => m.id)
      )
    ].sort()
  return {
    receivedEmail: klaviyos('Received Email'),
    clickedEmail: klaviyos('Clicked Email'),
    openedEmail: klaviyos('Opened Email'),
    activeOnSite: all('Active on Site'),
    placedOrders: all('Placed Order'),
    complete: read.complete && read.skipped === 0
  }
}

const segmentRecord = z.object({
  type: z.literal('segment'),
  id: kid,
  attributes: z.object({
    name: z.string().max(400).nullish(),
    created: z.string().nullish()
  })
})

/** At most this many pages when looking a segment up by name. */
const maxNamePages = 3

/** Segments with exactly this list-hygiene name, oldest first. */
export async function findSegmentsByName(client: KlaviyoClient, name: string) {
  if (!hygieneSegmentNamePattern.test(name)) throw invalid('/api/segments')
  const query = new URLSearchParams({
    'fields[segment]': 'name,created',
    filter: `equals(name,"${name}")`
  })
  const read = await readPages(
    client,
    `/api/segments?${query}`,
    'segments:read',
    maxNamePages,
    () => true,
    (body) => ({
      records: body.data.flatMap((raw) => {
        const s = segmentRecord.safeParse(raw)
        return s.success && s.data.attributes.name === name ? [s.data] : []
      }),
      skipped: 0
    })
  )
  return read.records
    .sort(
      (a, b) =>
        (a.attributes.created ?? '').localeCompare(
          b.attributes.created ?? ''
        ) || a.id.localeCompare(b.id)
    )
    .map((s) => s.id)
}

/**
 * One segment's definition and size (Klaviyo counts it by itself, so a new
 * one may say null for a while); `gone` when Klaviyo no longer has it.
 */
export async function readSegment(
  client: KlaviyoClient,
  id: string
): Promise<{ definition: unknown; profileCount: number | null } | 'gone'> {
  let body: unknown
  try {
    body = await client.get(
      `/api/segments/${kid.parse(id)}?fields[segment]=name,definition&additional-fields[segment]=profile_count`,
      'segments:read'
    )
  } catch (error) {
    if (gone(error)) return 'gone'
    throw error
  }
  const parsed = z
    .object({
      data: z.object({
        type: z.literal('segment'),
        attributes: z.object({
          definition: z.unknown().optional(),
          profile_count: z.number().int().min(0).max(1e12).nullish()
        })
      })
    })
    .safeParse(body)
  if (!parsed.success) throw invalid('/api/segments/')
  return {
    definition: parsed.data.data.attributes.definition ?? null,
    profileCount: parsed.data.data.attributes.profile_count ?? null
  }
}

/** Makes the list-hygiene segment for `spec` (never starred); its id. */
export async function createHygieneSegment(
  client: KlaviyoClient,
  spec: HygieneSegmentSpec
) {
  const definition = hygieneSegmentDefinition(spec)
  if (!definition) throw invalid('/api/segments')
  const body = await client.write(
    'POST',
    '/api/segments',
    {
      data: {
        type: 'segment',
        attributes: {
          name: hygieneSegmentName(spec),
          definition,
          is_starred: false
        }
      }
    },
    'segments:write'
  )
  const parsed = z
    .object({ data: z.object({ type: z.literal('segment'), id: kid }) })
    .safeParse(body)
  if (!parsed.success) throw invalid('/api/segments')
  return parsed.data.data.id
}
