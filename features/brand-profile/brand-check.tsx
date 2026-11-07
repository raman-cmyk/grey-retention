import Link from 'next/link'
import { TriangleAlert } from 'lucide-react'
import { brandGuard } from './data'

/**
 * A short warning to place before any AI step (UIR-021, OWNER_JOURNEYS
 * §0.1): when the Brand profile looks like another brand than the connected
 * accounts or the catalogue. It never blocks; the owner decides.
 */
export async function BrandCheck({
  tenantId,
  action = 'the AI writes anything'
}: {
  tenantId: string
  /** What is about to happen, e.g. "GROS answers". */
  action?: string
}) {
  const mismatches = await brandGuard(tenantId)
  if (!mismatches.length) return null
  return (
    <aside
      role="note"
      aria-label="Brand check"
      className="mb-6 flex gap-3 rounded-[var(--radius-panel)] border border-[var(--warning-ink)] bg-[var(--warning-soft)] p-4 text-sm text-[var(--warning-ink)]"
    >
      <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-semibold">
          Check your Brand profile before {action}.
        </p>
        <p>{mismatches[0]!.message}</p>
        {mismatches.length > 1 && (
          <p>
            {mismatches.length - 1} more{' '}
            {mismatches.length === 2 ? 'difference' : 'differences'} on the
            Brand page.
          </p>
        )}
        <p>
          <Link href="/brand" className="font-medium underline">
            Open the Brand profile
          </Link>
        </p>
      </div>
    </aside>
  )
}
