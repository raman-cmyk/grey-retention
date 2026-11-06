import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { login } from './accounts'

const card = (page: Page, title: string) =>
  page.locator('section', {
    has: page.getByRole('heading', { name: title, level: 2, exact: true })
  })

test('UIR-005 owner edits, locks and redoes the Brand profile', async ({
  page
}, info) => {
  await login(page, info.project.name.startsWith('mobile') ? 'other' : 'owner')
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

  // Edit Identity: change the niche and keep it from AI changes.
  const niche = `Original niche ${randomUUID().slice(0, 8)}`
  const identity = card(page, 'Brand Identity')
  await identity.getByRole('button', { name: 'Edit' }).click()
  await identity.getByLabel('Niche', { exact: true }).fill(niche)
  await identity
    .getByRole('checkbox', { name: /AI won’t change niche/ })
    .check()
  await identity.getByRole('button', { name: 'Save Brand Identity' }).click()
  await expect(identity.getByText(/^Saved\./)).toBeVisible()
  await page.reload()
  await expect(card(page, 'Brand Identity').getByText(niche)).toBeVisible()

  // Redo with AI keeps the locked niche and labels the sample honestly.
  await card(page, 'Brand Identity')
    .getByRole('button', { name: 'Redo Brand Identity with AI' })
    .click()
  await expect(
    page.getByText(
      'Sample suggestion applied (not real AI, nothing was spent). Fields you locked were kept.'
    )
  ).toBeVisible()
  await page.reload()
  const redone = card(page, 'Brand Identity')
  await expect(redone.getByText(niche)).toBeVisible()
  await expect(
    redone.getByText(
      'Sample: add how the brand started, in your own words here.'
    )
  ).toBeVisible()
  await expect(redone.getByText(/sample suggestion, not real AI/)).toBeVisible()

  // Changed brand details need the owner's approval again.
  const approve = page.getByRole('button', { name: /^Approve brand v\d+$/ })
  if (await approve.isVisible()) {
    await approve.click()
    await expect(page.getByText('Brand version approved.')).toBeVisible()
    await page.reload()
  }
  await expect(
    page.getByText(/^Approved for AI use · version \d+$/)
  ).toBeVisible()

  // The old Copy & Voice address opens that part of the profile.
  await page.goto('/brand/voice')
  await expect(page).toHaveURL(/\/brand#voice$/)
  await expect(card(page, 'Tone of Voice')).toBeVisible()

  // Store keeps the sub-tabs (old-app fix).
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
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0)
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
  const edit = card(page, 'Audience').getByRole('button', { name: 'Edit' })
  await edit.focus()
  await page.keyboard.press('Enter')
  await expect(
    card(page, 'Audience').getByLabel('Primary persona', { exact: true })
  ).toBeFocused()
  expect(await fits()).toBe(true)
})
