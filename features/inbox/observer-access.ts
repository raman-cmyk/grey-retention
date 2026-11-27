import 'server-only'
import { cache } from 'react'
import { createServiceClient } from '@/lib/supabase/service'
import { messageKey } from './addresses'
import {
  observerEnabled,
  observerSelection,
  type ObserverSelection
} from './observer-sheet'

type Row = {
  id?: string
  inbox_message_id?: string | null
  external_id?: string
  synthetic?: boolean
}
/**
 * GROS-INS-002: one read of the human selection per server render, shared
 * by the library and Your niche (half the Sheets reads on a page). Outside a
 * render (actions, the worker) every call reads afresh; nothing is ever
 * kept across requests.
 */
const currentSelection = cache(() => observerSelection().read())

/** Recheck on display AND reference use. Derived GROS records never own ratings.
 * Caller has already read rows through workspace membership/follow/hide rules.
 * The service lookup returns only the provenance of those authorized IDs.
 */
export async function observerAllowed<T extends Row>(
  rows: T[],
  source?: ObserverSelection
): Promise<T[]> {
  if (!source && !observerEnabled()) return rows
  const selected = await (source ? source.read() : currentSelection())
  const ids = new Set(selected.map((r) => 'observer:' + r.id))
  const keys = new Set(
    selected
      .filter((r) => r.messageId)
      .map((r) => 'msg:' + messageKey(r.messageId, new Uint8Array()))
  )
  const unresolved = rows.filter(
    (r) => !r.synthetic && !keys.has(r.external_id ?? '') && r.inbox_message_id
  )
  const permitted = new Set<string>()
  if (unresolved.length) {
    const service = createServiceClient()
    if (!service) throw Error('Observer provenance unavailable')
    const list = [...new Set(unresolved.map((r) => r.inbox_message_id!))]
    for (let i = 0; i < list.length; i += 100) {
      const result = await service
        .from('inbox_messages')
        .select('id,transport_id')
        .in('id', list.slice(i, i + 100))
      if (result.error) throw Error('Observer provenance unavailable')
      for (const row of result.data ?? [])
        if (ids.has(row.transport_id ?? '')) permitted.add(row.id)
    }
  }
  return rows.filter(
    (r) =>
      r.synthetic ||
      keys.has(r.external_id ?? '') ||
      permitted.has(r.inbox_message_id ?? '')
  )
}
