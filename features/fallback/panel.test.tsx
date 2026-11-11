import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
vi.mock('@/lib/supabase/server', () => supabase)
vi.mock('@/features/auth/application/request-context', () => auth)

import { FallbackLogPanel, fallbackRows } from './panel'

const row = {
  id: 'f1',
  workspace: 'Cedar Lane',
  campaign_id: 'c1',
  agent: 'copy_check',
  reason_code: 'copy_check_failed',
  reason: 'The copy failed the brand check 3 times.',
  fallback: 'Used plainer copy.',
  attempts: 3,
  occurrences: 2,
  detail: {},
  created_at: '2026-11-10T08:00:00Z',
  last_seen_at: '2026-11-11T09:30:00Z'
}
const answer = (value: { data: unknown; error: unknown }) => {
  const rpc = vi.fn(async () => value)
  supabase.createClient.mockResolvedValue({ rpc })
  return rpc
}

afterEach(cleanup)

describe('the fallback log on Admin -> Operations', () => {
  it('lists what went wrong and what the system did instead', async () => {
    const rpc = answer({
      data: [row, { ...row, id: 'f2', workspace: null, agent: 'tagger' }],
      error: null
    })
    render(await FallbackLogPanel())
    expect(auth.requireRequestContext).toHaveBeenCalledWith('admin')
    expect(rpc).toHaveBeenCalledWith('admin_fallback_log', {
      max_rows: fallbackRows
    })
    const [first, second] = screen.getAllByRole('row').slice(1)
    expect(within(first).getByText('2026-11-11 09:30 UTC')).toBeVisible()
    expect(within(first).getByText('Cedar Lane')).toBeVisible()
    expect(
      within(first).getByText('The copy failed the brand check 3 times.')
    ).toBeVisible()
    expect(within(first).getByText('Used plainer copy.')).toBeVisible()
    expect(within(second).getByText('Platform')).toBeVisible()
  })

  it('reads nothing for someone who is not an admin', async () => {
    const rpc = answer({ data: [row], error: null })
    auth.requireRequestContext.mockRejectedValueOnce(new Error('NEXT_REDIRECT'))
    await expect(FallbackLogPanel()).rejects.toThrow('NEXT_REDIRECT')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('shows nothing without a database', async () => {
    supabase.createClient.mockResolvedValue(null)
    expect(await FallbackLogPanel()).toBeNull()
  })

  it('says when there is nothing yet, or when it cannot load', async () => {
    answer({ data: [], error: null })
    render(await FallbackLogPanel())
    expect(screen.getByText('No fallbacks yet.')).toBeVisible()
    cleanup()
    answer({ data: null, error: { code: '42501' } })
    render(await FallbackLogPanel())
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The fallback log is unavailable.'
    )
  })
})
