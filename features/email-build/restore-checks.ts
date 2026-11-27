import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { neverWordsIn } from '@/features/assembly/assemble'
import type { AssemblyInput } from '@/features/assembly/inputs'
import { SupabaseOfferSource, type OfferSource } from '@/features/offers/source'
import { planStore, storeForPlan } from '@/features/onboarding/store-source'
import {
  storedRefusal,
  type KlaviyoRefusal
} from '@/features/results/never-overwrite'
import { planOfferSource } from '@/features/strategy/offers'
import { codeWorksNow, type BuiltEmail } from './build'
import { drawnText } from './drawn-text'
import { offersAt, type StoreSource } from './ports'
import { checksFor } from './steps'
import { restoreWords } from './versions'

type Db = SupabaseClient<Database>

/**
 * PICK-106: what can be known before "Use this version" queues its push,
 * so a version that the push would refuse never leaves the draft. Run with
 * the worker's own (service-role) client and sources, as the push and the
 * design step read them:
 *
 * - PICK-99: what the owner did with this planned email's draft in
 *   Klaviyo (`storedRefusal`, by its push key);
 * - REL-OFF: the version's discount code still works now, at the percent
 *   and end it shows (`codeWorksNow`, the push's own check);
 * - DST-005's hard checks on the version's HTML (each design) under the
 *   rules now: today's max discount, the store's hosts and words, spam and
 *   accessibility (`checksFor`, the design step's own);
 * - the phrases the owner takes out (`brand_never_words`, the writers'
 *   "don'ts"), in its subject, preview line and drawn text.
 *
 * Null when it may go; else the refusal in the owner's words. The push
 * itself re-runs its checks when it runs.
 */
export async function restoreRefusal(
  db: Db,
  input: {
    tenantId: string
    runId: string
    startOn: string
    pushKey: string
    email: BuiltEmail
  },
  deps: {
    stores?: StoreSource
    offers?: OfferSource
    klaviyoState?: (
      tenantId: string,
      pushKey: string
    ) => Promise<KlaviyoRefusal | null>
  } = {}
): Promise<string | null> {
  const { email, tenantId } = input
  const owners = await (
    deps.klaviyoState
      ? deps.klaviyoState(tenantId, input.pushKey)
      : storedRefusal(db, tenantId, input.pushKey)
  ).catch(() => 'unreadable' as const)
  if (owners === 'unreadable') return checksUnread
  if (owners) return klaviyoWords[owners]
  const offers =
    deps.offers ??
    planOfferSource(new SupabaseOfferSource(db), input.startOn, {
      sample: email.sample
    })
  if (email.code !== null) {
    const works = await codeWorksNow(
      email.code,
      offers,
      tenantId,
      email.plannedSendAt,
      email.offer
    )
    if (works === 'unreadable') return offersUnread
    if (works === 'unsafe') return codeWords(email.code)
  }
  let store
  try {
    const plan = await planStore(db, {
      tenant_id: tenantId,
      run_id: input.runId
    })
    store = await (deps.stores ?? storeForPlan(db, plan, input.startOn)).read(
      tenantId
    )
    if (store.sample !== plan.sample)
      return 'Your store data changed since this plan was made, so this version cannot be used. Plan next 15 days again.'
  } catch {
    return checksUnread
  }
  const rules = await offersAt(offers, tenantId, email.plannedSendAt)
  const check = checksFor(store, {
    maxDiscountPercent: rules.maxDiscountPercent
  } as Parameters<typeof checksFor>[1])
  for (const html of [email.html, ...(email.designA ? [email.designA] : [])]) {
    const problems = check(html, {
      subject: email.subject,
      preheader: email.preheader,
      code: email.code,
      ...(email.text !== undefined ? { text: email.text } : {})
    })
    if (problems.length)
      return `This version no longer passes the email checks: ${problems[0]!.problem}`
  }
  if (store.neverWords?.length) {
    const words = neverWordsIn(
      [
        email.subject,
        email.subjectB ?? '',
        email.preheader,
        drawnText(email.html),
        email.designA ? drawnText(email.designA) : '',
        email.text ?? ''
      ].join(' \n '),
      {
        products: store.products,
        facts: store.facts,
        neverWords: store.neverWords
      } as unknown as AssemblyInput
    )
    if (words.length)
      return `This version uses “${words[0]}”, which you take out of your emails, so it is not used again.`
  }
  return null
}

const checksUnread =
  'This version could not be checked just now. Try again in a moment.'
const offersUnread = 'Your saved offers could not be read. Try again.'
/** The refusals that mean a read failed, not the version (tried again). */
export const restoreUnread: ReadonlySet<string> = new Set([
  checksUnread,
  offersUnread
])
const codeWords = (code: string) =>
  `This version’s discount code ${code} is no longer one of your working codes within your max discount, so it is not used again.`

const klaviyoWords: Record<KlaviyoRefusal, string> = {
  sent_in_klaviyo: restoreWords.version_sent!,
  scheduled_in_klaviyo: restoreWords.version_scheduled!,
  deleted_in_klaviyo: restoreWords.version_gone!,
  cancelled_in_klaviyo: restoreWords.version_gone!,
  edited_in_klaviyo: restoreWords.version_edited!
}
