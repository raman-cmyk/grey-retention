import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { unstable_rethrow } from 'next/navigation'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import { offersPage } from '@/features/offers/data'
import { profilePageData } from '@/features/profile/data'
import { teamPage } from '@/features/team/data'
import { getServerEnvironment } from '@/lib/env/server'
import type { Database } from '@/lib/supabase/database.types'
import { createClient } from '@/lib/supabase/server'
import { listChangeHistory, type Change } from './change-history'

type Db = SupabaseClient<Database>

/** The Klaviyo connection as Settings shows it (never the key itself). */
export type KlaviyoState = {
  status: 'connected' | 'disconnected' | 'expired' | 'error' | 'none'
  /** `live`: a real key was checked with Klaviyo (KLV-001); `sample`: sample data. */
  mode: 'live' | 'sample'
  /**
   * The stored real key: `active`, or `refused` once Klaviyo turned it down;
   * null without one. Klaviyo is read only when the status is `connected`,
   * the mode `live` and the key `active`.
   */
  keyStatus: 'active' | 'refused' | null
  accountLabel: string | null
  /** The masked hint, e.g. "pk_abcde••••••••wxyz". */
  keyHint: string | null
  checkedAt: string | null
  /** Scopes later steps need that the key lacks (a warning). */
  missingLater: string[]
}

/**
 * Everything the Settings page needs (master handoff section 11), each part
 * null when it could not be read, so one failing part never hides the rest.
 */
export type SettingsReadModel = {
  state: 'ready' | 'demo'
  offers: Awaited<ReturnType<typeof offersPage>>
  klaviyo: KlaviyoState | null
  /**
   * Active members, invites not yet expired (null for staff, who do not see
   * invites, or when they could not be read), and whether this person may
   * manage the team.
   */
  team: {
    members: number
    openInvites: number | null
    canManage: boolean
  } | null
  account: { name: string; email: string } | null
  history: Change[] | null
  /** Not stored yet: it comes with the design studio (D25). */
  brandKit: { available: false; reason: string }
}

const brandKit = {
  available: false as const,
  reason: 'The brand kit comes with the design studio; nothing is stored yet.'
}
const statuses = ['connected', 'disconnected', 'expired', 'error'] as const

/** The workspace's Klaviyo connection and key, as its members may read them. */
export async function klaviyoState(
  db: Db,
  tenantId: string
): Promise<KlaviyoState | null> {
  const [connection, key] = await Promise.all([
    db
      .from('workspace_connections')
      .select('status,mode,account_label,credential_hint')
      .eq('tenant_id', tenantId)
      .eq('provider', 'klaviyo')
      .maybeSingle(),
    db
      .from('klaviyo_credentials')
      .select('key_hint,status,checked_at,later_missing')
      .eq('tenant_id', tenantId)
      .maybeSingle()
  ])
  if (connection.error || key.error) return null
  const row = connection.data
  if (!row)
    return {
      status: 'none',
      mode: 'sample',
      keyStatus: null,
      accountLabel: null,
      keyHint: null,
      checkedAt: null,
      missingLater: []
    }
  const status = (statuses as readonly string[]).includes(row.status)
    ? (row.status as KlaviyoState['status'])
    : 'error'
  const mode = row.mode === 'live' ? 'live' : 'sample'
  const stored = mode === 'live' ? key.data : null
  return {
    status,
    mode,
    keyStatus: stored
      ? stored.status === 'active'
        ? 'active'
        : 'refused'
      : null,
    accountLabel: row.account_label,
    keyHint: stored?.key_hint ?? row.credential_hint,
    checkedAt: stored?.checked_at ?? null,
    missingLater:
      stored?.status === 'active' ? (stored.later_missing ?? []) : []
  }
}

/** The Settings page's read model for the signed-in member's workspace. */
export async function settingsReadModel(
  context: ClientRequestContext
): Promise<SettingsReadModel> {
  const empty = {
    offers: null,
    klaviyo: null,
    team: null,
    account: null,
    history: null,
    brandKit
  }
  if (getServerEnvironment().AUTH_MODE === 'demo')
    return { state: 'demo', ...empty }
  const db = await createClient()
  if (!db) return { state: 'ready', ...empty }
  // A part that fails is null; Next's own redirects still go through.
  const settle = <T>(work: Promise<T>) =>
    work.catch((error: unknown) => {
      unstable_rethrow(error)
      return null
    })
  const [offers, klaviyo, team, account] = await Promise.all([
    settle(offersPage(context)),
    settle(klaviyoState(db, context.tenantId)),
    settle(teamPage(context)),
    settle(profilePageData())
  ])
  const teamReady = team && team.state === 'ready' ? team : null
  // Without the team, the changes still show (names then read "someone").
  const history = await settle(
    listChangeHistory(db, context.tenantId, teamReady?.members ?? [], {
      limit: 20,
      timeZone: context.timezone
    })
  )
  return {
    state: 'ready',
    offers,
    klaviyo,
    team: teamReady
      ? {
          members: teamReady.members.filter((m) => m.status === 'active')
            .length,
          openInvites:
            teamReady.canManage && teamReady.invites
              ? teamReady.invites.filter(
                  (i) => Date.parse(i.expiresAt) > teamReady.now
                ).length
              : null,
          canManage: teamReady.canManage
        }
      : null,
    account: account ? { name: account.name, email: account.email } : null,
    history,
    brandKit
  }
}
