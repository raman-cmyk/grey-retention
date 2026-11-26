import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page } from '@playwright/test'
import { uploadEmails } from '../../features/design-engine/golden/uploads'
import { picture } from '../../features/design-engine/golden/pictures'
import { ENGINE_VERSION, isBare } from '../../features/design-engine/stored'
import { parseBlueprint } from '../../features/design-engine/blueprint'
import { measureUpload } from '../../features/email-uploads/measure'
import { run as measureUploads } from '../../scripts/design-uploads.mjs'
import { newOwner } from './new-owner'

/**
 * DES-ENGINE-003a: "Add your own email", end to end on the local stack
 * (DESIGN_UPLOAD_COPY=on in local runs). The owner uploads an .eml as his
 * brand's own design (its picture inside the file) and an .html as another
 * brand's email; both land in the workspace's private list; the upload
 * measuring browser job (scripts/design-uploads.mjs, here against the
 * local app) reads their designs; the own design keeps its picture, the
 * other brand's keeps none. Another workspace sees neither.
 */

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

/** An .eml whose hero picture is inside the file (`cid:`). */
function ownEml() {
  const hero = picture(600, 300, '#a9c1d9', true).split(',')[1]!
  const html =
    '<!doctype html><html><head><title>Autumn edit</title></head><body style="margin:0">' +
    '<table width="600" align="center" cellpadding="0" cellspacing="0"><tr><td><img src="cid:hero@cedar" width="600" height="300" alt="Autumn" style="display:block"></td></tr>' +
    '<tr><td style="padding:24px;font-family:Arial;font-size:28px;font-weight:700;color:#222222">Layers for quiet weekends</td></tr>' +
    '<tr><td style="padding:0 24px 24px;font-family:Arial;font-size:16px;color:#555555">Soft knits and easy overshirts, made to last.</td></tr></table></body></html>'
  return Buffer.from(
    [
      'From: Cedar Lane <hello@cedar-lane.example>',
      'Subject: Autumn edit',
      'MIME-Version: 1.0',
      'Content-Type: multipart/related; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/html; charset=utf-8',
      '',
      html,
      '--b1',
      'Content-Type: image/png',
      'Content-Transfer-Encoding: base64',
      'Content-ID: <hero@cedar>',
      '',
      hero,
      '--b1--',
      ''
    ].join('\r\n')
  )
}

async function add(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
  design: RegExp,
  name: string
) {
  const form = page.getByRole('region', { name: 'Add an email' })
  await form.getByLabel('Email file (.html or .eml)').setInputFiles(file)
  await form.getByLabel(design).check()
  await form.getByLabel('Name (optional)').fill(name)
  await form.getByRole('button', { name: 'Add email' }).click()
  await expect(
    page.getByText('Added. GROS is reading its design.')
  ).toBeVisible({
    timeout: 30_000
  })
}

test('the owner adds his own design and another brand’s email; they are read and kept private', async ({
  page,
  browser
}, info) => {
  test.skip(
    info.project.name.startsWith('mobile'),
    'One journey of the measuring job is enough; the page is checked on desktop.'
  )
  test.setTimeout(180_000)
  const owner = await newOwner(page, {
    prefix: 'upload',
    name: 'Upload studio'
  })
  const tenant = (await owner.from('tenants').select('id').single()).data!.id
  await page.goto('/inspiration')
  await page.getByRole('link', { name: 'Add your own email' }).click()
  await expect(page).toHaveURL(/\/inspiration\/add$/)
  await expect(
    page.getByText('No emails added yet. Only your workspace sees them.')
  ).toBeVisible()

  const eml = ownEml()
  await add(
    page,
    { name: 'autumn.eml', mimeType: 'message/rfc822', buffer: eml },
    /This is my brand’s own design/,
    'Autumn edit'
  )
  const theirs = uploadEmails.find((e) => e.id === 'up-03-klaviyo-like')!
  await add(
    page,
    {
      name: 'theirs.html',
      mimeType: 'text/html',
      buffer: Buffer.from(theirs.html)
    },
    /This is another brand’s email/,
    'Their sale'
  )
  const list = page.getByRole('list', { name: 'Your emails' })
  await expect(list.getByText('Autumn edit')).toBeVisible()
  await expect(list.getByText('Their sale')).toBeVisible()
  await expect(list.getByText('Reading', { exact: true })).toHaveCount(2)

  // The original file is kept exactly as uploaded.
  const db = admin()
  const rows = await db
    .from('email_uploads')
    .select('id,tenant_id,name,design,state,pictures')
    .eq('tenant_id', tenant)
    .in('name', ['Autumn edit', 'Their sale'])
  expect(rows.error).toBeNull()
  const own = rows.data!.find((r) => r.name === 'Autumn edit')!
  const other = rows.data!.find((r) => r.name === 'Their sale')!
  expect(own.design).toBe('own')
  expect((own.pictures as unknown[]).length).toBe(1)
  expect((other.pictures as unknown[]).length).toBe(0)
  const original = await db.storage
    .from('email-uploads')
    .download(`${own.tenant_id}/${own.id}/original.eml`)
  expect(Buffer.from(await original.data!.arrayBuffer()).equals(eml)).toBe(true)

  // The measuring browser job, against the local app.
  const counts = await measureUploads({
    base: new URL(page.url()).origin,
    secret: readFileSync('.audit/local-cron-secret.txt', 'utf8').trim(),
    browser,
    log: () => undefined,
    engine: ENGINE_VERSION,
    measure: measureUpload
  })
  expect(counts.measured).toBeGreaterThanOrEqual(2)
  await page.reload()
  await expect(
    list.getByText(/Your design · Ready to use · 1 picture kept/)
  ).toBeVisible()
  await expect(
    list.getByText(/Another brand’s email · Ready to use/)
  ).toBeVisible()

  const stored = await db
    .from('email_uploads')
    .select('name,state,blueprint')
    .in('id', [own.id, other.id])
  for (const r of stored.data!) {
    expect(r.state).toBe('ready')
    const bp = parseBlueprint(r.blueprint)
    expect(bp.ok).toBe(true)
    if (!bp.ok) continue
    if (r.name === 'Their sale') expect(isBare(bp.blueprint)).toBe(true)
    else
      expect(JSON.stringify(bp.blueprint)).toContain(
        'https://email-uploads.invalid/0.png'
      )
  }

  // Another workspace sees none of them.
  const context = await browser.newContext()
  const stranger = await context.newPage()
  await newOwner(stranger, { prefix: 'upload-other', name: 'Other studio' })
  await stranger.goto('/inspiration/add')
  await expect(
    stranger.getByText('No emails added yet. Only your workspace sees them.')
  ).toBeVisible()
  await context.close()

  // The owner deletes one: its row and its files go.
  page.once('dialog', (d) => void d.accept())
  await list.getByRole('button', { name: 'Delete: Their sale' }).click()
  await expect(list.getByText('Their sale')).toHaveCount(0)
  await expect
    .poll(
      async () =>
        (
          await db.storage
            .from('email-uploads')
            .list(`${other.tenant_id}/${other.id}`)
        ).data?.map((f) => f.name) ?? [],
      { timeout: 15_000 }
    )
    .toEqual([])
})
