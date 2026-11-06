import { z } from 'zod'

/**
 * Settings "Campaign defaults" (docs/UI_REBUILD_SPEC.md §11). Limits mirror
 * `public.save_campaign_defaults` (migration 20260914090020).
 */
export type CampaignDefaults = {
  featuredProductId: string | null
  senderName: string
  primaryLink: string
  sendTo: string[]
  dontSendTo: string[]
  includeFooter: boolean
  footerSource: 'auto'
  revision: number
}

export const emptyDefaults: CampaignDefaults = {
  featuredProductId: null,
  senderName: '',
  primaryLink: '',
  sendTo: [],
  dontSendTo: [],
  includeFooter: true,
  footerSource: 'auto',
  revision: 0
}

export const defaultTabs = [
  { key: 'product', label: 'Featured Product' },
  { key: 'sender', label: 'Sender Name' },
  { key: 'link', label: 'Primary Link' },
  { key: 'audience', label: 'Audience' },
  { key: 'email', label: 'Email Settings' }
] as const
export type DefaultTab = (typeof defaultTabs)[number]['key']

const audienceIds = (label: string) =>
  z
    .array(z.string().trim().min(1).max(100))
    .max(20, `${label}: choose at most 20 lists or segments.`)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      `${label}: each list or segment once.`
    )

export const defaultsSchema = z
  .object({
    featuredProductId: z.uuid('Choose a product from the list.').nullable(),
    senderName: z
      .string()
      .trim()
      .max(100, 'Sender name: at most 100 characters.'),
    primaryLink: z
      .string()
      .trim()
      .max(2000, 'Primary link: at most 2000 characters.')
      .refine(
        (v) => v === '' || /^https:\/\/\S+$/.test(v),
        'Primary link: use a full address that starts with https://'
      ),
    sendTo: audienceIds('Send to'),
    dontSendTo: audienceIds('Don’t send to'),
    includeFooter: z.boolean(),
    footerSource: z.literal('auto', 'Choose the automatic footer.'),
    revision: z.number().int().min(0, 'Reload the page and try again.')
  })
  .refine((v) => !v.sendTo.some((id) => v.dontSendTo.includes(id)), {
    path: ['dontSendTo'],
    message: 'A list or segment cannot be in both Send to and Don’t send to.'
  })

/** Reads the Settings form (every tab is in one form). */
export function readDefaultsForm(form: FormData) {
  const text = (key: string) => {
    const value = form.get(key)
    return typeof value === 'string' ? value : ''
  }
  const product = text('featured_product').trim()
  const revision = text('revision')
  return defaultsSchema.safeParse({
    featuredProductId: product === '' ? null : product,
    senderName: text('sender_name'),
    primaryLink: text('primary_link'),
    sendTo: form.getAll('send_to').filter((v) => typeof v === 'string'),
    dontSendTo: form
      .getAll('dont_send_to')
      .filter((v) => typeof v === 'string'),
    includeFooter: form.get('include_footer') === 'on',
    footerSource: text('footer_source') || 'auto',
    revision: /^\d+$/.test(revision) ? Number(revision) : -1
  })
}

/** "US/Pacific (UTC-08:00)" at the given moment (offsets follow daylight time). */
export function timezoneLabel(timezone: string, at: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset'
  }).formatToParts(at)
  const offset = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
  const utc = offset === 'GMT' ? 'UTC+00:00' : offset.replace('GMT', 'UTC')
  return `${timezone} (${utc})`
}

/** "Fri, Nov 6 2026 · 9:07 AM" in the given timezone. */
export function localTime(timezone: string, at: Date) {
  const get = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, ...options }).format(
      at
    )
  return `${get({ weekday: 'short' })}, ${get({ month: 'short' })} ${get({ day: 'numeric' })} ${get({ year: 'numeric' })} · ${get({ hour: 'numeric', minute: '2-digit' })}`
}
