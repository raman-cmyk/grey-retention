import 'server-only'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
import { microSchema, intelligenceProfile } from './intelligence'
import { readPages } from '@/lib/db/read-pages'
export async function referenceWorkspace() {
  const context = await requireRequestContext('client'),
    db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { context, data: null, error: 'Supabase authentication required.' }
  const subscriptions = await readPages((from, to) =>
    db
      .from('competitor_subscriptions')
      .select('*')
      .eq('tenant_id', context.tenantId)
      .order('label')
      .order('id')
      .range(from, to)
  )
  const ids = (subscriptions.data ?? [])
    .filter((s) => s.active)
    .map((s) => s.capture_id)
  const [captures, emails, sequences, playbooks, jobs] = await Promise.all([
    readPages((from, to) =>
      db
        .from('competitor_captures')
        .select('*')
        .in('id', ids)
        .order('id')
        .range(from, to)
    ),
    readPages((from, to) =>
      db
        .from('competitor_emails')
        .select('*')
        .in('capture_id', ids)
        .order('received_at', { ascending: false })
        .order('id')
        .range(from, to)
    ),
    readPages((from, to) =>
      db
        .from('competitor_sequences')
        .select('*')
        .in('capture_id', ids)
        .order('id')
        .range(from, to)
    ),
    readPages((from, to) =>
      db
        .from('playbooks')
        .select('*')
        .eq('tenant_id', context.tenantId)
        .order('revision', { ascending: false })
        .order('id')
        .range(from, to)
    ),
    db
      .from('job_runs')
      .select('*')
      .eq('tenant_id', context.tenantId)
      .in('kind', ['competitors.capture', 'playbook.synthesize'])
      .order('created_at', { ascending: false })
      .limit(20)
  ])
  if (
    [subscriptions, captures, emails, sequences, playbooks, jobs].some(
      (r) => r.error
    )
  )
    return {
      context,
      data: null,
      error: 'Reference evidence unavailable. Check migrations and retry.'
    }
  const profiles = (subscriptions.data ?? []).map((s) => {
    const capture = captures.data?.find((c) => c.id === s.capture_id),
      records = (emails.data ?? [])
        .filter((e) => e.capture_id === s.capture_id)
        .map((e) => ({
          id: e.id,
          receivedAt: e.received_at,
          micro: microSchema.parse(e.micro)
        }))
    return {
      ...s,
      capture,
      profile: intelligenceProfile(records),
      sequences: (sequences.data ?? []).filter(
        (q) => q.capture_id === s.capture_id
      ),
      health:
        capture?.last_received_at &&
        new Date(capture.last_received_at).getTime() <
          new Date().getTime() - 72 * 3600000
          ? 'No fixture email in the last 72 hours'
          : (capture?.last_error ??
            (!records.length ? 'Capture has no evidence yet' : null))
    }
  })
  return {
    context,
    data: {
      subscriptions: profiles,
      emails: emails.data ?? [],
      playbooks: playbooks.data ?? [],
      jobs: jobs.data ?? []
    },
    error: null
  }
}

export async function referenceEmailDetail(id: string) {
  const context = await requireRequestContext('client'),
    db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return {
      context,
      email: null,
      error: 'Supabase authentication required.'
    }
  const subscriptions = await readPages((from, to) =>
    db
      .from('competitor_subscriptions')
      .select('capture_id')
      .eq('tenant_id', context.tenantId)
      .eq('active', true)
      .order('id')
      .range(from, to)
  )
  if (subscriptions.error)
    return {
      context,
      email: null,
      error: 'Reference evidence unavailable. Refresh to retry.'
    }
  const ids = (subscriptions.data ?? []).map((s) => s.capture_id)
  if (!ids.length) return { context, email: null, error: null }
  const email = await db
    .from('competitor_emails')
    .select('*')
    .eq('id', id)
    .in('capture_id', ids)
    .maybeSingle()
  return {
    context,
    email: email.data,
    error: email.error
      ? 'Reference evidence unavailable. Refresh to retry.'
      : null
  }
}
