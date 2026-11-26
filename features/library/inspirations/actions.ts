'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { observerEnabled } from '@/features/inbox/observer-sheet'
import type { FormResult } from '@/components/ui/action-form'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
import {
  domainLimit,
  domainShape,
  isSampleDomain,
  trackedDomainOf
} from './domain'

const ownerOnly = 'Only the workspace owner can change the brands you follow.'
// Following real brands comes with REAL-01 part b; until then only the
// sample brands can be followed, in every workspace.
const sampleOnly =
  'For now you can follow only sample brands, whose websites end in .example, for example northwind.example.'

async function ownerSession() {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner') return { error: ownerOnly } as const
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { error: 'Please sign in again.' } as const
  return { context, db } as const
}

const refresh = () => revalidatePath('/inspiration')

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
  `Following ${domain}, but we could not ask for their emails yet. Click Follow again to retry.`

/** Follow a brand's emails by its website, then ask for its emails. */
export async function trackDomain(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  const raw = form.get('domain')
  if (typeof raw !== 'string' || !raw.trim())
    return { error: 'Enter a brand website, for example brand.com.' }
  const domain = trackedDomainOf(raw)
  if (raw.length > 300 || !domainShape.test(domain))
    return {
      error: 'That is not a website. Enter one like brand.com, without spaces.'
    }
  // The domain is also its label, which holds up to 120 characters.
  if (domain.length > 120)
    return { error: 'That website is too long. Use one under 120 characters.' }
  // GROS-INS-002: a real brand Grey Observer does not collect yet is not
  // refused; following it records a request that the scheduled sweep hands
  // to Observer (the only system that subscribes). Only its emails a person
  // rates Exemplary ever appear.
  const real = !isSampleDomain(domain)
  if (real && !observerEnabled()) return { error: sampleOnly }
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
      const queued =
        real || (await requestEmails(db, context.tenantId, tracked.data.id))
      return queued
        ? { message: `You already follow ${domain}.` }
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
        error: `You follow ${domainLimit} brands, the most at a time. Stop one to follow another.`
      }
    if (saved.error.code === '42501') return { error: ownerOnly }
    if (saved.error.code === 'PT429')
      return {
        error:
          'You asked for 10 new brands today, the most in a day. Try again tomorrow.'
      }
    if (saved.error.code === '23514')
      return {
        error: real
          ? 'That website could not be followed. Check it and try again.'
          : sampleOnly
      }
    return { error: 'We could not follow this brand. Nothing was changed.' }
  }
  // Ask for their emails now; the scheduled worker brings them in.
  const queued = real || (await requestEmails(db, context.tenantId, saved.data))
  refresh()
  if (!queued) return { error: retryText(domain) }
  if (!real)
    return {
      message: `Following ${domain}. Its newsletters usually arrive within 1–7 days.`
    }
  // A brand Observer is not subscribed to yet is a request.
  const now = await db
    .from('competitor_captures')
    .select('subscription_status')
    .eq('domain', domain)
    .maybeSingle()
  return {
    message:
      now.data?.subscription_status === 'pending'
        ? `Requested ${domain}. We are subscribing to its emails; they appear here once our team rates them Exemplary.`
        : `Following ${domain}. Only its human-rated Exemplary emails appear here.`
  }
}

const stopForm = z.object({
  subscription: z.uuid(),
  revision: z.coerce.number().int().positive(),
  domain: z.string().max(200)
})

/** Stop following a brand. */
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
    .select('private_rules,label')
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
            'This brand changed in another window. Reload the page, then try again.'
        }
      : saved.error.code === '42501'
        ? { error: ownerOnly }
        : { error: 'We could not stop following. Nothing was changed.' }
  refresh()
  return {
    message: `Stopped following ${current.data.label}. Its emails left your library.`
  }
}
