import Link from 'next/link'
import type { Route } from 'next'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
import { Panel, Notice, Field, controlClass } from '@/components/ui/workspace'
import { TextField } from '@/components/ui/text-field'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { libraryDraftAction } from './actions'
import { StructurePicker } from './source-picker'
import { readPages } from '@/lib/db/read-pages'
import { LocalDateTimeField } from '@/components/ui/local-date-time-field'
import { futureIso } from '@/lib/time'
export async function OwnLibraryPanel() {
  const ctx = await requireRequestContext('client'),
    db = await createClient()
  if (!db) return <Notice error>Supabase authentication required.</Notice>
  const subscriptions = await readPages((from, to) =>
    db
      .from('competitor_subscriptions')
      .select('capture_id')
      .eq('tenant_id', ctx.tenantId)
      .eq('active', true)
      .order('id')
      .range(from, to)
  )
  if (subscriptions.error)
    return <Notice error>Authorized library unavailable.</Notice>
  const captureIds = (subscriptions.data ?? []).map((s) => s.capture_id)
  const [templates, references, audiences] = await Promise.all([
    db
      .from('own_templates')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: false }),
    db
      .from('competitor_emails')
      .select('id,subject,micro')
      .in('capture_id', captureIds)
      .order('received_at', { ascending: false })
      .order('id')
      .limit(50),
    db.from('audiences').select('id,label').eq('tenant_id', ctx.tenantId)
  ])
  if ([templates, references, audiences].some((r) => r.error))
    return <Notice error>Authorized library unavailable.</Notice>
  const results = ['owner', 'admin'].includes(ctx.tenantRole)
    ? await db
        .from('campaign_results')
        .select(
          'delivery_id,window_key,complete,clicks,recipients,revenue_minor,currency'
        )
        .eq('tenant_id', ctx.tenantId)
        .eq('window_key', '7d')
    : null
  return (
    <div className="mb-6 space-y-6">
      <Panel title="Own sent structures and performance">
        <Notice>
          These structural skeletons come only from confirmed synthetic sends in
          your workspace. Reuse starts an unapproved draft using your current
          brand facts and assets. Executed creative is not copied. Cross-client
          publication is unavailable.
        </Notice>
        {!templates.data?.length && (
          <p className="mt-4 text-sm">
            Confirm a synthetic send to save an own structure.
          </p>
        )}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {templates.data?.map((t) => {
            const r = results?.data?.find(
              (r) => r.delivery_id === t.delivery_id
            )
            return (
              <article
                key={t.id}
                className="rounded border border-[var(--line)] p-4 text-sm"
              >
                <h3 className="font-semibold">{t.name}</h3>
                <p className="my-2">
                  Tenant-private · original structural skeleton
                </p>
                {r ? (
                  <p>
                    Synthetic 7d metrics:{' '}
                    {r.complete ? 'complete' : 'incomplete'} · clicks {r.clicks}
                    /{r.recipients} · {r.currency}{' '}
                    {(r.revenue_minor / 100).toFixed(2)} fixture revenue.
                  </p>
                ) : (
                  <p>Performance window not available to this view.</p>
                )}
                <Link
                  href={`/campaigns/${t.campaign_id}` as Route}
                  className="mt-3 inline-block underline"
                >
                  Open own campaign history
                </Link>
                {['owner', 'admin'].includes(ctx.tenantRole) && (
                  <Link href="/reports" className="ml-3 underline">
                    Window/source evidence
                  </Link>
                )}
              </article>
            )
          })}
        </div>
      </Panel>
      {ctx.tenantRole === 'owner' && (
        <Panel title="Start an original structural draft">
          <ActionForm
            action={libraryDraftAction}
            className="grid gap-4 sm:grid-cols-2"
          >
            <StructurePicker
              label="Authorized structure"
              templates={templates.data ?? []}
              references={references.data ?? []}
            />
            <Field label="New draft title">
              <TextField name="title" required minLength={2} maxLength={200} />
            </Field>
            <Field label="New draft goal">
              <TextField name="goal" maxLength={5000} />
            </Field>
            <LocalDateTimeField
              name="plannedAt"
              label="New draft send time"
              timezone={ctx.timezone}
              defaultValue={futureIso(14)}
            />
            <Field label="New draft audience">
              <select name="audience" className={controlClass}>
                {audiences.data?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="New draft format">
              <select name="channel" className={controlClass}>
                <option value="email_design">Design email</option>
                <option value="email_text">Text email</option>
              </select>
            </Field>
            <div>
              <SubmitButton>Create unapproved structural draft</SubmitButton>
            </div>
          </ActionForm>
        </Panel>
      )}
    </div>
  )
}
