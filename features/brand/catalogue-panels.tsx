import { Panel, Field, controlClass } from '@/components/ui/workspace'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { TextField } from '@/components/ui/text-field'
import { StockRefresh } from '@/features/onboarding/panels'
import { futureIso } from '@/lib/time'
import { brandAction } from './actions'
import type { campaignWorkspace } from '@/features/campaigns/data'
import type { ClientRequestContext } from '@/features/auth/domain/types'

type Data = NonNullable<Awaited<ReturnType<typeof campaignWorkspace>>['data']>

/** Catalogue and permitted offers (moved unchanged from the old /brand page). */
export function CataloguePanels({
  context,
  data
}: {
  context: Pick<ClientRequestContext, 'tenantRole' | 'timezone'>
  data: Data
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Catalog">
        {data.products.map((p) => (
          <article
            className="mb-4 border-b border-[var(--line)] pb-3 text-sm"
            key={p.id}
          >
            <h3 className="font-medium">{p.title}</h3>
            <p>
              {p.stock} available · {p.source}
              {p.synthetic ? ' · Synthetic' : ''}
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              Stock checked{' '}
              {new Intl.DateTimeFormat('en', {
                timeZone: context.timezone,
                dateStyle: 'short',
                timeStyle: 'short'
              }).format(new Date(p.stock_observed_at))}
            </p>
            {context.tenantRole === 'owner' && <StockRefresh product={p} />}
          </article>
        ))}
        {context.tenantRole === 'owner' && (
          <ActionForm action={brandAction} className="grid gap-4">
            <input type="hidden" name="kind" value="product" />
            <Field label="Product title">
              <TextField name="title" required />
            </Field>
            <Field label="Product HTTPS URL">
              <TextField name="url" type="url" required />
            </Field>
            <Field label="Price in minor units">
              <TextField
                name="price_minor"
                type="number"
                min={0}
                defaultValue={0}
              />
            </Field>
            <Field label="Verified available stock">
              <TextField name="stock" type="number" min={0} defaultValue={0} />
            </Field>
            <div>
              <SubmitButton variant="secondary">
                Add catalog product
              </SubmitButton>
            </div>
          </ActionForm>
        )}
      </Panel>
      <Panel title="Permitted offers">
        {data.offers.map((o) => (
          <article
            className="mb-4 border-b border-[var(--line)] pb-3 text-sm"
            key={o.id}
          >
            <h3 className="font-medium">{o.label}</h3>
            <p>{o.conditions}</p>
            <p className="text-xs text-[var(--text-muted)]">
              {o.kind} · {o.depth_percent}% · until{' '}
              {new Date(o.ends_at).toLocaleDateString('en', {
                timeZone: context.timezone
              })}
            </p>
          </article>
        ))}
        {context.tenantRole === 'owner' && (
          <ActionForm action={brandAction} className="grid gap-4">
            <input type="hidden" name="kind" value="offer" />
            <Field label="Offer label">
              <TextField name="label" required />
            </Field>
            <Field label="Offer type">
              <select name="offer_kind" className={controlClass}>
                <option value="evergreen">Evergreen</option>
                <option value="discount">Discount</option>
                <option value="sitewide">Sitewide offer</option>
              </select>
            </Field>
            <Field label="Maximum discount percent">
              <TextField
                name="depth_percent"
                type="number"
                min={0}
                max={100}
                defaultValue={0}
              />
            </Field>
            <Field label="Offer conditions">
              <textarea
                name="conditions"
                className={controlClass}
                required
                rows={2}
              />
            </Field>
            <Field label="Valid from (ISO UTC)">
              <TextField
                name="starts_at"
                defaultValue={new Date().toISOString()}
                required
              />
            </Field>
            <Field label="Valid until (ISO UTC)">
              <TextField name="ends_at" defaultValue={futureIso(30)} required />
            </Field>
            <div>
              <SubmitButton variant="secondary">
                Save permitted offer
              </SubmitButton>
            </div>
          </ActionForm>
        )}
      </Panel>
    </div>
  )
}
