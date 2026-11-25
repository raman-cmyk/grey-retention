import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { test, expect, type Page } from '@playwright/test'
import { login } from './accounts'
import { newOwner } from './new-owner'

// Each card is a region named by its own title.
const card = (page: Page, title: string) =>
  page.getByRole('region', { name: title, exact: true })

test('UIR-005 owner edits, approves, locks and redoes the Brand profile', async ({
  page
}) => {
  // A fresh workspace: brand changes reset campaigns, so never touch the
  // shared accounts here.
  await newOwner(page, { prefix: 'brand', name: 'Brand profile studio' })
  // UI-BRAND-2: Brand is a main page, opened from the top bar (owner
  // decision of 25 Nov); Settings no longer repeats it.
  const menu = page.getByRole('navigation', { name: 'Main' })
  await menu.getByRole('link', { name: 'Brand', exact: true }).click()
  await expect(page).toHaveURL(/\/brand$/)
  await expect(
    page.getByRole('heading', { name: 'Brand', level: 1 })
  ).toBeVisible()
  await expect(page).toHaveTitle(/Brand/)
  await expect(
    menu.getByRole('link', { name: 'Brand', exact: true })
  ).toHaveAttribute('aria-current', 'page')
  // No Store tab in v2.
  await expect(
    page.getByRole('navigation', { name: 'Brand & Store' })
  ).toHaveCount(0)

  // First Identity save creates the brand the agents read.
  const brandName = `Juniper Field ${randomUUID().slice(0, 6)}`
  const niche = `Original niche ${randomUUID().slice(0, 8)}`
  const identity = card(page, 'Brand identity')
  await identity.getByRole('button', { name: 'Edit Brand identity' }).click()
  await identity.getByLabel('Brand name', { exact: true }).fill(brandName)
  await identity
    .getByLabel('Positioning', { exact: true })
    .fill('Quiet layers for long weekends.')
  await identity.getByLabel('Niche', { exact: true }).fill(niche)
  await identity
    .getByRole('checkbox', { name: /AI won’t change niche/ })
    .check()
  await identity.getByRole('button', { name: 'Save brand identity' }).click()
  await expect(
    identity.getByText(/^Saved\. Your brand details changed/)
  ).toBeVisible()
  await expect(
    identity.getByRole('button', { name: 'Edit Brand identity' })
  ).toBeFocused()

  // A new or changed brand always waits for the owner's approval of
  // exactly the version shown.
  const version = card(page, 'Brand version')
  await expect(version.getByText('Needs you')).toBeVisible()
  await version.getByRole('button', { name: 'Approve brand v1' }).click()
  await expect(
    version.getByText('Brand version approved. Rewriting the Brand book.')
  ).toBeVisible()
  await page.reload()
  await expect(page.getByText('Approved for AI use · version 1')).toBeVisible()

  // The Brand book review opens from Brand; it shows where the brand
  // stands but approves nothing itself (UI-BRAND review).
  await card(page, 'Brand book')
    .getByRole('link', { name: 'Review Brand book' })
    .click()
  await expect(page).toHaveURL(/\/brand\/book$/)
  await expect(
    page.getByRole('heading', { name: 'Brand book', level: 1 })
  ).toBeVisible()
  await expect(
    card(page, 'Your brand').getByText('Approved for AI use · version 1')
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /^Approve brand/ })
  ).toHaveCount(0)
  await page.getByRole('link', { name: 'Back to Brand' }).click()
  await expect(page).toHaveURL(/\/brand$/)

  // Notes the agents do not read keep the approval.
  await identity.getByRole('button', { name: 'Edit Brand identity' }).click()
  await identity.getByLabel('Target audience', { exact: true }).fill('')
  await identity.getByRole('button', { name: 'Save brand identity' }).click()
  await expect(identity.getByText('Saved.', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Approved for AI use · version 1')).toBeVisible()

  // Redo with AI only fills empty fields, keeps the owner's words, and
  // labels the sample honestly.
  await card(page, 'Brand identity')
    .getByRole('button', { name: 'Redo with AI: Brand identity' })
    .click()
  await expect(
    page.getByText(
      'Sample text added to 3 empty fields (not real AI, nothing was spent). Your own words and locked fields were kept.'
    )
  ).toBeVisible()
  await page.reload()
  const redone = card(page, 'Brand identity')
  await expect(redone.getByText(niche)).toBeVisible()
  await expect(redone.getByText(brandName)).toBeVisible()
  await expect(
    redone.getByText(
      'Sample: add how the brand started, in your own words here.'
    )
  ).toBeVisible()
  await expect(
    redone.getByText(/Has sample text \(not real AI\)/)
  ).toBeVisible()
  await expect(page.getByText('Approved for AI use · version 1')).toBeVisible()

  // Tone rules are stored as written and need approval again.
  const tone = card(page, 'Tone of voice')
  await tone.getByRole('button', { name: 'Edit Tone of voice' }).click()
  await tone
    .getByLabel('Do', { exact: true })
    .fill(
      'Use U.S. spelling. Write like Mr. Pemberly’s field notes.\nBe brief.'
    )
  await tone.getByRole('button', { name: 'Save tone of voice' }).click()
  await expect(
    tone.getByText(/^Saved\. Your brand details changed/)
  ).toBeVisible()
  await expect(
    tone.getByText('Use U.S. spelling. Write like Mr. Pemberly’s field notes.')
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Approve brand v2' })
  ).toBeVisible()
  // From the Brand book, the owner approves on Brand, where he sees what
  // he approves.
  await page.goto('/brand/book')
  await card(page, 'Your brand')
    .getByRole('link', { name: 'Review and approve' })
    .click()
  await expect(page).toHaveURL(/\/brand#version$/)
  await expect(
    card(page, 'Brand version').getByRole('button', {
      name: 'Approve brand v2'
    })
  ).toBeVisible()

  // The old addresses open the new pages: the old Copy & Voice address
  // (the Tone of voice card), the old Store tab, and the pages' short stay
  // under Settings.
  await page.goto('/brand/voice')
  await expect(page).toHaveURL(/\/brand#tone$/)
  await expect(card(page, 'Tone of voice')).toBeVisible()
  for (const [old, moved] of [
    ['/store', /\/brand$/],
    ['/settings/brand', /\/brand$/],
    ['/settings/brand/book', /\/brand\/book$/],
    ['/settings/assets', /\/brand\/assets$/],
    ['/assets', /\/brand\/assets$/]
  ] as const) {
    await page.goto(old)
    await expect(page, old).toHaveURL(moved)
  }
  await page.goto('/settings')
  await expect(card(page, 'Brand')).toHaveCount(0)
  await expect(card(page, 'Brand assets')).toHaveCount(0)
})

test('UI-BRAND-2 approving rewrites the Brand book, and the owner corrects it', async ({
  page
}) => {
  test.setTimeout(90_000)
  const db = await newOwner(page, { prefix: 'book', name: 'Brand book studio' })
  const tenant = await db.from('tenants').select('id').single()
  expect(tenant.error).toBeNull()
  await page.goto('/brand')
  const identity = card(page, 'Brand identity')
  await identity.getByRole('button', { name: 'Edit Brand identity' }).click()
  await identity
    .getByLabel('Brand name', { exact: true })
    .fill(`Juniper Field ${randomUUID().slice(0, 6)}`)
  await identity
    .getByLabel('Positioning', { exact: true })
    .fill('Quiet layers for long weekends.')
  await identity.getByRole('button', { name: 'Save brand identity' }).click()
  await expect(
    identity.getByText(/^Saved\. Your brand details changed/)
  ).toBeVisible()
  // This journey's store has no readers' findings: a sample store, as the
  // sample setup makes one (test-only, on the disposable local stack), so
  // the code-written book may be saved.
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  expect(
    (
      await service
        .from('brand_profiles')
        .update({ synthetic: true })
        .eq('tenant_id', tenant.data!.id)
    ).error
  ).toBeNull()

  // Approving queues the rewrite and runs it right after the click.
  await card(page, 'Brand version')
    .getByRole('button', { name: 'Approve brand v1' })
    .click()
  await expect(
    page.getByText('Brand version approved. Rewriting the Brand book.')
  ).toBeVisible()
  await page.goto('/brand/book')
  await expect(card(page, 'Rewriting the Brand book')).toHaveCount(0, {
    timeout: 20_000
  })
  await expect(card(page, 'Your words')).toContainText(
    'Quiet layers for long weekends.',
    { timeout: 20_000 }
  )

  // He adds a line of his own: the book is rewritten with it, marked as his.
  const seen = card(page, 'What GROS saw')
  await seen.getByRole('button', { name: 'Add a line: What you sell' }).click()
  await seen
    .getByLabel('New line: What you sell', { exact: true })
    .fill('Linen shirts made in Porto')
  await seen.getByRole('button', { name: /^Add line/ }).click()
  await expect(seen.getByText('Saved. Rewriting the Brand book.')).toBeVisible()
  const sell = card(page, 'What GROS saw').getByRole('list', {
    name: 'What you sell'
  })
  await expect(sell).toContainText('Linen shirts made in Porto', {
    timeout: 20_000
  })
  await expect(sell).toContainText('Your correction')

  // He sets a fact: it is a confirmed fact in his words.
  const facts = card(page, 'Confirmed facts')
  await facts.getByRole('button', { name: 'Correct facts' }).click()
  await facts.getByLabel('Returns', { exact: true }).fill('30')
  await facts.getByRole('button', { name: 'Save facts' }).click()
  await expect(
    card(page, 'Confirmed facts').getByRole('list', { name: 'Confirmed facts' })
  ).toContainText('Returns within 30 daysYour correction', { timeout: 20_000 })
  await expect(card(page, 'Your corrections')).toContainText(
    'What you sellAdded “Linen shirts made in Porto”'
  )

  // A page opened before a rewrite cannot correct the newer book.
  const stale = await db.rpc('correct_brand_book_at', {
    t: tenant.data!.id,
    expected_version: 1,
    corrections: [{ section: 'voice', action: 'add', value: 'Calm.' }]
  })
  expect(stale.error?.code).toBe('PT409')

  // He takes the line back: it is gone after the rewrite.
  page.once('dialog', (dialog) => dialog.accept())
  await card(page, 'Your corrections')
    .getByRole('button', { name: /^Take back: What you sell/ })
    .click()
  await expect(
    card(page, 'What GROS saw').getByRole('list', { name: 'What you sell' })
  ).toHaveCount(0, { timeout: 20_000 })
  await expect(card(page, 'Your corrections')).not.toContainText(
    'Linen shirts made in Porto'
  )
})

test('UIR-005 staff read the Brand profile without edit controls', async ({
  page
}, info) => {
  test.skip(
    info.project.name.startsWith('mobile'),
    'Role check; one layout is enough'
  )
  await login(page, 'staff')
  await page.goto('/brand')
  await expect(card(page, 'Brand identity')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /with AI/ })).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: /^Approve brand/ })
  ).toHaveCount(0)
  await page.goto('/brand/book')
  await expect(
    page.getByRole('heading', { name: 'Brand book', level: 1 })
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /^Approve brand/ })
  ).toHaveCount(0)
})

test('UIR-005 Brand profile fits 375px and edits by keyboard', async ({
  page
}, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Sets its own viewport')
  await page.setViewportSize({ width: 375, height: 812 })
  await login(page, 'owner')
  await page.goto('/brand')
  const fits = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
  expect(await fits()).toBe(true)
  const edit = card(page, 'Audience').getByRole('button', {
    name: 'Edit Audience'
  })
  await edit.focus()
  await page.keyboard.press('Enter')
  await expect(
    card(page, 'Audience').getByLabel('Primary persona', { exact: true })
  ).toBeFocused()
  expect(await fits()).toBe(true)
  await card(page, 'Audience').getByRole('button', { name: 'Cancel' }).click()
  await expect(edit).toBeFocused()
  await page.goto('/brand/book')
  expect(await fits()).toBe(true)
})
