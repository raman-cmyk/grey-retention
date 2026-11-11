// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
import { aliasAddress } from './data'

describe('aliasAddress', () => {
  it("gives a sample brand the sample inbox's own address", () => {
    expect(aliasAddress('juniper', true, {})).toBe(
      'capture+juniper@inbox.example'
    )
  })

  it('gives a real brand the Gmail inbox address with its +alias', () => {
    expect(
      aliasAddress('northwind', false, {
        INBOX_IMAP_USER: 'Sample.Inbox@gmail.com',
        INBOX_IMAP_APP_PASSWORD: 'abcd efgh ijkl mnop'
      })
    ).toBe('sample.inbox+northwind@gmail.com')
  })

  it('says so instead of guessing when the Gmail inbox is not set up', () => {
    expect(aliasAddress('northwind', false, {})).toBeNull()
    expect(
      aliasAddress('northwind', false, { INBOX_IMAP_USER: 'not-an-address' })
    ).toBeNull()
  })
})
