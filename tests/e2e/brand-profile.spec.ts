import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { login } from './accounts'
import { newOwner } from './new-owner'

// Each card is a region named by its own heading.
const card = (page: Page, title: string) =>
  page.getByRole('region', { name: title, exact: true })

test('UIR-005 owner edits, approves, locks and redoes the Brand profile', async ({
  page
}, info) => {
  // A fresh workspace: brand changes reset campaigns, so never touch the
  // shared accounts here.
  await newOwner(page, { prefix: 'brand', name: 'Brand profile studio' })
  await page.goto('/brand')
  await expect(
    page.getByRole('heading', { name: 'Brand & Store', level: 1 })
  ).toBeVisible()
  await expect(page).toHaveTitle(/Brand Intelligence/)
  await expect(
    page
      .getByRole('navigation', { name: 'Brand & Store' })
      .getByRole('link', { name: 'Brand profile', exact: true })
  ).toHaveAttribute('aria-current', 'page')

  // First Identity save creates the brand the AI reads.
  const brandName = `Juniper Field ${randomUUID().slice(0, 6)}`
  const niche = `Original niche ${randomUUID().slice(0, 8)}`
  const identity = card(page, 'Brand Identity')
  await identity.getByRole('button', { name: 'Edit Brand Identity' }).click()
  await identity.getByLabel('Brand name', { exact: true }).fill(brandName)
  await identity
    .getByLabel('Positioning', { exact: true })
    .fill('Quiet layers for long weekends.')
  await identity.getByLabel('Niche', { exact: true }).fill(niche)
  await identity
    .getByRole('checkbox', { name: /AI won’t change niche/ })
    .check()
  await identity.getByRole('button', { name: 'Save Brand Identity' }).click()
  await expect(
    identity.getByText(/^Saved\. Your brand details changed/)
  ).toBeVisible()
  await expect(
    identity.getByRole('button', { name: 'Edit Brand Identity' })
  ).toBeFocused()

  // A new or changed brand always waits for the owner's approval.
  await page.getByRole('button', { name: 'Approve brand v1' }).click()
  await expect(page.getByText('Brand version approved.')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Approved for AI use · version 1')).toBeVisible()

  // Notes the AI does not read keep the approval.
  await identity.getByRole('button', { name: 'Edit Brand Identity' }).click()
  await identity.getByLabel('Target audience', { exact: true }).fill('')
  await identity.getByRole('button', { name: 'Save Brand Identity' }).click()
  await expect(identity.getByText('Saved.', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Approved for AI use · version 1')).toBeVisible()

  // Redo with AI only fills empty fields, keeps the owner's words, and
  // labels the sample honestly.
  await card(page, 'Brand Identity')
    .getByRole('button', { name: 'Redo Brand Identity with AI' })
    .click()
  await expect(
    page.getByText(
      'Sample text added to 3 empty fields (not real AI, nothing was spent). Your own words and locked fields were kept.'
    )
  ).toBeVisible()
  await page.reload()
  const redone = card(page, 'Brand Identity')
  await expect(redone.getByText(niche)).toBeVisible()
  await expect(redone.getByText(brandName)).toBeVisible()
  await expect(
    redone.getByText(
      'Sample: add how the brand started, in your own words here.'
    )
  ).toBeVisible()
  await expect(
    redone.getByText(/has sample text \(not real AI\)/)
  ).toBeVisible()
  await expect(page.getByText('Approved for AI use · version 1')).toBeVisible()

  // Tone rules are stored as written and need approval again.
  const tone = card(page, 'Tone of Voice')
  await tone.getByRole('button', { name: 'Edit Tone of Voice' }).click()
  await tone
    .getByLabel('Do', { exact: true })
    .fill('Use U.S. spelling. Write like Dr. Bronner’s label.\nBe brief.')
  await tone.getByRole('button', { name: 'Save Tone of Voice' }).click()
  await expect(
    tone.getByText(/^Saved\. Your brand details changed/)
  ).toBeVisible()
  await expect(
    tone.getByText('Use U.S. spelling. Write like Dr. Bronner’s label.')
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Approve brand v2' })
  ).toBeVisible()

  // The old Copy & Voice address opens that part of the profile.
  await page.goto('/brand/voice')
  await expect(page).toHaveURL(/\/brand#voice$/)
  await expect(card(page, 'Tone of Voice')).toBeVisible()

  // Store keeps the sub-tabs, and the sidebar still marks Brand & Store.
  const tabs = page.getByRole('navigation', { name: 'Brand & Store' })
  await tabs.getByRole('link', { name: 'Store', exact: true }).click()
  await expect(page).toHaveURL(/\/store$/)
  await expect(page).toHaveTitle(/Store Intelligence/)
  await expect(
    tabs.getByRole('link', { name: 'Brand profile', exact: true })
  ).toBeVisible()
  await expect(
    page
      .getByRole('heading', {
        name: 'Connect Shopify to see Store Intelligence'
      })
      .or(page.getByRole('heading', { name: 'Store Intelligence' }))
  ).toBeVisible()
  if (!info.project.name.startsWith('mobile'))
    // The sidebar (not the tabs) marks Brand & Store as the current area.
    await expect(
      page.locator('nav a[href="/brand"][aria-current="page"]').first()
    ).toBeVisible()
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
  await expect(card(page, 'Brand Identity')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /with AI$/ })).toHaveCount(0)
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
})
