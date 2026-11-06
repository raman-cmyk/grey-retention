import Link from 'next/link'
import { Sparkles, TriangleAlert } from 'lucide-react'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { brandAction } from '@/features/brand/actions'
import { redoAllBrandSections } from './actions'
import type { Mismatch } from './mismatch'
import { sectionKeys } from './sections'

/** "today", "yesterday", "96 days ago". */
export function updatedAgo(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return null
  const days = Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000))
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
    -days,
    'day'
  )
}

/** Brand & Store sub-tabs; kept visible on every tab (owner brief §5 fix). */
export function BrandTabs({ active }: { active: 'profile' | 'store' }) {
  const tabs = [
    { key: 'profile', label: 'Brand profile', href: '/brand' },
    { key: 'store', label: 'Store', href: '/store' }
  ] as const
  return (
    <nav aria-label="Brand & Store" className="border-b border-[var(--line)]">
      <ul className="flex gap-6 text-sm">
        {tabs.map((tab) => (
          <li key={tab.key}>
            <Link
              href={tab.href}
              aria-current={active === tab.key ? 'page' : undefined}
              className={`-mb-px inline-block border-b-2 py-2.5 ${active === tab.key ? 'border-[var(--text)] font-medium text-[var(--text)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'}`}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function BrandHeader({
  active,
  lastUpdated,
  owner,
  revisions
}: {
  active: 'profile' | 'store'
  lastUpdated: string | null
  owner: boolean
  /** Current revision per section, for "Redo all with AI". */
  revisions?: Record<string, number>
}) {
  return (
    <header className="mb-6 space-y-5">
      <h1 className="tracking-display font-serif text-[1.875rem] leading-tight">
        Brand & Store
      </h1>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-muted)]">
          A sample profile made from your saved brand details. Edit anything; AI
          never changes a field you lock.
        </p>
        {active === 'profile' && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--text-muted)]">
              {lastUpdated
                ? `Last updated ${lastUpdated}`
                : 'Not filled in yet'}
            </span>
            {owner && revisions && (
              <ActionForm action={redoAllBrandSections}>
                {sectionKeys.map((key) => (
                  <input
                    key={key}
                    type="hidden"
                    name={`revision:${key}`}
                    value={revisions[key] ?? 0}
                  />
                ))}
                <SubmitButton pendingLabel="Writing…">
                  <Sparkles className="size-4" aria-hidden="true" />
                  Redo all with AI
                </SubmitButton>
              </ActionForm>
            )}
          </div>
        )}
      </div>
      <BrandTabs active={active} />
    </header>
  )
}

/** Big banner when the profile does not look like the connected accounts. */
export function MismatchBanner({ mismatches }: { mismatches: Mismatch[] }) {
  if (!mismatches.length) return null
  return (
    <section
      aria-labelledby="brand-mismatch"
      className="mb-6 flex gap-3 rounded-[var(--radius-panel)] border border-[var(--danger-ink)] bg-[var(--danger-soft)] p-5 text-sm text-[var(--danger-ink)]"
    >
      <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="space-y-2">
        <h2 id="brand-mismatch" className="font-semibold">
          This profile may belong to a different brand
        </h2>
        {mismatches.map((m) => (
          <p key={m.source}>{m.message}</p>
        ))}
        <p>
          Fix the Brand Identity below, or check the account on{' '}
          <Link href="/connections" className="font-medium underline">
            Connections
          </Link>
          .
        </p>
      </div>
    </section>
  )
}

/** Owner approval of the brand details the AI reads (unchanged rule). */
export function ApprovalBar({
  brand,
  owner
}: {
  brand: { revision: number; approved_revision: number | null } | null
  owner: boolean
}) {
  if (!brand) return null
  const approved = brand.approved_revision === brand.revision
  const text = (
    <p>
      {approved
        ? `Approved for AI use · version ${brand.revision}`
        : 'Your brand details changed. AI drafts and planning wait until you approve this version.'}
    </p>
  )
  const box =
    'mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-[var(--line)] p-4 text-sm'
  if (!owner) return <div className={box}>{text}</div>
  // One form in both states, so "Brand version approved." stays visible
  // after the page re-renders as approved.
  return (
    <ActionForm action={brandAction} className={box}>
      <input name="kind" type="hidden" value="approve" />
      <input name="revision" type="hidden" value={brand.revision} />
      {text}
      {!approved && (
        <SubmitButton variant="secondary">
          Approve brand v{brand.revision}
        </SubmitButton>
      )}
    </ActionForm>
  )
}
