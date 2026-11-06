'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { ArrowRight } from 'lucide-react'
import { useId, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { ActionForm } from '@/components/ui/action-form'
import { buttonVariants } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { cn } from '@/lib/utils'
import { pastedLimits } from '@/features/references/pasted'
import { composeEmail } from './actions'
import { composerModes, isLinkOnly, type ComposerMode } from './compose'

function SubmitArrow({ blocked }: { blocked: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending || blocked}
      aria-label={pending ? 'Saving your email…' : 'Create my version'}
      className={cn(
        buttonVariants({ variant: 'accent' }),
        'ml-auto size-11 shrink-0 self-end px-0'
      )}
    >
      <ArrowRight className="size-5" aria-hidden />
    </button>
  )
}

/** The paste box; inside the form so its shortcut respects the save state. */
function PasteBox({
  id,
  value,
  onChange,
  blocked,
  describedBy
}: {
  id: string
  value: string
  onChange: (value: string) => void
  blocked: boolean
  describedBy: string
}) {
  const { pending } = useFormStatus()
  return (
    <textarea
      id={id}
      name="body"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          if (!pending && !blocked) event.currentTarget.form?.requestSubmit()
        }
      }}
      aria-keyshortcuts="Control+Enter Meta+Enter"
      rows={6}
      required
      placeholder="Paste a competitor email — its text or HTML"
      aria-describedby={describedBy}
      className="block min-h-40 w-full resize-y border-0 bg-transparent px-5 py-4 text-[0.9375rem] leading-6 text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
    />
  )
}

const statusLinks = (brandName: string | null, productCount: number) =>
  [
    { label: 'Brand', value: brandName ?? 'Not added yet', href: '/brand' },
    {
      label: 'Products',
      value: productCount ? `${productCount} saved` : 'None saved yet',
      href: '/brand'
    },
    { label: 'Footer', value: 'Not set up yet', href: '/connections' }
  ] satisfies { label: string; value: string; href: Route }[]

/**
 * The composer (docs/DESIGN.md → Signature pattern): paste a competitor email,
 * pick EXACT or REBRAND, press the one blue arrow. It saves the email to the
 * workspace and opens the "What should we make?" page with that choice
 * marked; nothing is copied, rewritten or sent until the owner confirms there.
 */
export function Composer({
  requestKey,
  brandName,
  productCount,
  rewriteReady
}: {
  requestKey: string
  brandName: string | null
  productCount: number
  /** False when rewriting is not set up for this workspace. */
  rewriteReady: boolean
}) {
  const id = useId()
  const [body, setBody] = useState('')
  const modes = composerModes.map((item) => ({
    value: item.value,
    label: item.label,
    description: item.description,
    disabledReason:
      'disabledReason' in item
        ? item.disabledReason
        : item.value === 'rebrand' && !rewriteReady
          ? 'Rewriting is not set up for this workspace yet'
          : undefined
  }))
  const [mode, setMode] = useState<ComposerMode>(
    rewriteReady ? 'rebrand' : 'exact'
  )
  const link = isLinkOnly(body)
  const tooLong = body.length > pastedLimits.body
  const current = modes.find((item) => item.value === mode)
  const hint = tooLong
    ? `This email is longer than ${pastedLimits.body.toLocaleString('en')} characters. Upload the file instead, or paste a shorter version.`
    : link
      ? 'Reading an email from a link is not available yet. Open the email, copy its text or HTML, and paste it here.'
      : `${current?.description} We save it to your workspace, then you choose what to make on the next page. Nothing is sent.`

  return (
    <ActionForm preserveValues action={composeEmail}>
      <input type="hidden" name="requestKey" value={requestKey} />
      <div className="overflow-hidden rounded-[var(--radius-panel)] border border-[var(--line-strong)] bg-[var(--surface-raised)] focus-within:border-[var(--focus)] focus-within:ring-1 focus-within:ring-[var(--focus)]">
        <label htmlFor={`${id}-body`} className="sr-only">
          Paste a competitor email
        </label>
        <PasteBox
          id={`${id}-body`}
          value={body}
          onChange={setBody}
          blocked={link || tooLong}
          describedBy={`${id}-hint`}
        />
        <div className="flex flex-wrap items-end justify-between gap-4 border-t border-[var(--line)] bg-[var(--surface-hover)] px-4 py-3">
          <SegmentedControl
            name="mode"
            legend="What to make"
            hideLegend
            options={modes.map((item) => ({ ...item, description: undefined }))}
            value={mode}
            onValueChange={setMode}
            className="min-w-0"
          />
          <SubmitArrow blocked={link || tooLong} />
        </div>
      </div>
      <p
        id={`${id}-hint`}
        className={cn(
          'mt-3 text-sm leading-6',
          tooLong || link
            ? 'text-[var(--danger-ink)]'
            : 'text-[var(--text-muted)]'
        )}
        aria-live="polite"
      >
        {hint}
      </p>
      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs">
        {statusLinks(brandName, productCount).map(({ label, value, href }) => (
          <div key={label} className="flex items-baseline gap-2">
            <dt className="tracking-label font-mono text-[0.6875rem] text-[var(--text-muted)] uppercase">
              {label}
            </dt>
            <dd>
              <Link
                href={href}
                className="text-[var(--text)] underline-offset-4 hover:underline"
              >
                {value}
              </Link>
            </dd>
          </div>
        ))}
      </dl>
    </ActionForm>
  )
}
