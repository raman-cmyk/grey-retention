import Link from 'next/link'
import type { Route } from 'next'
import { Check, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { Field, Notice, controlClass } from '@/components/ui/workspace'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { campaignWorkspace } from '@/features/campaigns/data'
import { referenceWorkspace } from '@/features/references/data'
import { brandAction } from '@/features/brand/actions'
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
  const progress = startProgress({
    hasBrand: !!brand,
    hasEmails: references.data.emails.length > 0,
    hasCampaign: data.campaigns.length > 0
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
            Explore a competitor’s email, understand its structure, then use it
            as a starting point for your brand.
          </p>
          <div className="my-6 rounded-xl bg-[var(--surface-hover)] p-5 text-sm leading-6">
            <p className="font-semibold">Sample capture is available</p>
            <p className="mt-2 text-[var(--text-muted)]">
              This build uses fictional .example brands. Real competitor
              monitoring and exact visual reconstruction are still to be built.
            </p>
          </div>
          <Button asChild>
            <Link
              href={
                references.data.emails.length
                  ? '/email-library'
                  : '/competitor-agent'
              }
            >
              {references.data.emails.length
                ? 'Choose an email'
                : 'Add a sample competitor'}{' '}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
          <Link
            href="/get-started?step=draft"
            className="mt-5 block text-sm text-[var(--text-muted)] underline underline-offset-4"
          >
            Skip for now and plan an original email
          </Link>
        </>
      ) : (
        <>
          <h1 className="text-3xl font-semibold tracking-tight">
            {progress.complete ? 'You’re underway.' : 'Make your first draft.'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
            {data.campaigns.length
              ? 'Your saved campaigns are waiting in the workspace. Keep refining your copy and design there.'
              : 'Give your email a goal, choose an audience and pick a date. You’ll review the copy and design before delivery.'}
          </p>
          <Button asChild className="mt-7">
            <Link href={data.campaigns.length ? '/dashboard' : '/first-draft'}>
              {data.campaigns.length
                ? 'Open my workspace'
                : 'Plan my first email'}{' '}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
          <p className="mt-5 text-xs leading-5 text-[var(--text-muted)]">
            This is a practice workflow. Generation and delivery use sample
            providers. Brand approval and sending requirements remain in the
            workspace.
          </p>
        </>
      )}
      <p className="mt-8 border-t border-[var(--line)] pt-5 text-xs leading-5 text-[var(--text-faint)]">
        Saved changes stay in this workspace. Come back to Get started whenever
        you need it.
      </p>
    </div>
  )
}
