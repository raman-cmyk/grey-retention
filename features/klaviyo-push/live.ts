import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { klaviyoMode, revisionOk } from '@/features/connections/live-klaviyo'
import { logger } from '@/lib/logger'
import { KlaviyoError, klaviyoClient } from '@/lib/providers/klaviyo/client'
import {
  fakeDraftPusher,
  type DraftPusher
} from '@/lib/providers/klaviyo-draft'
import {
  liveDraftPusher,
  type PushProgress,
  type PushSource,
  type PushStep,
  type PushStore
} from './pusher'

type Db = SupabaseClient<Database>
type Env = Record<string, string | undefined>

/** Each Klaviyo request waits at most this long (a write may then be checked again). */
export const pushCallMs = 6_000

/** The push steps in `klaviyo_draft_pushes`, saved through `save_klaviyo_push`. */
export function databasePushStore(db: Db): PushStore {
  return {
    async load({ tenantId, key }) {
      const { data, error } = await db
        .from('klaviyo_draft_pushes')
        .select(
          'state,images,templates,campaign_id,message_id,create_started_at,message_started_at,template_started_at,audience_id,designs,fallback,ab,reason,written,target'
        )
        .eq('tenant_id', tenantId)
        .eq('push_key', key)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      return {
        state: data.state as PushProgress['state'],
        images: (data.images ?? {}) as Record<string, string>,
        templates: (data.templates ?? []) as PushProgress['templates'],
        campaignId: data.campaign_id,
        messageId: data.message_id,
        createStartedAt: data.create_started_at,
        messageStartedAt: data.message_started_at,
        templateStartedAt: data.template_started_at,
        audienceId: data.audience_id,
        ab: data.ab as PushProgress['ab'],
        target: data.target,
        designs: data.designs as PushProgress['designs'],
        fallback: data.fallback,
        reason: data.reason,
        written: data.written
      }
    },
    async save({ build, lease }, step: PushStep) {
      const row: Record<string, unknown> = {}
      const names: [keyof PushStep, string][] = [
        ['state', 'state'],
        ['images', 'images'],
        ['templates', 'templates'],
        ['campaignId', 'campaign_id'],
        ['messageId', 'message_id'],
        ['createStartedAt', 'create_started_at'],
        ['messageStartedAt', 'message_started_at'],
        ['templateStartedAt', 'template_started_at'],
        ['audienceId', 'audience_id'],
        ['ab', 'ab'],
        ['target', 'target'],
        ['designs', 'designs'],
        ['fallback', 'fallback'],
        ['checks', 'checks'],
        ['reason', 'reason'],
        ['written', 'written']
      ]
      for (const [from, to] of names)
        if (from in step) row[to] = step[from] ?? null
      const { error } = await db.rpc('save_klaviyo_push', {
        build,
        lease,
        step: row as Json
      })
      if (error) throw error
    }
  }
}

/**
 * The workspace's live Klaviyo: only when the owner's switch is on
 * (`KLAVIYO_MODE=live`), at the revision this client is written for, and
 * with the key the owner connected (`klaviyo_api_key`: a live, connected
 * workspace with an active key; the worker only).
 */
export function liveSource(db: Db, env: Env = process.env): PushSource {
  return {
    async client(tenantId) {
      if (!draftPushLive(env)) return null
      // A server setting, not the owner's key: tried again, never "auth".
      if (!revisionOk(env)) {
        logger.error(
          'Klaviyo push: KLAVIYO_API_REVISION is not the one this client is written for'
        )
        throw new KlaviyoError('unavailable', { endpoint: 'revision' })
      }
      const { data, error } = await db.rpc('klaviyo_api_key', { t: tenantId })
      if (error) throw error
      // No wait inside a request: a busy Klaviyo is the build's wait.
      return data
        ? klaviyoClient(data, { timeoutMs: pushCallMs, maxWaits: 0 })
        : null
    },
    async timezone(tenantId) {
      const { data, error } = await db
        .from('tenants')
        .select('timezone')
        .eq('id', tenantId)
        .single()
      if (error) throw error
      return data.timezone || 'UTC'
    }
  }
}

/**
 * Writing drafts into a real Klaviyo account is its own switch, the
 * owner's, off by default: `KLAVIYO_DRAFT_PUSH=live`, on top of
 * `KLAVIYO_MODE=live` (KLV-001's reads). One without the other writes
 * nothing.
 */
export const draftPushLive = (env: Env) =>
  klaviyoMode(env) === 'live' && env.KLAVIYO_DRAFT_PUSH === 'live'

/**
 * The pusher "Create email" uses: the sample store's emails always get a
 * sample draft (no Klaviyo call); a real email goes to the workspace's own
 * Klaviyo only when the owner's write switch is on, else the fake as
 * before. `deadline` is a time no push goes past (its route's end).
 */
export function draftPusherFor(
  db: Db,
  options: { env?: Env; budgetMs?: number; deadline?: number } = {}
): DraftPusher {
  const env = options.env ?? process.env
  const fake = fakeDraftPusher()
  if (!draftPushLive(env)) return fake
  const live = liveDraftPusher({
    source: liveSource(db, env),
    store: databasePushStore(db),
    budgetMs: options.budgetMs,
    deadline: options.deadline,
    callMs: pushCallMs
  })
  return {
    createDraft: (input) =>
      input.sample ? fake.createDraft(input) : live.createDraft(input)
  }
}
