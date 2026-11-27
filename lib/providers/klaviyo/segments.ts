import 'server-only'
import { z } from 'zod'
import { metricsPath, readPages, type MorePages } from './catalog'
import { KlaviyoError, type KlaviyoClient } from './client'
import { grosSegmentNamePattern } from './segment-name'

/**
 * PICK-101 (list hygiene): the Klaviyo calls behind GROS's own exclusion
 * segment, in the shapes revision 2026-10-15 publishes. Reads: the metrics
 * the rule needs, a segment by its exact name, a segment's size. One write:
 * making the segment (`POST /api/segments`), which the client allows only
 * for a GROS list-hygiene name and only with the write lock released.
 * Nothing here changes or deletes a segment.
 */

const kid = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const invalid = (endpoint: string) =>
  new KlaviyoError('invalid_response', { endpoint })
const gone = (error: unknown) =>
  error instanceof KlaviyoError &&
  error.kind === 'rejected' &&
  (error.details.status === 404 || error.details.status === 410)

/** The metrics the rule reads, by their id in this account (null: missing). */
export type HygieneMetrics = {
  receivedEmail: string | null
  clickedEmail: string | null
  openedEmail: string | null
  activeOnSite: string | null
  placedOrder: string | null
}

const metricRecord = z.object({
  type: z.literal('metric'),
  id: kid,
  attributes: z.object({
    name: z.string().max(200),
    integration: z.object({ name: z.string().max(200).nullish() }).nullish()
  })
})

/** At most this many pages of metrics (Klaviyo's 200 a page). */
const maxMetricPages = 5

/**
 * The account's email metrics (Klaviyo's own), its Active on Site and its
 * Placed Order (a store platform's first, one sent through the API last).
 * `complete` is false when not every page was read: a missing metric then
 * means "not seen", not "not there".
 */
export async function readHygieneMetrics(
  client: KlaviyoClient,
  more: MorePages = () => true
): Promise<HygieneMetrics & { complete: boolean }> {
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
  const orders = read.records
    .filter((m) => m.attributes.name === 'Placed Order')
    .sort(
      (a, b) =>
        Number(source(a) === 'api' || !source(a)) -
        Number(source(b) === 'api' || !source(b))
    )
  return {
    receivedEmail: klaviyos('Received Email'),
    clickedEmail: klaviyos('Clicked Email'),
    openedEmail: klaviyos('Opened Email'),
    activeOnSite: klaviyos('Active on Site'),
    placedOrder: orders[0]?.id ?? null,
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

/**
 * Our segments with exactly this name, oldest first (a create whose answer
 * was lost shows here; more than one is our earlier lost ones). Only a
 * GROS name is ever looked up.
 */
export async function findSegmentsByName(client: KlaviyoClient, name: string) {
  if (!grosSegmentNamePattern.test(name)) throw invalid('/api/segments')
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

/** Makes GROS's segment (never starred); its id. */
export async function createSegment(
  client: KlaviyoClient,
  name: string,
  definition: Record<string, unknown>
) {
  const body = await client.write(
    'POST',
    '/api/segments',
    {
      data: {
        type: 'segment',
        attributes: { name, definition, is_starred: false }
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

/**
 * How many people the segment holds now (Klaviyo counts it by itself, so
 * a new one may say null for a while); `gone` when Klaviyo no longer has it.
 */
export async function segmentSize(
  client: KlaviyoClient,
  id: string
): Promise<number | null | 'gone'> {
  let body: unknown
  try {
    body = await client.get(
      `/api/segments/${kid.parse(id)}?fields[segment]=name&additional-fields[segment]=profile_count`,
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
          profile_count: z.number().int().min(0).max(1e12).nullish()
        })
      })
    })
    .safeParse(body)
  if (!parsed.success) throw invalid('/api/segments/')
  return parsed.data.data.attributes.profile_count ?? null
}
