/**
 * Where the Brand book's newest rewrite stands (UI-BRAND-2), from its job
 * (`brand.write_book`, read by the member's session): null once it is done
 * (or there was none).
 *
 * - `waiting`: queued, about to start (it runs right after the click);
 * - `writing`: running under a live lease;
 * - `failed`: a try failed (it waits to try again, or stopped for good);
 * - `stuck`: queued or running for longer than a rewrite takes, so the
 *   owner gets Try again rather than a page that says it is working.
 */
export type RewriteState = 'waiting' | 'writing' | 'failed' | 'stuck'

export type RewriteRow = {
  status: string
  updated_at: string
  lease_until: string | null
}

/** A queued rewrite that has not started after this long is stuck. */
export const stuckAfterMs = 5 * 60_000

export function rewriteState(
  row: RewriteRow | null,
  now: number = Date.now()
): RewriteState | null {
  if (!row) return null
  if (row.status === 'queued')
    return now - Date.parse(row.updated_at) > stuckAfterMs ? 'stuck' : 'waiting'
  if (row.status === 'leased' || row.status === 'running')
    return row.lease_until && Date.parse(row.lease_until) > now
      ? 'writing'
      : 'stuck'
  if (row.status === 'retry_wait' || row.status === 'failed') return 'failed'
  return null
}

/**
 * The rewrite's steps for the Progress card, from its real job states. A
 * failed or stuck rewrite says what to do: the owner tries again, staff
 * ask him.
 */
export function rewriteSteps(state: RewriteState, owner = true) {
  if (state === 'waiting')
    return [
      { text: 'Starting the rewrite', state: 'now' as const },
      { text: 'Write the new Brand book', state: 'next' as const }
    ]
  if (state === 'writing')
    return [
      { text: 'Started the rewrite', state: 'done' as const },
      { text: 'Writing the new Brand book', state: 'now' as const }
    ]
  const next = owner ? 'Try again.' : 'Ask the owner to try again.'
  return [
    {
      text:
        state === 'stuck'
          ? 'The rewrite did not finish'
          : 'The Brand book was not rewritten',
      state: 'failed' as const,
      reason: `Your brand and its corrections are saved. ${next}`
    }
  ]
}
