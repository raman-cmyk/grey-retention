import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page, type Browser } from '@playwright/test'
import { libraryCopy } from '../../features/design-engine/library-copy'
import { photoTools } from '../../features/design-engine/photos'
import { ENGINE_VERSION } from '../../features/design-engine/stored'
import { uploadEmails } from '../../features/design-engine/golden/uploads'
import { picture } from '../../features/design-engine/golden/pictures'
import { measureUpload } from '../../features/email-uploads/measure'
import { run as runCopies } from '../../scripts/design-copies.mjs'
import { run as measureUploads } from '../../scripts/design-uploads.mjs'
import { newOwner } from './new-owner'

/**
 * DES-ENGINE-003b: Create email from one of the owner's own uploaded
 * emails, end to end on the local stack (fake providers, DESIGN_UPLOAD_COPY
 * and DESIGN_LIBRARY_COPY on in local runs): the owner uploads an email
 * ("Add your own email"), the measuring job reads it, he clicks Use this
 * design, picks a planned email and clicks Create email; the copy job
 * copies it (his own design keeps its look and its picture, now at a
 * signed link; another brand's email is copied in his brand's look), the
 * email's page says how its design was made, and it is a (sample)
 * Klaviyo draft.
 */

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
const secret = () => readFileSync('.audit/local-cron-secret.txt', 'utf8').trim()

/** An .eml of the owner's own design, its hero picture inside the file. */
function ownEml() {
  const hero = picture(600, 300, '#a9c1d9', true).split(',')[1]!
  const html =
    '<!doctype html><html><head><title>Autumn edit</title></head><body style="margin:0;background:#f4efe6">' +
    '<table width="600" align="center" cellpadding="0" cellspacing="0" style="background:#ffffff"><tr><td><img src="cid:hero@cedar" width="600" height="300" alt="Autumn" style="display:block"></td></tr>' +
    '<tr><td style="padding:24px 24px 8px;font-family:Georgia;font-size:30px;font-weight:700;color:#2b2118"><h1 style="margin:0;font-size:30px">Layers for quiet weekends</h1></td></tr>' +
    '<tr><td style="padding:0 24px 24px;font-family:Arial;font-size:16px;line-height:24px;color:#4a4038">Soft knits and easy overshirts, made to last a long time.</td></tr>' +
    '<tr><td align="center" style="padding:0 24px 32px"><a href="https://cedar-lane.example/" style="display:inline-block;background:#8a5a2b;color:#ffffff;font-family:Arial;font-size:16px;padding:14px 28px;border-radius:4px;text-decoration:none">Shop the edit</a></td></tr>' +
    '<tr><td style="padding:16px 24px;font-family:Arial;font-size:12px;color:#5f5650">Cedar Lane, 1 Example Street. <a href="https://cedar-lane.example/unsubscribe" style="color:#5f5650">Unsubscribe</a></td></tr></table></body></html>'
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

async function addAndMeasure(
  page: Page,
  browser: Browser,
  file: { name: string; mimeType: string; buffer: Buffer },
  design: RegExp,
  name: string
) {
  await page.goto('/inspiration/add')
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
  const counts = await measureUploads({
    base: new URL(page.url()).origin,
    secret: secret(),
    browser,
    log: () => undefined,
    engine: ENGINE_VERSION,
    measure: measureUpload
  })
  expect(counts.measured).toBeGreaterThanOrEqual(1)
  await page.reload()
}

async function plan(page: Page) {
  await page.goto('/plan')
  await page.getByRole('button', { name: 'Plan next 15 days' }).click()
  await expect(
    page.getByRole('heading', { name: 'Which offers should we run?' })
  ).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Plan the 15 days' }).click()
  await expect(
    page.getByRole('heading', { name: 'Your next 15 days' })
  ).toBeVisible({
    timeout: 30_000
  })
}

/** The copy browser job against the local app; product photos cut by a stand-in. */
async function copy(page: Page, browser: Browser) {
  return runCopies({
    base: new URL(page.url()).origin,
    secret: secret(),
    browser,
    log: () => undefined,
    engine: ENGINE_VERSION,
    copy: libraryCopy,
    tools: (origins) => {
      const real = photoTools(browser, { origins })
      return {
        sizeOf: async (src) => {
          const got = await real.sizeOf(src)
          return 'failed' in got ? { width: 1000, height: 703 } : got
        },
        cropTo: async (photo, width, height) => {
          const p = await browser.newPage()
          try {
            const src = await p.evaluate(
              ([w, h]) => {
                const c = document.createElement('canvas')
                c.width = w!
                c.height = h!
                const g = c.getContext('2d')!
                g.fillStyle = '#6f8f5f'
                g.fillRect(0, 0, w!, h!)
                return c.toDataURL('image/jpeg', 0.8)
              },
              [Math.round(width), Math.round(height)]
            )
            return { ...photo, src, width, height }
          } finally {
            await p.close()
          }
        }
      }
    }
  })
}

async function createFrom(page: Page, uploadName: string) {
  await page.goto('/inspiration/add')
  const list = page.getByRole('list', { name: 'Your emails' })
  await list
    .getByRole('listitem')
    .filter({ hasText: uploadName })
    .getByRole('link', { name: 'Use this design' })
    .click()
  await expect(page).toHaveURL(/\/inspiration\/use\?upload=/)
  const pick = page.getByRole('region', { name: 'Choose a planned email' })
  await pick.getByRole('button', { name: 'Create email' }).click()
  await expect(page).toHaveURL(/\/plan\/email\/[0-9a-f-]{36}$/, {
    timeout: 30_000
  })
  return page.url().split('/').at(-1)!
}

async function waitForCopyAsked(buildId: string) {
  const db = admin()
  await expect
    .poll(
      async () =>
        (
          await db
            .from('email_copies')
            .select('state')
            .eq('build_id', buildId)
            .maybeSingle()
        ).data?.state,
      { timeout: 60_000 }
    )
    .toBe('queued')
}

async function drafted(page: Page, buildId: string, words: RegExp) {
  await expect(async () => {
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'The design you chose' })
    ).toBeVisible()
  }).toPass({ timeout: 60_000 })
  await expect(page.getByText(words).first()).toBeVisible()
  await expect(
    page.getByText(
      'Klaviyo is not connected yet, so this is a sample draft: nothing was sent to Klaviyo.'
    )
  ).toBeVisible()
  const built = await admin()
    .from('email_builds')
    .select('state,email,upload_id')
    .eq('id', buildId)
    .single()
  expect(built.data!.state).toBe('drafted')
  return built.data!.email as { html: string; library?: { upload?: string } }
}

test('the owner’s own design: Use this design keeps its look with the new words, and lands as a draft', async ({
  page,
  browser
}, info) => {
  test.skip(
    info.project.name.startsWith('mobile'),
    'One journey of the browser jobs is enough.'
  )
  test.setTimeout(300_000)
  await newOwner(page, { prefix: 'upcopy', name: 'Upload copy studio' })
  await addAndMeasure(
    page,
    browser,
    { name: 'autumn.eml', mimeType: 'message/rfc822', buffer: ownEml() },
    /This is my brand’s own design/,
    'Autumn edit'
  )
  await plan(page)
  const buildId = await createFrom(page, 'Autumn edit')
  await waitForCopyAsked(buildId)
  const copy0 = await admin()
    .from('email_copies')
    .select('input,upload_id')
    .eq('build_id', buildId)
    .single()
  expect((copy0.data!.input as { keepLook?: boolean }).keepLook).toBe(true)
  const counts = await copy(page, browser)
  expect(counts).toMatchObject({ failed: 0, skew: false })
  expect(counts.carried).toBe(1)
  const email = await drafted(page, buildId, /Your own design was kept/)
  expect(email.library?.upload).toBe('own')
  // Its look: the file's own colours and its own picture, now hosted at a
  // signed link (the push imports it into Klaviyo); the file's old words
  // replaced by the email's own.
  expect(email.html).toContain('#8a5a2b')
  expect(email.html).toContain('#f4efe6')
  expect(email.html).toMatch(/\/email-uploads\/[^"]+\/picture-0\.png\?token=/)
  expect(email.html).not.toContain('email-uploads.invalid')
  expect(email.html).not.toContain('Layers for quiet weekends')
  expect(email.html).toContain('{% unsubscribe')
})

test('another brand’s email: Use this design copies its layout in the brand’s look, and lands as a draft', async ({
  page,
  browser
}, info) => {
  test.skip(
    info.project.name.startsWith('mobile'),
    'One journey of the browser jobs is enough.'
  )
  test.setTimeout(300_000)
  await newOwner(page, { prefix: 'upother', name: 'Upload other studio' })
  const theirs = uploadEmails.find((e) => e.id === 'up-03-klaviyo-like')!
  await addAndMeasure(
    page,
    browser,
    {
      name: 'theirs.html',
      mimeType: 'text/html',
      buffer: Buffer.from(theirs.html)
    },
    /This is another brand’s email/,
    'Their sale'
  )
  await plan(page)
  const buildId = await createFrom(page, 'Their sale')
  await waitForCopyAsked(buildId)
  const counts = await copy(page, browser)
  expect(counts).toMatchObject({ failed: 0, skew: false })
  const email = await drafted(page, buildId, /copied from the email you added/)
  expect(email.library?.upload).toBe('other')
  expect(email.html).not.toContain('email-uploads.invalid')
  expect(email.html).toContain('{% unsubscribe')
})
