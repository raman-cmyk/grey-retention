import type { Database } from '@/lib/supabase/database.types'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { Field, controlClass } from '@/components/ui/workspace'
import { TextField } from '@/components/ui/text-field'
import { futureIso } from '@/lib/time'
import { saveCampaign } from './actions'
type Row<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']
export function CampaignEditor({
  campaign,
  products,
  offers,
  audiences
}: {
  campaign?: Row<'campaigns'>
  products: Row<'products'>[]
  offers: Row<'offers'>[]
  audiences: Row<'audiences'>[]
}) {
  return (
    <ActionForm action={saveCampaign} className="grid gap-5">
      <input type="hidden" name="id" value={campaign?.id ?? ''} />
      <input
        type="hidden"
        name="revision"
        value={campaign?.calendar_revision ?? 0}
      />
      <Field label="Campaign title">
        <TextField
          name="title"
          defaultValue={campaign?.title}
          required
          minLength={2}
          maxLength={200}
        />
      </Field>
      <Field label="Goal and approved facts">
        <textarea
          className={controlClass}
          name="goal"
          defaultValue={campaign?.goal ?? ''}
          rows={3}
          maxLength={5000}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Email format">
          <select
            name="channel"
            className={controlClass}
            defaultValue={campaign?.channel ?? 'email_design'}
          >
            <option value="email_design">Design email</option>
            <option value="email_text">Text email</option>
          </select>
        </Field>
        <Field label="Send time (ISO UTC, e.g. 2026-11-01T10:00:00Z)">
          <TextField
            name="planned_at"
            defaultValue={
              campaign?.planned_at
                ? new Date(campaign.planned_at).toISOString()
                : futureIso(7)
            }
            required
          />
        </Field>
      </div>
      <Field label="Audience">
        <select
          name="audience_id"
          className={controlClass}
          defaultValue={campaign?.audience_id ?? ''}
        >
          <option value="">Select an audience</option>
          {audiences.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Featured product">
          <select
            name="product_id"
            className={controlClass}
            defaultValue={campaign?.product_id ?? ''}
          >
            <option value="">No product</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} · {p.stock} available
              </option>
            ))}
          </select>
        </Field>
        <Field label="Permitted offer">
          <select
            name="offer_id"
            className={controlClass}
            defaultValue={campaign?.offer_id ?? ''}
          >
            <option value="">No offer</option>
            {offers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Reference structure and notes">
        <textarea
          name="reference_notes"
          className={controlClass}
          rows={3}
          defaultValue={campaign?.reference_notes ?? ''}
          maxLength={5000}
        />
      </Field>
      <p className="text-xs leading-5 text-[var(--text-muted)]">
        Material changes create a new revision and require affected approvals
        again. Times are stored in UTC and displayed in your workspace timezone.
        SMS is unavailable.
      </p>
      <div>
        <SubmitButton>
          {campaign ? 'Save calendar revision' : 'Create campaign'}
        </SubmitButton>
      </div>
    </ActionForm>
  )
}
