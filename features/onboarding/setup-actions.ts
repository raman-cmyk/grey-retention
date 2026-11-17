'use server'
import type { Route } from 'next'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { getServerEnvironment } from '@/lib/env/server'
import { createClient } from '@/lib/supabase/server'
import { startAdsReading } from './ads/start'
import { maxWebsite, websiteOf } from './flow-model'
import { startReviewsReading } from './reviews/start'
import { startSiteReading } from './site/start'

/**
 * The onboarding steps' commands (UI-ONBb). Each checks the owner again on
 * the server; staff only see the steps. A step saved goes back to `/setup`,
 * which opens the step that is Now.
 */
export type SetupAnswer = {
  error?: string
  /** What was done, when the step stays open. */
  message?: string
  /** An error for one field, by the field's name. */
  fields?: Record<string, string>
}

const ownerOnly = 'Only the workspace owner can set up your store.'
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
