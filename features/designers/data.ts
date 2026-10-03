import 'server-only'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
import { assignmentBriefSchema } from './uploads'
export async function designerWorkspace() {
  const context = await requireRequestContext('designer')
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return {
      context,
      assignments: [],
      notifications: [],
      error: 'Sign in through local Supabase to view assigned briefs.'
    }
  const [assignments, notifications] = await Promise.all([
    db
      .from('designer_assignments')
      .select('*')
      .eq('designer_id', context.designerId)
      .neq('state', 'cancelled')
      .order('due_at'),
    db
      .from('notifications')
      .select('*')
      .eq('recipient_id', context.userId)
      .order('created_at', { ascending: false })
      .limit(20)
  ])
  return {
    context,
    assignments: assignments.data ?? [],
    notifications: notifications.data ?? [],
    error:
      assignments.error || notifications.error
        ? 'Assigned work is unavailable. Refresh to retry.'
        : null
  }
}
export async function assignmentDetail(id: string) {
  const context = await requireRequestContext('designer')
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo') return null
  const result = await db.rpc('assignment_brief', { assignment: id })
  if (result.error) return null
  const parsed = assignmentBriefSchema.safeParse(result.data)
  if (!parsed.success) return null
  const [submissions, reviews] = await Promise.all([
    db
      .from('designer_submissions')
      .select('*')
      .eq('assignment_id', id)
      .order('revision', { ascending: false }),
    db
      .from('designer_reviews')
      .select('*')
      .eq('assignment_id', id)
      .order('created_at', { ascending: false })
  ])
  const previews = await Promise.all(
    (submissions.data ?? []).map(async (s) => ({
      ...s,
      preview:
        (
          await db.storage
            .from('designer-submissions')
            .createSignedUrl(s.storage_path, 300)
        ).data?.signedUrl ?? null
    }))
  )
  const inspirationAssets = await Promise.all(
    parsed.data.brief.assetPaths.map(async (path) => ({
      path,
      preview:
        (await db.storage.from('brand-assets').createSignedUrl(path, 300)).data
          ?.signedUrl ?? null
    }))
  )
  return {
    inspirationAssets,
    context,
    ...parsed.data,
    submissions: previews,
    reviews: reviews.data ?? [],
    error:
      submissions.error || reviews.error
        ? 'Some revision history is unavailable.'
        : null
  }
}
