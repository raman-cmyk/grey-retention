import 'server-only'
import { unstable_rethrow } from 'next/navigation'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import { klaviyoMode } from '@/features/connections/live-klaviyo'
import { feedbackPage, type FeedbackPage } from '@/features/feedback/data'
import type { FeatureRequest } from '@/features/feedback/rules'
import type { ManagedOffers } from '@/features/offers/source'
import { timezoneWithOffset } from '@/lib/brand-time'
import { localTime } from './defaults'
import {
  settingsReadModel,
  type KlaviyoState,
  type SettingsReadModel
} from './read-model'
import {
  brandTimezone,
  type BrandTimezone,
  type TimezoneSource
} from './timezone'

/**
 * The Settings screen (UI-SETa, master handoff section 11): the max
 * discount and codes, the Klaviyo connection, the brand timezone, the team
 * and the account, each read on its own so one that fails never hides the
 * others. Who may change what follows the server actions: the owner and
 * admins change offers; only the owner changes Klaviyo and the timezone.
 */
export type SettingsPart =
  | 'offers'
  | 'klaviyo'
  | 'timezone'
  | 'team'
  | 'account'
  | 'changes'
  | 'support'
  | 'requests'

export type SettingsView = {
  /** Nothing is kept in the demo: the cards say so. */
  demo: boolean
  owner: boolean
  /** The owner or an admin (`saveMaxDiscount` and the code actions). */
  editor: boolean
  offers: ManagedOffers | null
  klaviyo: KlaviyoState | null
  /** A key is checked with Klaviyo itself (KLAVIYO_MODE=live), else its format only. */
  liveKeys: boolean
  timezone: {
    /** As saved: sent back with a change, so another window is noticed. */
    saved: string
    label: string
    source: TimezoneSource
    at: string
    localTime: string
    /** Klaviyo's timezone, only when it is another zone than the brand's. */
    klaviyo: { zone: string; label: string } | null
    options: string[]
  } | null
  team: SettingsReadModel['team']
  account: SettingsReadModel['account']
  /** Who changed what (UI-SETc): the owner and managers only. */
  changes: SettingsReadModel['changes']
  /**
   * The workspace's support questions, newest first (UI-SETd): any member
   * asks and replies. `tenantId` goes back with a reply, as the action asks.
   */
  support: {
    threads: FeatureRequest[]
    team: string
    tenantId: string
  } | null
  /** The workspace's feature requests, newest first (UI-SETd): any member. */
  requests: { items: FeatureRequest[] } | null
  unread: SettingsPart[]
}

export type SettingsInput = {
  context: Pick<ClientRequestContext, 'tenantRole' | 'tenantId'>
  now: Date
  read: SettingsReadModel | null
  zone: BrandTimezone | null
  support: FeedbackPage | null
  requests: FeedbackPage | null
  liveKeys: boolean
}

/** The support threads and feature requests Settings shows, newest first. */
export const supportLimit = 10

/** The Settings view from its parts. Pure, for tests. */
export function settingsView(input: SettingsInput): SettingsView {
  const { read, zone, now } = input
  const role = input.context.tenantRole
  const view: SettingsView = {
    demo: read?.state === 'demo',
    owner: role === 'owner',
    editor: role === 'owner' || role === 'admin',
    offers: read?.offers ?? null,
    klaviyo: read?.klaviyo ?? null,
    liveKeys: input.liveKeys,
    timezone: zone
      ? {
          saved: zone.saved,
          label: timezoneWithOffset(zone.saved, now),
          source: zone.source,
          at: now.toISOString(),
          localTime: localTime(zone.saved, now),
          klaviyo:
            zone.klaviyoDiffers && zone.klaviyoTimezone
              ? {
                  zone: zone.klaviyoTimezone,
                  label: timezoneWithOffset(zone.klaviyoTimezone, now)
                }
              : null,
          options: zone.options
        }
      : null,
    team: read?.team ?? null,
    account: read?.account ?? null,
    changes: read?.changes ?? null,
    support:
      input.support?.state === 'ready'
        ? {
            threads: input.support.requests.slice(0, supportLimit),
            team: input.support.team,
            tenantId: input.context.tenantId
          }
        : null,
    requests:
      input.requests?.state === 'ready'
        ? { items: input.requests.requests.slice(0, supportLimit) }
        : null,
    unread: []
  }
  for (const part of [
    'offers',
    'klaviyo',
    'timezone',
    'team',
    'account',
    'support',
    'requests'
  ] as const)
    if (view[part] === null) view.unread.push(part)
  // Staff do not see the changes, so they are never missing for them.
  if (view.editor && view.changes === null) view.unread.push('changes')
  return view
}

/** A part that fails is null; Next's own redirects still go through. */
const settle = <T>(work: Promise<T>) =>
  work.catch((error: unknown) => {
    unstable_rethrow(error)
    return null
  })

/** Settings for the signed-in member's workspace. */
export async function settingsPageModel(
  context: ClientRequestContext,
  now = new Date()
): Promise<SettingsView> {
  const [read, zone, support, requests] = await Promise.all([
    settle(settingsReadModel(context)),
    settle(brandTimezone(context)),
    settle(feedbackPage(context, now.getTime(), { kind: 'support' })),
    settle(feedbackPage(context, now.getTime()))
  ])
  return settingsView({
    context,
    now,
    read,
    zone,
    support,
    requests,
    liveKeys: klaviyoMode() === 'live'
  })
}
