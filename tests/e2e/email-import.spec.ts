import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { login } from './accounts'
import { newOwner } from './new-owner'

// Original synthetic files only; every host is fictional. Built as raw bytes so
// CRLF, a non-UTF-8 part, a byte order mark and attachment bytes are exact.
const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n')
const eml = (subject: string) =>
  Buffer.from(
    crlf(
      [
        'From: =?utf-8?Q?Caf=C3=A9_Cedar?= <news@cedar-lane.example>',
        `Subject: ${subject}`,
        'Date: Thu, 01 Oct 2026 09:30:00 +0000',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="mix"',
        '',
        '--mix',
        'Content-Type: multipart/alternative; boundary="alt"',
        '',
        '--alt',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Autumn layers are here.',
        '--alt',
        'Content-Type: text/html; charset=iso-8859-1',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        '<table width=3D"600"><tr><td><h1>Autumn layers</h1><p>Caf=E9 blend, warm =',
        'knits.</p><img src=3D"cid:hero@cedar-lane.example" width=3D"600">',
        '<img src=3D"https://tracker.example/open.gif"><script>fetch("https://evil.example")</script>',
        '<a href=3D"https://cedar-lane.example/shop" style=3D"padding:12px">Shop autumn</a></td></tr></table>',
        '--alt--',
        '--mix',
        'Content-Type: application/pdf; name="terms.pdf"',
        'Content-Disposition: attachment; filename="terms.pdf"',
        'Content-Transfer-Encoding: base64',
        '',
        'JVBERi0xLjQKJcOkw7zDtsOfCg==',
        '--mix--',
        ''
      ].join('\n')
    ),
    'latin1'
  )

function watchExternal(page: Page) {
  const seen: string[] = []
  page.on('request', (request) => {
    const host = new URL(request.url()).hostname
    if (!['127.0.0.1', 'localhost'].includes(host)) seen.push(host)
  })
  return seen
}

async function evidence(page: Page, name: string) {
  mkdirSync('coverage/ref-003/screenshots', { recursive: true })
  await page.evaluate(async () => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    window.scrollTo(0, 0)
    await document.fonts.ready
  })
  await page.screenshot({
    path: `coverage/ref-003/screenshots/${name}.png`,
    fullPage: true,
    animations: 'disabled',
    style: 'nextjs-portal { display: none !important; }'
  })
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
}

async function openUpload(page: Page) {
  await page.goto('/import-reference?mode=file')
  await expect(
    page.getByRole('link', { name: 'Upload a file' })
  ).toHaveAttribute('aria-current', 'page')
}

async function upload(
  page: Page,
  name: string,
  buffer: Buffer,
  mimeType: string
) {
  await openUpload(page)
  await page.getByLabel('Email file').setInputFiles({ name, mimeType, buffer })
  await page.getByRole('button', { name: 'Upload and continue' }).click()
  await expect(page).toHaveURL(/\/create-email\/[a-f0-9-]+\?attempt=/, {
    timeout: 20_000
  })
  return page.url().split('/create-email/')[1].split('?')[0]
}

const sha = (b: Buffer | Uint8Array) =>
  createHash('sha256').update(b).digest('hex')

// A complete synthetic message of exactly `size` bytes: a short body plus a
// plain-text attachment padded to fill the remainder.
const maxRaw = 4 * 1024 * 1024
function boundaryEml(size: number) {
  const head = crlf(
    [
      'Subject: Boundary file',
      'From: Cedar Lane <news@cedar-lane.example>',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="edge"',
      '',
      '--edge',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'A short email kept whole at the 4 MiB limit.',
      '--edge',
      'Content-Type: text/plain; charset=us-ascii',
      'Content-Disposition: attachment; filename="filler.txt"',
      '',
      ''
    ].join('\n')
  )
  const tail = '\r\n--edge--\r\n'
  const fill = size - Buffer.byteLength(head) - tail.length
  const line = `${'x'.repeat(76)}\r\n`
  let body = line.repeat(Math.floor(fill / line.length))
  body += 'x'.repeat(fill - body.length)
  const bytes = Buffer.from(head + body + tail, 'latin1')
  expect(bytes.length).toBe(size)
  return bytes
}

test('owner uploads an .eml, copies and edits it, and downloads the exact original file', async ({
  page,
  browser
}, info) => {
  const db = await newOwner(page, { prefix: 'file-eml', name: 'File studio' })
  // A real signed-in workspace is not labelled as a demo, and the overview
  // says plainly which parts are samples.
  await expect(page.getByText('Demo workspace')).toHaveCount(0)
  await expect(page.getByText('Synthetic data only')).toHaveCount(0)
  await expect(
    page.getByText('Emails are saved privately').first()
  ).toBeAttached()
  await expect(
    page.getByText(
      'Sending and performance data use samples. Emails you add and create are saved.'
    )
  ).toBeAttached()
  await expect(page.getByText(/live providers remain disabled/)).toHaveCount(0)
  const external = watchExternal(page)
  const subject = `Autumn layers ${randomUUID().slice(0, 8)}`
  const bytes = eml(subject)

  // The choice sits beside paste in setup; the default stays simple.
  await page.goto('/get-started?step=reference')
  await expect(page.getByRole('link', { name: 'Paste an email' })).toBeVisible()
  await page.getByRole('link', { name: 'Upload a file' }).click()
  await expect(page).toHaveURL(/\/import-reference\?mode=file&attempt=/)
  if (info.project.name.startsWith('mobile'))
    await page.setViewportSize({ width: 360, height: 800 })
  await page.getByLabel('Email file').setInputFiles({
    name: 'autumn.eml',
    mimeType: 'message/rfc822',
    buffer: bytes
  })
  await expect(
    page.getByText(/^autumn\.eml · \d+(\.\d)? (B|KB)$/)
  ).toBeVisible()
  await noOverflow(page)
  await evidence(page, `upload-${info.project.name}`)
  await page.getByRole('button', { name: 'Upload and continue' }).click()
  await expect(page).toHaveURL(/\/create-email\/[a-f0-9-]+\?attempt=/, {
    timeout: 20_000
  })
  const referenceId = page.url().split('/create-email/')[1].split('?')[0]
  await expect(
    page.getByRole('heading', { name: 'What should we make?' })
  ).toBeVisible()
  await expect(page.getByText(`From “${subject}”`)).toBeVisible()

  // Persisted as an owner import linked to the frozen file; the decoded HTML part is the source.
  const imported = await db
    .from('email_file_imports')
    .select(
      'id,state,sha256,byte_size,header_from,attachment_count,notes,content_format'
    )
    .eq('reference_import_id', referenceId)
    .single()
  expect(imported.data).toMatchObject({
    state: 'succeeded',
    sha256: sha(bytes),
    byte_size: bytes.length,
    header_from: 'Café Cedar <news@cedar-lane.example>',
    attachment_count: 1,
    content_format: 'html'
  })
  const reference = await db
    .from('reference_imports')
    .select('original_body,source_kind,origin')
    .eq('id', referenceId)
    .single()
  expect(reference.data).toMatchObject({
    source_kind: 'file',
    origin: 'owner_import'
  })
  expect(reference.data!.original_body).toContain(
    '<p>Café blend, warm knits.</p>'
  )

  // Optional details stay closed; sender/date are labelled unverified.
  await page.getByText('From your file').click()
  await expect(
    page.getByText('Café Cedar <news@cedar-lane.example>')
  ).toBeVisible()
  await expect(
    page.getByText(/as written in the file you added\. They are not verified/)
  ).toBeVisible()
  await expect(
    page.getByText(/Attachments stay inside the original file/)
  ).toBeVisible()
  await noOverflow(page)
  await evidence(page, `choose-file-${info.project.name}`)

  // Exact original bytes, attachment-only, never run at the app origin.
  const raw = await page.request.get(
    `/api/v1/email-imports/${imported.data!.id}/file`
  )
  expect(raw.status()).toBe(200)
  expect(Buffer.compare(await raw.body(), bytes)).toBe(0)
  const headers = raw.headers()
  expect(headers['content-type']).toBe('message/rfc822')
  expect(headers['content-disposition']).toBe(
    `attachment; filename="autumn.eml"; filename*=UTF-8''autumn.eml`
  )
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['cache-control']).toBe('private, no-store')
  expect(headers['content-security-policy']).toBe("sandbox; default-src 'none'")

  // Preview of the decoded part: opaque sandbox, no CID/remote loads, no script.
  await page.getByText('See the email you added').click()
  const preview = page.locator('iframe[title="The email you added"]')
  await expect(preview).toHaveAttribute('sandbox', '')
  const srcdoc = (await preview.getAttribute('srcdoc'))!
  expect(srcdoc).toContain('Café blend')
  expect(srcdoc).not.toMatch(/cid:|tracker\.example|evil\.example|<script/)

  await page.getByRole('button', { name: 'Copy this email' }).click()
  await expect(page).toHaveURL(/\/emails\/[a-f0-9-]+$/, { timeout: 15_000 })
  const resultId = page.url().split('/emails/')[1]
  await page.getByText('Edit email', { exact: true }).click()
  await page.getByLabel('Text 1', { exact: true }).fill('Winter layers')
  await page
    .getByRole('button', { name: 'Save as new version' })
    .first()
    .click()
  await expect(
    page.getByText('Version 2', { exact: false }).first()
  ).toBeVisible({ timeout: 15_000 })

  // After edits: raw file and decoded source are both unchanged, and distinct.
  const exported = (part: string, version?: number) =>
    page.request.get(
      `/api/v1/emails/${resultId}/export?part=${part}${version ? `&version=${version}` : ''}`
    )
  const file = await exported('file')
  expect(file.status()).toBe(200)
  expect(Buffer.compare(await file.body(), bytes)).toBe(0)
  expect(file.headers()['content-security-policy']).toBe(
    "sandbox; default-src 'none'"
  )
  expect(await (await exported('original')).text()).toBe(
    reference.data!.original_body
  )
  expect(await (await exported('html', 2)).text()).toContain('Winter layers')
  await page.getByText('The email you added · from your uploaded file').click()
  await expect(
    page.getByRole('link', { name: 'Download original file (exact bytes)' })
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Download the email content (decoded)' })
  ).toBeVisible()
  expect(external).toEqual([])

  // Re-uploading identical bytes reuses the same import instead of storing twice.
  expect(await upload(page, 'autumn-again.eml', bytes, 'message/rfc822')).toBe(
    referenceId
  )
  const count = await db
    .from('email_file_imports')
    .select('id', { count: 'exact', head: true })
  expect(count.count).toBe(1)

  // Another workspace gets an indistinguishable 404 for both download paths.
  const foreign = await browser.newContext()
  const foreignPage = await foreign.newPage()
  await login(foreignPage, 'other')
  expect(
    (
      await foreignPage.request.get(
        `/api/v1/email-imports/${imported.data!.id}/file`
      )
    ).status()
  ).toBe(404)
  expect(
    (
      await foreignPage.request.get(
        `/api/v1/emails/${resultId}/export?part=file`
      )
    ).status()
  ).toBe(404)
  await foreignPage.goto(`/import-reference/files/${imported.data!.id}`)
  await expect(foreignPage.getByText('Nothing is pinned here.')).toBeVisible()
  await foreign.close()
})

test('file formats are trusted: text stays text, HTML keeps exact bytes, and rewrite works from a file', async ({
  page
}) => {
  const db = await newOwner(page, {
    prefix: 'file-formats',
    name: 'Cedar Lane'
  })
  // An encoded subject whose emoji crosses the 200-unit name bound and a file
  // name whose emoji crosses the 120-unit download bound both save and download.
  const longSubject = 'a'.repeat(198) + '😀long'
  const unicodeEml = Buffer.from(
    crlf(
      `Subject: =?utf-8?B?${Buffer.from(longSubject).toString('base64')}?=\nContent-Type: text/plain; charset=utf-8\n\nEmoji boundary email 😀\n`
    ),
    'utf8'
  )
  const unicodeName = `${'n'.repeat(119)}😀x.eml`
  const unicodeRef = await upload(
    page,
    unicodeName,
    unicodeEml,
    'message/rfc822'
  )
  await expect(page.getByText(`From “${'a'.repeat(198)}…”`)).toBeVisible()
  const unicodeRow = await db
    .from('email_file_imports')
    .select('id,file_name,header_subject,notes')
    .eq('reference_import_id', unicodeRef)
    .single()
  expect(unicodeRow.data).toMatchObject({
    file_name: unicodeName,
    header_subject: longSubject
  })
  expect(unicodeRow.data!.notes).toContain('subject_shortened')
  const unicodeFile = await page.request.get(
    `/api/v1/email-imports/${unicodeRow.data!.id}/file`
  )
  expect(unicodeFile.status()).toBe(200)
  expect(Buffer.compare(await unicodeFile.body(), unicodeEml)).toBe(0)
  expect(unicodeFile.headers()['content-disposition']).toBe(
    `attachment; filename="${'n'.repeat(119)}....eml"; filename*=UTF-8''${'n'.repeat(119)}%E2%80%A6.eml`
  )
  // A .txt with literal markup must stay a text email.
  const literal = Buffer.from(
    crlf('Template notes\n\nUse <p> and <svg> tags in the footer — café ☕.\n'),
    'utf8'
  )
  await upload(page, 'notes.txt', literal, 'text/plain')
  await page.getByRole('button', { name: 'Copy this email' }).click()
  await expect(page).toHaveURL(/\/emails\/[a-f0-9-]+$/, { timeout: 15_000 })
  const textResult = page.url().split('/emails/')[1]
  await expect(page.getByText('Plain-text email').first()).toBeVisible()
  await expect(page.locator('iframe[title^="Email version"]')).toHaveCount(0)
  await expect(
    page
      .getByText('Use <p> and <svg> tags in the footer', { exact: false })
      .locator('visible=true')
      .first()
  ).toBeVisible()
  expect(
    await (
      await page.request.get(`/api/v1/emails/${textResult}/export?part=text`)
    ).text()
  ).toBe(literal.toString('utf8'))

  // An .html with a byte order mark, CRLF and Unicode downloads byte-for-byte.
  await page.goto('/get-started?step=brand')
  await page.getByLabel('Store website (optional)').fill('cedar-lane.example')
  await page.getByRole('button', { name: 'Save brand details' }).click()
  await expect(
    page.getByRole('link', { name: /Complete: Your brand/ })
  ).toBeVisible()
  const html = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(
      crlf(
        '<!doctype html><html><head><title>Acme spring</title></head><body>\n<table width="600"><tr><td><h1>Spring edit</h1><p>Fresh layers for slow weekends — 東京.</p>\n<a href="https://acme.example/shop">Shop the edit</a></td></tr></table></body></html>\n'
      ),
      'utf8'
    )
  ])
  const ref = await upload(page, 'spring.html', html, 'text/html')
  const row = await db
    .from('email_file_imports')
    .select('id')
    .eq('reference_import_id', ref)
    .single()
  const raw = await page.request.get(
    `/api/v1/email-imports/${row.data!.id}/file`
  )
  expect(Buffer.compare(await raw.body(), html)).toBe(0)
  expect(raw.headers()['content-type']).toBe('text/html')

  // Rewrite from the uploaded file through the loopback test double only.
  await page.getByRole('button', { name: 'Rewrite for my brand' }).click()
  await expect(page).toHaveURL(/\/emails\/[a-f0-9-]+$/, { timeout: 15_000 })
  await expect(
    page.getByText('Rewritten with AI ·', { exact: false })
  ).toBeVisible({ timeout: 30_000 })
})

test('invalid files are explained with the selection kept, and an interrupted upload resumes', async ({
  page
}, info) => {
  const db = await newOwner(page, {
    prefix: 'file-errors',
    name: 'Recovery studio'
  })
  await openUpload(page)
  const input = page.getByLabel('Email file')
  const submit = page.getByRole('button', { name: 'Upload and continue' })

  // Browser hints first: unsupported type and over-size never submit.
  await input.setInputFiles({
    name: 'inbox.mbox',
    mimeType: 'application/mbox',
    buffer: Buffer.from('From a\n')
  })
  await expect(page.getByText(/ZIP, mailbox \(\.mbox\)/)).toBeVisible()
  await expect(submit).toBeDisabled()
  await input.setInputFiles({
    name: 'big.eml',
    mimeType: 'message/rfc822',
    buffer: Buffer.alloc(4 * 1024 * 1024 + 1, 0x61)
  })
  await expect(page.getByText(/The limit is 4 MB/)).toBeVisible()
  await expect(submit).toBeDisabled()

  // Server validation (hints are not trusted): a ZIP named .eml, a mailbox, a bad charset.
  const cases: [string, Buffer, RegExp][] = [
    [
      'disguised.eml',
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]),
      /This file type is not supported/
    ],
    [
      'mailbox.eml',
      Buffer.from(
        crlf('From a@cedar.example Thu Oct  1 09:30:00 2026\nSubject: A\n\nx\n')
      ),
      /mailbox with many messages/
    ],
    [
      'odd.eml',
      Buffer.from(
        crlf('Subject: X\nContent-Type: text/plain; charset=x-made-up\n\nhi\n')
      ),
      /text encoding we cannot read/
    ],
    [
      'old.html',
      Buffer.from('<p>Caf\xe9</p>', 'latin1'),
      /how this file’s text is encoded/
    ]
  ]
  for (const [name, buffer, message] of cases) {
    await input.setInputFiles({
      name,
      mimeType: 'application/octet-stream',
      buffer
    })
    await submit.click()
    await expect(page.getByText(message)).toBeVisible({ timeout: 15_000 })
    expect(
      await input.evaluate((el: HTMLInputElement) => el.files?.[0]?.name)
    ).toBe(name)
  }
  expect(
    (
      await db
        .from('email_file_imports')
        .select('id', { count: 'exact', head: true })
    ).count
  ).toBe(0)
  if (info.project.name.startsWith('mobile'))
    await page.setViewportSize({ width: 360, height: 800 })
  await noOverflow(page)
  await evidence(page, `upload-error-${info.project.name}`)

  // An admission whose write never happened (lost connection) is shown honestly...
  const bytes = eml(`Resume ${randomUUID().slice(0, 8)}`)
  const tenant = (await db.rpc('resolve_client_context', {})).data![0].tenant_id
  const admitted = await db.rpc('admit_email_file_upload', {
    t: tenant,
    request_key: randomUUID(),
    input: {
      sha256: sha(bytes),
      byteSize: bytes.length,
      kind: 'eml',
      fileName: 'resume.eml',
      title: ''
    }
  })
  expect(admitted.error).toBeNull()
  const pending = admitted.data![0]
  expect(pending.needs_upload).toBe(true)
  await openUpload(page)
  await expect(page.getByText('Upload not finished')).toBeVisible()
  await page.goto(`/import-reference/files/${pending.import_id}`)
  await expect(
    page.getByRole('heading', { name: 'This upload did not finish.' })
  ).toBeVisible()
  // ...and choosing the same file again completes the same admission, once.
  await upload(page, 'resume.eml', bytes, 'message/rfc822')
  const rows = await db.from('email_file_imports').select('id,state')
  expect(rows.data).toEqual([{ id: pending.import_id, state: 'succeeded' }])
  await openUpload(page)
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: 'resume.eml' })
      .getByText('Ready', { exact: true })
  ).toBeVisible()
})

test('a file of exactly 4 MiB is preserved and exported; one byte more is refused before storage', async ({
  page
}, info) => {
  const db = await newOwner(page, { prefix: 'file-edge', name: 'Edge studio' })
  const exact = boundaryEml(maxRaw)
  const ref = await upload(page, 'boundary.eml', exact, 'message/rfc822')
  const row = await db
    .from('email_file_imports')
    .select('id,byte_size,attachment_count,sha256')
    .eq('reference_import_id', ref)
    .single()
  expect(row.data).toMatchObject({
    byte_size: maxRaw,
    attachment_count: 1,
    sha256: sha(exact)
  })
  const raw = await page.request.get(
    `/api/v1/email-imports/${row.data!.id}/file`
  )
  expect(raw.status()).toBe(200)
  const body = await raw.body()
  expect(body.length).toBeLessThanOrEqual(maxRaw)
  expect(Buffer.compare(body, exact)).toBe(0)
  expect(raw.headers()['content-length']).toBe(String(maxRaw))
  await page.getByRole('button', { name: 'Copy this email' }).click()
  await expect(page).toHaveURL(/\/emails\/[a-f0-9-]+$/, { timeout: 15_000 })
  const resultId = page.url().split('/emails/')[1]
  const exported = await page.request.get(
    `/api/v1/emails/${resultId}/export?part=file`
  )
  expect(Buffer.compare(await exported.body(), exact)).toBe(0)
  expect(
    (
      await page.request.get(`/api/v1/emails/${resultId}/export?part=original`)
    ).ok()
  ).toBe(true)

  // One byte over: the browser blocks it immediately...
  const over = boundaryEml(maxRaw + 1)
  await openUpload(page)
  const input = page.getByLabel('Email file')
  await input.setInputFiles({
    name: 'over.eml',
    mimeType: 'message/rfc822',
    buffer: over
  })
  await expect(page.getByText(/The limit is 4 MB/)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Upload and continue' })
  ).toBeDisabled()
  if (info.project.name.startsWith('mobile'))
    await page.setViewportSize({ width: 360, height: 800 })
  await noOverflow(page)
  await evidence(page, `upload-over-limit-${info.project.name}`)
  // ...and the server refuses it before admission or storage if the hint is bypassed.
  await page
    .locator('form')
    .filter({ has: input })
    .evaluate((form: HTMLFormElement) => form.requestSubmit())
  await expect(page.getByText(/This file is larger than 4 MB/)).toBeVisible({
    timeout: 15_000
  })
  expect(
    await input.evaluate((el: HTMLInputElement) => el.files?.[0]?.name)
  ).toBe('over.eml')
  const rows = await db.from('email_file_imports').select('id')
  expect(rows.data).toHaveLength(1)
  const tenant = (await db.rpc('resolve_client_context', {})).data![0].tenant_id
  const objects = await db.storage.from('email-imports').list(tenant)
  expect(objects.data?.map((o) => o.name)).toEqual([`${sha(exact)}.eml`])
})
