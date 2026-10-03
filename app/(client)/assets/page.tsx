import Image from 'next/image'
import Link from 'next/link'
import {
  PageHeading,
  Panel,
  Notice,
  Field,
  controlClass
} from '@/components/ui/workspace'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { DataTable } from '@/components/ui/data-table'
import { onboardingWorkspace } from '@/features/onboarding/data'
import { onboardingAction } from '@/features/onboarding/actions'
import { importAssets } from '@/features/assets/actions'
import { ReadinessPanel, SetupJobs } from '@/features/onboarding/panels'
export default async function AssetsPage({
  searchParams
}: {
  searchParams: Promise<{ category?: string }>
}) {
  const data = await onboardingWorkspace(),
    category = (await searchParams).category,
    setup = data.setup,
    owner = data.context.tenantRole === 'owner'
  if (!setup || !data.data)
    return <Notice error>{data.error ?? 'Asset data unavailable.'}</Notice>
  const shown = setup.assets.filter(
    (a) =>
      !category ||
      category === 'all' ||
      (category === 'pending' ? !a.category : a.category === category)
  )
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeading
        title="Brand assets"
        description="Private originals, resumable imports, catalog matches and owner corrections. No product photography is generated."
      />
      <div className="space-y-6">
        <Panel title="Bulk image or ZIP intake">
          <ActionForm action={importAssets} className="grid gap-4">
            <Field label="Brand image files or one ZIP">
              <input
                name="files"
                type="file"
                multiple
                required
                accept="image/png,image/jpeg,image/webp,.zip"
                className={controlClass}
              />
            </Field>
            <p className="text-xs text-[var(--text-muted)]">
              100 files maximum; 10 MiB compressed intake and 20 MiB expanded.
              PNG/JPEG/WebP signatures required. Unsupported files fail
              individually; archives never extract paths to disk.
            </p>
            <div>
              <SubmitButton>Import private assets</SubmitButton>
            </div>
          </ActionForm>
          {owner && (
            <ActionForm action={onboardingAction} className="mt-5">
              <input type="hidden" name="kind" value="queue" />
              <input type="hidden" name="job" value="assets.classify" />
              <input type="hidden" name="sourceText" value="" />
              <SubmitButton variant="secondary">
                Queue synthetic classification
              </SubmitButton>
            </ActionForm>
          )}
        </Panel>
        <Panel title={`Classified gallery · ${shown.length} shown`}>
          <Notice>
            Fixture tags and filename-based catalog matches are synthetic.
            Review them before design use; ambiguous matches stay unresolved.
            The real-image 90% accuracy target has not been evaluated.
          </Notice>
          <nav
            className="my-5 flex flex-wrap gap-3 text-sm"
            aria-label="Asset category filters"
          >
            {[
              'all',
              'pending',
              'product',
              'lifestyle',
              'proof',
              'logo',
              'unusable'
            ].map((c) => (
              <Link
                key={c}
                href={`/assets?category=${c}`}
                className="rounded-lg border border-[var(--line)] px-3 py-2"
              >
                {c}
              </Link>
            ))}
          </nav>
          {!shown.length ? (
            <Notice>
              No assets match this category. Import originals or sync the
              fixture folder in Connections.
            </Notice>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((a) => (
                <article
                  key={a.id}
                  className="min-w-0 rounded-xl border border-[var(--line)] p-4"
                >
                  <div className="flex h-44 items-center justify-center rounded-lg bg-[var(--surface-muted)]">
                    {a.preview ? (
                      <Image
                        src={a.preview}
                        width={300}
                        height={180}
                        unoptimized
                        alt={a.filename}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <p className="text-sm">Preview unavailable</p>
                    )}
                  </div>
                  <h3 className="my-3 text-sm font-semibold break-words">
                    {a.filename}
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    {a.category ?? 'Pending'} · v{a.revision} ·{' '}
                    {a.classification_source ?? 'unclassified'}
                    {a.synthetic ? ' · Synthetic graphic' : ''}
                  </p>
                  <p className="my-2 text-xs">
                    Match:{' '}
                    {data.data!.products.find((p) => p.id === a.product_id)
                      ?.title ?? 'Unresolved'}
                    {a.variant_id ? ' · variant matched' : ''}
                  </p>
                  {owner && (
                    <ActionForm
                      key={a.revision}
                      action={onboardingAction}
                      className="mt-4 grid gap-3"
                    >
                      <input type="hidden" name="kind" value="correct" />
                      <input type="hidden" name="asset" value={a.id} />
                      <input type="hidden" name="revision" value={a.revision} />
                      <Field label={`Category for ${a.filename}`}>
                        <select
                          name="category"
                          className={controlClass}
                          defaultValue={a.category ?? 'unusable'}
                        >
                          {[
                            'product',
                            'lifestyle',
                            'proof',
                            'logo',
                            'unusable'
                          ].map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label={`Product for ${a.filename}`}>
                        <select
                          name="product"
                          className={controlClass}
                          defaultValue={a.product_id ?? ''}
                        >
                          <option value="">Unresolved / not a product</option>
                          {data.data!.products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.title}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label={`Variant for ${a.filename}`}>
                        <select
                          name="variant"
                          className={controlClass}
                          defaultValue={a.variant_id ?? ''}
                        >
                          <option value="">No variant match</option>
                          {setup.variants.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.title} · {v.sku}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <SubmitButton variant="secondary">
                        Save owner correction
                      </SubmitButton>
                    </ActionForm>
                  )}
                </article>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Import outcomes">
          <DataTable
            caption="Recent private asset imports"
            headers={['Filename', 'Outcome', 'Diagnostic']}
          >
            {setup.items.map((i) => (
              <tr key={i.id}>
                <td className="p-3 break-all">{i.filename}</td>
                <td className="p-3">{i.status}</td>
                <td className="p-3">{i.error_code ?? '—'}</td>
              </tr>
            ))}
          </DataTable>
          <p className="mt-4 text-xs text-[var(--text-muted)]">
            {setup.imports.map((i) => `${i.source}: ${i.state}`).join(' · ') ||
              'No imports yet'}
          </p>
        </Panel>
        <SetupJobs setup={setup} owner={owner} />
        <ReadinessPanel setup={setup} />
      </div>
    </div>
  )
}
