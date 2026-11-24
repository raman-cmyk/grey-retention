import { createClient } from '@/lib/supabase/server'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { ButtonLink } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { ListRow, RowList } from '@/components/gros/list-row'
import { ErrorState } from '@/components/gros/states'

/** How many entries the Operations page shows, newest first. */
export const fallbackRows = 50

const when = (iso: string) =>
  `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC`

/**
 * Decision D16 (RET-002): the people queue became this log. Agents that
 * keep failing a check fall back to a safer option and write one entry;
 * nobody has to act on it. Platform admins only (the read command checks).
 * A GROS card of rows, newest first (UI-ADM).
 */
export async function FallbackLogPanel() {
  await requireRequestContext('admin')
  const db = await createClient()
  if (!db) return null
  const { data, error } = await db.rpc('admin_fallback_log', {
    max_rows: fallbackRows
  })
  if (error)
    return (
      <ErrorState
        title="Fallback log did not open"
        reason="The fallback log is unavailable. Reload the page to try again."
        action={<ButtonLink href="/admin/operations" label="Try again" />}
      />
    )
  const title = 'Fallback log'
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <h2 className="type-heading">{title}</h2>
        {!data?.length ? (
          <p className="type-body text-[var(--stone)]">No fallbacks yet.</p>
        ) : (
          <RowList label="Latest fallbacks, newest first">
            {data.map((f) => (
              <ListRow
                key={f.id}
                thumbnail={null}
                title={f.reason}
                wrap
                details={[
                  when(f.last_seen_at),
                  f.workspace ?? 'Platform',
                  f.agent,
                  `Did instead: ${f.fallback}`,
                  `${f.attempts} ${f.attempts === 1 ? 'try' : 'tries'}`,
                  `${f.occurrences} ${f.occurrences === 1 ? 'time' : 'times'}`
                ]}
                end={null}
              />
            ))}
          </RowList>
        )}
      </div>
    </Card>
  )
}
