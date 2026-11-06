import Link from 'next/link'
import type { Route } from 'next'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { TextField } from '@/components/ui/text-field'
import { Field, Notice, controlClass } from '@/components/ui/workspace'
import { chooseEmailOutcome } from './actions'
import { rewriteAvailability } from './config'
import { emailChoice } from './data'
import { emailFormat } from './html'
import { EmailPreview } from './preview'
import { readablePastedText } from '@/features/references/pasted'
import { httpsLink } from './rewrite'

export async function ChooseOutcome({
  tenantId,
  importId,
  attempt,
  owner
}: {
  tenantId: string
  importId: string
  attempt: string
  owner: boolean
}) {
  const { data, error } = await emailChoice(tenantId, importId)
  if (!data)
    return (
      <div className="space-y-5">
        <h1 className="text-3xl font-semibold tracking-tight">
          What should we make?
        </h1>
        <Notice error={!!error}>
          {error ?? 'This email is not available in this workspace.'}
        </Notice>
        <Link
          href="/import-reference"
          className="block text-sm underline underline-offset-4"
        >
          Paste an email
        </Link>
      </div>
    )
  const original = data.imported.original_body
  const html = emailFormat(original) === 'html'
  const availability = rewriteAvailability(tenantId)
  // Without a website or product the rewrite needs a destination for its button.
  const needsLink = !httpsLink(data.brand?.domain) && data.products.length === 0
  return (
    <div>
      <Link
        href="/get-started?step=reference"
        className="text-xs text-[var(--text-muted)] underline"
      >
        Back to setup
      </Link>
      <h1 className="mt-7 text-3xl font-semibold tracking-tight">
        What should we make?
      </h1>
      <p className="mt-3 text-sm leading-6 break-words text-[var(--text-muted)]">
        From “{data.imported.subject}”. Nothing is sent, and you can edit
        everything after.
      </p>
      <details className="mt-5 rounded-xl border border-[var(--line)] p-4">
        <summary className="cursor-pointer text-sm">
          See the email you added
        </summary>
        <div className="mt-4">
          <EmailPreview
            title="The email you added"
            html={html ? original : null}
            text={html ? '' : readablePastedText(original)}
          />
        </div>
      </details>
      {error && (
        <div className="mt-5">
          <Notice error>{error}</Notice>
        </div>
      )}
      {!owner ? (
        <div className="mt-7">
          <Notice>Ask your workspace owner to make emails.</Notice>
        </div>
      ) : (
        <div className="mt-7 space-y-5">
          <section
            aria-labelledby="choose-rewrite"
            className="rounded-xl border border-[var(--line-strong)] p-5"
          >
            <h2 id="choose-rewrite" className="font-semibold">
              Rewrite for my brand
            </h2>
            <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
              New wording in your voice, using only your brand details. Its
              layout is kept where possible.
              {availability.sample
                ? ' Sample mode: the result is placeholder text, not AI writing.'
                : ''}
            </p>
            {availability.ready ? (
              <ActionForm
                preserveValues
                action={chooseEmailOutcome}
                className="mt-4 space-y-4"
              >
                <input type="hidden" name="attempt" value={attempt} />
                <input type="hidden" name="importId" value={importId} />
                <input type="hidden" name="mode" value="rewrite" />
                {needsLink && (
                  <div className="space-y-2">
                    <Field label="Where should the button go?">
                      <TextField
                        name="link"
                        required
                        inputMode="url"
                        placeholder="https://yourstore.com"
                        maxLength={2000}
                        autoComplete="url"
                      />
                    </Field>
                    <p className="text-xs leading-5 text-[var(--text-muted)]">
                      Or{' '}
                      <Link
                        href="/get-started?step=brand"
                        className="underline underline-offset-4"
                      >
                        add your store website to your brand
                      </Link>{' '}
                      so it is used every time.
                    </p>
                  </div>
                )}
                <details className="rounded-lg border border-[var(--line)] p-4">
                  <summary className="cursor-pointer text-sm">
                    Options · optional
                  </summary>
                  <div className="mt-4 space-y-4">
                    {data.products.length > 0 && (
                      <Field label="Product to feature">
                        <select
                          name="productId"
                          className={controlClass}
                          defaultValue=""
                        >
                          <option value="">None</option>
                          {data.products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.title}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                    {data.offers.length > 0 && (
                      <Field label="Offer to mention">
                        <select
                          name="offerId"
                          className={controlClass}
                          defaultValue=""
                        >
                          <option value="">No offer</option>
                          {data.offers.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                    {!needsLink && (
                      <Field label="Button link">
                        <TextField
                          name="link"
                          inputMode="url"
                          placeholder="https://"
                          maxLength={2000}
                          autoComplete="off"
                        />
                      </Field>
                    )}
                    <Field label="Anything to focus on?">
                      <textarea
                        name="note"
                        rows={2}
                        maxLength={500}
                        className={controlClass}
                      />
                    </Field>
                  </div>
                </details>
                <SubmitButton>Rewrite for my brand</SubmitButton>
              </ActionForm>
            ) : (
              <p className="mt-4 rounded-lg bg-[var(--surface-hover)] p-4 text-sm leading-6">
                Rewriting is not set up yet. An administrator needs to finish
                the AI setup for this workspace. You can copy the email now and
                rewrite it later.
              </p>
            )}
          </section>
          <section
            aria-labelledby="choose-copy"
            className="rounded-xl border border-[var(--line-strong)] p-5"
          >
            <h2 id="choose-copy" className="font-semibold">
              Copy this email
            </h2>
            <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
              An exact copy of the original you can edit. Nothing is rewritten.
            </p>
            <ActionForm
              preserveValues
              action={chooseEmailOutcome}
              className="mt-4"
            >
              <input type="hidden" name="attempt" value={attempt} />
              <input type="hidden" name="importId" value={importId} />
              <input type="hidden" name="mode" value="copy" />
              <SubmitButton variant="secondary">Copy this email</SubmitButton>
            </ActionForm>
          </section>
        </div>
      )}
      {data.results.length > 0 && (
        <section className="mt-8 border-t border-[var(--line)] pt-5">
          <h2 className="text-sm font-semibold">
            Already made from this email
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {data.results.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/emails/${r.id}` as Route}
                  className="underline underline-offset-4"
                >
                  {r.mode === 'copy' ? 'Exact copy' : 'Rewrite'} ·{' '}
                  {new Date(r.created_at).toLocaleDateString('en', {
                    dateStyle: 'medium'
                  })}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Link
        href={`/first-draft?imported=${importId}` as Route}
        className="mt-6 block text-xs text-[var(--text-muted)] underline underline-offset-4"
      >
        Use only its outline in a new plan
      </Link>
    </div>
  )
}
