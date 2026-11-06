import { createClient } from '@/lib/supabase/server'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { Panel, Notice, Field, controlClass } from '@/components/ui/workspace'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { optimizerAction } from './actions'
import { LocalDateTimeField } from '@/components/ui/local-date-time-field'
function Command({
  kind,
  id,
  revision,
  children
}: {
  kind: string
  id?: string
  revision?: number
  children: React.ReactNode
}) {
  return (
    <ActionForm action={optimizerAction} className="grid gap-3">
      <input name="kind" type="hidden" value={kind} />
      {id && <input name="id" type="hidden" value={id} />}{' '}
      {revision && <input name="revision" type="hidden" value={revision} />}{' '}
      {children}
    </ActionForm>
  )
}
export async function OptimizerPanel() {
  const ctx = await requireRequestContext('client')
  if (!['owner', 'admin'].includes(ctx.tenantRole))
    return (
      <Notice error>
        Workspace owner or admin is required to inspect profile optimization.
      </Notice>
    )
  const db = await createClient()
  if (!db) return <Notice error>Supabase authentication required.</Notice>
  const t = ctx.tenantId,
    owner = ctx.tenantRole === 'owner'
  const [profiles, sweeps, candidates, events, jobs] = await Promise.all([
    db
      .from('optimizer_profiles')
      .select('*')
      .eq('tenant_id', t)
      .order('external_id'),
    db
      .from('optimizer_sweeps')
      .select('*')
      .eq('tenant_id', t)
      .order('created_at', { ascending: false })
      .limit(10),
    db
      .from('optimizer_candidates')
      .select('*')
      .eq('tenant_id', t)
      .order('updated_at', { ascending: false })
      .limit(100),
    db
      .from('optimizer_events')
      .select('*')
      .eq('tenant_id', t)
      .order('created_at', { ascending: false })
      .limit(100),
    db
      .from('job_runs')
      .select('id,kind,status,attempt,error_code,input')
      .eq('tenant_id', t)
      .in('kind', ['optimizer.winback', 'optimizer.suppress'])
      .order('created_at', { ascending: false })
      .limit(50)
  ])
  if ([profiles, sweeps, candidates, events, jobs].some((r) => r.error))
    return <Notice error>Optimizer data unavailable.</Notice>
  return (
    <div className="space-y-6">
      <Panel title="Profile protection and sweep preview">
        <Notice>
          Only eight original fictional profiles at fixture.example are
          available. Live messaging, suppression and automatic reversal are
          unavailable. Purchasers in the last twelve calendar months are
          protected. Unsubscribed/pending consent, hard bounces, spam and
          existing suppression are excluded from winback. Two local message
          simulations occur five days apart; eligible nonresponders are
          suppressed after ten days.
        </Notice>
        {owner && (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Command kind="install">
              <SubmitButton variant="secondary">
                Install original profile fixtures
              </SubmitButton>
            </Command>
            <Command kind="preview">
              <LocalDateTimeField
                name="observedAt"
                label="Sample sweep clock"
                timezone={ctx.timezone}
                defaultValue={new Date()}
              />
              <SubmitButton>Preview protected candidates</SubmitButton>
            </Command>
            <Command kind="run">
              <SubmitButton variant="secondary">
                Run optimizer fixture jobs
              </SubmitButton>
            </Command>
          </div>
        )}
      </Panel>
      {sweeps.data?.map((s) => {
        const list = candidates.data?.filter((c) => c.sweep_id === s.id) ?? []
        const eligible = list.filter((c) => c.eligible).length,
          suppressed = list.filter((c) => c.state === 'suppressed').length
        return (
          <Panel key={s.id} title={`Sweep · ${s.state} · v${s.revision}`}>
            <p className="mb-3 text-sm">
              {eligible} eligible · {list.length - eligible} protected or
              excluded · {suppressed} synthetic suppressions. Preview clock{' '}
              {s.observed_at}.
            </p>
            <Notice>
              Fictional price snapshot dated{' '}
              {(s.pricing_snapshot as { effectiveDate: string }).effectiveDate}.
              USD 10 per 1,000-profile band/month. Estimated plan reduction: USD{' '}
              {(
                (Math.ceil(list.length / 1000) -
                  Math.ceil((list.length - suppressed) / 1000)) *
                10
              ).toFixed(2)}
              . This is an estimate using fictional rates, never measured
              billing savings.
            </Notice>
            <ul className="my-4 space-y-2 text-sm">
              {list.map((c) => (
                <li key={c.profile_id}>
                  {profiles.data?.find((p) => p.id === c.profile_id)
                    ?.external_id ?? c.profile_id}{' '}
                  · {c.state} · {c.reason.replaceAll('_', ' ')}
                </li>
              ))}
            </ul>
            {owner && s.state === 'preview' && (
              <ConfirmDialog
                label="Review first sweep approval"
                title="Confirm exact fixture sweep"
                description="Review the listed profiles and protection reasons. This authorizes only local consented winback and guarded suppression simulation. Every later stage rechecks evidence."
              >
                <Command kind="approve" id={s.id} revision={s.revision}>
                  <SubmitButton>Approve reviewed fixture sweep</SubmitButton>
                </Command>
              </ConfirmDialog>
            )}
            {owner && ['approved', 'winback_wait'].includes(s.state) && (
              <div className="mt-5">
                <Command kind="clock" id={s.id}>
                  <LocalDateTimeField
                    name="observedAt"
                    label="Frozen sweep clock"
                    timezone={ctx.timezone}
                    defaultValue={
                      new Date(
                        new Date(s.observed_at).getTime() + 11 * 86400000
                      )
                    }
                  />
                  <SubmitButton>Advance fixture sweep clock</SubmitButton>
                </Command>
              </div>
            )}
          </Panel>
        )
      })}
      <Panel title="Fictional profiles and guarded reversal">
        <div className="grid gap-4 lg:grid-cols-2">
          {profiles.data?.map((p) => (
            <article
              key={p.id}
              className="rounded-lg border border-[var(--line)] p-4 text-sm"
            >
              <h3 className="font-semibold">{p.external_id}</h3>
              <p className="my-2">
                Consent: {p.consent} · Suppression reasons:{' '}
                {p.suppression_reasons.join(', ') || 'none'} · v{p.revision}
              </p>
              <p>
                Last engagement: {p.last_engaged_at ?? 'none'}
                <br />
                Last purchase: {p.last_order_at ?? 'none'}
              </p>
              {owner && p.suppression_reasons.includes('optimizer') && (
                <div className="mt-4">
                  <ConfirmDialog
                    danger
                    label="Review fixture reversal"
                    title="Confirm reason-aware reversal"
                    description="Only the optimizer reason may be removed. Consent must be subscribed; bounce/spam or any other suppression reason blocks reversal."
                  >
                    <Command kind="reverse" id={p.id} revision={p.revision}>
                      <SubmitButton>
                        Confirm guarded fixture reversal
                      </SubmitButton>
                    </Command>
                  </ConfirmDialog>
                </div>
              )}
              {owner && (
                <details className="mt-4">
                  <summary>Simulate a changed protection signal</summary>
                  <Command kind="evidence" id={p.id} revision={p.revision}>
                    <Field label={`Consent ${p.external_id}`}>
                      <select
                        name="consent"
                        className={controlClass}
                        defaultValue={p.consent}
                      >
                        <option value="subscribed">Subscribed</option>
                        <option value="unsubscribed">Unsubscribed</option>
                        <option value="pending">Pending</option>
                      </select>
                    </Field>
                    <Field label={`Hard bounce ${p.external_id}`}>
                      <select
                        name="bounce"
                        className={controlClass}
                        defaultValue={String(p.hard_bounce)}
                      >
                        <option value="false">No</option>
                        <option value="true">Yes</option>
                      </select>
                    </Field>
                    <Field label={`Spam ${p.external_id}`}>
                      <select
                        name="spam"
                        className={controlClass}
                        defaultValue={String(p.spam)}
                      >
                        <option value="false">No</option>
                        <option value="true">Yes</option>
                      </select>
                    </Field>
                    <Field label={`New purchase ${p.external_id}`}>
                      <select name="recentOrder" className={controlClass}>
                        <option value="false">
                          Preserve purchase evidence
                        </option>
                        <option value="true">
                          Record synthetic purchase now
                        </option>
                      </select>
                    </Field>
                    <SubmitButton variant="secondary">
                      Save fixture protection evidence
                    </SubmitButton>
                  </Command>
                </details>
              )}
            </article>
          ))}
        </div>
      </Panel>
      <Panel title="Sweep operations and retained audit">
        <ul className="space-y-2 text-sm">
          {jobs.data?.map((j) => (
            <li key={j.id}>
              {j.kind} · {j.status} · {j.attempt}/4 · {j.error_code ?? '—'}
            </li>
          ))}
        </ul>
        {events.data?.map((e) => (
          <details className="mt-4 text-sm" key={e.id}>
            <summary>
              {profiles.data?.find((p) => p.id === e.profile_id)?.external_id} ·{' '}
              {e.kind} · {e.created_at}
            </summary>
            <pre className="overflow-auto text-xs break-words whitespace-pre-wrap">
              {JSON.stringify(e.detail, null, 2)}
            </pre>
          </details>
        ))}
      </Panel>
    </div>
  )
}
