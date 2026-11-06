import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { fileImportSetup } from './config'
import { originalDisposition, originalFileResponse } from './download'
import {
  failureMessage,
  fileHint,
  fileKind,
  retryable,
  safeFileName
} from './limits'
import { runEmailFileImport } from './worker'

const tenant = '00000000-0000-4000-8000-000000000101'

describe('file names and hints', () => {
  it('detects only supported kinds and gives immediate hints', () => {
    expect(fileKind('Spring.HTM')).toBe('html')
    expect(fileKind('note.txt')).toBe('text')
    expect(fileKind('msg.eml')).toBe('eml')
    for (const name of [
      'a.zip',
      'a.mbox',
      'a.msg',
      'a.png',
      'eml',
      'a.eml.exe'
    ])
      expect(fileKind(name)).toBeNull()
    expect(fileHint({ name: 'a.zip', size: 10 })).toMatch(/not supported/)
    expect(fileHint({ name: 'a.eml', size: 0 })).toMatch(/empty/)
    expect(fileHint({ name: 'a.eml', size: 4 * 1024 * 1024 + 1 })).toMatch(
      /4 MB/
    )
    expect(fileHint({ name: 'a.eml', size: 4 * 1024 * 1024 })).toBeNull()
  })

  it('cleans untrusted names: path, controls, overrides and quotes removed, extension kept', () => {
    expect(safeFileName('C:\\Users\\x\\..\\spring.eml')).toBe('spring.eml')
    expect(safeFileName('../../etc/pass"wd.txt')).toBe('passwd.txt')
    expect(safeFileName('inv\u202Elmth.eml')).toBe('invlmth.eml')
    expect(safeFileName('a\u0000b\r\n.html')).toBe('ab.html')
    const long = safeFileName(`${'x'.repeat(400)}.eml`)
    expect(long).toHaveLength(200)
    expect(long.endsWith('….eml')).toBe(true)
  })

  it('gives actionable messages and retries only temporary failures', () => {
    expect(failureMessage('content_too_large')).toMatch(/Nothing was cut/)
    expect(failureMessage('mbox_unsupported')).toMatch(/one email/)
    expect(retryable('storage_unavailable')).toBe(true)
    expect(retryable('malformed')).toBe(false)
    expect(retryable('actor_inactive')).toBe(false)
  })
})

describe('protected original downloads', () => {
  it('serves exact bytes (BOM, CRLF, non-UTF-8, attachment bytes) as a sandboxed attachment', async () => {
    const bytes = new Uint8Array([
      0xef, 0xbb, 0xbf, 0x48, 0x0d, 0x0a, 0xe9, 0x00, 0xff
    ])
    const response = originalFileResponse({
      bytes,
      fileName: 'Café spring.eml',
      mediaType: 'message/rfc822'
    })
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
    expect(response.headers.get('content-type')).toBe('message/rfc822')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('content-security-policy')).toBe(
      "sandbox; default-src 'none'"
    )
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="Cafe spring.eml"; filename*=UTF-8''Caf%C3%A9%20spring.eml`
    )
  })

  it('never lets a name break the header or change the type', () => {
    const header = originalDisposition('evil";\r\nx: y.html', 'text/html')
    expect(header).not.toMatch(/[\r\n]/)
    expect(header.startsWith('attachment; filename="evilx y.html"')).toBe(true)
    expect(originalDisposition('noext', 'message/rfc822')).toContain(
      'filename="noext.eml"'
    )
  })

  it('shortens names at emoji boundaries and always produces a valid header', async () => {
    // Stored name: 200 units including the extension, the emoji never split.
    const stored = safeFileName(`${'a'.repeat(194)}😀${'x'.repeat(10)}.eml`)
    expect(stored).toBe(`${'a'.repeat(194)}….eml`)
    expect(stored.length).toBeLessThanOrEqual(200)
    expect(safeFileName(`${'a'.repeat(193)}😀${'x'.repeat(10)}.eml`)).toBe(
      `${'a'.repeat(193)}😀….eml`
    )
    // Lone surrogates from a hostile name become a replacement character.
    expect(safeFileName('bad\uD800name.eml')).toBe('bad�name.eml')
    // Download stem crossing the 120-unit cut: no URIError, emoji kept whole or dropped.
    const header = originalDisposition(
      `${'a'.repeat(119)}😀x.eml`,
      'message/rfc822'
    )
    expect(header).toBe(
      `attachment; filename="${'a'.repeat(119)}....eml"; filename*=UTF-8''${'a'.repeat(119)}%E2%80%A6.eml`
    )
    const response = originalFileResponse({
      bytes: new Uint8Array([1, 2, 3]),
      fileName: `${'a'.repeat(117)}😀xx.eml`,
      mediaType: 'message/rfc822'
    })
    // 117 + emoji (2 units) fits before the ellipsis at 120 units, so it is kept whole.
    expect(response.headers.get('content-disposition')).toContain(
      `${'a'.repeat(117)}%F0%9F%98%80%E2%80%A6.eml`
    )
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3])
    )
  })
})

describe('upload pilot gate', () => {
  const base = {
    SUPABASE_SERVICE_ROLE_KEY: 'k',
    NODE_ENV: 'development'
  } as NodeJS.ProcessEnv
  it('needs the server worker credential', () => {
    expect(
      fileImportSetup(tenant, {
        ...base,
        SUPABASE_SERVICE_ROLE_KEY: '',
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321'
      })
    ).toEqual({
      ready: false,
      reason: 'missing_service_credential'
    })
  })
  it('allows a local loopback stack outside production only', () => {
    expect(
      fileImportSetup(tenant, {
        ...base,
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321'
      }).ready
    ).toBe(true)
    expect(
      fileImportSetup(tenant, {
        ...base,
        NODE_ENV: 'production',
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321'
      }).ready
    ).toBe(false)
  })
  it('hosted storage is default-deny; exact UUIDs only, no wildcard', () => {
    const hosted = {
      ...base,
      NODE_ENV: 'production',
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co'
    } as NodeJS.ProcessEnv
    expect(fileImportSetup(tenant, hosted)).toEqual({
      ready: false,
      reason: 'workspace_not_enabled'
    })
    expect(
      fileImportSetup(tenant, { ...hosted, EMAIL_IMPORT_TENANT_IDS: '*' }).ready
    ).toBe(false)
    expect(
      fileImportSetup(tenant, {
        ...hosted,
        EMAIL_IMPORT_TENANT_IDS: `x, ${tenant.toUpperCase()}`
      }).ready
    ).toBe(true)
    const many = Array.from(
      { length: 50 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    )
    expect(
      fileImportSetup(tenant, {
        ...hosted,
        EMAIL_IMPORT_TENANT_IDS: [...many, tenant].join(',')
      }).ready
    ).toBe(false)
  })
})

describe('server worker', () => {
  const eml = new TextEncoder().encode(
    'Subject: Hi\r\nContent-Type: text/plain\r\n\r\nHello\r\n'
  )
  const sha = createHash('sha256').update(eml).digest('hex')
  const env = {
    SUPABASE_SERVICE_ROLE_KEY: 'k',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NODE_ENV: 'test'
  } as NodeJS.ProcessEnv
  const claim = {
    job_id: 'j',
    lease_token: 'l',
    storage_path: `${tenant}/${sha}.eml`,
    sha256: sha,
    byte_size: eml.length,
    file_kind: 'eml',
    file_name: 'hi.eml',
    title: ''
  }
  const rpc = vi.fn()
  let download: () => Promise<{ data: Blob | null; error: unknown }>
  const worker = () =>
    ({
      rpc,
      storage: { from: () => ({ download: () => download() }) }
    }) as unknown as Parameters<typeof runEmailFileImport>[0]
  beforeEach(() => {
    rpc.mockReset()
    download = async () => ({ data: new Blob([eml]), error: null })
    rpc.mockImplementation(async (name: string) => {
      if (name === 'claim_email_file_import')
        return { data: [claim], error: null }
      if (name === 'fail_email_file_import')
        return { data: 'failed', error: null }
      if (name === 'finish_email_file_import')
        return { data: 'ref', error: null }
      return { data: null, error: { message: 'unexpected' } }
    })
  })
  const failures = () =>
    rpc.mock.calls
      .filter(([name]) => name === 'fail_email_file_import')
      .map(([, a]) => a.failure.code)

  it('accepts output only for the verified frozen bytes', async () => {
    expect(await runEmailFileImport(worker(), tenant, 'i', { env })).toBe(
      'succeeded'
    )
    const finish = rpc.mock.calls.find(
      ([name]) => name === 'finish_email_file_import'
    )![1]
    expect(finish.output.sha256).toBe(sha)
    expect(finish.output.format).toBe('text')
  })
  it('refuses changed bytes', async () => {
    download = async () => ({
      data: new Blob([eml.slice(0, -1), new Uint8Array([0x21])]),
      error: null
    })
    expect(await runEmailFileImport(worker(), tenant, 'i', { env })).toBe(
      'failed'
    )
    expect(failures()).toEqual(['hash_mismatch'])
  })
  it('separates a missing object from a storage outage', async () => {
    download = async () => ({
      data: null,
      error: { status: 400, message: 'Object not found' }
    })
    await runEmailFileImport(worker(), tenant, 'i', { env })
    download = async () => ({
      data: null,
      error: { status: 503, message: 'down' }
    })
    await runEmailFileImport(worker(), tenant, 'i', { env })
    expect(failures()).toEqual(['source_missing', 'storage_unavailable'])
  })
  it('stops without a pilot grant and reports a paused workspace', async () => {
    await runEmailFileImport(worker(), tenant, 'i', {
      env: { ...env, NODE_ENV: 'production' }
    })
    expect(failures()).toEqual(['setup_required'])
    expect(
      rpc.mock.calls.some(([name]) => name === 'finish_email_file_import')
    ).toBe(false)
    rpc.mockImplementation(async () => ({
      data: null,
      error: { code: '42501', message: 'Workspace unavailable' }
    }))
    expect(await runEmailFileImport(worker(), tenant, 'i', { env })).toBe(
      'paused'
    )
  })
  it('maps parser-only codes onto stored codes and never leaks content in failures', async () => {
    const misnamed = new TextEncoder().encode(
      'MIME-Version: 1.0\r\nSubject: x\r\n\r\n<p>x</p>'
    )
    download = async () => ({ data: new Blob([misnamed]), error: null })
    const sha2 = createHash('sha256').update(misnamed).digest('hex')
    rpc.mockImplementation(async (name: string) =>
      name === 'claim_email_file_import'
        ? {
            data: [
              {
                ...claim,
                file_kind: 'html',
                sha256: sha2,
                byte_size: misnamed.length
              }
            ],
            error: null
          }
        : { data: 'failed', error: null }
    )
    await runEmailFileImport(worker(), tenant, 'i', { env })
    expect(rpc.mock.calls.at(-1)![1]).toEqual({
      job: 'j',
      lease: 'l',
      failure: { code: 'unsupported_type' }
    })
  })
  it('is idle when nothing is due', async () => {
    rpc.mockImplementation(async () => ({ data: [], error: null }))
    expect(await runEmailFileImport(worker(), tenant, 'i', { env })).toBe(
      'idle'
    )
  })
})
