import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { BuildAgents } from '@/features/email-build/build'
import { agentCallMs } from '@/features/email-build/step-names'
import { keyPart } from '@/features/fallback/entry'
import type { FallbackLog } from '@/features/fallback/log'
import { critiqueSection } from './critic'
import type { StudioStepPorts } from './design-step'
import { designSection } from './designer'
import { renderScale, renderWidth } from './renderer'
import { requestSectionRender } from './render-jobs'
import { codedReasons } from './rounds'
import { storyboardFor } from './storyboard'
import { buildRenders, type BuildRender } from './waits'

/**
 * DST-006c part 2b: the studio's ports in the email build (D25), for the
 * design step of one build under its claim's lease: the agents through
 * the build's metered AI (`BuildAgents`), the render job under the same
 * lease, the stored pictures read back only with their recorded tag, and
 * long-lived signed links for the pictures the email uses.
 */

type Db = SupabaseClient<Database>
const bucket = 'studio-renders'
/** A slack after each agent call, as the build's other agent steps keep. */
const callSlackMs = 2_000
/**
 * A picture's link lives a year: the draft holds it until Klaviyo copies
 * the picture when the draft is pushed (VISION rule 11), and a draft can
 * wait for its day.
 */
export const pictureLinkSeconds = 365 * 24 * 60 * 60

/** A storage tag as stored (`"abc"`) or as read (`abc`), compared alike. */
const tagOf = (etag: string | undefined | null) =>
  (etag ?? '').replace(/^W\//, '').replace(/^"|"$/g, '')

export function studioPortsFor(
  db: Db,
  input: {
    tenant: string
    build: string
    lease: string
    agents: BuildAgents
    fallbacks: FallbackLog
    callerKey: string
    until: number
    now: () => number
  }
): StudioStepPorts {
  const ctx = {
    tenantId: input.tenant,
    callerKey: input.callerKey,
    memory: input.agents.memory,
    log: input.agents.log,
    ai: input.agents.ai,
    fallbacks: input.fallbacks
  }
  const fits = (calls = 1) =>
    input.now() + calls * agentCallMs + callSlackMs <= input.until
  const files = () => db.storage.from(bucket)
  /** The render's stored file, only while its tag is the one recorded. */
  const tagged = async (render: Extract<BuildRender, { state: 'drawn' }>) => {
    const info = await files().info(render.path)
    return !info.error && tagOf(info.data?.etag) === tagOf(render.etag)
  }
  return {
    storyboard: (board) => storyboardFor(board, ctx),
    design: (brief, from) =>
      designSection(brief, { ...ctx, fits: () => fits() }, from),
    critique: (brief, image) => critiqueSection({ brief, image }, ctx),
    request: ({ key, section, hosts }) =>
      requestSectionRender(db, {
        build: input.build,
        lease: input.lease,
        key,
        section,
        hosts
      }),
    renders: () =>
      buildRenders(db, { tenant: input.tenant, build: input.build }),
    async picture(render, section) {
      if (!(await tagged(render))) return null
      const file = await files().download(render.path)
      if (file.error || !file.data) return null
      // Changed while it was read: not the picture the browser drew.
      if (!(await tagged(render))) return null
      return {
        id: section,
        bytes: new Uint8Array(await file.data.arrayBuffer()),
        contentType: 'image/jpeg',
        width: renderWidth,
        height: render.height * renderScale
      }
    },
    async sign(render) {
      const drawn = (
        await buildRenders(db, {
          tenant: input.tenant,
          build: input.build
        })
      ).find(
        // Read again: this build's, still drawn as the studio saw it.
        (r): r is Extract<BuildRender, { state: 'drawn' }> =>
          r.id === render.id &&
          r.state === 'drawn' &&
          r.path === render.path &&
          r.etag === render.etag
      )
      if (!drawn || !(await tagged(drawn))) return null
      const signed = await files().createSignedUrl(
        drawn.path,
        pictureLinkSeconds
      )
      const url = signed.data?.signedUrl
      if (signed.error || !url) return null
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
        reasonCode: `studio_${reason}`,
        reason: codedReasons[reason],
        fallback: 'Drew the section as its coded block.',
        attempts: 1,
        detail: { section },
        dedupeKey: `design-studio:${keyPart(input.callerKey)}:${keyPart(section)}`
      })
    },
    fits,
    now: input.now
  }
}
