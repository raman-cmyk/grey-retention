// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const context = vi.hoisted(() => ({ resolveRequestContext: vi.fn() }))
vi.mock('./request-context', () => context)

import { adminAlsoMember } from './admin-member'

describe('adminAlsoMember (UI-ADM)', () => {
  it('is true only when the admin can open a workspace', async () => {
    context.resolveRequestContext.mockResolvedValueOnce({
      kind: 'client',
      tenantId: 't'
    })
    expect(await adminAlsoMember()).toBe(true)
    expect(context.resolveRequestContext).toHaveBeenLastCalledWith('client')
    context.resolveRequestContext.mockResolvedValueOnce(null)
    expect(await adminAlsoMember()).toBe(false)
  })

  it('hides the link when the lookup fails, and never throws', async () => {
    context.resolveRequestContext.mockRejectedValueOnce(new Error('down'))
    expect(await adminAlsoMember()).toBe(false)
  })
})
