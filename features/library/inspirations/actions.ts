'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { FormResult } from '@/components/ui/action-form'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
import { domainShape, isSampleDomain, trackedDomainOf } from './domain'

const ownerOnly = 'Only the workspace owner can change tracked domains.'
const sampleOnly =
  'This workspace uses sample data, so only sample domains that end in .example can be tracked, for example northwind.example.'

async function ownerSession() {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner') return { error: ownerOnly } as const
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { error: 'Please sign in again.' } as const
  return { context, db } as const
}

const refresh = () => revalidatePath('/library/inspirations')

/** "+ Track": follow a competitor's emails, then ask for their emails. */
export async function trackDomain(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  const raw = form.get('domain')
  if (typeof raw !== 'string' || !raw.trim())
    return { error: 'Enter a domain, for example brand.com.' }
  const domain = trackedDomainOf(raw)
  if (raw.length > 300 || domain.length > 200 || !domainShape.test(domain))
    return {
      error: 'That is not a domain. Enter one like brand.com, without spaces.'
    }
  if (!isSampleDomain(domain)) return { error: sampleOnly }
  const { context, db } = session
  const saved = await db.rpc('subscribe_competitor', {
    t: context.tenantId,
    domain,
    label: domain
  })
  if (saved.error) {
    if (saved.error.code === 'PT409')
      return {
        error: 'You already track 10 domains. Stop tracking one to add another.'
      }
    if (saved.error.code === '42501') return { error: ownerOnly }
    if (saved.error.code === '23514') return { error: sampleOnly }
    return { error: 'We could not track this domain. Nothing was changed.' }
  }
  // Ask for their emails now; the scheduled worker brings them in.
  await db.rpc('enqueue_reference_job', {
    t: context.tenantId,
    kind: 'competitors.capture',
    subscription: saved.data
  })
  refresh()
  return {
    message: `Tracking ${domain}. It shows PENDING until their emails arrive.`
  }
}

const stopForm = z.object({
  subscription: z.uuid(),
  revision: z.coerce.number().int().positive(),
  domain: z.string().max(200)
})

/** "✕ Remove", after the confirm: stop tracking a domain. */
export async function stopTracking(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  const parsed = stopForm.safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: 'Reload the page and try again.' }
  const { context, db } = session
  // Keep the owner's private rules as they are.
  const current = await db
    .from('competitor_subscriptions')
    .select('private_rules')
    .eq('tenant_id', context.tenantId)
    .eq('id', parsed.data.subscription)
    .maybeSingle()
  if (current.error || !current.data)
    return { error: 'Reload the page and try again.' }
  const saved = await db.rpc('update_competitor_subscription', {
    t: context.tenantId,
    subscription: parsed.data.subscription,
    expected_revision: parsed.data.revision,
    active: false,
    private_rules: current.data.private_rules
  })
  if (saved.error)
    return saved.error.code === 'PT409'
      ? {
          error:
            'This domain changed in another window. Reload the page, then try again.'
        }
      : saved.error.code === '42501'
        ? { error: ownerOnly }
        : { error: 'We could not stop tracking. Nothing was changed.' }
  refresh()
  return {
    message: `Stopped tracking ${parsed.data.domain}. Its emails left your library.`
  }
}
