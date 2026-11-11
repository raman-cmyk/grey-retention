import { createClient } from '@/lib/supabase/server'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { Notice, Panel } from '@/components/ui/workspace'
import { DataTable } from '@/components/ui/data-table'

/** How many entries the Operations page shows, newest first. */
export const fallbackRows = 50

const when = (iso: string) =>
  `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC`

/**
 * Decision D16 (RET-002): the people queue became this log. Agents that
 * keep failing a check fall back to a safer option and write one entry;
 * nobody has to act on it. Platform admins only (the read command checks).
 */
export async function FallbackLogPanel() {
  await requireRequestContext('admin')
  const db = await createClient()
  if (!db) return null
  const { data, error } = await db.rpc('admin_fallback_log', {
    max_rows: fallbackRows
  })
  return (
    <Panel title="Fallback log">
      <p className="mb-4 text-sm text-[var(--text-muted)]">
        When an agent&apos;s check keeps failing, the system uses a safer option
        and writes it here. Nobody needs to act; repeated problems become rules
        later.
      </p>
      {error ? (
        <Notice error>The fallback log is unavailable.</Notice>
      ) : !data?.length ? (
        <Notice>No fallbacks yet.</Notice>
      ) : (
        <DataTable
          caption="Latest fallbacks, newest first"
          headers={[
            'Last seen',
            'Workspace',
            'Agent',
            'What went wrong',
            'What we did instead',
            'Tries',
            'Times'
          ]}
        >
          {data.map((f) => (
            <tr key={f.id} className="align-top">
              <td className="px-3 py-2 whitespace-nowrap">
                {when(f.last_seen_at)}
              </td>
              <td className="px-3 py-2">{f.workspace ?? 'Platform'}</td>
              <td className="px-3 py-2 font-mono text-xs">{f.agent}</td>
              <td className="min-w-64 px-3 py-2 break-words">{f.reason}</td>
              <td className="min-w-48 px-3 py-2 break-words">{f.fallback}</td>
              <td className="px-3 py-2">{f.attempts}</td>
              <td className="px-3 py-2">{f.occurrences}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </Panel>
  )
}
