// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const after = vi.hoisted(() => vi.fn())
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => null }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/server', () => ({ after }))
vi.mock('./worker', () => ({ runEmailBuilds: vi.fn() }))

import { redirect } from 'next/navigation'
import { createEmail, createEmailFromInspiration } from './actions'

const tenantId = '00000000-0000-4000-8000-000000000101'
const run = '00000000-0000-4000-8000-0000000000aa'
const build = '00000000-0000-4000-8000-0000000000bb'
const rpc = vi.fn()
const form = (fields: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.append(k, v)
  return f
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.requireRequestContext.mockResolvedValue({
    tenantId,
    tenantRole: 'owner'
  })
  supabase.createClient.mockResolvedValue({ rpc })
  rpc.mockResolvedValue({ data: build, error: null })
})

describe('creating an email', () => {
  it('creates it for the owner, builds it after the reply, and shows the plan', async () => {
    expect(await createEmail({}, form({ run, slot: '2' }))).toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('create_email_build', {
      t: tenantId,
      run,
      slot: 2
    })
    expect(after).toHaveBeenCalledOnce()
    expect(redirect).toHaveBeenCalledWith('/plan')
  })

  it('makes it in the owner’s mode, and leaves Scratch to the command’s default', async () => {
    for (const mode of ['copy', 'remix'] as const) {
      await createEmail({}, form({ run, slot: '1', mode }))
      expect(rpc).toHaveBeenLastCalledWith('create_email_build', {
        t: tenantId,
        run,
        slot: 1,
        mode
      })
    }
    await createEmail({}, form({ run, slot: '1', mode: 'scratch' }))
    expect(rpc).toHaveBeenLastCalledWith('create_email_build', {
      t: tenantId,
      run,
      slot: 1
    })
  })

  it('asks for Copy, Remix or Scratch when the mode is not one of them', async () => {
    for (const mode of ['paste', ''])
      expect(await createEmail({}, form({ run, slot: '0', mode }))).toEqual({
        error: 'Choose Copy, Remix or Scratch.'
      })
    // A broken email and a broken mode: the email comes first.
    expect(
      await createEmail({}, form({ run: 'x', slot: '0', mode: 'paste' }))
    ).toEqual({ error: 'Choose an email from the plan.' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses staff before anything, whatever the mode', async () => {
    auth.requireRequestContext.mockResolvedValue({
      tenantId,
      tenantRole: 'staff'
    })
    expect(
      await createEmail({}, form({ run, slot: '0', mode: 'copy' }))
    ).toEqual({ error: 'Only this workspace’s owner creates emails.' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('is the owner’s only', async () => {
    auth.requireRequestContext.mockResolvedValue({
      tenantId,
      tenantRole: 'staff'
    })
    expect(await createEmail({}, form({ run, slot: '0' }))).toEqual({
      error: 'Only this workspace’s owner creates emails.'
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses a broken form', async () => {
    for (const fields of <Record<string, string>[]>[
      { run: 'x', slot: '0' },
      { run, slot: '-1' },
      { run, slot: '20' },
      { run }
    ])
      expect(await createEmail({}, form(fields))).toEqual({
        error: 'Choose an email from the plan.'
      })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('says why it could not', async () => {
    const cases = [
      [
        { code: 'PT409' },
        'This email’s day has passed or the plan has changed. Plan again to create it.'
      ],
      [
        { code: 'PT409', message: 'This email failed 5 times; plan again' },
        'This email could not be made after 5 tries. Plan again for new emails.'
      ],
      [{ code: '22023' }, 'This plan has no such email. Reload the page.'],
      [
        {
          code: '22023',
          message: 'A text email is written, not copied or remixed',
          hint: 'build_mode_text'
        },
        'A text email is written as a letter, not copied or remixed. Create it as it is.'
      ],
      [
        {
          code: '22023',
          message: 'Choose Copy, Remix or Scratch',
          hint: 'build_mode_unknown'
        },
        'Choose Copy, Remix or Scratch.'
      ],
      [{ code: 'XX000' }, 'We could not create the email. Try again.']
    ] as const
    for (const [error, message] of cases) {
      rpc.mockResolvedValue({ data: null, error })
      expect(await createEmail({}, form({ run, slot: '0' }))).toEqual({
        error: message
      })
    }
    supabase.createClient.mockResolvedValue(null)
    expect(await createEmail({}, form({ run, slot: '0' }))).toEqual({
      error: 'Creating emails is unavailable right now.'
    })
    expect(after).not.toHaveBeenCalled()
  })
})

describe('creating an email from an inspiration email (UI-USE)', () => {
  const reference = '00000000-0000-4000-8000-0000000000cc'
  const use = (over: Record<string, string> = {}) =>
    form({ run, slot: '3', mode: 'copy', reference, ...over })
  // The build the command returned, read back with the owner's session.
  const made = vi.fn()
  const reads: unknown[][] = []
  beforeEach(() => {
    reads.length = 0
    made.mockResolvedValue({
      data: { mode: 'copy', reference_id: reference },
      error: null
    })
    const chain: Record<string, unknown> = {}
    for (const op of ['select', 'eq'])
      chain[op] = (...a: unknown[]) => {
        reads.push([op, ...a])
        return chain
      }
    chain.maybeSingle = made
    supabase.createClient.mockResolvedValue({
      rpc,
      from: (table: string) => {
        reads.push(['from', table])
        return chain
      }
    })
  })

  it('tells the owner, instead of opening it, when that email is already being made another way', async () => {
    for (const data of [
      { mode: 'copy', reference_id: null },
      { mode: 'copy', reference_id: '00000000-0000-4000-8000-0000000000dd' },
      { mode: 'remix', reference_id: reference }
    ]) {
      made.mockResolvedValue({ data, error: null })
      expect(await createEmailFromInspiration({}, use())).toEqual({
        error:
          'This email is already being made from another design. Open it on your plan.'
      })
    }
    expect(reads).toEqual(
      expect.arrayContaining([
        ['from', 'email_builds'],
        ['select', 'mode,reference_id'],
        ['eq', 'id', build],
        ['eq', 'tenant_id', tenantId]
      ])
    )
    expect(redirect).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
  })

  it('creates it for the owner with the chosen email, builds it, and opens its page', async () => {
    expect(await createEmailFromInspiration({}, use())).toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('create_email_build', {
      t: tenantId,
      run,
      slot: 3,
      mode: 'copy',
      reference
    })
    expect(after).toHaveBeenCalledOnce()
    expect(redirect).toHaveBeenCalledWith(`/plan/email/${build}`)
    await createEmailFromInspiration({}, use({ mode: 'remix' }))
    expect(rpc).toHaveBeenLastCalledWith(
      'create_email_build',
      expect.objectContaining({ mode: 'remix', reference })
    )
  })

  it('is the owner’s only, before anything is read', async () => {
    auth.requireRequestContext.mockResolvedValue({
      tenantId,
      tenantRole: 'staff'
    })
    expect(await createEmailFromInspiration({}, use())).toEqual({
      error: 'Only this workspace’s owner creates emails.'
    })
    expect(supabase.createClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses a broken form: a missing email, a planned email, or Copy or Remix', async () => {
    const cases: [Record<string, string>, string][] = [
      [{ reference: 'x' }, 'Choose an email in Inspiration first.'],
      [{ reference: '' }, 'Choose an email in Inspiration first.'],
      [{ slot: '' }, 'Choose a planned email.'],
      [{ slot: '20' }, 'Choose a planned email.'],
      [{ run: 'x' }, 'Choose a planned email.'],
      // Scratch follows no email.
      [{ mode: 'scratch' }, 'Choose Copy or Remix.'],
      [{ mode: '' }, 'Choose Copy or Remix.']
    ]
    for (const [over, error] of cases)
      expect(await createEmailFromInspiration({}, use(over))).toEqual({
        error
      })
    const none = new FormData()
    none.append('run', run)
    none.append('reference', reference)
    expect(await createEmailFromInspiration({}, none)).toEqual({
      error: 'Choose a planned email.'
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('says why it could not, from the command’s hints', async () => {
    const cases = [
      [
        {
          code: '22023',
          message: 'This inspiration email is not one you can use',
          hint: 'build_reference_unknown'
        },
        'This email is no longer in your Inspiration. Choose another one there.'
      ],
      [
        {
          code: '22023',
          message: 'Choose Copy or Remix for an inspiration email',
          hint: 'build_mode_reference'
        },
        'Choose Copy or Remix.'
      ],
      [
        { code: '22023', hint: 'build_mode_text' },
        'A text email is written as a letter, not copied or remixed. Create it as it is.'
      ],
      [
        { code: 'PT409' },
        'This email’s day has passed or the plan has changed. Plan again to create it.'
      ],
      [{ code: '42501' }, 'We could not create the email. Try again.']
    ] as const
    for (const [error, message] of cases) {
      rpc.mockResolvedValue({ data: null, error })
      expect(await createEmailFromInspiration({}, use())).toEqual({
        error: message
      })
    }
    expect(after).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })
})
