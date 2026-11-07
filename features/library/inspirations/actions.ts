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

type Db = NonNullable<Awaited<ReturnType<typeof createClient>>>

/** Queues the sample capture for a tracked domain; false when it failed. */
async function requestEmails(db: Db, tenantId: string, subscription: string) {
  const queued = await db.rpc('enqueue_reference_job', {
    t: tenantId,
    kind: 'competitors.capture',
    subscription
  })
  return !queued.error
}

const retryText = (domain: string) =>
  `Tracking ${domain}, but we could not ask for their emails yet. Click Track again to retry.`

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
  if (raw.length > 300 || !domainShape.test(domain))
    return {
      error: 'That is not a domain. Enter one like brand.com, without spaces.'
    }
  // The domain is also its label, which holds up to 120 characters.
  if (domain.length > 120)
    return { error: 'That domain is too long. Use one under 120 characters.' }
  if (!isSampleDomain(domain)) return { error: sampleOnly }
  const { context, db } = session
  // Already tracked: say so, and change nothing (its label, rules and any
  // playbook built on it stay as they are).
  const capture = await db
    .from('competitor_captures')
    .select('id')
    .eq('domain', domain)
    .maybeSingle()
  if (capture.data) {
    const tracked = await db
      .from('competitor_subscriptions')
      .select('id')
      .eq('tenant_id', context.tenantId)
      .eq('capture_id', capture.data.id)
      .eq('active', true)
      .maybeSingle()
    if (tracked.data) {
      // Ask for their emails again (the same request is never queued twice).
      const queued = await requestEmails(db, context.tenantId, tracked.data.id)
      return queued
        ? { message: `You already track ${domain}.` }
        : { error: retryText(domain) }
    }
  }
  // No label or rules: a new domain is labelled with itself, and one that
  // was stopped keeps its label and private rules.
  const saved = await db.rpc('subscribe_competitor', {
    t: context.tenantId,
    domain
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
  const queued = await requestEmails(db, context.tenantId, saved.data)
  refresh()
  if (!queued) return { error: retryText(domain) }
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
