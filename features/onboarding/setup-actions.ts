'use server'
import type { Route } from 'next'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { getServerEnvironment } from '@/lib/env/server'
import { createClient } from '@/lib/supabase/server'
import { connectKlaviyo } from '@/features/connections/actions'
import { trackDomain } from '@/features/library/inspirations/actions'
import { trackedDomainOf } from '@/features/library/inspirations/domain'
import { hideBrand } from '@/features/inspiration/actions'
import { defaultAssistant } from '@/components/gros/nav'
import { addDiscountCode, saveMaxDiscount } from '@/features/offers/actions'
import { parseCode, parseExpiry, parsePercent } from '@/features/offers/fields'
import { startAdsReading } from './ads/start'
import { startCatalogReading } from './catalog/start'
import { startHistoryReading } from './history/start'
import { setupReadModel } from './flow'
import { maxBrandWords, maxWebsite, setupSteps, websiteOf } from './flow-model'
import { startReviewsReading } from './reviews/start'
import { startSiteReading } from './site/start'

/**
 * The onboarding steps' commands (UI-ONBb). Each checks the owner again on
 * the server; staff only see the steps. A step saved goes back to `/setup`,
 * which opens the step that is Now.
 */
export type SetupAnswer = {
  error?: string
  /** What was done, when the step stays open (a code added). */
  message?: string
  /** An error for one field, by the field's name. */
  fields?: Record<string, string>
}

const ownerOnly = 'Only the workspace owner can set up your store.'
/** The Settings action's words for an end date that has passed. */
const passedDate = 'That end date has passed. Choose a later one.'
const changedWebsite =
  'Your website was changed in another window. Look at what was found again.'
const setupPath = '/setup' as Route

async function ownerSession() {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner') return { error: ownerOnly } as const
  const db = await createClient()
  if (!db || getServerEnvironment().AUTH_MODE === 'demo')
    return { error: 'Please sign in again. Nothing was changed.' } as const
  return { context, db } as const
}
type Session = Exclude<
  Awaited<ReturnType<typeof ownerSession>>,
  { error: string }
>

const store = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Enter your store’s name, 2 to 120 letters.')
    .max(120, 'Enter your store’s name, 2 to 120 letters.'),
  website: z
    .string()
    .trim()
    .max(maxWebsite, 'Enter your store’s website, like cedarlane.com.')
})

/** The readers that need only the website: the site, its ads, its reviews. */
async function startReaders({ context, db }: Session) {
  const started = await Promise.all([
    startSiteReading(db, context.tenantId),
    startAdsReading(db, context.tenantId),
    startReviewsReading(db, context.tenantId)
  ])
  return started.every((s) => s.ok)
}

/**
 * Store: the store's name and website, saved with the brand profile's own
 * command (`save_brand`). Everything else in the profile is kept as it is,
 * read on the server, never sent from the page. Then the readers start.
 */
export async function saveStore(
  _state: SetupAnswer,
  form: FormData
): Promise<SetupAnswer> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  const parsed = store.safeParse({
    name: form.get('name') ?? '',
    website: form.get('website') ?? ''
  })
  const site = parsed.success ? websiteOf(parsed.data.website) : null
  if (!parsed.success || !site) {
    const issues = parsed.success ? [] : parsed.error.issues
    const name = issues.find((i) => i.path[0] === 'name')?.message
    return {
      fields: {
        ...(name ? { name } : {}),
        ...(site
          ? {}
          : { website: 'Enter your store’s website, like cedarlane.com.' })
      }
    }
  }
  const { context, db } = session
  const current = await db
    .from('brand_profiles')
    .select('revision,positioning,voice,prohibitions')
    .eq('tenant_id', context.tenantId)
    .maybeSingle()
  if (current.error)
    return {
      error: 'We could not save your store. Nothing was changed. Try again.'
    }
  const saved = await db.rpc('save_brand', {
    t: context.tenantId,
    expected_revision: current.data?.revision ?? 0,
    brand_name: parsed.data.name,
    domain: site,
    positioning: current.data?.positioning ?? '',
    voice: current.data?.voice ?? '',
    prohibitions: current.data?.prohibitions ?? ''
  })
  if (saved.error)
    return {
      error:
        saved.error.code === '42501'
          ? ownerOnly
          : saved.error.code === 'PT409' || saved.error.code === '40001'
            ? 'Your store was changed in another window. Open setup again.'
            : 'We could not save your store. Nothing was changed. Try again.'
    }
  // A reader that did not start shows on the Brand step, with Try again.
  await startReaders(session)
  revalidatePath(setupPath)
  redirect(setupPath)
}

const brandWords = z
  .string()
  .trim()
  .max(maxBrandWords, `Keep it under ${maxBrandWords} characters.`)

/**
 * Brand: the owner confirms what was found on the website he was shown
 * (`site`: a change from another window is refused, never confirmed
 * blind), with how his emails should sound and what to avoid (optional),
 * saved with the brand profile's own command when they changed.
 */
export async function confirmBrand(
  _state: SetupAnswer,
  form: FormData
): Promise<SetupAnswer> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  const voice = brandWords.safeParse(form.get('voice') ?? '')
  const rules = brandWords.safeParse(form.get('prohibitions') ?? '')
  if (!voice.success || !rules.success)
    return {
      fields: {
        ...(voice.success ? {} : { voice: voice.error.issues[0]!.message }),
        ...(rules.success
          ? {}
          : { prohibitions: rules.error.issues[0]!.message })
      }
    }
  const site = String(form.get('site') ?? '')
  const { context, db } = session
  const current = await db
    .from('brand_profiles')
    .select('revision,brand_name,domain,positioning,voice,prohibitions')
    .eq('tenant_id', context.tenantId)
    .maybeSingle()
  if (current.error || !current.data)
    return { error: 'Save your store’s website first.' }
  const brand = current.data
  if (brand.domain !== site) return { error: changedWebsite }
  if (brand.voice !== voice.data || brand.prohibitions !== rules.data) {
    const words = await db.rpc('save_brand', {
      t: context.tenantId,
      expected_revision: brand.revision,
      brand_name: brand.brand_name,
      domain: brand.domain,
      positioning: brand.positioning,
      voice: voice.data,
      prohibitions: rules.data
    })
    if (words.error)
      return {
        error:
          words.error.code === 'PT409' || words.error.code === '40001'
            ? changedWebsite
            : 'We could not save this step. Try again.'
      }
  }
  const saved = await db.rpc('save_onboarding_step', {
    t: context.tenantId,
    step: 'brand',
    site_shown: site
  })
  if (saved.error)
    return {
      error:
        saved.error.code === 'PT409'
          ? saved.error.details === 'changed'
            ? changedWebsite
            : 'Save your store’s website first.'
          : saved.error.code === '42501'
            ? ownerOnly
            : 'We could not save this step. Try again.'
    }
  revalidatePath(setupPath)
  redirect(setupPath)
}

/**
 * Reads the store again: every reader that failed or never started. The
 * Klaviyo readers (catalog, history) start only once Klaviyo is connected;
 * before that their refusal is no failure.
 */
export async function readStoreAgain(): Promise<SetupAnswer> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  const { context, db } = session
  const [own, catalog, history] = await Promise.all([
    startReaders(session),
    startCatalogReading(db, context.tenantId),
    startHistoryReading(db, context.tenantId)
  ])
  const klaviyoOk = [catalog, history].every(
    (s) => s.ok || s.code === 'connect_klaviyo'
  )
  if (!own || !klaviyoOk)
    return {
      error: 'We could not start reading your store. Try again in a minute.'
    }
  revalidatePath(setupPath)
  return {}
}

/**
 * Klaviyo: the key, checked and kept by the Klaviyo card's own action
 * (`connectKlaviyo`: its format in sample mode, with Klaviyo itself once
 * `KLAVIYO_MODE=live`). Then the readers that need Klaviyo start: the
 * catalog and what the store already sent. Its refusal goes under the key.
 */
export async function connectSetupKlaviyo(
  _state: SetupAnswer,
  form: FormData
): Promise<SetupAnswer> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  const connected = await connectKlaviyo({}, form)
  if (connected.error) return { fields: { apiKey: connected.error } }
  // A reader that does not start now starts the next time Klaviyo is connected.
  await Promise.all([
    startCatalogReading(session.db, session.context.tenantId),
    startHistoryReading(session.db, session.context.tenantId)
  ])
  revalidatePath(setupPath)
  redirect(setupPath)
}

/**
 * Discount: the biggest discount, saved by the Settings card's own action
 * (`saveMaxDiscount`, which checks the revision the page read).
 */
export async function saveSetupDiscount(
  _state: SetupAnswer,
  form: FormData
): Promise<SetupAnswer> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  const saved = await saveMaxDiscount({}, form)
  if (saved.error) return { fields: { percent: saved.error } }
  revalidatePath(setupPath)
  redirect(setupPath)
}

/** A real discount code, optional, added by the Settings card's own action. */
export async function addSetupCode(
  _state: SetupAnswer,
  form: FormData
): Promise<SetupAnswer> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  // Each field checked first, as the Settings action checks it, so its
  // error sits under it.
  const fields: Record<string, string> = {}
  if (!parseCode(form.get('code')))
    fields.code =
      'Enter the code exactly as it works in your store: 3 to 40 letters, numbers, - or _.'
  if (parsePercent(form.get('percent'), 1) === null)
    fields.percent = 'Enter a whole percent from 1 to 100.'
  const expiry = parseExpiry(form.get('expires'), session.context.timezone)
  if (expiry === undefined) fields.expires = 'Choose a valid end date.'
  else if (expiry && Date.parse(expiry) <= Date.now())
    fields.expires = passedDate
  if (Object.keys(fields).length) return { fields }
  const added = await addDiscountCode({}, form)
  if (added.error === passedDate) return { fields: { expires: passedDate } }
  if (added.error) return { error: added.error }
  revalidatePath(setupPath)
  return { message: added.message }
}

/** Whether the workspace follows a brand's website now. */
async function follows(session: Session, typed: FormDataEntryValue | null) {
  if (typeof typed !== 'string') return false
  const { context, db } = session
  const capture = await db
    .from('competitor_captures')
    .select('id')
    .eq('domain', trackedDomainOf(typed))
    .maybeSingle()
  if (capture.error || !capture.data) return false
  const followed = await db
    .from('competitor_subscriptions')
    .select('id')
    .eq('tenant_id', context.tenantId)
    .eq('capture_id', capture.data.id)
    .eq('active', true)
    .maybeSingle()
  return !followed.error && !!followed.data
}

/**
 * Rivals: follow a brand, by the Inspiration page's own action. A follow
 * that was saved but could not yet ask for the brand's emails is followed
 * all the same: its words are a note, not a refusal.
 */
async function follow(
  form: FormData
): Promise<SetupAnswer & { saved?: boolean }> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  const followed = await trackDomain({}, form)
  const saved = !followed.error || (await follows(session, form.get('domain')))
  if (!saved) return { error: followed.error }
  revalidatePath(setupPath)
  // Saved, but its emails were not asked for yet: the brand is already
  // under the brands followed, so say what happens next, not "try again".
  const typed = form.get('domain')
  const domain = typeof typed === 'string' ? trackedDomainOf(typed) : ''
  return {
    message: followed.error
      ? `Following ${domain}. We will try to read its emails again soon.`
      : followed.message,
    saved
  }
}

/** Rivals: a website the owner types; its refusal goes under the field. */
export async function followRival(
  _state: SetupAnswer,
  form: FormData
): Promise<SetupAnswer> {
  const followed = await follow(form)
  return followed.error
    ? { fields: { domain: followed.error } }
    : { message: followed.message }
}

/** Rivals: Follow on a suggested brand's row. */
export async function followSuggestion(
  _state: SetupAnswer,
  form: FormData
): Promise<SetupAnswer> {
  const followed = await follow(form)
  return followed.error
    ? { error: followed.error }
    : { message: followed.message }
}

/**
 * Rivals: Hide on a suggested brand's row (never suggested again), by the
 * Inspiration page's own action and words.
 */
export async function hideRival(
  _state: SetupAnswer,
  form: FormData
): Promise<SetupAnswer> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  const hidden = await hideBrand({}, form)
  if (hidden.error)
    return {
      // Inspiration's words point to Inspiration; here they point to setup.
      error: hidden.error.startsWith('That brand is no longer suggested')
        ? 'That brand is no longer suggested here. Open setup again.'
        : hidden.error
    }
  revalidatePath(setupPath)
  return { message: `Hidden. ${defaultAssistant} will not suggest it again.` }
}

/** Rivals: the owner skips following a brand for now. */
export async function skipRivals(): Promise<SetupAnswer> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  const saved = await session.db.rpc('save_onboarding_step', {
    t: session.context.tenantId,
    step: 'rivals'
  })
  if (saved.error) return { error: 'We could not save this step. Try again.' }
  revalidatePath(setupPath)
  redirect(setupPath)
}

/** The step a refused finish names, in the owner's words. */
const unfinished = (key: string | undefined) => {
  const name = setupSteps.find((s) => s.key === key)?.name
  return name ? `Finish the ${name} step first.` : 'Finish every step first.'
}

/**
 * Finish: only once every step is done, as the screen reads it (Klaviyo
 * with the live-key rule) and as the database checks it again. Lands on
 * Home.
 */
export async function finishSetup(): Promise<SetupAnswer> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  const view = await setupReadModel(session.context)
  if (!view.flow)
    return { error: 'We could not read your setup. Try again in a minute.' }
  const todo = view.flow.steps.find((s) => !s.done)
  if (todo) return { error: `Finish the ${todo.name} step first.` }
  const saved = await session.db.rpc('save_onboarding_step', {
    t: session.context.tenantId,
    step: 'finish'
  })
  if (saved.error)
    return {
      error:
        saved.error.code === 'PT409'
          ? unfinished(saved.error.details)
          : 'We could not finish setup. Try again.'
    }
  revalidatePath(setupPath)
  redirect('/home' as Route)
}
