import Link from 'next/link'
import type { Route } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { Panel, Notice, Field, controlClass } from '@/components/ui/workspace'
import { SplitSection } from '@/components/ui/split-section'
import { StatGrid, StatTile, cappedCount } from '@/components/ui/stat-tile'
import { TextField } from '@/components/ui/text-field'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { reportingAction } from './actions'
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
    <ActionForm action={reportingAction} className="grid gap-3">
      <input name="kind" type="hidden" value={kind} />
      {id && <input name="id" type="hidden" value={id} />}{' '}
      {revision !== undefined && (
        <input name="revision" type="hidden" value={revision} />
      )}{' '}
      {children}
    </ActionForm>
  )
}
export async function ReportingPanel() {
  const ctx = await requireRequestContext('client')
  if (!['owner', 'admin'].includes(ctx.tenantRole))
    return (
      <Notice error>
        Workspace owner or admin is required to read revenue and learning.
      </Notice>
    )
  const db = await createClient()
  if (!db) return <Notice error>Supabase authentication required.</Notice>
  const owner = ctx.tenantRole === 'owner',
    t = ctx.tenantId
  const [
    results,
    metadata,
    deliveries,
    rules,
    runs,
    digests,
    jobs,
    policy,
    streak,
    candidates,
    campaigns,
    packages
  ] = await Promise.all([
    db
      .from('campaign_results')
      .select('*')
      .eq('tenant_id', t)
      .order('created_at', { ascending: false })
      .limit(100),
    db
      .from('campaign_send_metadata')
      .select('*')
      .eq('tenant_id', t)
      .order('created_at', { ascending: false })
      .limit(100),
    db
      .from('fixture_deliveries')
      .select('*')
      .eq('tenant_id', t)
      .eq('state', 'sent')
      .order('sent_at', { ascending: false })
      .limit(100),
    db
      .from('learned_rules')
      .select('*')
      .eq('tenant_id', t)
      .order('updated_at', { ascending: false })
      .limit(50),
    db
      .from('learning_runs')
      .select('*')
      .eq('tenant_id', t)
      .order('created_at', { ascending: false })
      .limit(10),
    db
      .from('result_digests')
      .select('*')
      .eq('tenant_id', t)
      .order('local_date', { ascending: false })
      .limit(7),
    db
      .from('job_runs')
      .select('id,kind,status,attempt,error_code,available_at')
      .eq('tenant_id', t)
      .in('kind', ['results.pull', 'reports.digest', 'learning.synthesize'])
      .order('created_at', { ascending: false })
      .limit(100),
    db
      .from('l2_simulation_policies')
      .select('*')
      .eq('tenant_id', t)
      .maybeSingle(),
    db.from('autopilot_streaks').select('*').eq('tenant_id', t).maybeSingle(),
    db
      .from('l2_silence_candidates')
      .select('*')
      .eq('tenant_id', t)
      .order('created_at', { ascending: false })
      .limit(40),
    db
      .from('campaigns')
      .select('id,title,copy_state,copy_revision,delivery_state')
      .eq('tenant_id', t)
      .eq('calendar_state', 'approved')
      .eq('copy_state', 'pending_approval')
      .order('planned_at')
      .limit(100),
    db
      .from('delivery_packages')
      .select('id,campaign_id,revision')
      .eq('tenant_id', t)
      .order('created_at', { ascending: false })
      .limit(100)
  ])
  if (
    [
      results,
      metadata,
      deliveries,
      rules,
      runs,
      digests,
      jobs,
      policy,
      streak,
      candidates,
      campaigns,
      packages
    ].some((r) => r.error)
  )
    return (
      <Notice error>
        Reporting data unavailable. Retry after checking local migrations.
      </Notice>
    )
  // Only pinned rules change generation; proposed ones wait for the owner.
  const pinnedRules = (rules.data ?? []).filter(
    (rule) => rule.status === 'pinned'
  ).length
  const proposedRules = (rules.data ?? []).filter(
    (rule) => rule.status === 'proposed'
  ).length
  const maxSent = deliveries.data?.[0]?.sent_at
  const clock = new Date(
    Math.max(new Date().getTime(), Date.parse(maxSent ?? '') || 0) +
      8 * 86400000
  ).toISOString()
  return (
    <div className="space-y-6">
      <SplitSection
        eyebrow="Results summary"
        title="What we have learned so far"
        takeaway="These are sample sends only — no real email goes out yet. They show how results and learning will work; they are not real sales or opens."
      >
        <StatGrid label="Results summary" columns={2}>
          <StatTile
            label="Sample sends"
            value={cappedCount(deliveries.data?.length ?? 0, 100)}
            caption="Simulated; no real email went out"
          />
          <StatTile
            label="Result windows"
            value={cappedCount(results.data?.length ?? 0, 100)}
            caption="Collected 48 hours and 7 days after a send"
          />
          <StatTile
            label="Pinned preferences"
            value={
              (rules.data?.length ?? 0) >= 50 ? `${pinnedRules}+` : pinnedRules
            }
            caption={
              proposedRules
                ? `Used in new plans · ${proposedRules} waiting for your decision`
                : 'Used in new plans'
            }
          />
          <StatTile
            label="Real revenue"
            value={null}
            unknownReason="Not connected yet: needs live Klaviyo data"
          />
        </StatGrid>
      </SplitSection>
      <Panel title="Confirmed sends and result windows">
        <Notice>
          All numbers here are deterministic synthetic fixtures. Revenue is a
          fixture seven-day click attribution example, never measured sales.
          Pulls mature at 48 hours and seven days after confirmed send;
          incomplete windows remain visible. Latest 100 windows shown.
        </Notice>
        {owner && (
          <div className="my-5 grid gap-4 sm:grid-cols-2">
            <Command kind="clock">
              <Field label="Synthetic reporting clock (ISO with timezone)">
                <TextField name="observedAt" required defaultValue={clock} />
              </Field>
              <SubmitButton>Advance fixture reporting clock</SubmitButton>
            </Command>
            <Command kind="run">
              <SubmitButton variant="secondary">
                Run reporting fixture jobs
              </SubmitButton>
            </Command>
          </div>
        )}
        {!results.data?.length && (
          <Notice>
            No collected windows yet. Confirm a synthetic send, then advance its
            reporting clock.
          </Notice>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          {results.data?.map((r) => {
            const m = metadata.data?.find((m) => m.package_id === r.package_id)
            const snapshot = m?.snapshot as { title?: string; goal?: string }
            return (
              <article
                key={r.id}
                className="rounded-lg border border-[var(--line)] p-4 text-sm"
              >
                <h3 className="font-semibold">
                  {snapshot?.title ?? 'Historical campaign'} · {r.window_key}
                </h3>
                <p className="my-2">
                  {r.complete ? 'Complete' : 'Incomplete'} ·{' '}
                  {r.comparable
                    ? 'Comparable cohort'
                    : 'Excluded from comparisons'}{' '}
                  · source: {r.source}
                </p>
                <dl className="grid grid-cols-2 gap-2">
                  <dt>Recipients</dt>
                  <dd>{r.recipients}</dd>
                  <dt>Unique clicks</dt>
                  <dd>
                    {r.clicks} (
                    {((100 * r.clicks) / Math.max(r.recipients, 1)).toFixed(2)}
                    %)
                  </dd>
                  <dt>Synthetic revenue</dt>
                  <dd>
                    {r.currency} {(r.revenue_minor / 100).toFixed(2)}
                  </dd>
                  <dt>Unsubscribes / spam</dt>
                  <dd>
                    {r.unsubscribes} / {r.spam}
                  </dd>
                </dl>
                <p className="mt-3 break-words">
                  Window: {r.window_start} → {r.window_end}
                  <br />
                  Collected at simulated time: {r.collected_at}
                  <br />
                  Stored locally: {r.created_at}
                </p>
                <details className="mt-3">
                  <summary>Comparison inputs, evidence and confounders</summary>
                  <pre className="mt-2 overflow-auto text-xs break-words whitespace-pre-wrap">
                    {JSON.stringify(
                      {
                        metadata: m?.snapshot,
                        cohort: m?.comparison_key,
                        confounders: r.confounders
                      },
                      null,
                      2
                    )}
                  </pre>
                </details>
                {m && (
                  <Link
                    className="mt-3 inline-block underline"
                    href={`/campaigns/${m.campaign_id}` as Route}
                  >
                    Open exact send history
                  </Link>
                )}
              </article>
            )
          })}
        </div>
        {owner &&
          deliveries.data
            ?.filter((d) => !results.data?.some((r) => r.delivery_id === d.id))
            .map((d) => (
              <details key={d.id} className="mt-4">
                <summary>Fixture completeness control · {d.id}</summary>
                <Command kind="metrics" id={d.id}>
                  <Field label={`Metric scenario ${d.id}`}>
                    <select name="scenario" className={controlClass}>
                      <option value="complete">Complete</option>
                      <option value="partial">Partial</option>
                      <option value="incomparable">Incomparable</option>
                    </select>
                  </Field>
                  <SubmitButton variant="secondary">
                    Save metric fixture
                  </SubmitButton>
                </Command>
              </details>
            ))}
      </Panel>
      <Panel title="Evidence-backed preferences">
        <Notice>
          At least five complete comparable campaigns per side, same
          account/audience, channel, approved brand revision, product, offer
          kind and sequence position, within thirty days. Only pinned own rules
          influence fixture copy. Owner prohibitions and offer/stock/cadence
          checks always take precedence. Subject-length correlation is advisory;
          other dimensions remain visible in the evidence.
        </Notice>
        {owner && (
          <div className="my-4">
            <Command kind="learn">
              <SubmitButton>Queue fixture learning comparison</SubmitButton>
            </Command>
          </div>
        )}
        {!rules.data?.length && (
          <p className="mt-4 text-sm">
            Insufficient evidence. No learned rule influences generation.
          </p>
        )}
        <div className="mt-4 space-y-4">
          {rules.data?.map((r) => (
            <article
              key={r.id}
              className="rounded-lg border border-[var(--line)] p-4"
            >
              <h3 className="font-semibold">
                {r.kind} · {r.status} · v{r.revision}
              </h3>
              <p className="my-3 text-sm">{r.summary}</p>
              <details>
                <summary>Exact samples and limitations</summary>
                <pre className="overflow-auto text-xs break-words whitespace-pre-wrap">
                  {JSON.stringify(r.evidence, null, 2)}
                </pre>
              </details>
              {owner && (
                <div className="mt-4">
                  <ConfirmDialog
                    label="Review learned preference"
                    title="Confirm advisory preference"
                    description="Pinning allows this own-data preference to guide future matching fixture copy. Dismissing removes its influence; generation cannot reinstate it."
                  >
                    <Command kind="rule" id={r.id} revision={r.revision}>
                      <Field label="Learning decision">
                        <select name="decision" className={controlClass}>
                          <option value="pinned">Pin preference</option>
                          <option value="dismissed">Dismiss preference</option>
                        </select>
                      </Field>
                      <SubmitButton>Confirm learning decision</SubmitButton>
                    </Command>
                  </ConfirmDialog>
                </div>
              )}
            </article>
          ))}
        </div>
        {runs.data?.map((r) => (
          <details className="mt-4 text-sm" key={r.id}>
            <summary>
              Learning run · {r.status} · {r.created_at}
            </summary>
            <pre className="overflow-auto break-words whitespace-pre-wrap">
              {JSON.stringify(r.detail, null, 2)}
            </pre>
          </details>
        ))}
      </Panel>
      <Panel title="L2 eligibility and silence simulation">
        <Notice>
          Production L2 and design delegation are disabled. Simulation requires
          an explicitly enabled owner policy, approved calendar and unchanged
          validated copy for 72 hours. The exact final design still needs owner
          review. New rejections reset the consecutive confirmed-send streak and
          invalidate pending simulations.
        </Notice>
        <p className="my-4 text-sm">
          Consecutive synthetic sends: {streak.data?.consecutive_sends ?? 0} /{' '}
          {policy.data?.required_sends ?? 10}. Simulation:{' '}
          {policy.data?.enabled ? 'enabled' : 'disabled'}. Production:
          unavailable.
        </p>
        {owner && (
          <div className="space-y-5">
            <ConfirmDialog
              label="Review L2 simulation policy"
              title="Confirm fixture-only L2 policy"
              description="This changes local simulation eligibility only. It does not enable production L2 or delegate owner design approval."
            >
              <Command kind="l2_policy" revision={policy.data?.revision ?? 0}>
                <Field label="Silence simulation">
                  <select
                    name="enabled"
                    className={controlClass}
                    defaultValue={String(policy.data?.enabled ?? false)}
                  >
                    <option value="false">Disabled</option>
                    <option value="true">Enabled (fixtures only)</option>
                  </select>
                </Field>
                <Field label="Required consecutive synthetic sends">
                  <TextField
                    name="required"
                    type="number"
                    min={1}
                    max={100}
                    defaultValue={policy.data?.required_sends ?? 10}
                    required
                  />
                </Field>
                <SubmitButton>Save L2 simulation policy</SubmitButton>
              </Command>
            </ConfirmDialog>
            {campaigns.data?.map((c) => (
              <div
                className="rounded border border-[var(--line)] p-4"
                key={c.id}
              >
                <p className="mb-3 text-sm">
                  {c.title} · pending copy v{c.copy_revision}
                </p>
                <Command
                  kind="silence_prepare"
                  id={c.id}
                  revision={c.copy_revision}
                >
                  <SubmitButton variant="secondary">
                    Prepare exact silence candidate
                  </SubmitButton>
                </Command>
              </div>
            ))}
          </div>
        )}
        {candidates.data?.map((x) => {
          const pkg = packages.data?.find(
            (p) => p.campaign_id === x.campaign_id
          )
          return (
            <article
              key={x.id}
              className="mt-4 rounded border border-[var(--line)] p-4 text-sm"
            >
              <p>
                Silence candidate · {x.status} · earliest synthetic approval{' '}
                {x.eligible_at}
              </p>
              <p className="my-2 break-words">
                Campaign: {x.campaign_id} · exact copy: {x.content_id}
              </p>
              {owner &&
                x.created_by === ctx.userId &&
                x.status === 'pending' && (
                  <ConfirmDialog
                    label="Review silence simulation"
                    title="Simulate version-bound copy silence"
                    description="The server rechecks policy, streak, brand and every target revision. Owner design approval is still required."
                  >
                    <Command kind="silence_apply" id={x.id}>
                      <Field label="Frozen silence clock">
                        <TextField
                          name="observedAt"
                          required
                          defaultValue={x.eligible_at}
                        />
                      </Field>
                      <SubmitButton>
                        Confirm frozen-clock silence simulation
                      </SubmitButton>
                    </Command>
                  </ConfirmDialog>
                )}
              {owner &&
                x.status === 'approved' &&
                x.created_by === ctx.userId &&
                pkg && (
                  <div className="mt-4">
                    <ConfirmDialog
                      label="Review L2 scheduling simulation"
                      title="Confirm synthetic L2 scheduling"
                      description="Only the current immutable package with exact owner copy and design approval may be queued. No real recipient is contacted."
                    >
                      <Command
                        kind="l2_schedule"
                        id={x.id}
                        revision={pkg.revision}
                      >
                        <input name="package" type="hidden" value={pkg.id} />
                        <SubmitButton>Confirm L2 fixture schedule</SubmitButton>
                      </Command>
                    </ConfirmDialog>
                  </div>
                )}
            </article>
          )
        })}
      </Panel>
      <Panel title="Daily synthetic digest">
        {!digests.data?.length && <Notice>No digest yet.</Notice>}
        {digests.data?.map((d) => (
          <details key={d.id} className="mt-3 text-sm">
            <summary>Daily digest · {d.local_date} · source: fixture</summary>
            <pre className="overflow-auto break-words whitespace-pre-wrap">
              {JSON.stringify(d.snapshot, null, 2)}
            </pre>
          </details>
        ))}
      </Panel>
      <Panel title="Reporting operations">
        <ul className="space-y-2 text-sm">
          {jobs.data?.map((j) => (
            <li key={j.id}>
              {j.kind} · {j.status} · {j.attempt}/4 · {j.error_code ?? '—'} ·
              due {j.available_at}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}
