import 'server-only'
import { observerAllowed } from '@/features/inbox/observer-access'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { inspirationBlueprint } from '@/features/inbox/blueprints'
import {
  blueprintWords,
  copyFailures,
  copyInputSchema,
  copyRecord,
  storedPhotos,
  photoPlaceholder,
  uploadWords,
  type BlueprintState,
  type CopyFailure,
  type CopyInput,
  type CopyState,
  type LibraryCopyPort,
  type UploadBlueprintState
} from './library-copy'
import { picturePath } from '@/features/email-uploads/intake'
import {
  uploadPlaceholderLeft,
  withUploadPictures
} from '@/features/email-uploads/pictures'

/**
 * DES-ENGINE-002b2: the library copy's live ports (service role), for one
 * claim of a build's design step:
 *
 * - `blueprint`: the chosen inspiration email only when the workspace may
 *   see it, on the terms Inspiration and the references use
 *   (`features/studio/reference-source.ts`): a brand it follows and has not
 *   hidden, or a sample brand for a sample workspace. Then its stored
 *   blueprint's state (`inspirationBlueprint`), each in plain words.
 * - `copy`: asks for the copy under the build's lease
 *   (`request_email_copy`, stored once) and reads it; a done copy's cut
 *   photos, pinned by the database in this build's own folder with their
 *   tag and size, are checked again (changed or gone: refused), signed for
 *   30 days and put in place of their placeholders, so Klaviyo can import
 *   them (rule 11).
 */

type Db = SupabaseClient<Database>

/**
 * How long a cut photo's link works: the push imports it into Klaviyo
 * within minutes, and the email's page shows it for 30 days (then its
 * photos are removed, `cleanCopyPhotos`).
 */
export const copyPhotoLinkSeconds = 30 * 24 * 60 * 60

const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/'))

/** Whether the workspace may see the email, and what the build needs of it. */
export async function visibleEmail(
  db: Db,
  tenant: string,
  competitorEmailId: string
): Promise<
  { ok: true; messageId: string | null; sourceNames: string[] } | { ok: false }
> {
  const email = await db
    .from('competitor_emails')
    .select('id,capture_id,external_id,inbox_message_id,synthetic')
    .eq('id', competitorEmailId)
    .maybeSingle()
  if (email.error) throw email.error
  if (!email.data || !(await observerAllowed([email.data])).length)
    return { ok: false }
  const brand = email.data.capture_id
  const [follows, hidden, profile, capture] = await Promise.all([
    db
      .from('competitor_subscriptions')
      .select('capture_id')
      .eq('tenant_id', tenant)
      .eq('capture_id', brand)
      .eq('active', true)
      .limit(1),
    db
      .from('competitor_hidden')
      .select('capture_id')
      .eq('tenant_id', tenant)
      .eq('capture_id', brand)
      .limit(1),
    db
      .from('brand_profiles')
      .select('synthetic')
      .eq('tenant_id', tenant)
      .maybeSingle(),
    db
      .from('competitor_captures')
      .select('brand_name,domain')
      .eq('id', brand)
      .maybeSingle()
  ])
  for (const r of [follows, hidden, profile, capture])
    if (r.error) throw r.error
  if (hidden.data?.length) return { ok: false }
  const sample = profile.data?.synthetic === true && email.data.synthetic
  if (!follows.data?.length && !sample) return { ok: false }
  const names = [capture.data?.brand_name?.trim(), capture.data?.domain]
    .filter((n): n is string => !!n)
    .map((n) => n.slice(0, 200))
  return {
    ok: true,
    messageId: email.data.inbox_message_id,
    sourceNames: [...new Set(names)]
  }
}

/** A copy's HTML with each uploaded photo's placeholder replaced by its link. */
export function withPhotoLinks(
  html: string,
  links: ReadonlyMap<number, string>
) {
  let out = html
  for (const [index, url] of links)
    out = out.split(photoPlaceholder(index)).join(url)
  return out
}

/** A placeholder still in the HTML: a photo that was never uploaded. */
const placeholderLeft = /https:\/\/email-copies\.invalid\//

export function libraryPortsFor(
  db: Db,
  input: { tenant: string; build: string; lease: string; upload?: string }
): LibraryCopyPort {
  /** Asks for the copy (stored once), reads it, and signs its cut photos. */
  const ask = async (
    source: { message: string } | { upload: string },
    copyIn: CopyInput,
    photos: number
  ): Promise<CopyState> => {
    // Checked here too: only input the browser job can read is stored.
    if (!copyInputSchema.safeParse(copyIn).success)
      return { state: 'failed', reason: copyFailures.input_invalid }
    const asked = await db.rpc('request_email_copy', {
      build: input.build,
      lease: input.lease,
      ...('upload' in source
        ? { upload: source.upload, message: null }
        : { message: source.message }),
      input: copyIn as unknown as Json,
      photos
    } as never)
    if (asked.error) {
      if (asked.error.details === 'no_blueprint')
        return { state: 'failed', reason: copyFailures.blueprint_gone }
      throw asked.error
    }
    return settled(asked.data)
  }
  /** A done copy's cut photos, checked and signed in place of their placeholders. */
  const settled = async (data: unknown): Promise<CopyState> => {
    const got = data as {
      state?: unknown
      result?: unknown
      failure?: unknown
    } | null
    if (got?.state === 'queued') return { state: 'queued' }
    if (got?.state === 'failed') {
      const code = String(got.failure) as CopyFailure
      return {
        state: 'failed',
        reason: Object.hasOwn(copyFailures, code)
          ? copyFailures[code]
          : copyFailures.copy_failed
      }
    }
    const record = copyRecord.safeParse(got?.result)
    if (got?.state !== 'done' || !record.success)
      return { state: 'failed', reason: copyFailures.copy_failed }
    const pinned = storedPhotos.safeParse(
      (got.result as { stored?: unknown } | null)?.stored
    )
    if (!pinned.success)
      return { state: 'failed', reason: copyFailures.copy_failed }
    const pins = new Map(pinned.data.map((p) => [p.index, p]))
    const own = `${input.tenant}/${input.build}/`
    const indexes = [...new Set(record.data.photos)]
    if (indexes.some((i) => !pins.get(i)?.path.startsWith(own)))
      return { state: 'failed', reason: copyFailures.copy_failed }
    const links = new Map<number, string>()
    if (indexes.length) {
      const files = db.storage.from('email-copies')
      const folders = [...new Set(indexes.map((i) => dirOf(pins.get(i)!.path)))]
      const seen = new Map<string, { etag?: unknown; size?: unknown }>()
      for (const folder of folders) {
        const listed = await files.list(folder, { limit: 100 })
        if (listed.error) throw listed.error
        for (const f of listed.data ?? [])
          seen.set(`${folder}/${f.name}`, {
            etag: f.metadata?.eTag,
            size: f.metadata?.size
          })
      }
      for (const i of indexes) {
        const pin = pins.get(i)!
        const now = seen.get(pin.path)
        if (
          !now ||
          now.etag !== pin.etag ||
          (pin.size !== null && Number(now.size) !== pin.size)
        )
          return { state: 'failed', reason: copyFailures.photo_changed }
      }
      const signed = await files.createSignedUrls(
        indexes.map((i) => pins.get(i)!.path),
        copyPhotoLinkSeconds
      )
      if (signed.error) throw signed.error
      for (const [n, s] of (signed.data ?? []).entries()) {
        const url = s.signedUrl
        if (!url || s.error) throw new Error('copy_photo_link_failed')
        if (new URL(url).protocol !== 'https:' && !isLocal(url))
          throw new Error('copy_photo_link_failed')
        links.set(indexes[n]!, url)
      }
    }
    const html = withPhotoLinks(record.data.html, links)
    if (placeholderLeft.test(html))
      return { state: 'failed', reason: copyFailures.copy_failed }
    return { state: 'done', record: { ...record.data, html } }
  }
  return {
    ...(input.upload
      ? {
          upload: input.upload,
          // DES-ENGINE-003b: the workspace's own upload, ready, of this workspace.
          async uploadBlueprint(uploadId): Promise<UploadBlueprintState> {
            const row = await db
              .from('email_uploads')
              .select('state,design,failure')
              .eq('id', uploadId)
              .eq('tenant_id', input.tenant)
              .maybeSingle()
            if (row.error) throw row.error
            if (!row.data || row.data.state === 'deleting')
              return { state: 'unusable', reason: uploadWords.gone }
            if (row.data.state === 'saving' || row.data.state === 'measuring')
              return { state: 'waiting' }
            if (row.data.state !== 'ready')
              return { state: 'unusable', reason: uploadWords.failed }
            return {
              state: 'ready',
              design: row.data.design === 'other' ? 'other' : 'own'
            }
          },
          async copyUpload(uploadId, copyIn, photos): Promise<CopyState> {
            const got = await ask({ upload: uploadId }, copyIn, photos)
            if (got.state !== 'done' || !copyIn.keepLook) return got
            // The brand's own pictures, as pinned when it was added, signed
            // in place of their placeholders (Klaviyo imports them, rule 11).
            const links = await uploadPictureLinks(db, input.tenant, uploadId)
            if (!links) return { state: 'failed', reason: uploadWords.pictures }
            const html = withUploadPictures(got.record.html, links)
            if (uploadPlaceholderLeft.test(html))
              return { state: 'failed', reason: uploadWords.pictures }
            return { state: 'done', record: { ...got.record, html } }
          }
        }
      : {}),
    async blueprint(competitorEmailId): Promise<BlueprintState> {
      const seen = await visibleEmail(db, input.tenant, competitorEmailId)
      if (!seen.ok) return { state: 'unusable', reason: blueprintWords.hidden }
      const stored = await inspirationBlueprint(db, competitorEmailId)
      if (stored.state === 'waiting') return { state: 'waiting' }
      if (stored.state === 'none' || !seen.messageId)
        return { state: 'unusable', reason: blueprintWords.none }
      if (stored.state === 'failed')
        return { state: 'unusable', reason: stored.reason }
      return {
        state: 'ready',
        messageId: seen.messageId,
        sourceNames: seen.sourceNames
      }
    },
    copy: (messageId, copyIn, photos) =>
      ask({ message: messageId }, copyIn, photos)
  }
}

/**
 * DES-ENGINE-003b: an own design's stored pictures, each still the one
 * pinned when it was added (its tag and size), signed for 30 days; null
 * when one changed or is gone.
 */
export async function uploadPictureLinks(
  db: Db,
  tenant: string,
  upload: string,
  /** How long the links work: 30 days for a draft, minutes for a preview. */
  seconds: number = copyPhotoLinkSeconds
): Promise<Map<number, string> | null> {
  const row = await db
    .from('email_uploads')
    .select('pictures')
    .eq('id', upload)
    .eq('tenant_id', tenant)
    .maybeSingle()
  if (row.error) throw row.error
  const pictures = (
    Array.isArray(row.data?.pictures) ? row.data.pictures : []
  ) as {
    index?: unknown
    type?: unknown
    bytes?: unknown
    etag?: unknown
  }[]
  const links = new Map<number, string>()
  if (!pictures.length) return links
  const folder = `${tenant}/${upload}`
  const files = db.storage.from('email-uploads')
  const listed = await files.list(folder, { limit: 100 })
  if (listed.error) throw listed.error
  const seen = new Map(
    (listed.data ?? []).map((f) => [
      f.name,
      f.metadata as { eTag?: unknown; size?: unknown } | null
    ])
  )
  const paths: string[] = []
  for (const p of pictures) {
    const path = picturePath(tenant, upload, {
      index: Number(p.index),
      type: String(p.type)
    })
    const now = seen.get(path.slice(folder.length + 1))
    if (!now || now.eTag !== p.etag || Number(now.size) !== Number(p.bytes))
      return null
    paths.push(path)
  }
  const signed = await files.createSignedUrls(paths, seconds)
  if (signed.error) throw signed.error
  for (const [n, s] of (signed.data ?? []).entries()) {
    if (!s.signedUrl || s.error) return null
    if (new URL(s.signedUrl).protocol !== 'https:' && !isLocal(s.signedUrl))
      return null
    links.set(Number(pictures[n]!.index), s.signedUrl)
  }
  return links
}

/** The local Supabase (development and tests) signs http links on loopback. */
function isLocal(url: string) {
  try {
    const u = new URL(url)
    return (
      process.env.NODE_ENV !== 'production' &&
      u.protocol === 'http:' &&
      (u.hostname === '127.0.0.1' || u.hostname === 'localhost')
    )
  } catch {
    return false
  }
}
