import { ButtonLink } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { Status } from '@/components/gros/status'
import { brandGuard } from '@/features/brand-profile/data'

/**
 * The brand check before GROS answers (UIR-021, as BrandCheck on the old
 * pages), in the GROS design: when the Brand profile looks like another
 * brand than the connected accounts or the catalogue, a card that says so
 * with the first difference and opens the Brand profile. It never blocks;
 * the owner decides.
 */
export async function BrandNote({
  tenantId,
  action
}: {
  tenantId: string
  /** What is about to happen: GROS answers. */
  action: string
}) {
  const mismatches = await brandGuard(tenantId)
  if (!mismatches.length) return null
  const more = mismatches.length - 1
  return (
    <Card label="Brand check">
      <aside
        role="note"
        aria-label="Brand check"
        className="flex flex-col items-start gap-[var(--space-4)]"
      >
        <Status kind="needs_you" />
        <div className="flex flex-col gap-[var(--space-2)]">
          <h2 className="type-heading">Check your brand</h2>
          <p className="type-body break-words">
            {mismatches[0]!.message} Check it before {action}.
          </p>
          {more > 0 ? (
            <p className="type-caption text-[var(--stone)]">
              {more} more {more === 1 ? 'difference' : 'differences'} on the
              Brand page.
            </p>
          ) : null}
        </div>
        <ButtonLink
          href="/settings/brand"
          label="Open the Brand profile"
          kind="outline"
        />
      </aside>
    </Card>
  )
}
