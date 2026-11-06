import Link from 'next/link'
import { rewriteAvailability } from '@/features/email-generation/config'
import { Composer } from '@/features/composer/composer'
import { randomUUID } from 'node:crypto'
import type { Route } from 'next'
import { Check, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { Field, Notice, controlClass } from '@/components/ui/workspace'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { campaignWorkspace } from '@/features/campaigns/data'
import { referenceWorkspace } from '@/features/references/data'
import { pastedReferences } from '@/features/references/pasted-data'
import { brandAction } from '@/features/brand/actions'
import { latestEmailResult } from '@/features/email-generation/data'
import { startProgress } from './start-model'
import { RetrySetup } from './retry-setup'

export async function GettingStarted({ step }: { step?: string }) {
  const [workspace, references] = await Promise.all([
    campaignWorkspace(),
    referenceWorkspace()
  ])
  const { context, data, error } = workspace
  if (error || references.error || !data || !references.data)
    return (
      <div className="space-y-5">
        <h1 className="text-3xl font-semibold tracking-tight">
          Let’s set up your workspace.
        </h1>
        <Notice error>
          {error ?? references.error ?? 'Setup could not be loaded. Try again.'}
        </Notice>
        <RetrySetup />
        <Link href="/dashboard" className="block text-sm underline">
          Go to workspace
        </Link>
      </div>
    )
  const brand = data.brand
  const [imported, latestEmail] = await Promise.all([
    pastedReferences(context.tenantId, 1).then((r) => r.data),
    latestEmailResult(context.tenantId).then((r) => r.data)
  ])
  const progress = startProgress({
    hasBrand: !!brand,
    hasEmails: references.data.emails.length > 0 || imported.length > 0,
    hasCampaign: data.campaigns.length > 0 || !!latestEmail
  })
  const current =
    progress.steps.find((item) => item.id === step)?.id ?? progress.current
  const owner = context.tenantRole === 'owner'
  return (
    <div>
      <div className="mb-7 flex items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
        <span>{context.tenantName}</span>
        <Link href="/dashboard" className="underline underline-offset-4">
          Exit setup
        </Link>
      </div>
      <nav aria-label="Setup progress" className="mb-8">
        <ol className="flex gap-3">
          {progress.steps.map((item, index) => (
            <li key={item.id} className="min-w-0 flex-1">
              <Link
                href={`/get-started?step=${item.id}` as Route}
                aria-current={current === item.id ? 'step' : undefined}
                className="flex flex-col gap-2 text-xs text-[var(--text-muted)] aria-[current=step]:font-semibold aria-[current=step]:text-[var(--text)]"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--line-strong)]">
                  {item.complete ? (
                    <>
                      <Check className="size-4" aria-hidden />
                      <span className="sr-only">Complete: </span>
                    </>
                  ) : (
                    index + 1
                  )}
                </span>
                {item.label}
              </Link>
            </li>
          ))}
        </ol>
      </nav>
      {current === 'brand' ? (
        <>
          <h1 className="text-3xl font-semibold tracking-tight">
            Which store is yours?
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
            Start with the basics. Add products, offers and connections when you
            need them.
          </p>
          {owner ? (
            <ActionForm
              key={brand?.revision ?? 0}
              action={brandAction}
              className="mt-7 space-y-5"
            >
              <input type="hidden" name="kind" value="save" />
              <input
                type="hidden"
                name="revision"
                value={brand?.revision ?? 0}
              />
              <Field label="Brand name">
                <TextField
                  name="brand_name"
                  defaultValue={brand?.brand_name ?? context.tenantName}
                  minLength={2}
                  maxLength={120}
                  required
                  autoComplete="organization"
                />
              </Field>
              <Field label="Store website (optional)">
                <TextField
                  name="domain"
                  defaultValue={brand?.domain ?? ''}
                  placeholder="yourstore.com"
                  maxLength={300}
                  autoComplete="url"
                />
              </Field>
              <p className="text-xs leading-5 text-[var(--text-muted)]">
                Saving a website records its address. Automatic store scanning
                is not connected yet.
              </p>
              <details className="rounded-lg border border-[var(--line)] p-4">
                <summary className="cursor-pointer text-sm">
                  Brand voice and rules · optional
                </summary>
                <div className="mt-4 space-y-4">
                  {(['positioning', 'voice', 'prohibitions'] as const).map(
                    (key) => (
                      <Field
                        key={key}
                        label={
                          key === 'positioning'
                            ? 'What makes your brand different?'
                            : key === 'voice'
                              ? 'How should your emails sound?'
                              : 'Anything we should avoid?'
                        }
                      >
                        <textarea
                          name={key}
                          defaultValue={brand?.[key] ?? ''}
                          rows={3}
                          maxLength={5000}
                          className={controlClass}
                        />
                      </Field>
                    )
                  )}
                </div>
              </details>
              <SubmitButton variant={brand ? 'secondary' : 'primary'}>
                Save brand details
              </SubmitButton>
            </ActionForm>
          ) : (
            <Notice>Ask your workspace owner to save the brand details.</Notice>
          )}
          {brand && (
            <Button asChild className="mt-5">
              <Link href="/get-started?step=reference">
                Continue <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          )}
        </>
      ) : current === 'reference' ? (
        <>
          <h1 className="text-3xl font-semibold tracking-tight">
            Start with one email.
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
            Paste or upload an email you like — your own or one you received.
            Then rewrite it for your brand or keep an exact copy to edit.
          </p>
          {owner ? (
            <div className="mt-7">
              <Composer
                requestKey={randomUUID()}
                brandName={brand?.brand_name ?? null}
                productCount={data.products.length}
                rewriteReady={rewriteAvailability(context.tenantId).ready}
              />
            </div>
          ) : null}
          {owner ? (
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild variant="secondary">
                <Link href="/import-reference">
                  Paste an email <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href={'/import-reference?mode=file' as Route}>
                  Upload a file
                </Link>
              </Button>
            </div>
          ) : (
            <div className="mt-7">
              <Notice>Ask your workspace owner to add reference emails.</Notice>
            </div>
          )}
          {imported.length > 0 && (
            <Link
              href={`/create-email/${imported[0].id}` as Route}
              className="mt-5 block text-sm underline underline-offset-4"
            >
              Use “{imported[0].subject}”, the email you added last
            </Link>
          )}
          <div className="my-6 rounded-xl bg-[var(--surface-hover)] p-5 text-sm leading-6">
            <p className="font-semibold">Or explore a sample</p>
            <p className="mt-2 text-[var(--text-muted)]">
              Sample capture uses fictional .example brands. Real competitor
              monitoring is still to be built.
            </p>
            <Link
              href={
                references.data.emails.length
                  ? '/email-library'
                  : '/competitor-agent'
              }
              className="mt-3 inline-block underline underline-offset-4"
            >
              {references.data.emails.length
                ? 'Choose a sample email'
                : 'Add a sample competitor'}
            </Link>
          </div>
          <Link
            href="/get-started?step=draft"
            className="block text-sm text-[var(--text-muted)] underline underline-offset-4"
          >
            Skip for now and plan an original email
          </Link>
        </>
      ) : (
        <>
          <h1 className="text-3xl font-semibold tracking-tight">
            {latestEmail ? 'Your email is saved.' : 'Make your first email.'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
            {latestEmail
              ? 'Open it to preview, edit and send it for your approval. Nothing is sent without you.'
              : imported.length
                ? 'Choose whether to rewrite the email you added for your brand or keep an exact copy.'
                : 'Start by adding an email you like. You can also plan an original email from scratch.'}
          </p>
          <Button asChild className="mt-7">
            <Link
              href={
                (latestEmail
                  ? `/emails/${latestEmail.id}`
                  : imported.length
                    ? `/create-email/${imported[0].id}`
                    : '/import-reference') as Route
              }
            >
              {latestEmail
                ? 'Open my email'
                : imported.length
                  ? 'Choose what to make'
                  : 'Paste an email'}{' '}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
          <Link
            href={data.campaigns.length ? '/dashboard' : '/first-draft'}
            className="mt-5 block text-sm text-[var(--text-muted)] underline underline-offset-4"
          >
            {data.campaigns.length
              ? 'Open my workspace'
              : 'Plan an original email instead'}
          </Link>
        </>
      )}
      <p className="mt-8 border-t border-[var(--line)] pt-5 text-xs leading-5 text-[var(--text-faint)]">
        Saved changes stay in this workspace. Come back to Get started whenever
        you need it.
      </p>
    </div>
  )
}
