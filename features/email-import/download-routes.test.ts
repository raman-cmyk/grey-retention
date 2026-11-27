// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * DES-ENGINE-003b: the download routes that stay after the old "Add an
 * email you like" pages were retired (their journeys were their only
 * tests): the email's export (`/api/v1/emails/:id/export`) and the exact
 * uploaded file (`/api/v1/email-imports/:id/file`). Signed in only; another
 * workspace gets the same 404 as an unknown id; unknown parts are refused;
 * the exports are attachments the browser never runs.
 */
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  emailExport: vi.fn(),
  fileForResult: vi.fn(),
  originalFile: vi.fn()
}))
vi.mock('@/features/auth/application/request-context', () => ({
  resolveRequestContext: mocks.context
}))
vi.mock('@/features/email-generation/data', () => ({
  emailExport: mocks.emailExport
}))
vi.mock('@/features/email-import/data', () => ({
  fileForResult: mocks.fileForResult,
  originalFile: mocks.originalFile
}))

const { GET: exportGet } =
  await import('@/app/api/v1/emails/[resultId]/export/route')
const { GET: fileGet } =
  await import('@/app/api/v1/email-imports/[importId]/file/route')

const mine = '00000000-0000-4000-8000-000000000101'
const theirs = '00000000-0000-4000-8000-000000000102'
const result = '00000000-0000-4000-8000-0000000000e1'
const upload = '00000000-0000-4000-8000-0000000000f1'
const as = (tenantId: string) =>
  mocks.context.mockResolvedValue({
    kind: 'client',
    tenantId,
    tenantRole: 'owner'
  })
const exp = (part: string, id = result) =>
  exportGet(
    new Request(`http://app.test/api/v1/emails/${id}/export?part=${part}`),
    {
      params: Promise.resolve({ resultId: id })
    }
  )
const file = (id = upload) =>
  fileGet(new Request(`http://app.test/api/v1/email-imports/${id}/file`), {
    params: Promise.resolve({ importId: id })
  })

beforeEach(() => {
  vi.clearAllMocks()
  // Each read is the workspace's own: only workspace 101 has these.
  mocks.emailExport.mockImplementation(
    async (t: string, _id: string, part: string) =>
      t !== mine
        ? null
        : part === 'html'
          ? {
              subject: 'Autumn edit',
              kind: 'html',
              label: 'v1',
              body: '<p>Hello</p>'
            }
          : { subject: 'Autumn edit', kind: 'text', label: 'v1', body: 'Hello' }
  )
  mocks.fileForResult.mockImplementation(async (t: string) =>
    t === mine ? upload : null
  )
  mocks.originalFile.mockImplementation(async (t: string) =>
    t === mine
      ? {
          bytes: new TextEncoder().encode('From: x\r\n\r\nHi'),
          fileName: 'autumn.eml',
          mediaType: 'message/rfc822'
        }
      : null
  )
})

describe('the email downloads that stay (DES-ENGINE-003b)', () => {
  it('refuses anyone not signed in', async () => {
    mocks.context.mockResolvedValue(null)
    expect((await exp('html')).status).toBe(401)
    expect((await file()).status).toBe(401)
    expect(mocks.emailExport).not.toHaveBeenCalled()
    expect(mocks.originalFile).not.toHaveBeenCalled()
  })

  it('refuses an unknown part or id, reading nothing', async () => {
    as(mine)
    for (const part of ['bogus', '', 'HTML'])
      expect((await exp(part)).status).toBe(400)
    expect((await exp('html', 'not-a-uuid')).status).toBe(400)
    expect((await file('not-a-uuid')).status).toBe(400)
    expect(mocks.emailExport).not.toHaveBeenCalled()
  })

  it('gives the html and text exports as attachments the browser never runs', async () => {
    as(mine)
    const html = await exp('html')
    expect(html.status).toBe(200)
    expect(await html.text()).toBe('<p>Hello</p>')
    expect(html.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(html.headers.get('content-disposition')).toContain(
      'attachment; filename="autumn-edit-v1.html"'
    )
    expect(html.headers.get('content-security-policy')).toBe(
      "sandbox; default-src 'none'"
    )
    expect(html.headers.get('x-content-type-options')).toBe('nosniff')
    expect(html.headers.get('cache-control')).toBe('private, no-store')
    const text = await exp('text')
    expect(await text.text()).toBe('Hello')
    expect(text.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    const original = await file()
    expect(original.status).toBe(200)
    expect(await original.text()).toBe('From: x\r\n\r\nHi')
    expect((await exp('file')).status).toBe(200)
  })

  it('gives another workspace the same 404 as an unknown email, on both', async () => {
    as(theirs)
    const unknown = {
      ok: false,
      error: { code: 'not_found', message: 'Not available.' }
    }
    for (const part of ['html', 'text', 'original', 'file']) {
      const got = await exp(part)
      expect(got.status).toBe(404)
      expect(await got.json()).toEqual(unknown)
    }
    const got = await file()
    expect(got.status).toBe(404)
    expect(await got.json()).toEqual(unknown)
    // Read only as the asking workspace.
    expect(mocks.emailExport.mock.calls.every((c) => c[0] === theirs)).toBe(
      true
    )
    expect(mocks.originalFile.mock.calls.every((c) => c[0] === theirs)).toBe(
      true
    )
  })
})
