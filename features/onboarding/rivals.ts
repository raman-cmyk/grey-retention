import 'server-only'
import { unstable_rethrow } from 'next/navigation'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import { isSampleDomain } from '@/features/library/inspirations/domain'
import { getServerEnvironment } from '@/lib/env/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  readCompetitorSuggestions,
  type CompetitorSuggestion
} from './suggested-competitors'

/**
 * The Rivals step's read (UI-ONBe): the brands the workspace follows and
 * the inbox brands suggested for its industry (ONB-065a, REAL-01a), with
 * whether each can be followed now: only sample `.example` brands can be
 * (following a real brand waits for REAL-01b), so a real store sees its
 * suggestions with Hide, and skips. Read with the member's own client;
 * only the inbox's brands are asked for with the server's client, after
 * the member's own read (`readCompetitorSuggestions`).
 */
/** The most brands a workspace follows (`trackDomain`'s own limit). */
export const maxFollowed = 10

export type SetupRivals = {
  /** The workspace runs on sample data (a synthetic brand). */
  sample: boolean
  /** The labels of the brands followed now. */
  following: string[]
  /** null when they could not be read. */
  suggestions: (CompetitorSuggestion & { followable: boolean })[] | null
}

export async function setupRivals(
  context: ClientRequestContext
): Promise<SetupRivals | null> {
  if (getServerEnvironment().AUTH_MODE === 'demo') return null
  const db = await createClient()
  if (!db) return null
  const [profile, following] = await Promise.all([
    db
      .from('brand_profiles')
      .select('synthetic')
      .eq('tenant_id', context.tenantId)
      .maybeSingle(),
    db
      .from('competitor_subscriptions')
      .select('label')
      .eq('tenant_id', context.tenantId)
      .eq('active', true)
      .order('label')
  ])
  if (profile.error || following.error) return null
  const service = createServiceClient()
  const suggestions = service
    ? await readCompetitorSuggestions(db, context.tenantId, { service }).catch(
        (error: unknown) => {
          unstable_rethrow(error)
          return null
        }
      )
    : null
  return {
    sample: profile.data?.synthetic === true,
    following: (following.data ?? []).map((f) => f.label),
    suggestions:
      suggestions?.map((s) => ({
        ...s,
        followable: isSampleDomain(s.domain)
      })) ?? null
  }
}
