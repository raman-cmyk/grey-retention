import { History } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card } from '@/components/gros/card'
import { ListRow, RowList } from '@/components/gros/list-row'
import { formatBrandDateTime } from '@/lib/brand-time'
import type { SettingsView } from './page-model'

/**
 * Recent changes on Settings (UI-SETc): who changed what, newest first, in
 * plain words, from the workspace's record (the biggest discount, codes,
 * Klaviyo, the Brand book and the team). Each says who and when, in the
 * brand's timezone (or in UTC, said so, when the timezone could not be
 * read). Only the owner and managers see it; the screen does
 * not draw it for staff.
 */
export function ChangesCard({
  view,
  unread
}: {
  view: SettingsView
  /** What the card says when nothing could be read (or in the demo). */
  unread: ReactNode
}) {
  const title = 'Recent changes'
  const changes = view.changes
  const zone = view.timezone?.saved ?? null
  const when = (at: string) => {
    const text = formatBrandDateTime(at, zone ?? 'UTC')
    return text && !zone ? `${text} UTC` : (text ?? '')
  }
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <h2 className="type-heading">{title}</h2>
        {!changes ? (
          unread
        ) : changes.items.length === 0 && !changes.partial ? (
          <p className="type-body text-[var(--stone)]">No changes yet.</p>
        ) : (
          <>
            {changes.items.length ? (
              <RowList label={title}>
                {changes.items.map((change) => (
                  <ListRow
                    key={change.id}
                    wrap
                    thumbnail={
                      <span
                        aria-hidden
                        className="gros-thumb flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--mist)] text-[var(--stone)]"
                      >
                        <History size={18} strokeWidth={2} />
                      </span>
                    }
                    title={change.text}
                    details={[`by ${change.by}`, when(change.at)]}
                    end={null}
                  />
                ))}
              </RowList>
            ) : null}
            {changes.partial ? (
              <p className="type-body text-[var(--stone)]">
                Some changes could not be read just now. Open Settings again in
                a minute.
              </p>
            ) : null}
          </>
        )}
      </div>
    </Card>
  )
}
