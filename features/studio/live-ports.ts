import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { BuildAgents } from '@/features/email-build/build'
import { agentCallMs } from '@/features/email-build/step-names'
import { keyPart } from '@/features/fallback/entry'
import type { FallbackLog } from '@/features/fallback/log'
import { critiqueSection } from './critic'
import type { StudioStepPorts } from './design-step'
import { designSection } from './designer'
import { critiqueEmail } from './email-critic'
import type { DrawnView, EmailViewPorts } from './email-check'
import { emailViewNames, requestEmailRender } from './preview-jobs'
import { renderScale, renderWidth } from './renderer'
import { requestSectionRender } from './render-jobs'
import { matchScore } from './match'
import { codedReasons } from './rounds'
import { storyboardFor } from './storyboard'
import { buildRenders, buildViews, type BuildRender } from './waits'
import type { ImageFetcher } from '@/lib/providers/image-fetch'
import { createImageFetcher } from '@/features/inbox/image-fetch'
import type { AiImage } from '@/lib/providers/contracts'

/**
 * DST-006c part 2b: the studio's ports in the email build (D25), for the
 * design step of one build under its claim's lease: the agents through
 * the build's metered AI (`BuildAgents`), the render job under the same
 * lease, the stored pictures read back only with their recorded tag, and
 * long-lived signed links for the pictures the email uses.
 */

type Db = SupabaseClient<Database>
const bucket = 'studio-renders'
/**
 * The studio's design step's time in one claim: the Art director's or the
 * critic's 3 tries, the product's photo and the picture read back fit,
 * inside the click's 110 s and the studio job's 105 s (the claims' own
 * deadlines still bound it; the sweep never runs the studio).
 */
export const studioStepMs = 90_000
/** A slack after each agent call, as the build's other agent steps keep. */
const callSlackMs = 2_000
/**
 * A picture's link lives a year: the draft holds it until Klaviyo copies
 * the picture when the draft is pushed (VISION rule 11), and a draft can
 * wait for its day.
 */
export const pictureLinkSeconds = 365 * 24 * 60 * 60
/**
 * The picture the email links to: a copy at a path no upload link
 * reaches (the browser's link uploads to render/<id>.jpg for 2 hours).
 */
export const finalPath = (render: string) => `final/${render}.jpg`
/** The product's own photo for the critic: small and quick, or none. */
const photoLimits = { maxBytes: 3 * 1024 * 1024, timeoutMs: 8_000 }
/** The critic's tries, as the rounds count them (`fits(3)`). */
const criticCalls = 3
/**
 * The studio's own photo fetcher (the inbox's guards: public hosts only,
 * ports 80 and 443, redirects checked, size and time capped), asking only
 * for what the critic takes, over https.
 */
export const studioPhotos: ImageFetcher = createImageFetcher({
  accept: 'image/jpeg,image/png,image/webp',
  protocols: ['https:']
})
/** A sample store's photos are never fetched: the critic goes without. */
export const noPhotos: ImageFetcher = {
  fetch: async () => ({ ok: false, failure: 'blocked' })
}

/** The photo's type by its bytes, as the critic takes them; else null. */
export function photoOf(bytes: Uint8Array): AiImage | null {
  const b = bytes
  const type =
    b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
      ? 'image/jpeg'
      : b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
        ? 'image/png'
        : b[0] === 0x52 &&
            b[1] === 0x49 &&
            b[2] === 0x46 &&
            b[3] === 0x46 &&
            b[8] === 0x57 &&
            b[9] === 0x45 &&
            b[10] === 0x42 &&
            b[11] === 0x50
          ? 'image/webp'
          : null
  return type
    ? { mediaType: type, base64: Buffer.from(b).toString('base64') }
    : null
}

/** A storage tag as stored (`"abc"`) or as read (`abc`), compared alike; never empty. */
const tagOf = (etag: string | undefined | null) => {
  const tag = (etag ?? '').replace(/^"|"$/g, '')
  return tag ? tag : null
}
/**
 * A storage answer: a missing object is null (the picture is gone); any
 * other error throws (storage or the network down: the step is tried
 * again, never coded for it).
 */
function stored<T>(answer: { data: T | null; error: unknown }): T | null {
  if (!answer.error) return answer.data
  const e = answer.error as { statusCode?: string | number; status?: number }
  if (String(e.statusCode ?? e.status ?? '') === '404') return null
  throw answer.error
}

export function studioPortsFor(
  db: Db,
  input: {
    tenant: string
    build: string
    lease: string
    agents: BuildAgents
    fallbacks: FallbackLog
    callerKey: string
    /** The store's industry, for the agents' do's and don'ts. */
    industry: string | null
    /** Reads the product's own photo for the critic (the live fetcher). */
    photos: ImageFetcher
    until: number
    now: () => number
  }
): StudioStepPorts {
  const ctx = {
    tenantId: input.tenant,
    industry: input.industry,
    callerKey: input.callerKey,
    memory: input.agents.memory,
    log: input.agents.log,
    ai: input.agents.ai,
    fallbacks: input.fallbacks
  }
  const fits = (calls = 1) =>
    input.now() + calls * agentCallMs + callSlackMs <= input.until
  const files = () => db.storage.from(bucket)
  /** One fetch per photo per claim; none when its time would not fit. */
  const photos = new Map<string, Promise<AiImage | null>>()
  const photoFor = (url: string) => {
    const left =
      input.until - input.now() - criticCalls * agentCallMs - callSlackMs
    const timeoutMs = Math.min(photoLimits.timeoutMs, left)
    if (timeoutMs < 1_000) return Promise.resolve(null)
    let got = photos.get(url)
    if (!got) {
      got = input.photos
        .fetch(url, { ...photoLimits, timeoutMs })
        .then((r) => (r.ok ? photoOf(r.bytes) : null))
        .catch(() => null)
      photos.set(url, got)
    }
    return got
  }
  /** The render's stored file, only while its tag is the one recorded. */
  const tagged = async (render: Extract<BuildRender, { state: 'drawn' }>) => {
    const info = stored(await files().info(render.path))
    const tag = tagOf(info?.etag)
    return tag !== null && tag === tagOf(render.etag)
  }
  return {
    storyboard: (board) => storyboardFor(board, ctx),
    design: (brief, from) =>
      designSection(brief, { ...ctx, fits: () => fits() }, from),
    async critique(brief, image) {
      // The product's own photo, so print on it is not read as drawn
      // words; without it (unreadable, too large, slow), the print counts
      // (the safe side).
      const photo = await photoFor(brief.image.url)
      return critiqueSection({ brief, image, ...(photo ? { photo } : {}) }, ctx)
    },
    // DST-004b2d: the score of the render's two grids, only when they are
    // of the crop this brief rebuilds; none when the browser read none.
    match: async (brief, render) =>
      render.grids && render.grids.referencePath === brief.reference?.image
        ? matchScore(render.grids.drawn, render.grids.reference)
        : null,
    request: ({ key, section, hosts, reference }) =>
      requestSectionRender(db, {
        build: input.build,
        lease: input.lease,
        key,
        section,
        hosts,
        ...(reference ? { reference } : {})
      }),
    renders: () =>
      buildRenders(db, { tenant: input.tenant, build: input.build }),
    async picture(render, section) {
      if (!(await tagged(render))) return null
      const file = stored(await files().download(render.path))
      if (!file) return null
      // Changed while it was read: not the picture the browser drew.
      if (!(await tagged(render))) return null
      const bytes = new Uint8Array(await file.arrayBuffer())
      // A single upload's tag is its bytes' MD5: the bytes read are the
      // tagged ones (a tag of another form is left to the checks above).
      const tag = tagOf(render.etag) ?? ''
      if (
        /^[0-9a-f]{32}$/i.test(tag) &&
        createHash('md5').update(bytes).digest('hex') !== tag.toLowerCase()
      )
        return null
      return {
        id: section,
        bytes,
        contentType: 'image/jpeg',
        width: renderWidth,
        height: render.height * renderScale
      }
    },
    async sign(render) {
      const drawn = (
        await buildRenders(
          db,
          { tenant: input.tenant, build: input.build },
          // Only to check the picture: never its grids.
          { grids: false }
        )
      ).find(
        // Read again: this build's, still drawn as the studio saw it.
        (r): r is Extract<BuildRender, { state: 'drawn' }> =>
          r.id === render.id &&
          r.state === 'drawn' &&
          r.path === render.path &&
          r.etag === render.etag
      )
      if (!drawn) return null
      // The copy the email links to, made from the picture as recorded:
      // its tag is checked before and after, and the copy's after.
      const final = finalPath(drawn.id)
      const copied = { ...drawn, path: final }
      if (!(await tagged(copied))) {
        if (!(await tagged(drawn))) return null
        const copy = await files().copy(drawn.path, final)
        const e = copy.error as { statusCode?: string | number } | null
        // Made by an earlier claim: its tag decides below.
        if (e && String(e.statusCode) !== '409') throw copy.error
        if (!(await tagged(drawn)) || !(await tagged(copied))) return null
      }
      const signed = await files().createSignedUrl(final, pictureLinkSeconds)
      const url = stored(signed)?.signedUrl
      if (!url) return null
      try {
        return new URL(url).protocol === 'https:' ? url : null
      } catch {
        return null
      }
    },
    async coded(section, reason) {
      await input.fallbacks.record({
        tenantId: input.tenant,
        campaignId: null,
        agent: 'design-studio',
        reasonCode: reason.startsWith('studio_') ? reason : `studio_${reason}`,
        reason: codedReasons[reason],
        fallback:
          reason === 'storyboard_reordered'
            ? 'Kept the email’s order, with the storyboard code makes.'
            : reason === 'reference_unfit'
              ? 'Designed the email’s sections from scratch, in the copied order.'
              : reason === 'layout_changed'
                ? 'Drew the email with its coded blocks.'
                : 'Drew the section as its coded block.',
        attempts: 1,
        detail: { section },
        dedupeKey: `design-studio:${keyPart(input.callerKey)}:${keyPart(section)}:${reason}`
      })
    },
    fits,
    now: input.now
  }
}

export { viewKey } from './email-check'

/** The width each view is drawn at (`renderEmail`). */
const viewWidth = { desktop: 600, phone: 375, dark: 600 } as const

export type { DrawnView, EmailViewPorts } from './email-check'

export function emailPortsFor(
  db: Db,
  input: {
    tenant: string
    build: string
    lease: string
    agents: BuildAgents
    fallbacks: FallbackLog
    callerKey: string
    industry: string | null
    email: { emailType: string; angle: string; brand: string }
  }
): EmailViewPorts {
  const files = () => db.storage.from(bucket)
  const tagged = async (view: DrawnView) => {
    const info = stored(await files().info(view.path))
    const tag = tagOf(info?.etag)
    return tag !== null && tag === tagOf(view.etag)
  }
  return {
    async ask(key, html) {
      for (const view of emailViewNames)
        await requestEmailRender(db, {
          build: input.build,
          lease: input.lease,
          key,
          view,
          html,
          brandName: input.email.brand
        })
    },
    views: async (key) =>
      (
        await buildViews(db, { tenant: input.tenant, build: input.build })
      ).filter((v) => v.key === key),
    async picture(view) {
      if (!(await tagged(view))) return null
      const file = stored(await files().download(view.path))
      if (!file) return null
      const bytes = new Uint8Array(await file.arrayBuffer())
      // Changed while it was read, or not the size recorded: not the
      // picture the browser drew.
      if (!(await tagged(view)) || bytes.byteLength !== view.bytes) return null
      // As a section's: a single upload's tag is its bytes' MD5, and the
      // bytes are a JPEG (the browser draws nothing else).
      const tag = tagOf(view.etag) ?? ''
      if (
        /^[0-9a-f]{32}$/i.test(tag) &&
        createHash('md5').update(bytes).digest('hex') !== tag.toLowerCase()
      )
        return null
      if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff))
        return null
      return {
        bytes,
        contentType: 'image/jpeg',
        width: viewWidth[view.view],
        height: view.height,
        cut: view.cut,
        wide: view.wide
      }
    },
    judge: (views) =>
      critiqueEmail(
        { email: input.email, views },
        {
          tenantId: input.tenant,
          industry: input.industry,
          callerKey: input.callerKey,
          memory: input.agents.memory,
          log: input.agents.log,
          ai: input.agents.ai,
          fallbacks: input.fallbacks
        }
      )
  }
}
