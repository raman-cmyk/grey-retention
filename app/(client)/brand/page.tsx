import {
  PageHeading,
  Panel,
  Notice,
  Field,
  controlClass
} from '@/components/ui/workspace'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { TextField } from '@/components/ui/text-field'
import { campaignWorkspace } from '@/features/campaigns/data'
import { futureIso } from '@/lib/time'
import { brandAction } from '@/features/brand/actions'
export default async function BrandPage() {
  const { context, data, error } = await campaignWorkspace()
  const b = data?.brand
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeading
        title="Brand and store"
        description="Correct brand facts, approve the current context, and maintain permitted offers and a catalog. Manual stock evidence expires after 24 hours."
      />
      {error ? (
        <Notice error>{error}</Notice>
      ) : (
        <div className="space-y-6">
          <Panel
            title={`Brand context · version ${b?.revision ?? 0}${b?.synthetic ? ' · Synthetic demo' : ''}`}
          >
            {context.tenantRole === 'owner' ? (
              <>
                <ActionForm action={brandAction} className="grid gap-5">
                  <input name="kind" type="hidden" value="save" />
                  <input
                    name="revision"
                    type="hidden"
                    value={b?.revision ?? 0}
                  />
                  <Field label="Brand name">
                    <TextField
                      name="brand_name"
                      defaultValue={b?.brand_name}
                      required
                    />
                  </Field>
                  <Field label="Domain">
                    <TextField name="domain" defaultValue={b?.domain} />
                  </Field>
                  {(['positioning', 'voice', 'prohibitions'] as const).map(
                    (k) => (
                      <Field
                        key={k}
                        label={
                          k === 'prohibitions'
                            ? 'Owner prohibitions'
                            : k === 'voice'
                              ? 'Voice and writing rules'
                              : 'Positioning and verified facts'
                        }
                      >
                        <textarea
                          className={controlClass}
                          rows={3}
                          name={k}
                          defaultValue={b?.[k] ?? ''}
                          maxLength={5000}
                        />
                      </Field>
                    )
                  )}
                  <div>
                    <SubmitButton>Save corrected context</SubmitButton>
                  </div>
                </ActionForm>
                {b && (
                  <ActionForm action={brandAction} className="mt-5">
                    <input name="kind" type="hidden" value="approve" />
                    <input name="revision" type="hidden" value={b.revision} />
                    {b.approved_revision === b.revision ? (
                      <Notice>Current brand version approved.</Notice>
                    ) : (
                      <SubmitButton variant="secondary">
                        Approve brand v{b.revision}
                      </SubmitButton>
                    )}
                  </ActionForm>
                )}
              </>
            ) : (
              <p className="text-sm whitespace-pre-wrap">
                {b?.positioning}\n{b?.voice}\n{b?.prohibitions}
              </p>
            )}
          </Panel>
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Catalog">
              {data!.products.map((p) => (
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
                    <TextField
                      name="stock"
                      type="number"
                      min={0}
                      defaultValue={0}
                    />
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
              {data!.offers.map((o) => (
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
                    <TextField
                      name="ends_at"
                      defaultValue={futureIso(30)}
                      required
                    />
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
        </div>
      )}
    </div>
  )
}
