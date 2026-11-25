import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import {
  desktopWindow,
  measureHtml
} from '../../features/design-engine/browser'
import { libraryCopy } from '../../features/design-engine/library-copy'
import { blueprintFrom } from '../../features/design-engine/measure'
import { photoTools } from '../../features/design-engine/photos'
import { ENGINE_VERSION, forStorage } from '../../features/design-engine/stored'
import { libraryEmails } from '../../features/design-engine/golden/library'
import { run as runCopies } from '../../scripts/design-copies.mjs'
import { newOwner } from './new-owner'

/**
 * DES-ENGINE-002b2: "Use this design" with Copy, end to end on the local
 * stack (fake providers, DESIGN_LIBRARY_COPY=on in local runs). A followed
 * brand's tagged email with its measured blueprint is chosen; Create email
 * waits for its copy; the copy browser job (scripts/design-copies.mjs,
 * here against the local app) copies it for the brand, uploads its cut
 * photos and carries the email on; the email's page says which sections
 * were built from a library block and why, and the email is a (sample)
 * Klaviyo draft.
 */

/** A sample brand's website, unique to the run (letters only). */
const sampleDomain = (name: string) =>
  `${name}-${randomBytes(4)
    .toString('hex')
    .replace(/[0-9]/g, (d) => 'ghijklmnop'[Number(d)]!)}.example`

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

test('Use this design with Copy copies the chosen email for the brand, says which sections were built from a library block, and lands as a draft', async ({
  page,
  browser
}, info) => {
  test.skip(
    info.project.name.startsWith('mobile'),
    'One journey of the browser job is enough; the page is checked on desktop.'
  )
  test.setTimeout(240_000)
  await newOwner(page, { prefix: 'copy', name: 'Copy studio' })
  // Follow a brand from Inspiration.
  await page.goto('/inspiration')
  const domain = sampleDomain('copying')
  await page.getByLabel('Brand website', { exact: true }).fill(domain)
  await page.getByRole('button', { name: 'Follow', exact: true }).click()
  await expect(page.getByText(`Following ${domain}.`)).toBeVisible()

  // One of its emails, read by the inbox: stored, tagged, photographed and
  // measured (the inbox jobs' work, done here on the local database).
  const db = admin()
  const capture = await db
    .from('competitor_captures')
    .select('id')
    .eq('domain', domain)
    .single()
  expect(capture.error).toBeNull()
  await db
    .from('competitor_captures')
    .update({ brand_name: 'Rival Studio' })
    .eq('id', capture.data!.id)
  const source = libraryEmails.find((e) => e.id === 'lib-04-offer-code')!
  const key = createHash('sha256').update(randomUUID()).digest('hex')
  const markedPath = `fake/${key}.marked.html`
  expect(
    (
      await db.storage
        .from('inbox-raw')
        .upload(markedPath, Buffer.from(source.html), {
          contentType: 'text/html'
        })
    ).error
  ).toBeNull()
  await db
    .from('inbox_mailboxes')
    .upsert({ key: 'fake', transport: 'fake' }, { onConflict: 'key' })
  const mailbox = await db
    .from('inbox_mailboxes')
    .select('id')
    .eq('key', 'fake')
    .single()
  const message = await db
    .from('inbox_messages')
    .insert({
      mailbox_id: mailbox.data!.id,
      message_key: key,
      uidvalidity: 1,
      uid: Math.floor(Math.random() * 1e9),
      raw_bytes: source.html.length,
      subject: 'The offer is on',
      received_at: new Date().toISOString(),
      synthetic: true,
      state: 'too_large',
      marked_html_path: markedPath,
      screenshot_at: new Date().toISOString()
    })
    .select('id')
    .single()
  expect(message.error).toBeNull()
  const email = await db
    .from('competitor_emails')
    .insert({
      capture_id: capture.data!.id,
      external_id: `msg:copy-${key.slice(0, 12)}`,
      received_at: new Date().toISOString(),
      subject: 'The offer is on',
      text_content: 'The offer is on',
      safe_html: '<p>The offer is on</p>',
      micro: {},
      synthetic: true,
      inbox_message_id: message.data!.id,
      labels_state: 'tagged',
      industry: 'home',
      email_type: 'sale',
      angle: 'value',
      offer_type: 'percent_off',
      season: 'none',
      brand_size: 'small',
      labels_confidence: 0.9,
      labels_pass: 'sample'
    })
    .select('id')
    .single()
  expect(email.error).toBeNull()
  const labelled = {
    label_source: 'sample',
    labelled_at: new Date().toISOString()
  }
  const sections = [
    ['header_logo', 90],
    ['hero_image', 420],
    ['offer_banner', 160],
    ['product_grid_2col', 520],
    ['footer', 180]
  ] as const
  expect(
    (
      await db.from('email_sections').insert(
        sections.map(([block, height], i) => ({
          inbox_message_id: message.data!.id,
          ordinal: i + 1,
          html: '<p>section</p>',
          kind: 'design',
          words: 1,
          images: 0,
          block_type: block,
          height,
          ...labelled
        }))
      )
    ).error
  ).toBeNull()
  // Its blueprint, measured as the blueprint job measures it.
  const opened = await measureHtml(browser, source.html, desktopWindow)
  if (!opened.ok) throw new Error(opened.error)
  const measured = blueprintFrom(opened.measurement)
  if (!measured.ok) throw new Error(measured.error)
  const claimed = await db.rpc('claim_platform_job', {
    kinds: ['inbox.blueprint'],
    subject: message.data!.id
  })
  const bjob = (claimed.data as { id: string; lease_token: string }[])[0]!
  expect(
    (
      await db.rpc('record_inbox_blueprint', {
        job: bjob.id,
        lease: bjob.lease_token,
        blueprint: forStorage(measured.blueprint) as never
      })
    ).error
  ).toBeNull()

  // A plan, then "Use this design" with Copy.
  await page.goto(`/inspiration/use?reference=${email.data!.id}`)
  await expect(page.getByRole('heading', { name: 'No plan yet' })).toBeVisible()
  await page.getByRole('button', { name: 'Plan next 15 days' }).click()
  await expect(
    page.getByRole('heading', { name: 'Which offers should we run?' })
  ).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Plan the 15 days' }).click()
  await expect(
    page.getByRole('heading', { name: 'Your next 15 days' })
  ).toBeVisible({ timeout: 30_000 })
  await page.goto(`/inspiration/use?reference=${email.data!.id}`)
  const pick = page.getByRole('region', { name: 'Choose a planned email' })
  await pick.getByLabel('Copy this email').check()
  await pick.getByRole('button', { name: 'Create email' }).click()
  await expect(page).toHaveURL(/\/plan\/email\/[0-9a-f-]{36}$/, {
    timeout: 30_000
  })
  const buildId = page.url().split('/').at(-1)!

  // The design step asks for its copy and waits for it.
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
  const copy = await db
    .from('email_copies')
    .select('input')
    .eq('build_id', buildId)
    .single()
  // Never where photos may come from: that is the server's own list.
  expect(copy.data!.input).not.toHaveProperty('origins')

  // The copy browser job, against the local app.
  const counts = await runCopies({
    base: new URL(page.url()).origin,
    secret: readFileSync('.audit/local-cron-secret.txt', 'utf8').trim(),
    browser,
    log: () => undefined,
    engine: ENGINE_VERSION,
    copy: libraryCopy,
    tools: (origins) => photoTools(browser, { origins })
  })
  expect(counts).toMatchObject({ copied: 1, failed: 0, skew: false })
  expect(counts.carried).toBe(1)

  // The email's page: the copy, and which sections were built from a
  // library block and why, in plain words; a draft (the sample store's).
  await expect(async () => {
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'The design you chose' })
    ).toBeVisible()
  }).toPass({ timeout: 60_000 })
  await expect(
    page.getByText(/copied from the email you chose in Inspiration/).first()
  ).toBeVisible()
  await expect(
    page.getByText(/^Section \d+ \([a-z_ ]+\) .*(library|left out)/).first()
  ).toBeVisible()
  await expect(
    page.getByText(
      'Klaviyo is not connected yet, so this is a sample draft: nothing was sent to Klaviyo.'
    )
  ).toBeVisible()
  const built = await db
    .from('email_builds')
    .select('state,email')
    .eq('id', buildId)
    .single()
  expect(built.data!.state).toBe('drafted')
  const stored = built.data!.email as {
    html: string
    library?: { sections: unknown[] }
  }
  expect(stored.library?.sections.length).toBeGreaterThan(0)
  // The brand's copy: none of the other brand's words, and Klaviyo's tags.
  expect(stored.html).not.toContain('Rival Studio')
  expect(stored.html).not.toContain('email-copies.invalid')
  expect(stored.html).toContain('{% unsubscribe')
  await page.screenshot({
    path: `.audit/library-copy-${info.project.name}.png`,
    fullPage: true
  })
})
